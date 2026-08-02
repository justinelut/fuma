import { describe, expect, test } from 'bun:test'
import { PublicHandoffRequestSchema } from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import type { HostedStaffAuthBoundary } from '../../auth/hosted/routes'
import { publicHandoffAuthorityMigration } from '../db/migrations/000077_public_handoff_authority'
import { hostedMigrationChecksum } from '../db/migrationPolicy'
import { createPublicHandoffAppBoundary } from './boundary'
import { APP_HANDOFF_SESSION_COOKIE, AppHandoffCancelRequestSchema } from './contracts'
import {
  PublicHandoffStoreError,
  type IssuedAppAuthCode,
  type IssuedAppSession,
  type IssuedPublicIntent,
  type PublicHandoffRepository,
} from './repository'
import { PublicHandoffService, type PublicHandoffClock, type PublicHandoffTokens } from './service'
import type { AppHandoffResolution, StoredAppAuthCode, StoredPublicIntent } from './contracts'
import type { PublicHandoffResolutionAuthority } from './authority'
import type { PublicHandoffRequest } from '@fuma/public-contracts'

const APP = 'https://app.trimly.co.ke'
const AUTH = 'https://auth.trimly.co.ke'
const PUBLIC = 'https://trimly.co.ke'

function token(index: number): string {
  return `token_${String(index).padStart(40, '0')}`
}

class FakeClock implements PublicHandoffClock {
  value = new Date('2026-07-30T02:00:00.000Z')
  now(): Date { return new Date(this.value) }
  advance(ms: number): void { this.value = new Date(this.value.getTime() + ms) }
}

class FakeTokens implements PublicHandoffTokens {
  index = 0
  token(): string { this.index += 1; return token(this.index) }
}

type IntentState = Readonly<{
  tokenHash: string
  token: string
  value: StoredPublicIntent
}> & { consumed: boolean; cancelled: boolean }
type CodeState = Readonly<{
  codeHash: string
  code: string
  value: StoredAppAuthCode
}> & { consumed: boolean; cancelled: boolean }

class FakeRepository implements PublicHandoffRepository {
  readonly intents = new Map<string, IntentState>()
  readonly codes = new Map<string, CodeState>()
  readonly sessions = new Map<string, IssuedAppSession>()

  async issueIntent(input: Parameters<PublicHandoffRepository['issueIntent']>[0]): Promise<IssuedPublicIntent> {
    if (this.intents.has(input.tokenHash)) throw new PublicHandoffStoreError('replayed')
    const value: StoredPublicIntent = {
      version: 1, recordKind: 'public-intent', audience: 'fuma-app', callback: '/resume',
      request: structuredClone(input.request), correlation: input.correlation, issuedAt: input.issuedAt, expiresAt: input.expiresAt,
    }
    this.intents.set(input.tokenHash, { tokenHash: input.tokenHash, token: input.token, value, consumed: false, cancelled: false })
    return { intent: input.token, correlation: input.correlation, expiresAt: input.expiresAt }
  }

  async authorizeIntent(input: Parameters<PublicHandoffRepository['authorizeIntent']>[0]): Promise<IssuedAppAuthCode> {
    const intent = this.intents.get(input.tokenHash)
    if (!intent || intent.value.correlation !== input.correlation) throw new PublicHandoffStoreError('invalid')
    if (intent.cancelled) throw new PublicHandoffStoreError('cancelled')
    if (intent.consumed) throw new PublicHandoffStoreError('replayed')
    if (Date.parse(intent.value.expiresAt) <= Date.parse(input.now)) throw new PublicHandoffStoreError('expired')
    intent.consumed = true
    const value: StoredAppAuthCode = {
      version: 1, recordKind: 'app-auth-code', audience: 'fuma-app', callback: '/resume', userId: input.userId,
      identitySessionId: input.identitySessionId, intent: intent.value, state: input.state, issuedAt: input.now, expiresAt: input.expiresAt,
    }
    this.codes.set(input.codeHash, { codeHash: input.codeHash, code: input.code, value, consumed: false, cancelled: false })
    return { code: input.code, state: input.state, expiresAt: input.expiresAt }
  }

  async inspectCode(input: Parameters<PublicHandoffRepository['inspectCode']>[0]): Promise<StoredAppAuthCode> {
    return this.usableCode(input.codeHash, input.state, input.now).value
  }

  async consumeCode(input: Parameters<PublicHandoffRepository['consumeCode']>[0]): Promise<StoredAppAuthCode> {
    const code = this.usableCode(input.codeHash, input.state, input.now)
    code.consumed = true
    return code.value
  }

