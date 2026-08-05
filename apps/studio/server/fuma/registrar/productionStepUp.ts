import { createHmac, timingSafeEqual } from 'node:crypto'
import { FUMA_STAFF_FRESH_SESSION_SECONDS, type HostedResolvedSession } from '../../auth/hosted/auth'
import type { FumaScopedRouteHandlerInput } from '../context'
import type { StepUpAuthority } from './service'

const MAX_PROOF_BYTES = 4096
const PURPOSE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,1023}$/

type ProofPayload = Readonly<{
  purpose: string
  userId: string
  sessionId: string
  issuedAt: number
  expiresAt: number
}>

function encode(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url')
}
function decode(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError('Registrar step-up proof is malformed.')
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.toString('base64url') !== value) throw new TypeError('Registrar step-up proof is non-canonical.')
  return bytes.toString('utf8')
}
function signature(secret: Uint8Array, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export interface RegistrarStepUpIssuer {
  issue(input: FumaScopedRouteHandlerInput, purpose: string): Promise<string>
}

/** Server-issued proof: browser input is ignored; freshness is re-resolved from Better Auth. */
export class BetterAuthRegistrarStepUp implements RegistrarStepUpIssuer, StepUpAuthority {
  readonly #resolveSession: (headers: Headers) => Promise<HostedResolvedSession | null>
  readonly #secret: Uint8Array
  readonly #now: () => Date

  constructor(input: Readonly<{
    resolveSession: (headers: Headers) => Promise<HostedResolvedSession | null>
    secret: Uint8Array
    now?: () => Date
  }>) {
    if (!(input.secret instanceof Uint8Array) || input.secret.byteLength < 32) {
      throw new TypeError('Registrar step-up signing secret must contain at least 256 bits.')
    }
    this.#resolveSession = input.resolveSession
    this.#secret = input.secret.slice()
    this.#now = input.now ?? (() => new Date())
  }

  async issue(input: FumaScopedRouteHandlerInput, purpose: string): Promise<string> {
    if (!PURPOSE.test(purpose)) throw new TypeError('Registrar step-up purpose is invalid.')
    const now = this.#now()
    const session = await this.#resolveSession(input.request.headers)
    const actor = input.context.actor
    const age = session ? now.getTime() - session.createdAt.getTime() : Number.NaN
    if (!Number.isFinite(now.getTime()) || actor.kind !== 'staff' || actor.impersonator !== null
      || !session || session.impersonatedBy !== null || session.userId !== actor.userId
      || session.sessionId !== actor.sessionId || !Number.isFinite(age) || age < 0
      || age >= FUMA_STAFF_FRESH_SESSION_SECONDS * 1_000) {
      throw new TypeError('Fresh direct Better Auth staff authority is required.')
    }
    const payload: ProofPayload = Object.freeze({
      purpose,
      userId: session.userId,
      sessionId: session.sessionId,
      issuedAt: now.getTime(),
      expiresAt: now.getTime() + FUMA_STAFF_FRESH_SESSION_SECONDS * 1_000,
    })
    const encoded = encode(JSON.stringify(payload))
    return `${encoded}.${signature(this.#secret, encoded)}`
  }

  async consume(proof: string, purpose: string): Promise<boolean> {
    if (typeof proof !== 'string' || Buffer.byteLength(proof, 'utf8') > MAX_PROOF_BYTES || !PURPOSE.test(purpose)) return false
    const [payloadText, supplied, ...extra] = proof.split('.')
    if (!payloadText || !supplied || extra.length) return false
    const expected = signature(this.#secret, payloadText)
    const left = Buffer.from(supplied)
    const right = Buffer.from(expected)
    if (left.byteLength !== right.byteLength || !timingSafeEqual(left, right)) return false
    let payload: unknown
    try { payload = JSON.parse(decode(payloadText)) } catch { return false }
    if (!payload || typeof payload !== 'object') return false
    const value = payload as Partial<ProofPayload>
    const now = this.#now().getTime()
    return value.purpose === purpose && typeof value.userId === 'string' && typeof value.sessionId === 'string'
      && Number.isFinite(value.issuedAt) && Number.isFinite(value.expiresAt)
      && value.issuedAt! <= now && value.expiresAt! > now
      && value.expiresAt! - value.issuedAt! === FUMA_STAFF_FRESH_SESSION_SECONDS * 1_000
  }

  close(): void { this.#secret.fill(0) }
}
