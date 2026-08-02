import { memoryAdapter } from 'better-auth/adapters/memory'
import { FUMA_STAFF_SESSION_COOKIE, createHostedAuth } from './auth'
import { createHostedAuthFakeInbox } from './fakeInbox'
import { createHostedStaffAuthBoundary } from './routes'
import { AUTH_MODEL_NAMES } from './schemaManifest'
import { withHashedSessionTokens } from './sessionTokenAdapter'

const ORIGIN = 'https://app.trimly.co.ke'
const SECRET = 'fuma-012-native-probe-secret-with-at-least-32-characters'
const EMAIL = 'native.staff@fuma.example'
const PASSWORD = 'Fuma-native-password-123!'
const NEW_PASSWORD = 'Fuma-native-reset-456!'

type Row = Record<string, unknown>
type MemoryDatabase = Record<string, Row[]>

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const database: MemoryDatabase = Object.fromEntries(
  Object.values(AUTH_MODEL_NAMES).map((name) => [name, []]),
)
const inbox = createHostedAuthFakeInbox()
const auth = createHostedAuth(
  withHashedSessionTokens(memoryAdapter(database)),
  {
    baseURL: ORIGIN,
    secret: SECRET,
    secureCookies: true,
    cookieName: FUMA_STAFF_SESSION_COOKIE,
    delivery: inbox,
  },
  { create: async () => {} },
)
const boundary = createHostedStaffAuthBoundary({
  auth,
  origin: ORIGIN,
  cookieName: FUMA_STAFF_SESSION_COOKIE,
  secureCookies: true,
})