  async cancelIntent(input: Parameters<PublicHandoffRepository['cancelIntent']>[0]): Promise<void> {
    const intent = this.intents.get(input.tokenHash)
    if (!intent || intent.value.correlation !== input.correlation) throw new PublicHandoffStoreError('invalid')
    if (intent.cancelled) throw new PublicHandoffStoreError('cancelled')
    if (intent.consumed) throw new PublicHandoffStoreError('replayed')
    if (Date.parse(intent.value.expiresAt) <= Date.parse(input.now)) throw new PublicHandoffStoreError('expired')
    intent.cancelled = true
  }

  async cancelCode(input: Parameters<PublicHandoffRepository['cancelCode']>[0]): Promise<void> {
    this.usableCode(input.codeHash, input.state, input.now).cancelled = true
  }

  async createSession(input: Parameters<PublicHandoffRepository['createSession']>[0]): Promise<IssuedAppSession> {
    const value = { token: input.token, userId: input.userId, identitySessionId: input.identitySessionId, expiresAt: input.expiresAt }
    this.sessions.set(input.tokenHash, value)
    return value
  }

  async resolveSession(input: Parameters<PublicHandoffRepository['resolveSession']>[0]): Promise<IssuedAppSession | null> {
    const value = this.sessions.get(input.tokenHash)
    return value && Date.parse(value.expiresAt) > Date.parse(input.now) ? value : null
  }

  private usableCode(hash: string, state: string, now: string): CodeState {
    const code = this.codes.get(hash)
    if (!code || code.value.state !== state) throw new PublicHandoffStoreError('invalid')
    if (code.cancelled) throw new PublicHandoffStoreError('cancelled')
    if (code.consumed) throw new PublicHandoffStoreError('replayed')
    if (Date.parse(code.value.expiresAt) <= Date.parse(now)) throw new PublicHandoffStoreError('expired')
    return code
  }
}

class MutableAuthority implements PublicHandoffResolutionAuthority {
  priceBookVersion = 'book-current-v1'
  templateAuthorityVersion = 1
  calls = 0

  async resolve(request: PublicHandoffRequest): Promise<AppHandoffResolution> {
    this.calls += 1
    if (request.kind === 'choose_plan') return {
      kind: 'choose_plan', source: request.source, planId: request.planId, cadence: request.cadence,
      profile: 'website', priceBookVersion: this.priceBookVersion,
    }
    if (request.kind === 'use_template') return {
      kind: 'use_template', source: request.source, templateId: request.templateId,
      releaseId: 'release-current', profiles: ['website'], authorityVersion: this.templateAuthorityVersion,
    }
    return request as AppHandoffResolution
  }
}

function harness() {
  const repository = new FakeRepository()
  const authority = new MutableAuthority()
  const clock = new FakeClock()
  const tokens = new FakeTokens()
  const service = new PublicHandoffService({ repository, authority, clock, tokens })
  return { repository, authority, clock, tokens, service }
}

function request(url: string, init: RequestInit = {}): Request {
  const host = new URL(url).host
  const headers = new Headers(init.headers)
  headers.set('host', host)
  const output = new Request(url, { ...init, headers })
  output.headers.set('host', host)
  for (const [name, value] of headers) output.headers.set(name, value)
  return output
}

function formRequest(url: string, origin: string, value: Record<string, string>, cookie?: string): Request {
  return request(url, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(value),
  })
}

function identityBoundary(): HostedStaffAuthBoundary {
  return {
    origin: AUTH,
    host: 'auth.trimly.co.ke',
    cookieName: '__Host-fuma_auth',
    handlesProductRequest: (value) => new URL(value.url).origin === AUTH,
    handle: async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': '__Host-fuma_auth=identity; Path=/; Secure; HttpOnly; SameSite=Lax' },
    }),
  }
}

function boundary(service: PublicHandoffService, authenticated = false) {
  return createPublicHandoffAppBoundary({
    service,
    appOrigin: APP,
    authOrigin: AUTH,
    marketingOrigin: PUBLIC,
    secureCookies: true,
    identityAuth: identityBoundary(),
    resolveIdentitySession: async () => authenticated ? {
      userId: 'user-1', sessionId: 'identity-session', email: 'user@example.invalid', impersonatedBy: null,
      createdAt: new Date('2026-07-30T02:00:00.000Z'),
    } : null,
  })
}

