import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { PublicationRepositoryScope } from '../publication/scope'
import {
  MemberCredentialRecordSchema,
  MemberIdentitySchema,
  MemberLoginInputSchema,
  MemberPrincipalSchema,
  MemberRegisterInputSchema,
  MemberSessionEnvelopeSchema,
  MemberSessionRecordSchema,
  parseMemberIdentityContract,
  type MemberConsentEvent,
  type MemberIdentity,
  type MemberLoginInput,
  type MemberPrincipal,
  type MemberRegisterInput,
  type MemberSessionEnvelope,
  type MemberSessionRecord,
} from './contracts'
import type { MemberIdentityRepository, ResolvedMemberSession } from './repository'

export const MEMBER_SESSION_COOKIE = '__Host-fuma_member_session'
export const MEMBER_TOKEN_PREFIX = 'fmm1_'
export const MEMBER_SESSION_POLICY = Object.freeze({
  absoluteMs: 30 * 24 * 60 * 60 * 1_000,
  idleMs: 24 * 60 * 60 * 1_000,
  reauthenticationMs: 10 * 60 * 1_000,
  loginAttempts: 5,
  loginWindowMs: 15 * 60 * 1_000,
  registrationAttempts: 5,
  registrationWindowMs: 60 * 60 * 1_000,
  reauthenticationAttempts: 5,
  reauthenticationWindowMs: 15 * 60 * 1_000,
})

export class MemberAuthenticationError extends Error {
  readonly code: 'invalid' | 'unauthenticated' | 'rate-limited' | 'conflict' | 'scope'
  constructor(code: 'invalid' | 'unauthenticated' | 'rate-limited' | 'conflict' | 'scope') {
    super(code === 'invalid' ? 'Invalid email or password.' : `Member authentication failed: ${code}.`)
    this.code = code
    this.name = 'MemberAuthenticationError'
  }
}

export interface MemberAttemptLimiter {
  consume(bucket: string, limit: number, windowMs: number, nowMs: number): Readonly<{ allowed: boolean; retryAfterMs: number }>
  reset(bucket: string): void
}

export class MemoryMemberAttemptLimiter implements MemberAttemptLimiter {
  readonly #buckets = new Map<string, number[]>()
  consume(bucket: string, limit: number, windowMs: number, nowMs: number) {
    const attempts = (this.#buckets.get(bucket) ?? []).filter((at) => at > nowMs - windowMs)
    if (attempts.length >= limit) return { allowed: false, retryAfterMs: attempts[0]! + windowMs - nowMs }
    attempts.push(nowMs)
    this.#buckets.set(bucket, attempts)
    return { allowed: true, retryAfterMs: 0 }
  }
  reset(bucket: string): void { this.#buckets.delete(bucket) }
}

export type MemberAuthenticationServiceOptions = Readonly<{
  repository: MemberIdentityRepository
  secret: string
  now?: () => Date
  id?: () => string
  randomToken?: () => string
  limiter?: MemberAttemptLimiter
  hashPassword?: (password: string) => Promise<string>
  verifyPassword?: (password: string, hash: string) => Promise<boolean>
}>

export type MemberRequestEvidence = Readonly<{ ip: string | null; userAgent: string | null }>
export type IssuedMemberSession = Readonly<{ token: string; principal: MemberPrincipal; expiresAt: string }>

function normalizeEmail(value: string): string { return value.trim().toLowerCase() }
function timestamp(value: Date): string { return value.toISOString() }
function add(now: Date, milliseconds: number): string { return new Date(now.getTime() + milliseconds).toISOString() }
function scopeKey(scope: PublicationRepositoryScope): string { return [scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.generation, scope.profileId].join('\u0000') }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }
function optionalEvidenceHash(value: string | null, secret: string): string | null { return value === null ? null : createHmac('sha256', secret).update(value).digest('hex') }

export class MemberAuthenticationService {
  readonly #repository: MemberIdentityRepository
  readonly #secret: string
  readonly #now: () => Date
  readonly #id: () => string
  readonly #randomToken: () => string
  readonly #limiter: MemberAttemptLimiter
  readonly #hashPassword: (password: string) => Promise<string>
  readonly #verifyPassword: (password: string, hash: string) => Promise<boolean>
  readonly #dummyPasswordHash: Promise<string>

  constructor(options: MemberAuthenticationServiceOptions) {
    if (options.secret.length < 32) throw new Error('Member auth secret must be at least 32 characters and independent from Better Auth.')
    this.#repository = options.repository
    this.#secret = options.secret
    this.#now = options.now ?? (() => new Date())
    this.#id = options.id ?? (() => crypto.randomUUID())
    this.#randomToken = options.randomToken ?? (() => randomBytes(32).toString('base64url'))
    this.#limiter = options.limiter ?? new MemoryMemberAttemptLimiter()
    this.#hashPassword = options.hashPassword ?? ((password) => Bun.password.hash(password, { algorithm: 'argon2id' }))
    this.#verifyPassword = options.verifyPassword ?? ((password, hash) => Bun.password.verify(password, hash))
    this.#dummyPasswordHash = this.#hashPassword('member-realm-nonexistent-account-dummy-password')
  }

