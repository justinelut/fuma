import { PublicHandoffRequestSchema, type PublicHandoffRequest } from '@fuma/public-contracts'
import {
  AppHandoffCancelRequestSchema,
  AppHandoffExchangeRequestSchema,
  AppHandoffReadyResponseSchema,
  AppHandoffStartQuerySchema,
  parseHandoffValue,
  type AppHandoffCancelRequest,
  type AppHandoffExchangeRequest,
  type AppHandoffReadyResponse,
  type AppHandoffStartQuery,
} from './contracts'
import type { PublicHandoffResolutionAuthority } from './authority'
import type { IssuedAppAuthCode, IssuedAppSession, IssuedPublicIntent, PublicHandoffRepository } from './repository'

const INTENT_TTL_MS = 10 * 60 * 1_000
const CODE_TTL_MS = 2 * 60 * 1_000
const SESSION_TTL_MS = 12 * 60 * 60 * 1_000

export type PublicHandoffClock = Readonly<{ now(): Date }>
export type PublicHandoffTokens = Readonly<{ token(): string }>

function systemToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Buffer.from(bytes).toString('base64url')
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function instant(clock: PublicHandoffClock): Date {
  const value = clock.now()
  if (!Number.isFinite(value.getTime())) throw new TypeError('Public handoff clock is invalid.')
  return value
}

function expires(now: Date, ttlMs: number): string {
  return new Date(now.getTime() + ttlMs).toISOString()
}

export class PublicHandoffService {
  readonly #repository: PublicHandoffRepository
  readonly #authority: PublicHandoffResolutionAuthority
  readonly #clock: PublicHandoffClock
  readonly #tokens: PublicHandoffTokens

  constructor(input: Readonly<{
    repository: PublicHandoffRepository
    authority: PublicHandoffResolutionAuthority
    clock?: PublicHandoffClock
    tokens?: PublicHandoffTokens
  }>) {
    this.#repository = input.repository
    this.#authority = input.authority
    this.#clock = input.clock ?? { now: () => new Date() }
    this.#tokens = input.tokens ?? { token: systemToken }
  }

  async issue(value: unknown): Promise<IssuedPublicIntent> {
    const request = parseHandoffValue(PublicHandoffRequestSchema, value, 'Public handoff request') as PublicHandoffRequest
    const now = instant(this.#clock)
    const token = this.#tokens.token()
    const correlation = this.#tokens.token()
    return await this.#repository.issueIntent({
      tokenHash: await sha256(token),
      token,
      correlation,
      request,
      issuedAt: now.toISOString(),
      expiresAt: expires(now, INTENT_TTL_MS),
    })
  }

  async authorize(value: unknown, userId: string, identitySessionId: string): Promise<IssuedAppAuthCode> {
    const query = parseHandoffValue(AppHandoffStartQuerySchema, value, 'App handoff start') as AppHandoffStartQuery
    if (!userId || userId.length > 255 || !identitySessionId || identitySessionId.length > 255) throw new TypeError('Authenticated identity session is invalid.')
    const now = instant(this.#clock)
    const code = this.#tokens.token()
    const state = this.#tokens.token()
    return await this.#repository.authorizeIntent({
      tokenHash: await sha256(query.intent),
      correlation: query.correlation,
      codeHash: await sha256(code),
      code,
      state,
      now: now.toISOString(),
      expiresAt: expires(now, CODE_TTL_MS),
      userId,
      identitySessionId,
    })
  }

  async inspectCode(value: unknown): Promise<void> {
    const input = parseHandoffValue(AppHandoffExchangeRequestSchema, value, 'App handoff exchange') as AppHandoffExchangeRequest
    await this.#repository.inspectCode({ codeHash: await sha256(input.code), state: input.state, now: instant(this.#clock).toISOString() })
  }

  async exchange(value: unknown): Promise<Readonly<{ ready: AppHandoffReadyResponse; session: IssuedAppSession }>> {
    const input = parseHandoffValue(AppHandoffExchangeRequestSchema, value, 'App handoff exchange') as AppHandoffExchangeRequest
    const now = instant(this.#clock)
    const code = await this.#repository.consumeCode({ codeHash: await sha256(input.code), state: input.state, now: now.toISOString() })
    const resolution = await this.#authority.resolve(code.intent.request)
    const token = this.#tokens.token()
    const session = await this.#repository.createSession({
      tokenHash: await sha256(token),
      token,
      userId: code.userId,
      identitySessionId: code.identitySessionId,
      createdAt: now.toISOString(),
      expiresAt: expires(now, SESSION_TTL_MS),
    })
    const ready = parseHandoffValue(AppHandoffReadyResponseSchema, {
      kind: 'ready',
      correlation: code.intent.correlation,
      resolution,
      sessionExpiresAt: session.expiresAt,
    }, 'App handoff ready') as AppHandoffReadyResponse
    return Object.freeze({ ready, session })
  }

  async cancel(value: unknown): Promise<void> {
    const input = parseHandoffValue(AppHandoffCancelRequestSchema, value, 'App handoff cancellation') as AppHandoffCancelRequest
    const now = instant(this.#clock).toISOString()
    if (input.kind === 'intent') {
      await this.#repository.cancelIntent({ tokenHash: await sha256(input.intent), correlation: input.correlation, now })
    } else {
      await this.#repository.cancelCode({ codeHash: await sha256(input.code), state: input.state, now })
    }
  }

  async resolveSession(token: string | null): Promise<IssuedAppSession | null> {
    if (!token || token.length < 32 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) return null
    return await this.#repository.resolveSession({ tokenHash: await sha256(token), now: instant(this.#clock).toISOString() })
  }
}
