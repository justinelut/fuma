import { clientIp } from '../../auth/security'
import { safeParseValue, type TSchema } from '@core/utils/typeboxHelpers'
import {
  EmptyMemberCommandSchema,
  MemberLoginInputSchema,
  MemberReauthenticateInputSchema,
  MemberRegisterInputSchema,
  type MemberIdentityScope,
} from './contracts'
import {
  MEMBER_SESSION_COOKIE,
  MEMBER_SESSION_POLICY,
  MemberAuthenticationError,
  type MemberAuthenticationService,
  type MemberRequestEvidence,
} from './service'

export const MEMBER_AUTH_PREFIX = '/_fuma/member-auth'
const MAX_BODY_BYTES = 16 * 1024

export type MemberSiteAuthority = Readonly<{
  resolve(request: Request): Promise<Readonly<{ scope: MemberIdentityScope; origin: string }> | null>
}>
export type MemberAuthBoundary = Readonly<{
  handles(request: Request): boolean
  handle(request: Request): Promise<Response | null>
}>

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const NativeResponse = (globalThis as Record<PropertyKey, unknown>)[Symbol.for('instatic.test.nativeResponse')] as typeof Response | undefined
  const ResponseConstructor = NativeResponse ?? Response
  return new ResponseConstructor(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } })
}
function cookieValue(request: Request): string | null {
  const raw = request.headers.get('cookie') ?? ''
  for (const item of raw.split(';')) {
    const separator = item.indexOf('=')
    if (separator < 0 || item.slice(0, separator).trim() !== MEMBER_SESSION_COOKIE) continue
    try { return decodeURIComponent(item.slice(separator + 1).trim()) } catch { return null }
  }
  return null
}
function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${MEMBER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}
function expiredCookie(): string { return `${MEMBER_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` }
function evidence(request: Request): MemberRequestEvidence {
  return { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
}
async function strictBody(request: Request, schema: TSchema): Promise<unknown> {
  const length = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new MemberAuthenticationError('invalid')
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new MemberAuthenticationError('invalid')
  let value: unknown
  try { value = JSON.parse(text || '{}') } catch { throw new MemberAuthenticationError('invalid') }
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new MemberAuthenticationError('invalid')
  return parsed.value
}
function errorResponse(error: unknown): Response {
  if (error instanceof MemberAuthenticationError) {
    if (error.code === 'rate-limited') return json({ error: 'Try again later.' }, 429, { 'retry-after': '60' })
    if (error.code === 'unauthenticated') return json({ error: 'Authentication required.' }, 401)
    if (error.code === 'scope') return json({ error: 'Not found.' }, 404)
    return json({ error: 'Invalid email or password.' }, 401)
  }
  return json({ error: 'Authentication request failed.' }, 400)
}

export function createMemberAuthBoundary(input: Readonly<{ service: MemberAuthenticationService; authority: MemberSiteAuthority }>): MemberAuthBoundary {
  function handles(request: Request): boolean { return new URL(request.url).pathname.startsWith(`${MEMBER_AUTH_PREFIX}/`) }
  async function handle(request: Request): Promise<Response | null> {
    if (!handles(request)) return null
    const url = new URL(request.url)
    const host = request.headers.get('host')
    if (url.protocol !== 'https:' || host?.toLowerCase() !== url.host.toLowerCase() || request.headers.has('authorization')) return json({ error: 'Not found.' }, 404)
    const resolved = await input.authority.resolve(request)
    if (!resolved || new URL(resolved.origin).origin !== url.origin) return json({ error: 'Not found.' }, 404)
    if (request.method !== 'GET' && request.headers.get('origin') !== resolved.origin) return json({ error: 'Origin not allowed.' }, 403)
    const endpoint = url.pathname.slice(MEMBER_AUTH_PREFIX.length)
    const token = cookieValue(request)
    try {
      if (request.method === 'GET' && endpoint === '/session') return json(await input.service.resolve(resolved.scope, token))
      if (request.method !== 'POST') return json({ error: 'Not found.' }, 404)
      if (endpoint === '/register') {
        await input.service.register(resolved.scope, await strictBody(request, MemberRegisterInputSchema), evidence(request))
        return json({ accepted: true }, 202)
      }
      if (endpoint === '/login') {
        const issued = await input.service.login(resolved.scope, await strictBody(request, MemberLoginInputSchema), evidence(request))
        return json({ authenticated: true, principal: issued.principal, expiresAt: issued.expiresAt }, 200, {
          'set-cookie': sessionCookie(issued.token, Math.floor(MEMBER_SESSION_POLICY.absoluteMs / 1_000)),
        })
      }
      if (endpoint === '/reauthenticate') {
        const body = await strictBody(request, MemberReauthenticateInputSchema) as { password: string }
        const issued = await input.service.reauthenticate(resolved.scope, token, body.password, evidence(request))
        return json({ authenticated: true, principal: issued.principal, expiresAt: issued.expiresAt }, 200, { 'set-cookie': sessionCookie(issued.token, Math.floor(MEMBER_SESSION_POLICY.absoluteMs / 1_000)) })
      }
      if (endpoint === '/logout') {
        await strictBody(request, EmptyMemberCommandSchema)
        await input.service.logout(resolved.scope, token)
        return json({ authenticated: false }, 200, { 'set-cookie': expiredCookie() })
      }
      if (endpoint === '/revoke-all') {
        await strictBody(request, EmptyMemberCommandSchema)
        const revoked = await input.service.revokeAll(resolved.scope, token)
        return json({ revoked }, 200, { 'set-cookie': expiredCookie() })
      }
      return json({ error: 'Not found.' }, 404)
    } catch (error) { return errorResponse(error) }
  }
  return Object.freeze({ handles, handle })
}
