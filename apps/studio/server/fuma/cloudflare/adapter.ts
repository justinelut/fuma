import { CloudflareHostnameSchema, DnsInstructionSchema, parseCloudflareContract, type CloudflareHostname, type DnsInstruction } from './contracts'
import { normalizeDomainHostname } from '../domains/contracts'

export interface CloudflareSaasAdapter {
  create(hostname: string, idempotencyKey: string): Promise<CloudflareHostname>
  read(id: string): Promise<CloudflareHostname>
  delete(id: string, idempotencyKey: string): Promise<void>
  purge(hostname: string, idempotencyKey: string): Promise<void>
}
export type CloudflareHttpRequest = Readonly<{ method: 'DELETE' | 'GET' | 'POST'; url: string; headers: Readonly<Record<string, string>>; body: unknown | null }>
export type CloudflareHttpResponse = Readonly<{ status: number; body: unknown }>
export interface CloudflareHttpClient { request(input: CloudflareHttpRequest): Promise<CloudflareHttpResponse> }

export class CloudflareTransportError extends Error {
  readonly code: 'configuration' | 'provider' | 'contract' | 'conflict'
  constructor(code: CloudflareTransportError['code'], message: string) { super(message); this.name = 'CloudflareTransportError'; this.code = code }
}

function explicitOrigin(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new CloudflareTransportError('configuration', 'Cloudflare API origin is invalid.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new CloudflareTransportError('configuration', 'Cloudflare API origin must be an explicit HTTPS origin.')
  }
  return url.origin
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2048) throw new CloudflareTransportError('contract', `${label} is invalid.`)
  return value
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CloudflareTransportError('contract', 'Cloudflare response is invalid.')
  return value as Record<string, unknown>
}
function providerRecord(raw: unknown, purpose: DnsInstruction['purpose']): DnsInstruction {
  const value = object(raw)
  const type = text(value.type, 'Cloudflare DNS record type').toUpperCase()
  const rawName = text(value.name, 'Cloudflare DNS record name')
  const name = (rawName.endsWith('.') ? rawName.slice(0, -1) : rawName).toLowerCase()
  return parseCloudflareContract(DnsInstructionSchema, {
    type, name,
    value: text(value.value, 'Cloudflare DNS record value'), purpose,
  }, 'Cloudflare DNS instruction') as DnsInstruction
}
function providerHostname(raw: unknown): CloudflareHostname {
  const envelope = object(raw)
  if (envelope.success !== true) throw new CloudflareTransportError('provider', 'Cloudflare rejected the hostname operation.')
  const value = object(envelope.result)
  const ssl = object(value.ssl)
  const status = text(value.status, 'Cloudflare hostname status')
  const sslStatus = text(ssl.status, 'Cloudflare SSL status')
  const ownershipRecords = Array.isArray(value.ownership_verification)
    ? value.ownership_verification.map((record) => providerRecord(record, 'ownership'))
    : value.ownership_verification ? [providerRecord(value.ownership_verification, 'ownership')] : []
  const validationRecords = Array.isArray(ssl.validation_records)
    ? ssl.validation_records.map((record) => providerRecord(record, 'tls-validation')) : []
  return parseCloudflareContract(CloudflareHostnameSchema, {
    id: text(value.id, 'Cloudflare hostname ID'), hostname: normalizeDomainHostname(text(value.hostname, 'Cloudflare hostname')).hostname,
    status, sslStatus, ownershipVerified: value.ownership_verified === true || status === 'active',
    ownershipRecords, validationRecords,
  }, 'Cloudflare custom hostname') as CloudflareHostname
}

