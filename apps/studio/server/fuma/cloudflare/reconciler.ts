import { Type, Value } from '@core/utils/typeboxHelpers'
import { normalizePublicHost } from '../freeHosts/service'
import type { DomainRecord, DomainService } from '../domains/service'

export type DnsInstruction = Readonly<{ type: 'CNAME' | 'TXT' | 'A'; name: string; value: string; purpose: 'routing' | 'ownership' | 'tls-validation' }>
export type CloudflareHostname = Readonly<{
  id: string
  hostname: string
  status: 'pending' | 'active' | 'blocked' | 'deleted'
  sslStatus: 'pending' | 'active' | 'failed'
  ownershipRecords: readonly DnsInstruction[]
  validationRecords: readonly DnsInstruction[]
}>
export interface CloudflareSaasAdapter {
  create(hostname: string, idempotencyKey: string): Promise<CloudflareHostname>
  read(id: string): Promise<CloudflareHostname>
  delete(id: string, idempotencyKey: string): Promise<void>
  purge(hostname: string): Promise<void>
}
export type ApexCapability = Readonly<{
  alias: boolean
  aname: boolean
  cnameFlattening: boolean
  registrarRedirect: boolean
  enterpriseApex: boolean
  actualQuoteApproved: boolean
  securityReviewApproved: boolean
  marginGatePassed: boolean
}>

const DnsInstructionSchema = Type.Object({
  type: Type.Union([Type.Literal('CNAME'), Type.Literal('TXT'), Type.Literal('A')]),
  name: Type.String({ minLength: 1, maxLength: 253 }),
  value: Type.String({ minLength: 1, maxLength: 2048 }),
  purpose: Type.Union([Type.Literal('routing'), Type.Literal('ownership'), Type.Literal('tls-validation')]),
}, { additionalProperties: false })
const CloudflareHostnameSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 255 }),
  hostname: Type.String({ minLength: 1, maxLength: 253 }),
  status: Type.Union([Type.Literal('pending'), Type.Literal('active'), Type.Literal('blocked'), Type.Literal('deleted')]),
  sslStatus: Type.Union([Type.Literal('pending'), Type.Literal('active'), Type.Literal('failed')]),
  ownershipRecords: Type.Array(DnsInstructionSchema, { maxItems: 20 }),
  validationRecords: Type.Array(DnsInstructionSchema, { maxItems: 20 }),
}, { additionalProperties: false })

export class CloudflareReconcileError extends Error {
  readonly code: 'unsupported-apex' | 'tls-pending' | 'provider' | 'inactive';
  readonly alternatives: readonly string[];
  constructor(code: 'unsupported-apex' | 'tls-pending' | 'provider' | 'inactive', message: string, alternatives: readonly string[] = []) {
    super(message); this.code = code; this.alternatives = alternatives;
    this.name = 'CloudflareReconcileError'
  }
}

export function assertDomainRouteActive(domain: DomainRecord): void {
  if (domain.desired !== 'active' || domain.observed !== 'active' || domain.certificate !== 'active') {
    throw new CloudflareReconcileError('inactive', 'Custom hostname cannot route before ownership and TLS are active.')
  }
}

function isApex(hostname: string): boolean {
  const labels = hostname.split('.')
  return hostname.endsWith('.co.ke') ? labels.length === 3 : labels.length === 2
}
function exactProviderState(expectedHostname: string, value: unknown): CloudflareHostname {
  if (!Value.Check(CloudflareHostnameSchema, value)) throw new CloudflareReconcileError('provider', 'Cloudflare returned an invalid custom-hostname contract.')
  const provider = value as CloudflareHostname
  if (normalizePublicHost(provider.hostname) !== expectedHostname) throw new CloudflareReconcileError('provider', 'Cloudflare returned a hostname for another domain.')
  return Object.freeze(structuredClone(provider))
}

export class CloudflareSaasReconciler {
  private readonly adapter: CloudflareSaasAdapter;
  private readonly domains: DomainService;
  constructor(adapter: CloudflareSaasAdapter, domains: DomainService) { this.adapter = adapter; this.domains = domains;}

  instructions(hostnameInput: string, providerInput: CloudflareHostname): readonly DnsInstruction[] {
    const hostname = normalizePublicHost(hostnameInput)
    const provider = exactProviderState(hostname, providerInput)
    const records = [...provider.ownershipRecords, ...provider.validationRecords, { type: 'CNAME', name: hostname, value: 'customers.fuma.co.ke', purpose: 'routing' } as const]
    const unique = new Map<string, DnsInstruction>()
    for (const record of records) {
      if (!Value.Check(DnsInstructionSchema, record)) throw new CloudflareReconcileError('provider', 'Cloudflare returned an invalid DNS instruction.')
      const normalized = Object.freeze({ ...record, name: normalizePublicHost(record.name) })
      const key = `${normalized.type}:${normalized.name}:${normalized.purpose}`
      const existing = unique.get(key)
      if (existing && existing.value !== normalized.value) throw new CloudflareReconcileError('provider', 'Cloudflare returned conflicting DNS instructions.')
      unique.set(key, normalized)
    }
    return Object.freeze([...unique.values()])
  }

