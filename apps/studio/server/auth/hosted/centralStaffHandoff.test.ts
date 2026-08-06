import { describe, expect, it } from 'bun:test'
import type { DbClient } from '../../db/client'
import type { HostedIdentityAuthRuntime } from './runtime'
import { createCentralStaffHandoffBoundary } from './centralStaffHandoff'

const APP = 'https://app.trimly.co.ke'
const AUTH = 'https://auth.trimly.co.ke'
const OWNER = 'justinequartz@gmail.com'

type Verification = { id: string; identifier: string; value: string; expires_at: string }

function database() {
  let verification: Verification | null = null
  let profile = false
  let sessions = 0
  const query = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?').replace(/\s+/g, ' ').trim()
    if (sql.includes('select account.email,exists')) return { rows: [{ email: OWNER, staff_profile: profile }], rowCount: 1 }
    if (sql.startsWith('insert into auth_verifications')) {
      verification = { id: String(values[0]), identifier: String(values[1]), value: String(values[2]), expires_at: String(values[3]) }
      return { rows: [], rowCount: 1 }
    }
    if (sql.startsWith('select id,value,expires_at from auth_verifications')) {
      return { rows: verification && verification.identifier === values[0] ? [verification] : [], rowCount: verification ? 1 : 0 }
    }
    if (sql.startsWith('delete from auth_verifications')) {
      const found = verification?.id === values[0]
      if (found) verification = null
      return { rows: [], rowCount: found ? 1 : 0 }
    }
    if (sql.includes('select account.id user_id')) return { rows: [{ user_id: 'owner-user', email: OWNER, banned: false, ban_expires: null, session_valid: true, staff_profile: profile }], rowCount: 1 }
    if (sql.startsWith('insert into auth_staff_profiles')) { profile = true; return { rows: [], rowCount: 1 } }
    if (sql.startsWith('insert into auth_sessions')) { sessions += 1; return { rows: [], rowCount: 1 } }
    throw new Error(`Unexpected SQL: ${sql}`)
  }
  const db = query as unknown as DbClient
  Object.assign(db, {
    dialect: 'postgres',
    transaction: async <T>(work: (tx: DbClient) => Promise<T>) => await work(db),
    unsafe: async () => ({ rows: [], rowCount: 0 }),
  })
  return { db, profile: () => profile, sessions: () => sessions }
}

function request(url: string, cookieHeader?: string): Request {
  const parsed = new URL(url)
  const allowedHeaders = new Headers({ host: parsed.host, 'x-forwarded-proto': 'https' })
  if (cookieHeader) allowedHeaders.set('cookie', cookieHeader)
  const NativeResponse = (globalThis as Record<PropertyKey, unknown>)[Symbol.for('instatic.test.nativeResponse')] as typeof Response
  const nativeHeaders = new NativeResponse(null, { headers: allowedHeaders }).headers
  const current = new Request(url, { headers: allowedHeaders })
  Object.defineProperty(current, 'headers', { value: nativeHeaders })
  return current
}

function identity(callbacks: string[]): HostedIdentityAuthRuntime {
  return {
    boundary: {
      origin: AUTH,
      host: 'auth.trimly.co.ke',
      cookieName: '__Host-fuma_auth',
      handlesProductRequest: () => true,
      handle: async (incoming) => {
        const value = await incoming.json() as { callbackURL: string }
        callbacks.push(value.callbackURL)
        const provider = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        provider.searchParams.set('redirect_uri', `${AUTH}/api/auth/callback/google`)
        return Response.json({ url: provider.toString(), redirect: true }, { headers: { 'set-cookie': '__Host-fuma_auth=state; Path=/; HttpOnly; Secure; SameSite=Lax' } })
      },
    },
    resolveSession: async () => ({ userId: 'owner-user', sessionId: 'identity-session', impersonatedBy: null, email: OWNER, createdAt: new Date('2026-08-06T00:00:00.000Z') }),
    close: async () => undefined,
  }
}

describe('central staff Google handoff', () => {
  it('uses only the auth-host Google callback and exchanges one code for one host-only staff session', async () => {
    const store = database()
    const callbacks: string[] = []
    let tick = Date.parse('2026-08-06T00:00:00.000Z')
    const boundary = createCentralStaffHandoffBoundary({ db: store.db, appOrigin: APP, authOrigin: AUTH, identityAuth: identity(callbacks), protectedOwnerEmail: OWNER, staffCookieName: '__Host-fuma_staff', staffAuthSecret: 'test-central-staff-secret-32-bytes-minimum', secureCookies: true, now: () => new Date(tick) })

    const started = await boundary.handle(request(`${APP}/api/auth/central-google`))
    expect(started?.status).toBe(303)
    const authStart = started!.headers.get('location')!
    expect(authStart).toStartWith(`${AUTH}/staff/google?state=`)

    const google = await boundary.handle(request(authStart))
    expect(google?.status).toBe(303)
    expect(new URL(google!.headers.get('location')!).searchParams.get('redirect_uri')).toBe(`${AUTH}/api/auth/callback/google`)
    expect(callbacks).toHaveLength(1)
    expect(callbacks[0]).toStartWith(`${AUTH}/staff/authorize?state=`)

    const authorized = await boundary.handle(request(callbacks[0]!))
    expect(authorized?.status).toBe(303)
    const consume = authorized!.headers.get('location')!
    expect(consume).toStartWith(`${APP}/api/auth/staff-handoff?code=`)

    const state = new URL(authStart).searchParams.get('state')!
    const statePair = `__Host-fuma_staff_oauth=${state}`
    const exchangeRequest = request(consume, statePair)
    expect(exchangeRequest.headers.get('cookie')).toBe(statePair)
    const exchanged = await boundary.handle(exchangeRequest)
    expect(exchanged?.status).toBe(303)
    expect(exchanged?.headers.get('location')).toBe(`${APP}/admin`)
    expect(store.profile()).toBe(true)
    expect(store.sessions()).toBe(1)

    tick += 1_000
    const replay = await boundary.handle(request(consume, statePair))
    expect(replay?.status).toBe(404)
    expect(store.sessions()).toBe(1)
  })

  it('rejects a handoff in a browser without the app-issued state cookie', async () => {
    const store = database()
    const callbacks: string[] = []
    const boundary = createCentralStaffHandoffBoundary({ db: store.db, appOrigin: APP, authOrigin: AUTH, identityAuth: identity(callbacks), protectedOwnerEmail: OWNER, staffCookieName: '__Host-fuma_staff', staffAuthSecret: 'test-central-staff-secret-32-bytes-minimum', secureCookies: true, now: () => new Date('2026-08-06T00:00:00.000Z') })
    const started = await boundary.handle(request(`${APP}/api/auth/central-google`))
    await boundary.handle(request(started!.headers.get('location')!))
    const authorized = await boundary.handle(request(callbacks[0]!))
    const rejected = await boundary.handle(request(authorized!.headers.get('location')!))
    expect(rejected?.status).toBe(404)
    expect(store.sessions()).toBe(0)
  })
})