describe('FUMA-WEB-013 closed public intent contracts', () => {
  test('reject arbitrary redirects, PII, admin audiences, invite tokens, and caller attribution', () => {
    const safe = { kind: 'choose_plan', source: 'pricing', planId: 'starter', priceBookVersion: 'book-v1', cadence: 'monthly' }
    expect(Value.Check(PublicHandoffRequestSchema, safe)).toBe(true)
    for (const extra of [
      { redirect: 'https://attacker.invalid' }, { email: 'person@example.invalid' }, { audience: 'fuma-admin' },
      { invitationId: 'invite-secret' }, { userId: 'staff-1' }, { organizationId: 'org-private' }, { referrer: 'https://private.invalid' },
    ]) expect(Value.Check(PublicHandoffRequestSchema, { ...safe, ...extra })).toBe(false)
    expect(Value.Check(PublicHandoffRequestSchema, { kind: 'choose_plan', source: 'ad-network', planId: 'starter', priceBookVersion: 'v1', cadence: 'monthly' })).toBe(false)
  })

  test('cancellation is also a closed union', () => {
    expect(Value.Check(AppHandoffCancelRequestSchema, { kind: 'intent', intent: token(1), correlation: token(2) })).toBe(true)
    expect(Value.Check(AppHandoffCancelRequestSchema, { kind: 'intent', intent: token(1), correlation: token(2), redirect: 'https://attacker.invalid' })).toBe(false)
    expect(Value.Check(AppHandoffCancelRequestSchema, { kind: 'admin', code: token(1), state: token(2) })).toBe(false)
  })
})

describe('FUMA-WEB-013 opaque single-use service', () => {
  test('stores token digests rather than bearer values and never stores identity in a public intent', async () => {
    const h = harness()
    const issued = await h.service.issue({ kind: 'create_site', source: 'home', profile: 'website' })
    const stored = [...h.repository.intents.values()][0]!
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.tokenHash).not.toContain(issued.intent)
    expect(JSON.stringify(stored.value)).not.toContain('email')
    expect(stored.value.audience).toBe('fuma-app')
    expect(stored.value.callback).toBe('/resume')
  })

  test('rejects tamper, consumes an intent once, and rejects replay', async () => {
    const h = harness()
    const issued = await h.service.issue({ kind: 'sign_in', source: 'direct' })
    await expect(h.service.authorize({ intent: issued.intent, correlation: token(999) }, 'user-1', 'identity-session')).rejects.toMatchObject({ code: 'invalid' })
    await h.service.authorize({ intent: issued.intent, correlation: issued.correlation }, 'user-1', 'identity-session')
    await expect(h.service.authorize({ intent: issued.intent, correlation: issued.correlation }, 'user-1', 'identity-session')).rejects.toMatchObject({ code: 'replayed' })
  })

  test('expires public intents and auth codes independently', async () => {
    const intentHarness = harness()
    const intent = await intentHarness.service.issue({ kind: 'sign_in', source: 'direct' })
    intentHarness.clock.advance(10 * 60 * 1_000)
    await expect(intentHarness.service.authorize({ intent: intent.intent, correlation: intent.correlation }, 'user-1', 'identity-session')).rejects.toMatchObject({ code: 'expired' })

    const codeHarness = harness()
    const second = await codeHarness.service.issue({ kind: 'sign_in', source: 'direct' })
    const code = await codeHarness.service.authorize({ intent: second.intent, correlation: second.correlation }, 'user-1', 'identity-session')
    codeHarness.clock.advance(2 * 60 * 1_000)
    await expect(codeHarness.service.exchange({ code: code.code, state: code.state })).rejects.toMatchObject({ code: 'expired' })
  })

  test('cancels intents and codes and keeps cancellation single-use', async () => {
    const h = harness()
    const intent = await h.service.issue({ kind: 'sign_up', source: 'home' })
    await h.service.cancel({ kind: 'intent', intent: intent.intent, correlation: intent.correlation })
    await expect(h.service.authorize({ intent: intent.intent, correlation: intent.correlation }, 'user-1', 'identity-session')).rejects.toMatchObject({ code: 'cancelled' })

    const second = await h.service.issue({ kind: 'sign_in', source: 'direct' })
    const code = await h.service.authorize({ intent: second.intent, correlation: second.correlation }, 'user-1', 'identity-session')
    await h.service.cancel({ kind: 'code', code: code.code, state: code.state })
    await expect(h.service.exchange({ code: code.code, state: code.state })).rejects.toMatchObject({ code: 'cancelled' })
  })

  test('re-resolves current pricing authority only at exchange and makes the code single-use', async () => {
    const h = harness()
    const intent = await h.service.issue({ kind: 'choose_plan', source: 'pricing', planId: 'starter', priceBookVersion: 'public-old', cadence: 'annual' })
    const code = await h.service.authorize({ intent: intent.intent, correlation: intent.correlation }, 'user-1', 'identity-session')
    h.authority.priceBookVersion = 'book-fresh-v2'
    const exchanged = await h.service.exchange({ code: code.code, state: code.state })
    expect(exchanged.ready.resolution).toMatchObject({ kind: 'choose_plan', priceBookVersion: 'book-fresh-v2', profile: 'website' })
    expect(h.authority.calls).toBe(1)
    await expect(h.service.exchange({ code: code.code, state: code.state })).rejects.toMatchObject({ code: 'replayed' })
  })

  test('re-resolves current immutable template coordinates rather than public release claims', async () => {
    const h = harness()
    const intent = await h.service.issue({ kind: 'use_template', source: 'template', templateId: 'template-safe' })
    const code = await h.service.authorize({ intent: intent.intent, correlation: intent.correlation }, 'user-1', 'identity-session')
    h.authority.templateAuthorityVersion = 7
    const exchanged = await h.service.exchange({ code: code.code, state: code.state })
    expect(exchanged.ready.resolution).toEqual({ kind: 'use_template', source: 'template', templateId: 'template-safe', releaseId: 'release-current', profiles: ['website'], authorityVersion: 7 })
  })
})

