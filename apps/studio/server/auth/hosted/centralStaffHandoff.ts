import type { DbClient } from '../../db/client'
import { sessionTokenAtRestValue } from './sessionTokenAdapter'
import type { HostedIdentityAuthRuntime } from './runtime'

const APP_START_PATH = '/api/auth/central-google'
const AUTH_START_PATH = '/staff/google'
const AUTH_AUTHORIZE_PATH = '/staff/authorize'
const APP_CONSUME_PATH = '/api/auth/staff-handoff'
const STATE_COOKIE = '__Host-fuma_staff_oauth'
const HANDOFF_PREFIX = 'fuma-staff-handoff:'
const HANDOFF_TTL_MS = 2 * 60_000
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000
const OPAQUE = /^[A-Za-z0-9_-]{43}$/

export type CentralStaffHandoffBoundary = Readonly<{
  handles(request: Request): boolean
  handle(request: Request): Promise<Response | null>
}>

type HandoffValue = Readonly<{ userId: string; identitySessionId: string; state: string }>
type StaffAuthorityRow = Readonly<{
  user_id: string
  email: string
  banned: boolean
  ban_expires: string | Date | null
  session_valid: boolean
  staff_profile: boolean
}>

function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Buffer.from(bytes).toString('base64url')
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Buffer.from(digest).toString('hex')
}

async function signedCookieValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return `${value}.${Buffer.from(signature).toString('base64')}`
}

function effectiveOrigin(request: Request): string {
  const url = new URL(request.url)
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim().toLowerCase()
  const protocol = forwarded === 'https' || forwarded === 'http' ? `${forwarded}:` : url.protocol
  return `${protocol}//${url.host}`
}

function exactOrigin(request: Request, origin: string): boolean {
  const expected = new URL(origin)
  const receivedHost = request.headers.get('host') ?? new URL(request.url).host
  return effectiveOrigin(request) === expected.origin
    && receivedHost.toLowerCase() === expected.host.toLowerCase()
}

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key !== name) continue
    try { return decodeURIComponent(value.join('=')) } catch { return null }
  }
  return null
}

function cookies(headers: Headers): readonly string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  if (typeof getSetCookie === 'function') return getSetCookie.call(headers)
  const value = headers.get('set-cookie')
  return value ? [value] : []
}