  tokenHash(scope: PublicationRepositoryScope, token: string): string {
    if (!token.startsWith(MEMBER_TOKEN_PREFIX) || token.length < MEMBER_TOKEN_PREFIX.length + 32) return sha256(`invalid-member-token\u0000${scopeKey(scope)}`)
    return createHmac('sha256', this.#secret).update(`member-session-v1\u0000${scopeKey(scope)}\u0000${token}`).digest('hex')
  }

  async register(scope: PublicationRepositoryScope, raw: unknown, evidence: MemberRequestEvidence): Promise<Readonly<{ accepted: true }>> {
    const input = parseMemberIdentityContract('member registration', MemberRegisterInputSchema, raw) as MemberRegisterInput
    const now = this.#now()
    this.#requireRate(`register:${scopeKey(scope)}:${evidence.ip ?? 'unknown'}`, MEMBER_SESSION_POLICY.registrationAttempts, MEMBER_SESSION_POLICY.registrationWindowMs, now)
    const normalizedEmail = normalizeEmail(input.email)
    const identityId = this.#id()
    const at = timestamp(now)
    const identity = parseMemberIdentityContract('member identity', MemberIdentitySchema, {
      memberIdentityId: identityId, email: normalizedEmail, displayName: input.displayName.trim(), state: 'active', origin: 'self-signup', importReceiptId: null, createdAt: at, updatedAt: at,
    }) as MemberIdentity
    const credential = parseMemberIdentityContract('member credential', MemberCredentialRecordSchema, {
      identity, normalizedEmail, passwordHash: await this.#hashPassword(input.password),
    })
    const consents = input.consents.map((consent): MemberConsentEvent => ({
      eventId: this.#id(), memberIdentityId: identityId, ...consent, source: 'member-signup', sourceReceiptId: null, occurredAt: at,
    }))
    // Duplicate and fresh registrations intentionally share the same response.
    await this.#repository.createIdentity(scope, credential, consents)
    return Object.freeze({ accepted: true })
  }

  async login(scope: PublicationRepositoryScope, raw: unknown, evidence: MemberRequestEvidence): Promise<IssuedMemberSession> {
    const input = parseMemberIdentityContract('member login', MemberLoginInputSchema, raw) as MemberLoginInput
    const now = this.#now()
    const normalizedEmail = normalizeEmail(input.email)
    const ipBucket = `login-ip:${scopeKey(scope)}:${evidence.ip ?? 'unknown'}`
    const identityBucket = `login-identity:${scopeKey(scope)}:${evidence.ip ?? 'unknown'}:${sha256(normalizedEmail)}`
    this.#requireRate(ipBucket, MEMBER_SESSION_POLICY.loginAttempts, MEMBER_SESSION_POLICY.loginWindowMs, now)
    this.#requireRate(identityBucket, MEMBER_SESSION_POLICY.loginAttempts, MEMBER_SESSION_POLICY.loginWindowMs, now)
    const credential = await this.#repository.findIdentityByEmail(scope, normalizedEmail)
    const valid = credential?.passwordHash !== null && credential?.identity.state === 'active'
      ? await this.#verifyPassword(input.password, credential.passwordHash)
      : await this.#constantTimeMiss(input.password)
    if (!credential || !valid || credential.identity.state !== 'active') throw new MemberAuthenticationError('invalid')
    this.#limiter.reset(ipBucket)
    this.#limiter.reset(identityBucket)
    return await this.#issue(scope, credential.identity, evidence, now, null)
  }

  async resolve(scope: PublicationRepositoryScope, token: string | null): Promise<MemberSessionEnvelope> {
    if (!token?.startsWith(MEMBER_TOKEN_PREFIX)) return this.#anonymous()
    const resolved = await this.#repository.resolveSession(scope, this.tokenHash(scope, token))
    const now = this.#now()
    if (!resolved || !this.#isCurrent(resolved, now)) return this.#anonymous()
    const idleExpiresAt = new Date(Math.min(Date.parse(resolved.session.expiresAt), now.getTime() + MEMBER_SESSION_POLICY.idleMs)).toISOString()
    if (!await this.#repository.touchSession(scope, resolved.session.sessionId, now.toISOString(), idleExpiresAt)) {
      return this.#anonymous()
    }
    return parseMemberIdentityContract('member session envelope', MemberSessionEnvelopeSchema, {
      authenticated: true, principal: this.#principal(resolved), expiresAt: resolved.session.expiresAt,
    }) as MemberSessionEnvelope
  }

  async reauthenticate(scope: PublicationRepositoryScope, token: string | null, password: string, evidence: MemberRequestEvidence): Promise<IssuedMemberSession> {
    const current = await this.#required(scope, token)
    const now = this.#now()
    const bucket = `reauthenticate:${scopeKey(scope)}:${current.identity.identity.memberIdentityId}:${evidence.ip ?? 'unknown'}`
    this.#requireRate(bucket, MEMBER_SESSION_POLICY.reauthenticationAttempts, MEMBER_SESSION_POLICY.reauthenticationWindowMs, now)
    if (current.identity.passwordHash === null || !await this.#verifyPassword(password, current.identity.passwordHash)) throw new MemberAuthenticationError('invalid')
    this.#limiter.reset(bucket)
    const next = await this.#newSession(scope, current.identity.identity, evidence, now, now.toISOString())
    if (!await this.#repository.rotateSession(scope, current.session.sessionId, next.record, now.toISOString())) throw new MemberAuthenticationError('unauthenticated')
    return { token: next.token, principal: this.#principal({ identity: current.identity, session: next.record }), expiresAt: next.record.expiresAt }
  }

  async logout(scope: PublicationRepositoryScope, token: string | null): Promise<void> {
    if (!token?.startsWith(MEMBER_TOKEN_PREFIX)) return
    const current = await this.#repository.resolveSession(scope, this.tokenHash(scope, token))
    if (current) await this.#repository.revokeSession(scope, current.session.sessionId, this.#now().toISOString())
  }

  async revokeAll(scope: PublicationRepositoryScope, token: string | null): Promise<number> {
    const current = await this.#required(scope, token)
    return await this.#repository.revokeIdentitySessions(scope, current.identity.identity.memberIdentityId, this.#now().toISOString())
  }

  async #required(scope: PublicationRepositoryScope, token: string | null): Promise<ResolvedMemberSession> {
    if (!token?.startsWith(MEMBER_TOKEN_PREFIX)) throw new MemberAuthenticationError('unauthenticated')
    const current = await this.#repository.resolveSession(scope, this.tokenHash(scope, token))
    if (!current || !this.#isCurrent(current, this.#now())) throw new MemberAuthenticationError('unauthenticated')
    return current
  }

  #isCurrent(value: ResolvedMemberSession, now: Date): boolean {
    return value.identity.identity.state === 'active' && value.session.revokedAt === null
      && Date.parse(value.session.expiresAt) > now.getTime() && Date.parse(value.session.idleExpiresAt) > now.getTime()
  }

  async #issue(scope: PublicationRepositoryScope, identity: MemberIdentity, evidence: MemberRequestEvidence, now: Date, reauthenticatedAt: string | null): Promise<IssuedMemberSession> {
    for (let attempts = 0; attempts < 3; attempts += 1) {
      const session = await this.#newSession(scope, identity, evidence, now, reauthenticatedAt)
      if (await this.#repository.createSession(scope, session.record)) return { token: session.token, principal: this.#principal({ identity: { identity, normalizedEmail: identity.email, passwordHash: null }, session: session.record }), expiresAt: session.record.expiresAt }
    }
    throw new MemberAuthenticationError('conflict')
  }

  async #newSession(scope: PublicationRepositoryScope, identity: MemberIdentity, evidence: MemberRequestEvidence, now: Date, reauthenticatedAt: string | null): Promise<{ token: string; record: MemberSessionRecord }> {
    const token = `${MEMBER_TOKEN_PREFIX}${this.#randomToken()}`
    const record = parseMemberIdentityContract('member session', MemberSessionRecordSchema, {
      sessionId: this.#id(), memberIdentityId: identity.memberIdentityId, tokenHashSha256: this.tokenHash(scope, token), createdAt: timestamp(now), lastSeenAt: timestamp(now),
      expiresAt: add(now, MEMBER_SESSION_POLICY.absoluteMs), idleExpiresAt: add(now, MEMBER_SESSION_POLICY.idleMs), reauthenticatedAt, revokedAt: null,
      userAgentHashSha256: optionalEvidenceHash(evidence.userAgent, this.#secret), ipHashSha256: optionalEvidenceHash(evidence.ip, this.#secret),
    }) as MemberSessionRecord
    return { token, record }
  }

  #principal(value: ResolvedMemberSession): MemberPrincipal {
    return parseMemberIdentityContract('member principal', MemberPrincipalSchema, {
      realm: 'site-member', memberIdentityId: value.identity.identity.memberIdentityId, email: value.identity.identity.email,
      displayName: value.identity.identity.displayName, sessionId: value.session.sessionId,
      permissions: ['publication.member.read', 'publication.member.profile'], staffRoles: [],
    }) as MemberPrincipal
  }

  #anonymous(): MemberSessionEnvelope { return Object.freeze({ authenticated: false, principal: null, expiresAt: null }) }
  #requireRate(bucket: string, limit: number, windowMs: number, now: Date): void {
    if (!this.#limiter.consume(bucket, limit, windowMs, now.getTime()).allowed) throw new MemberAuthenticationError('rate-limited')
  }
  async #constantTimeMiss(password: string): Promise<boolean> {
    await this.#verifyPassword(password, await this.#dummyPasswordHash)
    return false
  }
}
