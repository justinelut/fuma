import { Type } from '@core/utils/typeboxHelpers'
import { safeParseJson } from '@core/utils/jsonValidate'
import type { HostedResolvedSession } from './auth'

const AUTH_PREFIX = '/api/auth'
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const BetterAuthErrorSchema = Type.Object({
  message: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
}, { additionalProperties: true })
const JsonObjectSchema = Type.Record(Type.String(), Type.Unknown())
const TargetUserBodySchema = Type.Object({
  userId: Type.String({ minLength: 1 }),
}, { additionalProperties: true })
const TargetSessionBodySchema = Type.Object({
  sessionToken: Type.String({ minLength: 1 }),
}, { additionalProperties: true })

const ALLOWED_ENDPOINTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['/sign-up/email', new Set(['POST'])],
  ['/sign-in/email', new Set(['POST'])],
  ['/sign-out', new Set(['POST'])],
  ['/get-session', new Set(['GET'])],
  ['/send-verification-email', new Set(['POST'])],
  ['/verify-email', new Set(['GET'])],
  ['/request-password-reset', new Set(['POST'])],
  ['/reset-password', new Set(['POST'])],
  ['/list-sessions', new Set(['GET'])],
  ['/revoke-session', new Set(['POST'])],
  ['/revoke-other-sessions', new Set(['POST'])],
  ['/revoke-sessions', new Set(['POST'])],
  ['/two-factor/enable', new Set(['POST'])],
  ['/two-factor/verify-totp', new Set(['POST'])],
  ['/two-factor/verify-backup-code', new Set(['POST'])],
  ['/two-factor/generate-backup-codes', new Set(['POST'])],
  ['/two-factor/disable', new Set(['POST'])],
  ['/admin/list-users', new Set(['GET'])],
  ['/admin/get-user', new Set(['GET'])],
  ['/admin/list-user-sessions', new Set(['POST'])],
  ['/admin/ban-user', new Set(['POST'])],
  ['/admin/unban-user', new Set(['POST'])],
  ['/admin/revoke-user-session', new Set(['POST'])],
  ['/admin/revoke-user-sessions', new Set(['POST'])],
  ['/admin/set-role', new Set(['POST'])],
  ['/admin/remove-user', new Set(['POST'])],
])

const FRESH_ADMIN_ENDPOINTS = new Set([
  '/admin/ban-user',
  '/admin/unban-user',
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
  '/admin/set-role',
  '/admin/remove-user',
])

const PROTECTED_OWNER_ENDPOINTS = new Set([
  '/admin/ban-user',
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
  '/admin/set-role',
  '/admin/remove-user',
])

const BEARER_BODY_ENDPOINTS = new Set([
  '/sign-up/email',
  '/sign-in/email',
  '/get-session',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
])

export type HostedAuthHandler = Readonly<{
  handler: (request: Request) => Promise<Response>
}>

export type HostedStaffSecurityPolicy = Readonly<{
  freshSessionSeconds: number
  protectedOwnerEmail: string
  resolveSession: (headers: Headers) => Promise<HostedResolvedSession | null>
  findUserEmailById: (userId: string) => Promise<string | null>
  findSessionUserIdByToken: (token: string) => Promise<string | null>
}>

export type HostedStaffAuthBoundary = Readonly<{
  origin: string
  host: string
  cookieName: string
  handlesProductRequest: (request: Request) => boolean
  handle: (request: Request) => Promise<Response | null>
}>

export type HostedStaffAuthBoundaryInput = Readonly<{
  auth: HostedAuthHandler
  origin: string
  cookieName: string
  secureCookies: boolean
  security?: HostedStaffSecurityPolicy
}>

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function endpointFor(pathname: string): string {
  return pathname.slice(AUTH_PREFIX.length) || '/'
}

function endpointIsAllowed(pathname: string, method: string): boolean {
  const endpoint = endpointFor(pathname)
  if (ALLOWED_ENDPOINTS.get(endpoint)?.has(method)) return true
  return method === 'GET' && /^\/reset-password\/[^/]+$/.test(endpoint)
}

function hostHeaderMatches(request: Request, expectedHost: string): boolean {
  const host = request.headers.get('host')
  return host !== null && host.toLowerCase() === expectedHost
}

function responseCookieValues(headers: Headers): readonly string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  if (typeof getSetCookie === 'function') return getSetCookie.call(headers)
  const combined = headers.get('set-cookie')
  return combined ? [combined] : []
}

function staffCookieHasRequiredAttributes(
  value: string,
  cookieName: string,
  secureCookies: boolean,
): boolean {
  if (!value.startsWith(`${cookieName}=`)) return true
  return /(?:^|;)\s*HttpOnly(?:;|$)/i.test(value)
    && /(?:^|;)\s*SameSite=Lax(?:;|$)/i.test(value)
    && /(?:^|;)\s*Path=\/(?:;|$)/i.test(value)
    && (!secureCookies || /(?:^|;)\s*Secure(?:;|$)/i.test(value))
}

function cookiesAreSafe(
  response: Response,
  cookieName: string,
  secureCookies: boolean,
): boolean {
  return responseCookieValues(response.headers).every((value) => (
    !/(?:^|;)\s*Domain=/i.test(value)
    && staffCookieHasRequiredAttributes(value, cookieName, secureCookies)
  ))
}