function redirect(location: string, setCookies: readonly string[] = []): Response {
  const headers = new Headers({
    location,
    'cache-control': 'no-store, max-age=0',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  for (const value of setCookies) headers.append('set-cookie', value)
  return new Response(null, { status: 303, headers })
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function parseValue(value: unknown): HandoffValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (typeof item.userId !== 'string' || !item.userId || typeof item.identitySessionId !== 'string' || !item.identitySessionId
    || typeof item.state !== 'string' || !OPAQUE.test(item.state) || Object.keys(item).length !== 3) return null
  return Object.freeze({ userId: item.userId, identitySessionId: item.identitySessionId, state: item.state })
}

export function createCentralStaffHandoffBoundary(input: Readonly<{
  db: DbClient
  appOrigin: string
  authOrigin: string
  identityAuth: HostedIdentityAuthRuntime
  protectedOwnerEmail: string
  staffCookieName: string
  staffAuthSecret: string
  secureCookies: boolean
  now?: () => Date
}>): CentralStaffHandoffBoundary {
  const app = new URL(input.appOrigin).origin
  const auth = new URL(input.authOrigin).origin
  if (app === auth || new URL(app).pathname !== '/' || new URL(auth).pathname !== '/') throw new TypeError('Central staff handoff origins are invalid.')
  const ownerEmail = input.protectedOwnerEmail.trim().toLowerCase()
  const now = input.now ?? (() => new Date())
  const stateCookie = (value: string, maxAge: number) => `${STATE_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${input.secureCookies ? '; Secure' : ''}`
  const staffCookie = (value: string) => `${input.staffCookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${input.secureCookies ? '; Secure' : ''}`

  return Object.freeze({
    handles(request) {
      const path = new URL(request.url).pathname
      return (exactOrigin(request, app) && (path === APP_START_PATH || path === APP_CONSUME_PATH))
        || (exactOrigin(request, auth) && (path === AUTH_START_PATH || path === AUTH_AUTHORIZE_PATH))
    },
    async handle(request) {
      if (!this.handles(request)) return null
      if (request.method !== 'GET') return notFound()
      const url = new URL(request.url)
      if (exactOrigin(request, app) && url.pathname === APP_START_PATH) {
        if (url.search) return notFound()
        const state = token()
        return redirect(`${auth}${AUTH_START_PATH}?state=${encodeURIComponent(state)}`, [stateCookie(state, 600)])
      }
      if (exactOrigin(request, auth) && url.pathname === AUTH_START_PATH) {
        const state = url.searchParams.get('state') ?? ''
        if (!OPAQUE.test(state) || [...url.searchParams.keys()].some((key) => key !== 'state')) return notFound()
        const callbackURL = `${auth}${AUTH_AUTHORIZE_PATH}?state=${encodeURIComponent(state)}`
        const authorization = await input.identityAuth.boundary.handle(new Request(`${auth}/api/auth/sign-in/social`, {
          method: 'POST',
          headers: { host: new URL(auth).host, origin: auth, 'content-type': 'application/json', cookie: request.headers.get('cookie') ?? '' },
          body: JSON.stringify({ provider: 'google', callbackURL }),
        }))
        if (!authorization?.ok) return notFound()
        const body = await authorization.clone().json().catch(() => null) as { url?: unknown } | null
        if (!body || typeof body.url !== 'string') return notFound()
        const provider = new URL(body.url)
        if (provider.protocol !== 'https:' || provider.hostname !== 'accounts.google.com' || provider.pathname !== '/o/oauth2/v2/auth') return notFound()
        return redirect(provider.toString(), cookies(authorization.headers))
      }
      if (exactOrigin(request, auth) && url.pathname === AUTH_AUTHORIZE_PATH) {
        const state = url.searchParams.get('state') ?? ''
        if (!OPAQUE.test(state) || [...url.searchParams.keys()].some((key) => key !== 'state')) return notFound()
        const identity = await input.identityAuth.resolveSession(request.headers)
        if (!identity || identity.impersonatedBy !== null) return redirect(`${app}/admin/login`)
        const authority = await input.db<{ email: string; staff_profile: boolean }>`
          select account.email,exists(select 1 from auth_staff_profiles profile where profile.user_id=account.id) staff_profile
          from auth_users account where account.id=${identity.userId}
        `
        const row = authority.rows[0]
        if (!row || (row.email.trim().toLowerCase() !== ownerEmail && !row.staff_profile)) return notFound()
        const code = token()
        const issuedAt = now()
        const expiresAt = new Date(issuedAt.getTime() + HANDOFF_TTL_MS)
        await input.db`
          insert into auth_verifications(id,identifier,value,expires_at,created_at,updated_at)
          values(${crypto.randomUUID()},${HANDOFF_PREFIX + await sha256(code)},${JSON.stringify({ userId: identity.userId, identitySessionId: identity.sessionId, state })},${expiresAt.toISOString()},${issuedAt.toISOString()},${issuedAt.toISOString()})
        `
        return redirect(`${app}${APP_CONSUME_PATH}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`)
      }
      if (exactOrigin(request, app) && url.pathname === APP_CONSUME_PATH) {
        const code = url.searchParams.get('code') ?? ''
        const state = url.searchParams.get('state') ?? ''
        if (!OPAQUE.test(code) || !OPAQUE.test(state) || cookie(request, STATE_COOKIE) !== state
          || [...url.searchParams.keys()].some((key) => key !== 'code' && key !== 'state')) return notFound()
        const rawSessionToken = token()
        const storedSessionToken = await sessionTokenAtRestValue(rawSessionToken)
        const at = now()
        const expiresAt = new Date(at.getTime() + SESSION_TTL_MS)
        const email = await input.db.transaction(async (db) => {
          const selected = await db<{ id: string; value: unknown; expires_at: string | Date }>`
            select id,value,expires_at from auth_verifications
            where identifier=${HANDOFF_PREFIX + await sha256(code)} for update
          `
          const verification = selected.rows[0]
          if (!verification || Date.parse(String(verification.expires_at)) <= at.getTime()) return null
          const value = parseValue(typeof verification.value === 'string' ? JSON.parse(verification.value) : verification.value)
          if (!value || value.state !== state) return null
          const deleted = await db`delete from auth_verifications where id=${verification.id}`
          if (deleted.rowCount !== 1) return null
          const authority = await db<StaffAuthorityRow>`
            select account.id user_id,account.email,account.banned,account.ban_expires,
              exists(select 1 from auth_sessions identity where identity.id=${value.identitySessionId} and identity.user_id=account.id and identity.expires_at>${at.toISOString()}) session_valid,
              exists(select 1 from auth_staff_profiles profile where profile.user_id=account.id) staff_profile
            from auth_users account where account.id=${value.userId}
          `
          const row = authority.rows[0]
          const owner = row?.email.trim().toLowerCase() === ownerEmail
          const banned = row?.banned === true && (row.ban_expires === null || Date.parse(String(row.ban_expires)) > at.getTime())
          if (!row || !row.session_valid || banned || (!owner && !row.staff_profile)) return null
          if (owner && !row.staff_profile) await db`insert into auth_staff_profiles(user_id,source,created_at,updated_at) values(${row.user_id},${'native'},${at.toISOString()},${at.toISOString()}) on conflict(user_id) do nothing`
          await db`
            insert into auth_sessions(id,expires_at,token,created_at,updated_at,ip_address,user_agent,user_id,active_organization_id,impersonated_by)
            values(${crypto.randomUUID()},${expiresAt.toISOString()},${storedSessionToken},${at.toISOString()},${at.toISOString()},${request.headers.get('x-forwarded-for')?.split(',',1)[0]?.trim() ?? null},${request.headers.get('user-agent')},${row.user_id},${null},${null})
          `
          return row.email
        })
        if (!email) return notFound()
        return redirect(`${app}/admin`, [staffCookie(await signedCookieValue(rawSessionToken, input.staffAuthSecret)), stateCookie('', 0)])
      }
      return notFound()
    },
  })
}