  assertApex(hostnameInput: string, capability: ApexCapability): void {
    const hostname = normalizePublicHost(hostnameInput)
    if (!isApex(hostname)) return
    const alternatives = [
      capability.alias ? 'ALIAS' : null,
      capability.aname ? 'ANAME' : null,
      capability.cnameFlattening ? 'CNAME flattening' : null,
      capability.registrarRedirect ? 'registrar redirect to www' : null,
    ].filter((value): value is string => value !== null)
    const enterpriseApproved = capability.enterpriseApex
      && capability.actualQuoteApproved
      && capability.securityReviewApproved
      && capability.marginGatePassed
    if (!enterpriseApproved) {
      throw new CloudflareReconcileError(
        'unsupported-apex',
        'Universal apex proxying is blocked until Enterprise quote, security, cost, and margin gates all pass.',
        Object.freeze(alternatives),
      )
    }
  }

  async prevalidate(domain: DomainRecord, capability: ApexCapability): Promise<Readonly<{ provider: CloudflareHostname; records: readonly DnsInstruction[]; customerAccountRequired: false; customerTokenRequired: false }>> {
    const hostname = normalizePublicHost(domain.hostname)
    this.assertApex(hostname, capability)
    const provider = exactProviderState(hostname, await this.adapter.create(hostname, `cf-create:${domain.domainId}`))
    if (provider.status === 'deleted') throw new CloudflareReconcileError('provider', 'Cloudflare returned a deleted hostname during prevalidation.')
    await this.domains.transition(
      domain.domainId,
      'prevalidated',
      provider.status === 'blocked' ? 'failed' : provider.sslStatus === 'active' ? 'pending-tls' : 'pending-dns',
      provider.sslStatus === 'active' ? 'active' : provider.sslStatus === 'failed' ? 'failed' : 'pending',
      'cloudflare-reconciler',
    )
    return Object.freeze({
      provider,
      records: this.instructions(hostname, provider),
      customerAccountRequired: false as const,
      customerTokenRequired: false as const,
    })
  }

  async reconcile(domain: DomainRecord, providerId: string): Promise<CloudflareHostname> {
    const hostname = normalizePublicHost(domain.hostname)
    const state = exactProviderState(hostname, await this.adapter.read(providerId))
    if (state.status === 'active' && state.sslStatus === 'active') {
      await this.domains.transition(domain.domainId, 'active', 'active', 'active', 'cloudflare-reconciler')
    } else if (state.status === 'blocked' || state.sslStatus === 'failed') {
      await this.domains.transition(domain.domainId, 'prevalidated', 'failed', state.sslStatus === 'failed' ? 'failed' : 'pending', 'cloudflare-reconciler')
    }
    return state
  }

  async rollback(domain: DomainRecord): Promise<void> {
    await this.domains.transition(domain.domainId, 'detached', 'unknown', 'none', 'cloudflare-reconciler')
    await this.adapter.purge(normalizePublicHost(domain.hostname))
  }

  async remove(domain: DomainRecord, providerId: string): Promise<void> {
    const provider = exactProviderState(normalizePublicHost(domain.hostname), await this.adapter.read(providerId))
    if (provider.status !== 'deleted') await this.adapter.delete(providerId, `cf-delete:${domain.domainId}`)
    await this.domains.transition(domain.domainId, 'deleted', 'deleted', 'none', 'cloudflare-reconciler')
    await this.adapter.purge(normalizePublicHost(domain.hostname))
  }

  async reconcileHostnameMeter(observedCount: number, ledgerCount: number, settle: (delta: number, costUsdCents: number) => Promise<void>) {
    const observed = this.hostnameCost(observedCount)
    this.hostnameCost(ledgerCount)
    const delta = observedCount - ledgerCount
    if (delta !== 0) await settle(delta, observed.totalUsdCents)
    return observed
  }

  hostnameCost(count: number) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 50_000) {
      throw new CloudflareReconcileError('provider', 'Cloudflare hostname count is invalid or exceeds the 50,000 PAYG maximum.')
    }
    return Object.freeze({ included: 100, paygMaximum: 50_000, additional: Math.max(0, count - 100), unitUsdCents: 10, totalUsdCents: Math.max(0, count - 100) * 10, baselineDate: '2026-07-23' })
  }
}

export class FakeCloudflareSaasAdapter implements CloudflareSaasAdapter {
  readonly records = new Map<string, CloudflareHostname>()
  readonly purged: string[] = []
  async create(hostname: string, _idempotencyKey: string) {
    const id = `cf:${hostname}`
    const old = this.records.get(id)
    if (old) return old
    const value: CloudflareHostname = Object.freeze({
      id,
      hostname,
      status: 'pending',
      sslStatus: 'pending',
      ownershipRecords: Object.freeze([{ type: 'TXT', name: `_cf-custom-hostname.${hostname}`, value: `verify-${hostname}`, purpose: 'ownership' } as const]),
      validationRecords: Object.freeze([{ type: 'TXT', name: `_acme-challenge.${hostname}`, value: `tls-${hostname}`, purpose: 'tls-validation' } as const]),
    })
    this.records.set(id, value)
    return value
  }
  async read(id: string) {
    const value = this.records.get(id)
    if (!value) throw new CloudflareReconcileError('provider', 'Hostname missing.')
    return value
  }
  async delete(id: string, _idempotencyKey: string) {
    const value = await this.read(id)
    this.records.set(id, Object.freeze({ ...value, status: 'deleted' }))
  }
  async purge(hostname: string) { this.purged.push(hostname) }
  activate(id: string) {
    const value = this.records.get(id)
    if (value) this.records.set(id, Object.freeze({ ...value, status: 'active', sslStatus: 'active' }))
  }
}
