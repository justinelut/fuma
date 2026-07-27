import { createHmac, timingSafeEqual } from 'node:crypto'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import { UnsubscribeTokenClaimsSchema, type UnsubscribeTokenClaims } from '@core/fuma/publication'
import { PublicationRepositoryScopeSchema, type PublicationRepositoryScope } from './scope'

const SignedUnsubscribePayloadSchema = Type.Object({
  scope: PublicationRepositoryScopeSchema,
  claims: UnsubscribeTokenClaimsSchema,
}, { additionalProperties: false })
export type SignedUnsubscribePayload = Readonly<{ scope: PublicationRepositoryScope; claims: UnsubscribeTokenClaims }>

export class PublicationUnsubscribeTokenSigner {
  readonly #secret: string
  constructor(secret: string) {
    if (new TextEncoder().encode(secret).byteLength < 32) throw new TypeError('Publication unsubscribe secret must contain at least 32 bytes.')
    this.#secret = secret
  }
  issue(payload: SignedUnsubscribePayload): string {
    const parsed = safeParseValue(SignedUnsubscribePayloadSchema, payload)
    if (!parsed.ok) throw new TypeError('Publication unsubscribe payload is invalid.')
    const body = Buffer.from(JSON.stringify(parsed.value)).toString('base64url')
    return `${body}.${this.#signature(body)}`
  }
  verify(token: string, now: Date): SignedUnsubscribePayload | null {
    if (token.length > 8192) return null
    const parts = token.split('.')
    if (parts.length !== 2 || !parts[0] || !parts[1] || !this.#equal(parts[1], this.#signature(parts[0]))) return null
    let decoded: unknown
    try { decoded = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) } catch (_error) { return null }
    const parsed = safeParseValue(SignedUnsubscribePayloadSchema, decoded)
    if (!parsed.ok || Date.parse(parsed.value.claims.expiresAt) <= now.getTime()) return null
    return Object.freeze({ scope: Object.freeze(parsed.value.scope), claims: Object.freeze(parsed.value.claims) })
  }
  #signature(body: string): string { return createHmac('sha256', this.#secret).update('fuma-publication-unsubscribe-v1\0').update(body).digest('base64url') }
  #equal(left: string, right: string): boolean { const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b) }
}