describe('FUMA-WEB-013 host, redirect, cancellation, and cookie isolation', () => {
  test('redirects an unauthenticated app intent only to the fixed centralized auth endpoint', async () => {
    const h = harness()
    const issued = await h.service.issue({ kind: 'sign_in', source: 'direct' })
    const surface = boundary(h.service)
    const response = await surface.handle(request(`${APP}/resume?intent=${issued.intent}&correlation=${issued.correlation}`))
    expect(response?.status).toBe(303)
    const location = new URL(response!.headers.get('location')!)
    expect(location.origin).toBe(AUTH)
    expect(location.pathname).toBe('/handoff/authorize')
    expect(location.searchParams.has('redirect')).toBe(false)
    const signIn = await surface.handle(request(location.toString()))
    expect(signIn?.status).toBe(200)
    const signInHtml = await signIn!.text()
    expect(signInHtml).toContain('Sign in to Fuma')
    expect(signInHtml).toContain('Welcome back. Sign in to continue.')
    expect(signInHtml).not.toMatch(/public selection stays opaque|secure handoff|product authority|app\.trimly\.co\.ke/i)
  })

  test('rejects open-redirect additions and never reflects them', async () => {
    const h = harness()
    const issued = await h.service.issue({ kind: 'sign_in', source: 'direct' })
    const response = await boundary(h.service).handle(request(`${APP}/resume?intent=${issued.intent}&correlation=${issued.correlation}&redirect=https://attacker.invalid`))
    expect(response?.status).toBe(400)
    expect(await response!.text()).not.toContain('attacker.invalid')
  })

  test('does not handle app routes on auth, admin, public, or attacker hosts', () => {
    const surface = boundary(harness().service)
    for (const origin of [AUTH, 'https://admin.trimly.co.ke', PUBLIC, 'https://attacker.invalid']) {
      expect(surface.handles(request(`${origin}/resume?intent=${token(1)}&correlation=${token(2)}`))).toBe(false)
    }
    expect(surface.handles(request(`${APP}/resume?intent=${token(1)}&correlation=${token(2)}`))).toBe(true)
  })

  test('requires exact same-origin cancellation and returns only to the fixed marketing origin', async () => {
    const h = harness()
    const issued = await h.service.issue({ kind: 'sign_in', source: 'direct' })
    const surface = boundary(h.service)
    const denied = await surface.handle(formRequest(`${AUTH}/handoff/cancel`, 'https://attacker.invalid', { kind: 'intent', intent: issued.intent, correlation: issued.correlation }))
    expect(denied?.status).toBe(400)
    const accepted = await surface.handle(formRequest(`${AUTH}/handoff/cancel`, AUTH, { kind: 'intent', intent: issued.intent, correlation: issued.correlation }))
    expect(accepted?.status).toBe(303)
    expect(accepted?.headers.get('location')).toBe(PUBLIC)
  })

  test('exchanges only after app confirmation and emits a secure host-only app cookie', async () => {
    const h = harness()
    const issued = await h.service.issue({ kind: 'create_site', source: 'home', profile: 'website' })
    const code = await h.service.authorize({ intent: issued.intent, correlation: issued.correlation }, 'user-1', 'identity-session')
    const surface = boundary(h.service, true)
    const review = await surface.handle(request(`${APP}/resume?code=${code.code}&state=${code.state}`))
    expect(review?.status).toBe(200)
    expect(await review!.text()).toContain('Continue to Fuma')
    const exchanged = await surface.handle(formRequest(`${APP}/resume/exchange`, APP, { code: code.code, state: code.state }))
    const setCookie = exchanged?.headers.get('set-cookie') ?? ''
    expect(exchanged?.status).toBe(303)
    expect(exchanged?.headers.get('location')).toBe(`${APP}/admin`)
    expect(setCookie).toContain(`${APP_HANDOFF_SESSION_COOKIE}=`)
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).not.toContain('Domain=')
  })

  test('does not treat public, auth, member, or admin cookies as an app session', async () => {
    for (const foreign of ['public_session=x', '__Host-fuma_auth=x', '__Host-fuma_member_session=x', '__Host-fuma_admin=x']) {
      const h = harness()
      const issued = await h.service.issue({ kind: 'sign_in', source: 'direct' })
      const response = await boundary(h.service).handle(request(`${APP}/resume?intent=${issued.intent}&correlation=${issued.correlation}`, { headers: { host: 'app.trimly.co.ke', cookie: foreign } }))
      expect(new URL(response!.headers.get('location')!).origin).toBe(AUTH)
    }
  })
})

