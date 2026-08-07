/**
 * Cloudflare-backed DNS record reading and writing for a single zone.
 *
 * This is what makes the one-click connect flow real rather than gated: `zoneImport` defines what
 * must be copied, and this executes it against Cloudflare's DNS record API.
 *
 * ONE CLASS SERVES BOTH ONBOARDING MODES, because from here they are the same shape — a zone id
 * plus a token scoped to edit it. In `delegated` mode that is our zone; in `authorised` mode it is
 * the customer's own. Nothing else about the write differs, so modelling them separately would be
 * two copies of one behaviour.
 *
 * Deliberately distinct from `cloudflare/adapter.ts`, which drives `custom_hostnames` on our own
 * zone for TLS. That adapter cannot write records in a zone, which is exactly why the connect path
 * could previously only list records for the customer to paste by hand.
 */

import {
  type CloudflareHttpClient,
  type CloudflareHttpRequest,
  CloudflareTransportError,
} from '../cloudflare/adapter'
import type { ObservedRecord } from './cloudflareDns'
import type { ZoneRecordWriter } from './zoneImport'

function explicitOrigin(value: string): string {
  let url: URL
  try { url = new URL(value) } catch {
    throw new CloudflareTransportError('configuration', 'Cloudflare API origin is invalid.')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new CloudflareTransportError('configuration', 'Cloudflare API origin must be an explicit HTTPS origin.')
  }
  return url.origin
}

/** Cloudflare's record payload, narrowed to what we read back. */
function providerRecord(value: unknown): ObservedRecord {
  if (typeof value !== 'object' || value === null) {
    throw new CloudflareTransportError('contract', 'Cloudflare DNS record is invalid.')
  }
  const row = value as Record<string, unknown>
  const type = row['type']
  const name = row['name']
  const content = row['content']
  if (typeof type !== 'string' || typeof name !== 'string' || typeof content !== 'string') {
    throw new CloudflareTransportError('contract', 'Cloudflare DNS record is missing required fields.')
  }
  const priority = row['priority']
  return Object.freeze({
    type,
    name,
    value: content,
    // A priority of 0 is legal and meaningful for MX, so this checks the TYPE rather than
    // truthiness — `priority || undefined` would discard a valid highest-preference record.
    ...(typeof priority === 'number' ? { priority } : {}),
  })
}

export class CloudflareZoneRecordAdapter implements ZoneRecordWriter {
  readonly #origin: string
  readonly #zoneId: string
  readonly #token: Uint8Array
  readonly #http: CloudflareHttpClient
  #closed = false

  constructor(input: Readonly<{
    apiOrigin: string
    zoneId: string
    apiToken: Uint8Array
    http: CloudflareHttpClient
  }>) {
    this.#origin = explicitOrigin(input.apiOrigin)
    if (!/^[A-Za-z0-9_-]{1,255}$/.test(input.zoneId)) {
      throw new CloudflareTransportError('configuration', 'Cloudflare zone ID is invalid.')
    }
    if (!(input.apiToken instanceof Uint8Array) || input.apiToken.byteLength < 16 || input.apiToken.byteLength > 4096) {
      throw new CloudflareTransportError('configuration', 'Cloudflare API token is invalid.')
    }
    // Copied, following the existing adapter: a caller zeroing their own buffer must not leave us
    // holding a truncated credential.
    this.#zoneId = input.zoneId
    this.#token = input.apiToken.slice()
    this.#http = input.http
  }

  async #request(method: CloudflareHttpRequest['method'], path: string, body: unknown | null) {
    if (this.#closed) throw new CloudflareTransportError('configuration', 'Cloudflare zone adapter is closed.')
    const token = new TextDecoder('utf-8', { fatal: true }).decode(this.#token)
    const response = await this.#http.request(Object.freeze({
      method,
      url: `${this.#origin}/client/v4/zones/${encodeURIComponent(this.#zoneId)}${path}`,
      headers: Object.freeze({
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      }),
      body,
    }))
    if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
      throw new CloudflareTransportError('provider', 'Cloudflare DNS request failed.')
    }
    return response.body
  }

  async createRecord(_domain: string, record: ObservedRecord): Promise<void> {
    const type = record.type.toUpperCase()
    if (type === 'MX' && typeof record.priority !== 'number') {
      // Cloudflare would reject this, but the local refusal names the cause. An MX without a
      // preference is not a record the registry can order.
      throw new CloudflareTransportError('contract', 'An MX record requires a priority.')
    }
    await this.#request('POST', '/dns_records', {
      type,
      name: record.name,
      content: record.value,
      ...(typeof record.priority === 'number' ? { priority: record.priority } : {}),
      // TTL 1 is Cloudflare's "automatic". Chosen deliberately over copying the source TTL: during
      // a migration a short TTL is what makes a mistake recoverable in minutes rather than a day,
      // and the source zone's long TTL is the opposite of what this moment needs.
      ttl: 1,
      proxied: false,
    })
  }

  async listRecords(_domain: string): Promise<readonly ObservedRecord[]> {
    // per_page at Cloudflare's maximum: a zone paginated at the default 20 would report a partial
    // set, and a partial destination list makes the import recreate records that already exist.
    const body = await this.#request('GET', '/dns_records?per_page=5000', null)
    if (typeof body !== 'object' || body === null) {
      throw new CloudflareTransportError('contract', 'Cloudflare DNS listing is invalid.')
    }
    const result = (body as Record<string, unknown>)['result']
    if (!Array.isArray(result)) {
      throw new CloudflareTransportError('contract', 'Cloudflare DNS listing has no result set.')
    }
    return Object.freeze(result.map(providerRecord))
  }

  close(): void {
    this.#closed = true
    this.#token.fill(0)
  }
}