function request(
  pathOrUrl: string,
  init: RequestInit = {},
  options: Readonly<{ host?: string; origin?: string | null }> = {},
): Request {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${ORIGIN}/api/auth${pathOrUrl}`
  const headers = new Headers(init.headers)
  headers.set('host', options.host ?? new URL(url).host)
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  if ((init.method ?? 'GET') !== 'GET' && options.origin !== null) {
    headers.set('origin', options.origin ?? ORIGIN)
  }
  return new Request(url, { ...init, headers })
}

function post(
  path: string,
  body: Record<string, unknown>,
  cookie?: string,
  options?: Readonly<{ host?: string; origin?: string | null }>,
): Request {
  return request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: cookie ? { cookie } : undefined,
  }, options)
}

async function dispatch(req: Request): Promise<Response> {
  const response = await boundary.handle(req)
  assert(response, 'Hosted boundary did not own auth request')
  return response
}

function cookies(response: Response): readonly string[] {
  return response.headers.getSetCookie()
}

function staffCookie(response: Response): { pair: string; raw: string } {
  const raw = cookies(response).find((value) => value.startsWith(`${FUMA_STAFF_SESSION_COOKIE}=`))
  assert(raw, `Expected hosted staff cookie: ${JSON.stringify(cookies(response))}`)
  return { pair: raw.split(';', 1)[0]!, raw }
}

function assertCookiePolicy(raw: string): void {
  assert(raw.includes('Secure'), 'Staff cookie is missing Secure')
  assert(raw.includes('HttpOnly'), 'Staff cookie is missing HttpOnly')
  assert(raw.includes('SameSite=Lax'), 'Staff cookie is missing SameSite=Lax')
  assert(raw.includes('Path=/'), 'Staff cookie is missing Path=/')
  assert(!/(?:^|;)\s*Domain=/i.test(raw), 'Staff cookie includes Domain')
}

const signup = await dispatch(post('/sign-up/email', {
  name: 'Native Staff',
  email: EMAIL,
  password: PASSWORD,
  callbackURL: '/admin?verified=true',
}))
assert(signup.status === 200, `Signup returned ${signup.status}`)
assert(cookies(signup).length === 0, 'Unverified signup received a staff cookie')

const duplicate = await dispatch(post('/sign-up/email', {
  name: 'Duplicate Staff',
  email: EMAIL.toUpperCase(),
  password: 'Fuma-duplicate-password-789!',
  callbackURL: '/admin?verified=true',
}))
assert(duplicate.status === 200, 'Duplicate signup was identity-enumerable')
assert(cookies(duplicate).length === 0, 'Duplicate signup received a staff cookie')

const verificationMessage = inbox.latest(EMAIL, 'verification')
assert(verificationMessage, 'Verification did not reach fake inbox')
const verification = await dispatch(request(verificationMessage.url))
assert(verification.status === 302, `Verification returned ${verification.status}`)
const verifiedCookie = staffCookie(verification)
assertCookiePolicy(verifiedCookie.raw)

const reload = await dispatch(request('/get-session', { headers: { cookie: verifiedCookie.pair } }))
assert(reload.status === 200, 'Reload session failed')
const reloadText = await reload.text()
assert(reloadText.includes(EMAIL), 'Reload session omitted staff identity')
assert(!reloadText.includes('"token"'), 'Session response exposed a bearer token')
assert(!reloadText.includes(verifiedCookie.pair.split('=', 2)[1]!), 'Session response exposed cookie bearer value')

const knownReset = await dispatch(post('/request-password-reset', {
  email: EMAIL,
  redirectTo: '/admin/reset-password',
}))
const missingReset = await dispatch(post('/request-password-reset', {
  email: 'missing@fuma.example',
  redirectTo: '/admin/reset-password',
}))
assert(knownReset.status === 200 && missingReset.status === 200, 'Reset request leaked account existence by status')
assert(await knownReset.text() === await missingReset.text(), 'Reset request leaked account existence by body')

const resetMessage = inbox.latest(EMAIL, 'password-reset')
assert(resetMessage, 'Password reset did not reach fake inbox')
const resetCallback = await dispatch(request(resetMessage.url))
assert(resetCallback.status === 302, 'Reset callback failed')
const resetLocation = new URL(resetCallback.headers.get('location')!, ORIGIN)
const resetToken = resetLocation.searchParams.get('token')
assert(resetToken, 'Reset callback omitted token')
const reset = await dispatch(post('/reset-password', { token: resetToken, newPassword: NEW_PASSWORD }))
assert(reset.status === 200, 'Password reset failed')
assert(database[AUTH_MODEL_NAMES.session]?.length === 0, 'Password reset did not revoke sessions')

const revoked = await dispatch(request('/get-session', { headers: { cookie: verifiedCookie.pair } }))
assert(await revoked.text() === 'null', 'Revoked session remained valid')
const oldLogin = await dispatch(post('/sign-in/email', { email: EMAIL, password: PASSWORD }))
assert(oldLogin.status === 401, 'Old password remained valid')
const newLogin = await dispatch(post('/sign-in/email', { email: EMAIL, password: NEW_PASSWORD }))
assert(newLogin.status === 200, 'New password login failed')
const loginText = await newLogin.clone().text()
assert(!loginText.includes('"token"'), 'Login response exposed a bearer token')
const loginCookie = staffCookie(newLogin)
assertCookiePolicy(loginCookie.raw)

const logout = await dispatch(request('/sign-out', {
  method: 'POST',
  headers: { cookie: loginCookie.pair },
}))
assert(logout.status === 200, 'Logout failed')
const clearedCookie = staffCookie(logout)
assertCookiePolicy(clearedCookie.raw)
assert(clearedCookie.raw.includes('Max-Age=0'), 'Logout did not expire staff cookie')
const signedOut = await dispatch(request('/get-session', { headers: { cookie: loginCookie.pair } }))
assert(await signedOut.text() === 'null', 'Logged-out session remained valid')

for (const host of ['customer.example', 'trimly.co.ke']) {
  const denied = await dispatch(request(`https://${host}/api/auth/get-session`, {}, { host }))
  assert(denied.status === 404, `${host} received staff auth route`)
  assert(cookies(denied).length === 0, `${host} received a staff cookie`)
}
const hostileOrigin = await dispatch(post('/sign-in/email', {
  email: EMAIL,
  password: NEW_PASSWORD,
}, undefined, { origin: 'https://evil.example' }))
assert(hostileOrigin.status === 403, 'Hostile Origin was accepted')
assert(cookies(hostileOrigin).length === 0, 'Hostile Origin received a staff cookie')
const hostMismatch = await dispatch(post('/sign-in/email', {
  email: EMAIL,
  password: NEW_PASSWORD,
}, undefined, { host: 'evil.example' }))
assert(hostMismatch.status === 404, 'Host mismatch was accepted')
assert(cookies(hostMismatch).length === 0, 'Host mismatch received a staff cookie')

process.stdout.write(`${JSON.stringify({
  passed: true,
  signup: true,
  verification: true,
  reload: true,
  reset: true,
  revocation: true,
  logout: true,
  enumerationSafe: true,
  cookiePolicy: true,
  domainOmitted: true,
  bearerBodyOmitted: true,
  hostileOriginDenied: true,
  hostMismatchDenied: true,
  customerHostDenied: true,
  marketingHostDenied: true,
})}\n`)
