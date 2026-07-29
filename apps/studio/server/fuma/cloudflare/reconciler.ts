import { Value } from '@core/utils/typeboxHelpers'
import { DomainService, assertDomainState, type DomainRecord } from '../domains/service'
import { DomainScopeSchema, sameDomainScope, type CertificateState, type DomainDesiredState, type DomainObservedState, type DomainScope } from '../domains/contracts'
import { type CloudflareSaasAdapter, FakeCloudflareSaasAdapter } from './adapter'
import {
  ApexCapabilitySchema, CloudflareEventSchema, CloudflareHostnameSchema, CloudflareObservedDnsSchema,
  CloudflarePrevalidationSchema, DnsInstructionSchema, parseCloudflareContract,
  type ApexCapability, type CloudflareBinding, type CloudflareDiagnostic, type CloudflareEvent,
  type CloudflareHostname, type CloudflarePrevalidation, type DnsInstruction,
} from './contracts'
import { MemoryCloudflareStateRepository, type CloudflareStateRepository } from './repository'

export * from './contracts'
export * from './adapter'
export * from './repository'

export type CloudflareDomainTransition = Readonly<{
  scope: DomainScope
  current: DomainRecord
  operationId: string
  desired: DomainDesiredState
  observed: DomainObservedState
  certificate: CertificateState
  actorId: string
  reasonCode: string
  occurredAt: string
}>
/** Final FUMA-059 integration seam: exact scope plus one strict command, never positional tenant inference. */
export interface CloudflareDomainTransitionPort { transition(input: CloudflareDomainTransition): Promise<void> }
export class DomainServiceCloudflareTransitionPort implements CloudflareDomainTransitionPort {
  readonly service: Pick<DomainService, 'transition'>
  constructor(service: Pick<DomainService, 'transition'>) { this.service = service }
  async transition(input: CloudflareDomainTransition): Promise<void> {
    await this.service.transition(input.scope, {
      operationId: input.operationId, domainId: input.current.domainId,
      expectedVersion: input.current.version, expectedFence: input.current.operationFence,
      desired: input.desired, observed: input.observed, certificate: input.certificate,
      actorId: input.actorId, reasonCode: input.reasonCode, occurredAt: input.occurredAt,
    })
  }
}