/** Production-shaped adapter. Network execution is wholly injected and never occurs in constructors or tests. */
export class CloudflareForSaasApiAdapter implements CloudflareSaasAdapter {
  readonly #origin: string
  readonly #zoneId: string
  readonly #token: Uint8Array
  readonly #http: CloudflareHttpClient
  #closed = false
  constructor(input: Readonly<{ apiOrigin: string; zoneId: string; apiToken: Uint8Array; http: CloudflareHttpClient }>) {
    this.#origin = explicitOrigin(input.apiOrigin)
    if (!/^[A-Za-z0-9_-]{1,255}$/.test(input.zoneId)) throw new CloudflareTransportError('configuration', 'Cloudflare zone ID is invalid.')
    if (!(input.apiToken instanceof Uint8Array) || input.apiToken.byteLength < 16 || input.apiToken.byteLength > 4096) throw new CloudflareTransportError('configuration', 'Cloudflare API token is invalid.')
    this.#zoneId = input.zoneId; this.#token = input.apiToken.slice(); this.#http = input.http
  }
  async #request(method: CloudflareHttpRequest['method'], path: string, idempotencyKey: string | null, body: unknown | null) {
    if (this.#closed) throw new CloudflareTransportError('configuration', 'Cloudflare adapter is closed.')
    const token = new TextDecoder('utf-8', { fatal: true }).decode(this.#token)
    const response = await this.#http.request(Object.freeze({
      method, url: `${this.#origin}/client/v4/zones/${encodeURIComponent(this.#zoneId)}${path}`,
      headers: Object.freeze({ authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(idempotencyKey ? { 'x-fuma-idempotency-key': idempotencyKey } : {}) }), body,
    }))
    if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) throw new CloudflareTransportError('provider', 'Cloudflare request failed.')
    return response.body
  }
  async create(hostnameInput: string, idempotencyKey: string) {
    const hostname = normalizeDomainHostname(hostnameInput).hostname
    return providerHostname(await this.#request('POST', '/custom_hostnames', idempotencyKey, {
      hostname, ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } },
    }))
  }
  async read(id: string) { return providerHostname(await this.#request('GET', `/custom_hostnames/${encodeURIComponent(id)}`, null, null)) }
  async delete(id: string, idempotencyKey: string) { await this.#request('DELETE', `/custom_hostnames/${encodeURIComponent(id)}`, idempotencyKey, null) }
  async purge(hostnameInput: string, idempotencyKey: string) {
    const hostname = normalizeDomainHostname(hostnameInput).hostname
    await this.#request('POST', '/purge_cache', idempotencyKey, { hosts: [hostname] })
  }
  close(): void { this.#closed = true; this.#token.fill(0) }
}

type FakeAction = 'create' | 'read' | 'delete' | 'purge'
/** Deterministic transport fake with exact idempotency, injected faults, and no network capability. */
export class FakeCloudflareSaasAdapter implements CloudflareSaasAdapter {
  readonly records = new Map<string, CloudflareHostname>()
  readonly calls: Readonly<{ action: FakeAction; id: string; idempotencyKey: string | null }>[] = []
  readonly purged: string[] = []
  readonly #creates = new Map<string, Readonly<{ hostname: string; result: CloudflareHostname }>>()
  readonly #deletes = new Map<string, string>()
  readonly #purges = new Map<string, string>()
  readonly #faults = new Map<FakeAction, number>()
  failNext(action: FakeAction, count = 1): void { this.#faults.set(action, count) }
  #fault(action: FakeAction): void {
    const remaining = this.#faults.get(action) ?? 0
    if (remaining > 0) { this.#faults.set(action, remaining - 1); throw new CloudflareTransportError('provider', `Injected ${action} failure.`) }
  }
  async create(hostnameInput: string, idempotencyKey: string) {
    const hostname = normalizeDomainHostname(hostnameInput).hostname
    const prior = this.#creates.get(idempotencyKey)
    if (prior) {
      if (prior.hostname !== hostname) throw new CloudflareTransportError('conflict', 'Create idempotency identity changed.')
      return structuredClone(prior.result)
    }
    this.#fault('create')
    const id = `cf:${new Bun.CryptoHasher('sha256').update(hostname).digest('hex').slice(0, 24)}`
    const value = parseCloudflareContract(CloudflareHostnameSchema, {
      id, hostname, status: 'pending', sslStatus: 'pending', ownershipVerified: false,
      ownershipRecords: [{ type: 'TXT', name: `_cf-custom-hostname.${hostname}`, value: `verify-${hostname}`, purpose: 'ownership' }],
      validationRecords: [{ type: 'TXT', name: `_acme-challenge.${hostname}`, value: `tls-${hostname}`, purpose: 'tls-validation' }],
    }, 'Fake Cloudflare hostname') as CloudflareHostname
    this.records.set(id, value); this.#creates.set(idempotencyKey, { hostname, result: value })
    ;(this.calls as { action: FakeAction; id: string; idempotencyKey: string | null }[]).push({ action: 'create', id, idempotencyKey })
    return structuredClone(value)
  }
  async read(id: string) {
    this.#fault('read'); const value = this.records.get(id)
    if (!value) throw new CloudflareTransportError('provider', 'Hostname is unavailable.')
    ;(this.calls as { action: FakeAction; id: string; idempotencyKey: string | null }[]).push({ action: 'read', id, idempotencyKey: null })
    return structuredClone(value)
  }
  async delete(id: string, idempotencyKey: string) {
    const prior = this.#deletes.get(idempotencyKey)
    if (prior) { if (prior !== id) throw new CloudflareTransportError('conflict', 'Delete idempotency identity changed.'); return }
    this.#fault('delete'); const value = await this.read(id)
    this.records.set(id, Object.freeze({ ...value, status: 'deleted' })); this.#deletes.set(idempotencyKey, id)
    ;(this.calls as { action: FakeAction; id: string; idempotencyKey: string | null }[]).push({ action: 'delete', id, idempotencyKey })
  }
  async purge(hostnameInput: string, idempotencyKey: string) {
    const hostname = normalizeDomainHostname(hostnameInput).hostname
    const prior = this.#purges.get(idempotencyKey)
    if (prior) { if (prior !== hostname) throw new CloudflareTransportError('conflict', 'Purge idempotency identity changed.'); return }
    this.#fault('purge'); this.#purges.set(idempotencyKey, hostname); this.purged.push(hostname)
    ;(this.calls as { action: FakeAction; id: string; idempotencyKey: string | null }[]).push({ action: 'purge', id: hostname, idempotencyKey })
  }
  setState(id: string, patch: Partial<Pick<CloudflareHostname, 'status' | 'sslStatus' | 'ownershipVerified'>>): void {
    const value = this.records.get(id); if (!value) throw new CloudflareTransportError('provider', 'Hostname is unavailable.')
    this.records.set(id, parseCloudflareContract(CloudflareHostnameSchema, { ...value, ...patch }, 'Fake Cloudflare state') as CloudflareHostname)
  }
  activate(id: string) { this.setState(id, { status: 'active', sslStatus: 'active', ownershipVerified: true }) }
}
