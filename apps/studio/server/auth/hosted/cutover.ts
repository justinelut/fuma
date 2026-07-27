const LEGACY_CMS_PREFIX = '/admin/api/cms'
export const LEGACY_STAFF_SESSION_COOKIE = 'instatic_admin_session'

const LEGACY_AUTH_EXACT_PATHS = new Set([
  `${LEGACY_CMS_PREFIX}/login`,
  `${LEGACY_CMS_PREFIX}/logout`,
  `${LEGACY_CMS_PREFIX}/setup`,
  `${LEGACY_CMS_PREFIX}/setup/status`,
])

const LEGACY_AUTH_PREFIXES = [
  `${LEGACY_CMS_PREFIX}/auth`,
  `${LEGACY_CMS_PREFIX}/me`,
  `${LEGACY_CMS_PREFIX}/users`,
  `${LEGACY_CMS_PREFIX}/roles`,
] as const

function requestHasCookie(request: Request, name: string): boolean {
  const cookie = request.headers.get('cookie') ?? ''
  return cookie.split(';').some((part) => part.trim().split('=', 1)[0] === name)
}

function legacyStaffCookieExpiry(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${LEGACY_STAFF_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

export function isLegacyHostedAuthPath(pathname: string): boolean {
  if (LEGACY_AUTH_EXACT_PATHS.has(pathname)) return true
  return LEGACY_AUTH_PREFIXES.some((prefix) => (
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  ))
}

/**
 * Clears a presented self-hosted session as soon as it reaches the hosted
 * product boundary. The hosted cookie remains the sole staff credential.
 */
export function invalidateLegacyStaffCookie(request: Request, response: Response): Response {
  const alreadyCleared = response.headers.getSetCookie().some((value) => (
    value.startsWith(`${LEGACY_STAFF_SESSION_COOKIE}=`)
  ))
  if (requestHasCookie(request, LEGACY_STAFF_SESSION_COOKIE) && !alreadyCleared) {
    response.headers.append('set-cookie', legacyStaffCookieExpiry(request))
  }
  return response
}

export function rejectLegacyHostedAuth(request: Request): Response {
  return new Response(JSON.stringify({ error: 'Hosted staff reauthentication required' }), {
    status: 401,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': legacyStaffCookieExpiry(request),
    },
  })
}