export class CloudflareReconcileError extends Error {
  readonly code: 'unsupported-apex' | 'tls-pending' | 'provider' | 'inactive' | 'scope' | 'stale' | 'state'
  readonly alternatives: readonly string[]
  constructor(code: CloudflareReconcileError['code'], message: string, alternatives: readonly string[] = []) {
    super(message); this.name = 'CloudflareReconcileError'; this.code = code; this.alternatives = alternatives
  }
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}
function digest(value: unknown): string { return new Bun.CryptoHasher('sha256').update(canonical(value)).digest('hex') }
function operationId(action: string, domainId: string, identity: string | number): string { return `cf.${action}.${domainId}.${identity}` }
function timestamp(now: () => Date): string {
  const value = now(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new CloudflareReconcileError('state', 'Cloudflare clock is invalid.')
  return value.toISOString()
}
function isApex(hostname: string): boolean {
  const labels = hostname.split('.')
  return hostname.endsWith('.co.ke') ? labels.length === 3 : labels.length === 2
}
function scopeRecord(scope: DomainScope, domain: DomainRecord): void {
  if (!Value.Check(DomainScopeSchema, scope) || !sameDomainScope(scope, domain)) throw new CloudflareReconcileError('scope', 'Exact domain scope authority is required.')
  assertDomainState(domain)
}
function exactProviderState(expectedHostname: string, value: unknown): CloudflareHostname {
  const provider = parseCloudflareContract(CloudflareHostnameSchema, value, 'Cloudflare hostname') as CloudflareHostname
  if (provider.hostname !== expectedHostname) throw new CloudflareReconcileError('provider', 'Cloudflare returned a hostname for another domain.')
  return provider
}
export function assertDomainRouteActive(domain: DomainRecord): void {
  if (domain.desired !== 'active' || domain.observed !== 'active' || domain.certificate !== 'active') {
    throw new CloudflareReconcileError('inactive', 'Custom hostname cannot route before ownership, explicit cutover, and TLS are active.')
  }
}

type TargetState = Readonly<{ lifecycle: CloudflareBinding['lifecycle']; desired: DomainDesiredState; observed: DomainObservedState; certificate: CertificateState; reason: string }>
function providerTarget(domain: DomainRecord, provider: CloudflareHostname): TargetState {
  if (provider.status === 'blocked' || provider.sslStatus === 'failed') return {
    lifecycle: 'failed', desired: domain.desired === 'active' ? 'active' : 'validating', observed: 'degraded', certificate: 'failed', reason: 'provider-failed',
  }
  if (!provider.ownershipVerified || provider.status !== 'active') return domain.desired === 'active'
    ? { lifecycle: 'failed', desired: 'active', observed: 'degraded', certificate: domain.certificate === 'active' ? 'expiring' : 'provisioning', reason: 'dns-degraded' }
    : { lifecycle: 'awaiting-dns', desired: 'validating', observed: 'dns-pending', certificate: 'provisioning', reason: 'dns-pending' }
  if (provider.sslStatus !== 'active') return domain.desired === 'active'
    ? { lifecycle: 'failed', desired: 'active', observed: 'degraded', certificate: domain.certificate === 'active' ? 'expiring' : 'provisioning', reason: 'tls-degraded' }
    : { lifecycle: 'awaiting-tls', desired: 'validating', observed: 'dns-valid', certificate: 'provisioning', reason: 'tls-pending' }
  return { lifecycle: domain.desired === 'active' ? 'active' : 'ready', desired: domain.desired === 'active' ? 'active' : 'validating', observed: domain.desired === 'active' ? 'active' : 'dns-valid', certificate: 'active', reason: domain.desired === 'active' ? 'provider-active' : 'tls-ready' }
}

export class CloudflareSaasReconciler {
  readonly #adapter: CloudflareSaasAdapter
  readonly #domains: CloudflareDomainTransitionPort
  readonly #repository: CloudflareStateRepository
  readonly #now: () => Date
  constructor(adapter: CloudflareSaasAdapter, domains: CloudflareDomainTransitionPort, repository: CloudflareStateRepository = new MemoryCloudflareStateRepository(), now: () => Date = () => new Date()) {
    this.#adapter = adapter; this.#domains = domains; this.#repository = repository; this.#now = now
  }

  instructions(hostnameInput: string, providerInput: CloudflareHostname): readonly DnsInstruction[] {
    const hostname = hostnameInput.toLowerCase()
    const provider = exactProviderState(hostname, providerInput)
    const records: readonly DnsInstruction[] = [
      { type: 'CNAME', name: hostname, value: 'customers.fuma.co.ke', purpose: 'routing' },
      ...provider.ownershipRecords, ...provider.validationRecords,
    ]
    const unique = new Map<string, DnsInstruction>()
    for (const record of records) {
      const normalized = parseCloudflareContract(DnsInstructionSchema, record, 'Cloudflare DNS instruction') as DnsInstruction
      const key = `${normalized.type}:${normalized.name}:${normalized.purpose}`
      const prior = unique.get(key)
      if (prior && prior.value !== normalized.value) throw new CloudflareReconcileError('provider', 'Cloudflare returned conflicting DNS instructions.')
      unique.set(key, normalized)
    }
    return Object.freeze([...unique.values()])
  }

  assertApex(hostnameInput: string, rawCapability: ApexCapability): void {
    const hostname = hostnameInput.toLowerCase()
    const capability = parseCloudflareContract(ApexCapabilitySchema, rawCapability, 'Apex capability') as ApexCapability
    if (!isApex(hostname)) return
    const alternatives = Object.freeze([
      `Use www.${hostname} with the CNAME-first launch path`,
      capability.alias ? 'Use provider-supported ALIAS' : null,
      capability.aname ? 'Use provider-supported ANAME' : null,
      capability.cnameFlattening ? 'Use provider-supported CNAME flattening' : null,
      capability.registrarRedirect ? `Redirect the apex to www.${hostname} at the registrar` : null,
    ].filter((value): value is string => value !== null))
    if (!(capability.enterpriseApex && capability.actualQuoteApproved && capability.securityReviewApproved && capability.marginGatePassed)) {
      throw new CloudflareReconcileError('unsupported-apex', 'Universal apex proxying and BYOIP are unsupported. Enterprise requires an actual quote, security/cost review, and margin approval.', alternatives)
    }
  }

  async #transition(domain: DomainRecord, scope: DomainScope, target: Omit<TargetState, 'lifecycle'>, identity: string): Promise<void> {
    if (domain.desired === target.desired && domain.observed === target.observed && domain.certificate === target.certificate) return
    await this.#domains.transition({
      scope, current: domain, operationId: operationId('domain', domain.domainId, identity), desired: target.desired,
      observed: target.observed, certificate: target.certificate, actorId: 'cloudflare-reconciler',
      reasonCode: target.reason, occurredAt: timestamp(this.#now),
    })
  }
  async #write(scope: DomainScope, current: CloudflareBinding | null, input: Readonly<Omit<CloudflareBinding, keyof DomainScope | 'version' | 'reconcileFence' | 'createdAt' | 'updatedAt' | 'lastOperationSha256'> & { operationEvidence: unknown }>): Promise<CloudflareBinding> {
    const now = timestamp(this.#now)
    const hash = digest(input.operationEvidence)
    const replay = await this.#repository.byOperation(scope, input.lastOperationId)
    if (replay) {
      if (replay.lastOperationSha256 !== hash) throw new CloudflareReconcileError('stale', 'Cloudflare operation identity was reused with changed evidence.')
      return replay
    }
    const record = parseCloudflareContract((await import('./contracts')).CloudflareBindingSchema, {
      ...scope, domainId: input.domainId, hostname: input.hostname, providerHostnameId: input.providerHostnameId,
      lifecycle: input.lifecycle, providerStatus: input.providerStatus, sslStatus: input.sslStatus,
      ownershipVerified: input.ownershipVerified, instructions: input.instructions, diagnostics: input.diagnostics,
      version: current ? current.version + 1 : 1, reconcileFence: current ? current.reconcileFence + 1 : 1,
      lastEventSequence: input.lastEventSequence, lastOperationId: input.lastOperationId, lastOperationSha256: hash,
      createdAt: current?.createdAt ?? now, updatedAt: now,
    }, 'Cloudflare binding') as CloudflareBinding
    const outcome = current ? await this.#repository.advance(scope, current, record) : await this.#repository.create(scope, record)
    if (outcome === 'conflict') throw new CloudflareReconcileError('stale', 'Cloudflare state fence is stale.')
    if (outcome === 'duplicate') {
      const winner = await this.#repository.byOperation(scope, input.lastOperationId)
      if (!winner || winner.lastOperationSha256 !== hash) throw new CloudflareReconcileError('stale', 'Cloudflare operation replay conflicted.')
      return winner
    }
    return record
  }

  async prevalidate(scope: DomainScope, domain: DomainRecord, capability: ApexCapability): Promise<CloudflarePrevalidation> {
    scopeRecord(scope, domain); this.assertApex(domain.hostname, capability)
    const prior = await this.#repository.exact(scope, domain.domainId)
    const provider = prior
      ? exactProviderState(domain.hostname, await this.#adapter.read(prior.providerHostnameId))
      : exactProviderState(domain.hostname, await this.#adapter.create(domain.hostname, operationId('create', domain.domainId, 1)))
    const records = this.instructions(domain.hostname, provider)
    const operation = operationId('prevalidate', domain.domainId, domain.version)
    const binding = await this.#write(scope, prior, {
      domainId: domain.domainId, hostname: domain.hostname, providerHostnameId: provider.id,
      lifecycle: provider.ownershipVerified ? 'awaiting-tls' : 'awaiting-dns', providerStatus: provider.status,
      sslStatus: provider.sslStatus, ownershipVerified: provider.ownershipVerified, instructions: [...records], diagnostics: [],
      lastEventSequence: prior?.lastEventSequence ?? '0', lastOperationId: operation,
      operationEvidence: { action: 'prevalidate', domainId: domain.domainId, domainVersion: domain.version, provider, records },
    })
    await this.#transition(domain, scope, {
      desired: 'validating', observed: provider.ownershipVerified ? 'dns-valid' : 'dns-pending',
      certificate: provider.sslStatus === 'active' ? 'active' : 'provisioning', reason: 'prevalidation-requested',
    }, `prevalidate.${domain.version}`)
    return parseCloudflareContract(CloudflarePrevalidationSchema, {
      binding, records, customerAccountRequired: false, customerTokenRequired: false, authoritativeDnsRetainedByCustomer: true,
    }, 'Cloudflare prevalidation') as CloudflarePrevalidation
  }

  async #applyProvider(scope: DomainScope, domain: DomainRecord, current: CloudflareBinding, providerInput: CloudflareHostname, sequence: string, source: 'poll' | 'event'): Promise<CloudflareBinding> {
    const provider = exactProviderState(domain.hostname, providerInput)
    if (BigInt(sequence) <= BigInt(current.lastEventSequence)) return current
    const target = providerTarget(domain, provider)
    const records = this.instructions(domain.hostname, provider)
    const identity = operationId(source, domain.domainId, sequence)
    const binding = await this.#write(scope, current, {
      domainId: domain.domainId, hostname: domain.hostname, providerHostnameId: provider.id,
      lifecycle: target.lifecycle, providerStatus: provider.status, sslStatus: provider.sslStatus,
      ownershipVerified: provider.ownershipVerified, instructions: [...records], diagnostics: [],
      lastEventSequence: sequence, lastOperationId: identity,
      operationEvidence: { action: source, sequence, provider, target, domainVersion: domain.version },
    })
    await this.#transition(domain, scope, target, `${source}.${sequence}.${domain.version}`)
    return binding
  }

  async reconcile(scope: DomainScope, domain: DomainRecord): Promise<CloudflareBinding> {
    scopeRecord(scope, domain)
    const current = await this.#repository.exact(scope, domain.domainId)
    if (!current) throw new CloudflareReconcileError('state', 'Cloudflare prevalidation is required.')
    const provider = await this.#adapter.read(current.providerHostnameId)
    return await this.#applyProvider(scope, domain, current, provider, (BigInt(current.lastEventSequence) + 1n).toString(), 'poll')
  }
  async reconcileEvent(scope: DomainScope, domain: DomainRecord, raw: unknown): Promise<CloudflareBinding> {
    scopeRecord(scope, domain)
    const event = parseCloudflareContract(CloudflareEventSchema, raw, 'Cloudflare event') as CloudflareEvent
    const current = await this.#repository.exact(scope, domain.domainId)
    if (!current || event.provider.id !== current.providerHostnameId) throw new CloudflareReconcileError('scope', 'Cloudflare event does not belong to this domain.')
    return await this.#applyProvider(scope, domain, current, event.provider, event.sequence, 'event')
  }

  async cutover(scope: DomainScope, domain: DomainRecord): Promise<CloudflareBinding> {
    scopeRecord(scope, domain)
    const current = await this.#repository.exact(scope, domain.domainId)
    if (!current || current.lifecycle !== 'ready' || current.providerStatus !== 'active' || current.sslStatus !== 'active' || !current.ownershipVerified) {
      throw new CloudflareReconcileError('tls-pending', 'Cutover requires verified ownership and an active certificate.')
    }
    const identity = operationId('cutover', domain.domainId, current.reconcileFence)
    await this.#transition(domain, scope, { desired: 'active', observed: 'active', certificate: 'active', reason: 'cutover-approved' }, `cutover.${current.reconcileFence}`)
    return await this.#write(scope, current, {
      ...current, lifecycle: 'active', lastOperationId: identity,
      operationEvidence: { action: 'cutover', domainVersion: domain.version, reconcileFence: current.reconcileFence },
    })
  }

  async rollback(scope: DomainScope, domain: DomainRecord): Promise<CloudflareBinding> {
    scopeRecord(scope, domain)
    let current = await this.#repository.exact(scope, domain.domainId)
    if (!current) throw new CloudflareReconcileError('state', 'Cloudflare binding is unavailable.')
    if (current.lifecycle !== 'rolling-back' && current.lifecycle !== 'detached') current = await this.#write(scope, current, {
      ...current, lifecycle: 'rolling-back', lastOperationId: operationId('rollback-start', domain.domainId, current.reconcileFence),
      operationEvidence: { action: 'rollback-start', domainVersion: domain.version, reconcileFence: current.reconcileFence },
    })
    await this.#transition(domain, scope, { desired: 'detached', observed: 'detached', certificate: 'revoked', reason: 'cutover-rolled-back' }, `rollback.${current.reconcileFence}`)
    await this.#adapter.purge(domain.hostname, operationId('purge-rollback', domain.domainId, current.reconcileFence))
    if (current.lifecycle === 'detached') return current
    return await this.#write(scope, current, {
      ...current, lifecycle: 'detached', lastOperationId: operationId('rollback-finish', domain.domainId, current.reconcileFence),
      operationEvidence: { action: 'rollback-finish', reconcileFence: current.reconcileFence },
    })
  }

  async remove(scope: DomainScope, domain: DomainRecord): Promise<CloudflareBinding> {
    scopeRecord(scope, domain)
    let current = await this.#repository.exact(scope, domain.domainId)
    if (!current) throw new CloudflareReconcileError('state', 'Cloudflare binding is unavailable.')
    if (current.lifecycle === 'deleted') return current
    if (current.lifecycle !== 'deleting') current = await this.#write(scope, current, {
      ...current, lifecycle: 'deleting', lastOperationId: operationId('delete-start', domain.domainId, current.reconcileFence),
      operationEvidence: { action: 'delete-start', domainVersion: domain.version, reconcileFence: current.reconcileFence },
    })
    await this.#adapter.delete(current.providerHostnameId, operationId('provider-delete', domain.domainId, 1))
    await this.#transition(domain, scope, { desired: 'deleted', observed: 'deleted', certificate: 'revoked', reason: 'hostname-deleted' }, `delete.${current.reconcileFence}`)
    await this.#adapter.purge(domain.hostname, operationId('purge-delete', domain.domainId, 1))
    return await this.#write(scope, current, {
      ...current, lifecycle: 'deleted', providerStatus: 'deleted', lastOperationId: operationId('delete-finish', domain.domainId, current.reconcileFence),
      operationEvidence: { action: 'delete-finish', reconcileFence: current.reconcileFence },
    })
  }

  async diagnose(scope: DomainScope, domain: DomainRecord, rawObserved: unknown): Promise<CloudflareBinding> {
    scopeRecord(scope, domain)
    const observed = parseCloudflareContract(CloudflareObservedDnsSchema, rawObserved, 'Observed DNS records') as readonly DnsInstruction[]
    const current = await this.#repository.exact(scope, domain.domainId)
    if (!current) throw new CloudflareReconcileError('state', 'Cloudflare binding is unavailable.')
    const actual = new Set(observed.map((record) => canonical(record)))
    const diagnostics: CloudflareDiagnostic[] = current.instructions.filter((record) => !actual.has(canonical(record))).map((record) => Object.freeze({
      code: record.purpose === 'routing' ? 'cname-missing' as const : record.purpose === 'ownership' ? 'ownership-missing' as const : 'tls-validation-missing' as const,
      severity: 'error' as const, message: `${record.type} record for ${record.purpose} is missing or has the wrong value.`, expected: record,
    }))
    if (current.providerStatus === 'blocked') diagnostics.push(Object.freeze({ code: 'provider-blocked', severity: 'error', message: 'Cloudflare blocked this custom hostname.', expected: null }))
    if (current.sslStatus === 'failed') diagnostics.push(Object.freeze({ code: 'tls-failed', severity: 'error', message: 'Certificate issuance failed.', expected: null }))
    else if (current.sslStatus === 'pending') diagnostics.push(Object.freeze({ code: 'tls-pending', severity: 'warning', message: 'Certificate issuance is still pending.', expected: null }))
    if (diagnostics.length === 0) diagnostics.push(Object.freeze({ code: 'healthy', severity: 'info', message: 'DNS, ownership, and TLS evidence are healthy.', expected: null }))
    return await this.#write(scope, current, {
      ...current, diagnostics, lastOperationId: operationId('diagnose', domain.domainId, current.reconcileFence),
      operationEvidence: { action: 'diagnose', reconcileFence: current.reconcileFence, observed },
    })
  }

  async exact(scope: DomainScope, domainId: string) { return await this.#repository.exact(scope, domainId) }
  async reconcileHostnameMeter(observedCount: number, ledgerCount: number, settle: (delta: number, costUsdCents: number) => Promise<void>) {
    const observed = this.hostnameCost(observedCount); this.hostnameCost(ledgerCount)
    const delta = observedCount - ledgerCount
    if (delta !== 0) await settle(delta, observed.totalUsdCents)
    return Object.freeze({ ...observed, ledgerCount, delta })
  }
  hostnameCost(count: number) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 50_000) throw new CloudflareReconcileError('provider', 'Cloudflare hostname count is invalid or exceeds the 50,000 PAYG maximum.')
    return Object.freeze({ included: 100, paygMaximum: 50_000, additional: Math.max(0, count - 100), unitUsdCents: 10, totalUsdCents: Math.max(0, count - 100) * 10, baselineDate: '2026-07-23' })
  }
}

export { FakeCloudflareSaasAdapter }
