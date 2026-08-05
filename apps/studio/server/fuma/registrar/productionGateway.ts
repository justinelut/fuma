import { safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import {
  RegistrarAvailabilitySchema,
  RegistrarPurchaseProviderResultSchema,
  RegistrarQuoteSchema,
  RegistrarRenewalProviderResultSchema,
  type DomainRegistration,
  type RegistrarQuote,
  type RegistrationContacts,
} from './contracts'
import type { AuthorizedRegistrarProvider } from './workflow'
import type { DomainCredentialAuthority } from '../domains/contracts'

export type RegistrarGatewayRequest = Readonly<{
  method: 'GET' | 'POST'
  url: string
  headers: Readonly<Record<string, string>>
  body: unknown | null
}>
export interface RegistrarGatewayHttpClient {
  request(input: RegistrarGatewayRequest): Promise<Readonly<{ status: number; body: unknown }>>
}
export class RegistrarGatewayError extends Error {
  readonly code: 'configuration' | 'provider' | 'contract'
  constructor(code: RegistrarGatewayError['code'], message: string) {
    super(message)
    this.name = 'RegistrarGatewayError'
    this.code = code
  }
}

const MAX_GATEWAY_RESPONSE_BYTES = 2 * 1024 * 1024
export class FetchRegistrarGatewayHttpClient implements RegistrarGatewayHttpClient {
  readonly #fetch: typeof fetch
  constructor(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) { this.#fetch = fetchImpl }
  async request(input: RegistrarGatewayRequest): Promise<Readonly<{ status: number; body: unknown }>> {
    const target = new URL(input.url)
    if (target.protocol !== 'https:' || target.username || target.password || target.hash) throw new RegistrarGatewayError('configuration', 'Registrar gateway request URL is invalid.')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await this.#fetch(target, {
        method: input.method, headers: input.headers,
        body: input.body === null ? undefined : JSON.stringify(input.body),
        redirect: 'error', signal: controller.signal,
      })
      const declared = Number(response.headers.get('content-length') ?? '0')
      if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_GATEWAY_RESPONSE_BYTES) throw new RegistrarGatewayError('contract', 'Registrar gateway response exceeded its size limit.')
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > MAX_GATEWAY_RESPONSE_BYTES) throw new RegistrarGatewayError('contract', 'Registrar gateway response exceeded its size limit.')
      let body: unknown = null
      if (bytes.byteLength) {
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
        catch { throw new RegistrarGatewayError('contract', 'Registrar gateway returned invalid JSON.') }
      }
      return Object.freeze({ status: response.status, body })
    } catch (error) {
      if (error instanceof RegistrarGatewayError) throw error
      throw new RegistrarGatewayError('provider', 'Registrar gateway request failed.')
    } finally { clearTimeout(timer) }
  }
}

function origin(value: string): string {
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new RegistrarGatewayError('configuration', 'Registrar gateway origin is invalid.') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new RegistrarGatewayError('configuration', 'Registrar gateway must be an explicit HTTPS origin.')
  }
  return parsed.origin
}

/**
 * Provider-neutral production adapter. The configured gateway owns vendor-specific
 * translation; Fuma still verifies every strict quote/result and exact authority.
 */
export class RegistrarGatewayAdapter implements AuthorizedRegistrarProvider {
  readonly #origin: string
  readonly #token: Uint8Array
  readonly #http: RegistrarGatewayHttpClient
  #closed = false

  constructor(input: Readonly<{ origin: string; token: Uint8Array; http: RegistrarGatewayHttpClient }>) {
    this.#origin = origin(input.origin)
    if (!(input.token instanceof Uint8Array) || input.token.byteLength < 16 || input.token.byteLength > 4096) {
      throw new RegistrarGatewayError('configuration', 'Registrar gateway token is invalid.')
    }
    this.#token = input.token.slice()
    this.#http = input.http
  }

  async #call<T extends TSchema>(schema: T, path: string, body: unknown): Promise<Static<T>> {
    if (this.#closed) throw new RegistrarGatewayError('configuration', 'Registrar gateway is closed.')
    const token = new TextDecoder('utf-8', { fatal: true }).decode(this.#token)
    let response: Readonly<{ status: number; body: unknown }>
    try {
      response = await this.#http.request(Object.freeze({
        method: 'POST',
        url: `${this.#origin}${path}`,
        headers: Object.freeze({ authorization: `Bearer ${token}`, 'content-type': 'application/json' }),
        body,
      }))
    } catch {
      throw new RegistrarGatewayError('provider', 'Registrar gateway request failed.')
    }
    if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
      throw new RegistrarGatewayError('provider', 'Registrar gateway rejected the operation.')
    }
    const parsed = safeParseValue(schema, response.body)
    if (!parsed.ok) throw new RegistrarGatewayError('contract', 'Registrar gateway response failed its strict contract.')
    return parsed.value
  }

  search(authority: DomainCredentialAuthority, hostname: string) {
    return this.#call(RegistrarAvailabilitySchema, '/v1/domains/search', { authority, hostname })
  }
  quote(authority: DomainCredentialAuthority, hostname: string, periodYears: number) {
    return this.#call(RegistrarQuoteSchema, '/v1/domains/quote', { authority, hostname, periodYears })
  }
  purchase(authority: DomainCredentialAuthority, quote: RegistrarQuote, contacts: RegistrationContacts, idempotencyKey: string) {
    return this.#call(RegistrarPurchaseProviderResultSchema, '/v1/domains/purchase', { authority, quote, contacts, idempotencyKey })
  }
  lookupPurchase(authority: DomainCredentialAuthority, idempotencyKey: string) {
    return this.#call(RegistrarPurchaseProviderResultSchema, '/v1/domains/purchase/lookup', { authority, idempotencyKey })
      .catch((error) => { if (error instanceof RegistrarGatewayError && error.code === 'provider') return null; throw error })
  }
  renew(authority: DomainCredentialAuthority, registration: DomainRegistration, periodYears: number, idempotencyKey: string) {
    return this.#call(RegistrarRenewalProviderResultSchema, '/v1/domains/renew', { authority, registration, periodYears, idempotencyKey })
  }
  lookupRenewal(authority: DomainCredentialAuthority, idempotencyKey: string) {
    return this.#call(RegistrarRenewalProviderResultSchema, '/v1/domains/renew/lookup', { authority, idempotencyKey })
      .catch((error) => { if (error instanceof RegistrarGatewayError && error.code === 'provider') return null; throw error })
  }
  close(): void { this.#closed = true; this.#token.fill(0) }
}