async function normalizeErrorEnvelope(response: Response): Promise<Response> {
  if (response.ok) return response
  const raw = await response.clone().text()
  const parsed = safeParseJson(raw, BetterAuthErrorSchema)
  const message = parsed.ok
    ? parsed.value.error ?? parsed.value.message ?? 'Authentication request failed'
    : 'Authentication request failed'
  const headers = new Headers(response.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  headers.delete('content-length')
  return new Response(JSON.stringify({ error: message }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function parsedRequestBody(request: Request): Promise<string> {
  try {
    return await request.clone().text()
  } catch {
    return ''
  }
}

async function protectedTargetUserId(
  request: Request,
  endpoint: string,
  security: HostedStaffSecurityPolicy,
): Promise<string | null> {
  const raw = await parsedRequestBody(request)
  if (endpoint === '/admin/revoke-user-session') {
    const body = safeParseJson(raw, TargetSessionBodySchema)
    return body.ok ? await security.findSessionUserIdByToken(body.value.sessionToken) : null
  }
  const body = safeParseJson(raw, TargetUserBodySchema)
  return body.ok ? body.value.userId : null
}

async function enforceAdminSecurity(
  request: Request,
  endpoint: string,
  security: HostedStaffSecurityPolicy | undefined,
): Promise<Response | null> {
  if (!security || !FRESH_ADMIN_ENDPOINTS.has(endpoint)) return null
  const session = await security.resolveSession(request.headers)
  if (!session) return jsonError('Authentication required', 401)
  const ageMs = Date.now() - session.createdAt.getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= security.freshSessionSeconds * 1_000) {
    return jsonError('step_up_required', 401)
  }
  if (!PROTECTED_OWNER_ENDPOINTS.has(endpoint)) return null
  const targetUserId = await protectedTargetUserId(request, endpoint, security)
  if (!targetUserId) return null
  const targetEmail = await security.findUserEmailById(targetUserId)
  if (targetEmail?.trim().toLowerCase() === security.protectedOwnerEmail.trim().toLowerCase()) {
    return jsonError('The protected owner cannot be modified', 403)
  }
  return null
}

/**
 * Mounts the reviewed hosted staff surface. Organization endpoints remain
 * unreachable; MFA, self-service sessions, and bounded admin controls are
 * admitted only here and retain exact Host/Origin enforcement.
 */
export function createHostedStaffAuthBoundary(
  input: HostedStaffAuthBoundaryInput,
): HostedStaffAuthBoundary {
  const expected = new URL(input.origin)
  if (expected.pathname !== '/' || expected.search || expected.hash) {
    throw new Error('Hosted staff auth origin must not contain a path, query, or fragment')
  }
  const origin = expected.origin
  const host = expected.host.toLowerCase()
  const security = input.security
    ? Object.freeze({
      ...input.security,
      protectedOwnerEmail: input.security.protectedOwnerEmail.trim().toLowerCase(),
    })
    : undefined
  if (security && !security.protectedOwnerEmail) {
    throw new Error('Hosted staff auth requires a configured protected owner email')
  }

  function handlesProductRequest(request: Request): boolean {
    const url = new URL(request.url)
    return url.origin === origin && hostHeaderMatches(request, host)
  }

  async function handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(`${AUTH_PREFIX}/`) && url.pathname !== AUTH_PREFIX) return null
    if (!handlesProductRequest(request)) return jsonError('Not found', 404)

    const method = request.method.toUpperCase()
    if (!endpointIsAllowed(url.pathname, method)) return jsonError('Not found', 404)
    if (MUTATING_METHODS.has(method) && request.headers.get('origin') !== origin) {
      return jsonError('Origin not allowed', 403)
    }

    const endpoint = endpointFor(url.pathname)
    const securityFailure = await enforceAdminSecurity(request, endpoint, security)
    if (securityFailure) return securityFailure

    const response = await input.auth.handler(request)
    if (!cookiesAreSafe(response, input.cookieName, input.secureCookies)) {
      console.error('[hosted-auth] Better Auth emitted an unsafe staff cookie')
      return jsonError('Internal server error', 500)
    }
    const safeResponse = await sanitizeSuccessEnvelope(response, endpoint)
    return await normalizeErrorEnvelope(safeResponse)
  }

  return Object.freeze({ origin, host, cookieName: input.cookieName, handlesProductRequest, handle })
}

async function sanitizeSuccessEnvelope(response: Response, endpoint: string): Promise<Response> {
  if (!response.ok || !BEARER_BODY_ENDPOINTS.has(endpoint)) return response
  const raw = await response.clone().text()
  if (raw === 'null') return response
  const parsed = safeParseJson(raw, JsonObjectSchema)
  if (!parsed.ok) return jsonError('Internal server error', 500)

  const body = { ...parsed.value }
  delete body.token
  const session = body.session
  if (session !== undefined && session !== null) {
    if (typeof session !== 'object' || Array.isArray(session)) return jsonError('Internal server error', 500)
    const safeSession = { ...session as Record<string, unknown> }
    delete safeSession.token
    body.session = safeSession
  }

  const headers = new Headers(response.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  headers.delete('content-length')
  return new Response(JSON.stringify(body), { status: response.status, headers })
}