describe('FUMA-WEB-013 Better Auth continuation', () => {
  test('preserves the opaque handoff through a required TOTP challenge', async () => {
    const h = harness()
    const calls: string[] = []
    const identityAuth: HostedStaffAuthBoundary = {
      origin: AUTH,
      host: 'auth.trimly.co.ke',
      cookieName: '__Host-fuma_auth',
      handlesProductRequest: (value) => new URL(value.url).origin === AUTH,
      handle: async (value) => {
        const url = new URL(value.url)
        calls.push(`${value.method} ${url.pathname}`)
        if (url.pathname === '/api/auth/sign-in/email') {
          const body = JSON.stringify({ twoFactorRedirect: true })
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'application/json', 'set-cookie': '__Secure-fuma_two_factor=challenge; Path=/; Secure; HttpOnly; SameSite=Lax' }),
            clone: () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
          } as Response
        }
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json', 'set-cookie': '__Host-fuma_auth=identity; Path=/; Secure; HttpOnly; SameSite=Lax' }),
        } as Response
      },
    }
    const surface = createPublicHandoffAppBoundary({
      service: h.service,
      appOrigin: APP,
      authOrigin: AUTH,
      marketingOrigin: PUBLIC,
      secureCookies: true,
      identityAuth,
      resolveIdentitySession: async () => null,
    })
    const issued = await h.service.issue({ kind: 'sign_in', source: 'direct' })
    const login = await surface.handle(formRequest(`${AUTH}/handoff/sign-in`, AUTH, {
      mode: 'sign-in', email: 'user@example.invalid', password: 'password-safe', intent: issued.intent, correlation: issued.correlation,
    }))
    expect(login?.status).toBe(200)
    expect(await login!.text()).toContain('Verify it’s you')
    expect(login?.headers.get('set-cookie')).toContain('__Secure-fuma_two_factor=challenge')
    const verificationRequest = formRequest(`${AUTH}/handoff/two-factor`, AUTH, {
      code: '123456', intent: issued.intent, correlation: issued.correlation,
    })
    Object.defineProperty(verificationRequest, 'headers', { value: new Headers({
      host: 'auth.trimly.co.ke',
      origin: AUTH,
      cookie: '__Secure-fuma_two_factor=challenge',
      'content-type': 'application/x-www-form-urlencoded',
    }) })
    const verified = await surface.handle(verificationRequest)
    expect(verified?.status).toBe(303)
    expect(verified?.headers.get('location')).toContain('/handoff/authorize?')
    expect(verified?.headers.get('set-cookie')).toContain('__Host-fuma_auth=identity')
    expect(calls).toEqual(['POST /api/auth/sign-in/email', 'POST /api/auth/two-factor/verify-totp'])
  })

  test('exposes only reviewed verification and reset endpoints on the exact auth host', () => {
    const surface = boundary(harness().service)
    expect(surface.handles(request(`${AUTH}/api/auth/verify-email?token=opaque`))).toBe(true)
    expect(surface.handles(request(`${AUTH}/api/auth/request-password-reset`, { method: 'POST' }))).toBe(true)
    expect(surface.handles(request(`${AUTH}/api/auth/reset-password/opaque`))).toBe(true)
    expect(surface.handles(request(`${APP}/api/auth/verify-email?token=opaque`))).toBe(false)
    expect(surface.handles(request(`${AUTH}/api/auth/admin/list-users`))).toBe(false)
    expect(surface.handles(request(`${AUTH}/api/auth/organization/create`))).toBe(false)
  })
})

