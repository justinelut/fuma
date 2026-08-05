import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import type { RegistrarGatewayHttpClient } from '../registrar/productionGateway'
import type { RegistrarTransferProvider } from './service'

const Strict = { additionalProperties: false } as const
const ReferenceSchema = Type.Object({ providerReference: Type.String({ minLength: 1, maxLength: 255 }) }, Strict)
const LockSchema = Type.Object({ locked: Type.Boolean() }, Strict)
const OutboundSchema = Type.Object({
  providerReference: Type.String({ minLength: 1, maxLength: 255 }),
  authCode: Type.String({ minLength: 1, maxLength: 4096 }),
  expiresAt: Type.String({ format: 'date-time' }),
}, Strict)
const StatusSchema = Type.Object({
  state: Type.Union([Type.Literal('pending'), Type.Literal('completed'), Type.Literal('failed')]),
  ownership: Type.Union([Type.Literal('customer'), Type.Literal('fuma'), Type.Literal('external')]),
  failureCode: Type.Union([Type.String({ minLength: 1, maxLength: 100, pattern: '^[a-z][a-z0-9-]*$' }), Type.Null()]),
}, Strict)
const LookupSchema = Type.Union([ReferenceSchema, Type.Null()])
const EmptySchema = Type.Object({}, Strict)

function exactOrigin(value: string): string {
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new TypeError('Registrar transfer gateway origin is invalid.') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new TypeError('Registrar transfer gateway must be an explicit HTTPS origin.')
  }
  return parsed.origin
}

export class RegistrarTransferGatewayAdapter implements RegistrarTransferProvider {
  readonly #origin: string
  readonly #token: Uint8Array
  readonly #http: RegistrarGatewayHttpClient
  #closed = false
  constructor(input: Readonly<{ origin: string; token: Uint8Array; http: RegistrarGatewayHttpClient }>) {
    this.#origin = exactOrigin(input.origin)
    if (!(input.token instanceof Uint8Array) || input.token.byteLength < 16 || input.token.byteLength > 4096) throw new TypeError('Registrar transfer gateway token is invalid.')
    this.#token = input.token.slice()
    this.#http = input.http
  }
  async #call<T extends TSchema>(path: string, body: unknown, schema: T): Promise<Static<T>> {
    if (this.#closed) throw new TypeError('Registrar transfer gateway is closed.')
    const token = new TextDecoder('utf-8', { fatal: true }).decode(this.#token)
    let response: Awaited<ReturnType<RegistrarGatewayHttpClient['request']>>
    try {
      response = await this.#http.request({
        method: 'POST', url: `${this.#origin}${path}`,
        headers: Object.freeze({ authorization: `Bearer ${token}`, 'content-type': 'application/json' }), body,
      })
    } catch { throw new TypeError('Registrar transfer gateway request failed.') }
    if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) throw new TypeError('Registrar transfer gateway rejected the operation.')
    const parsed = safeParseValue(schema, response.body)
    if (!parsed.ok) throw new TypeError('Registrar transfer gateway response failed its strict contract.')
    return parsed.value
  }
  async registrarLocked(hostname: string): Promise<boolean> { return (await this.#call('/v1/transfers/lock-status', { hostname }, LockSchema)).locked }
  submitInbound(hostname: string, authCode: Uint8Array, idempotencyKey: string) {
    const code = new TextDecoder('utf-8', { fatal: true }).decode(authCode)
    return this.#call('/v1/transfers/inbound', { hostname, authCode: code, idempotencyKey }, ReferenceSchema)
  }
  async submitOutbound(hostname: string, idempotencyKey: string) {
    const value = await this.#call('/v1/transfers/outbound', { hostname, idempotencyKey }, OutboundSchema)
    return Object.freeze({ providerReference: value.providerReference, authCode: new TextEncoder().encode(value.authCode), expiresAt: value.expiresAt })
  }
  lookup(idempotencyKey: string) { return this.#call('/v1/transfers/lookup', { idempotencyKey }, LookupSchema) }
  status(providerReference: string) { return this.#call('/v1/transfers/status', { providerReference }, StatusSchema) }
  async cancel(providerReference: string, idempotencyKey: string): Promise<void> { await this.#call('/v1/transfers/cancel', { providerReference, idempotencyKey }, EmptySchema) }
  close(): void { this.#closed = true; this.#token.fill(0) }
}