describe('FUMA-WEB-013 durable PostgreSQL authority', () => {
  test('uses finalized additive migration with only token hashes, fixed audience/callback, and immutable non-PII events', () => {
    expect(publicHandoffAuthorityMigration.id).toBe('000077_public_handoff_authority')
    expect(hostedMigrationChecksum(publicHandoffAuthorityMigration.sql)).toBe('fb257b84c2e44b65212ef5227845c50524887248fb10732a6ec46a4b7dd53015')
    expect(publicHandoffAuthorityMigration.sql).toContain('token_hash_sha256')
    expect(publicHandoffAuthorityMigration.sql).not.toMatch(/\b(intent_token|auth_code|session_token|email|redirect_url|admin)\b/)
    expect(publicHandoffAuthorityMigration.sql).toContain("check(audience='fuma-app')")
    expect(publicHandoffAuthorityMigration.sql).toContain("check(callback_path='/resume')")
    expect(publicHandoffAuthorityMigration.sql).toContain('public handoff events are append-only')
  })
})


describe('FUMA-WEB-013 route composition architecture', () => {
  test('mounts private issuance plus exact app/auth boundaries without cross-app or shared UI imports', async () => {
    const root = new URL('../../../../../', import.meta.url)
    const [privateBoundary, router, startup, handoffBoundary] = await Promise.all([
      Bun.file(new URL('apps/studio/server/fuma/publicProjections/boundary.ts', root)).text(),
      Bun.file(new URL('apps/studio/server/router.ts', root)).text(),
      Bun.file(new URL('apps/studio/server/index.ts', root)).text(),
      Bun.file(new URL('apps/studio/server/fuma/publicHandoff/boundary.ts', root)).text(),
    ])
    expect(privateBoundary).toContain('PUBLIC_HANDOFF_PATH')
    expect(privateBoundary).toContain("request.headers.get('x-fuma-audience') !== 'fuma-public-web'")
    expect(privateBoundary).toContain("request.headers.has('cookie')")
    expect(router).toContain('runtime.publicHandoff?.handles(req)')
    expect(startup).toContain('publicHandoff: publicHandoffRuntime?.boundary')
    expect(startup).toContain('handoff: publicHandoffRuntime.issuer')
    expect(handoffBoundary).toContain("cookie: request.headers.get('cookie') ?? ''")
    expect(handoffBoundary).not.toMatch(/apps\/web|control-surfaces|shared\/ui/)
  })

  test('does not mount Better Auth admin endpoints on the centralized public identity surface', () => {
    const surface = boundary(harness().service)
    expect(surface.handles(request(`${AUTH}/api/auth/sign-in/email`))).toBe(true)
    expect(surface.handles(request(`${AUTH}/api/auth/admin/list-users`))).toBe(false)
    expect(surface.handles(request(`${AUTH}/api/auth/admin/set-role`))).toBe(false)
  })

  test('reuses canonical Better Auth storage without granting customer sign-ups a staff profile', async () => {
    const root = new URL('../../../../../', import.meta.url)
    const [auth, startup, delivery] = await Promise.all([
      Bun.file(new URL('apps/studio/server/auth/hosted/auth.ts', root)).text(),
      Bun.file(new URL('apps/studio/server/index.ts', root)).text(),
      Bun.file(new URL('apps/studio/server/auth/hosted/ociDelivery.ts', root)).text(),
    ])
    const start = auth.indexOf('export function createPostgresHostedIdentityAuth')
    const end = auth.indexOf('export function createPostgresHostedAuth(', start)
    const identityAuthority = auth.slice(start, end)
    expect(identityAuthority).toContain('createPostgresHostedAuthBase(input, false)')
    expect(identityAuthority).not.toContain('auth_staff_profiles')
    expect(startup).toContain('createHostedIdentityAuthRuntime')
    expect(startup).toContain("linkHost: hostedAuthHost, audience: 'account'")
    expect(delivery).toContain("input.audience ?? 'staff'")
  })
})
