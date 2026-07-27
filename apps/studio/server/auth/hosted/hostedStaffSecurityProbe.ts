import { createHmac } from 'node:crypto'
import { memoryAdapter } from 'better-auth/adapters/memory'
import {
  FUMA_STAFF_FRESH_SESSION_SECONDS,
  FUMA_STAFF_MFA_LOCKOUT_SECONDS,
  FUMA_STAFF_MFA_MAX_FAILED_ATTEMPTS,
  FUMA_STAFF_SESSION_COOKIE,
  createHostedAuth,
  resolveHostedSession,
} from './auth'
import {
  LEGACY_STAFF_SESSION_COOKIE,
  invalidateLegacyStaffCookie,
  isLegacyHostedAuthPath,
  rejectLegacyHostedAuth,
} from './cutover'
import { createHostedStaffAuthBoundary } from './routes'
import { AUTH_MODEL_NAMES } from './schemaManifest'
import { withHashedSessionTokens } from './sessionTokenAdapter'

const ORIGIN = 'https://app.fuma.co.ke'
const SECRET = 'fuma-013-native-security-secret-with-at-least-32-characters'
const OWNER_EMAIL = 'owner@fuma.example'
const OWNER_PASSWORD = 'Fuma-owner-password-123!'
const STAFF_EMAIL = 'staff@fuma.example'
const STAFF_PASSWORD = 'Fuma-staff-password-456!'

type Row = Record<string, unknown>
type Database = Record<string, Row[]>
type CookieJar = Map<string, string>

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function fixture() {
  const database: Database = Object.fromEntries(
    Object.values(AUTH_MODEL_NAMES).map((name) => [name, []]),
  )
  const auth = createHostedAuth(
    withHashedSessionTokens(memoryAdapter(database)),
    {
      baseURL: ORIGIN,
      secret: SECRET,
      secureCookies: true,
      cookieName: FUMA_STAFF_SESSION_COOKIE,
    },
    { create: async () => {} },
  )
  const boundary = createHostedStaffAuthBoundary({
    auth,
    origin: ORIGIN,
    cookieName: FUMA_STAFF_SESSION_COOKIE,
    secureCookies: true,
    security: {
      freshSessionSeconds: FUMA_STAFF_FRESH_SESSION_SECONDS,
      protectedOwnerEmail: OWNER_EMAIL,
      resolveSession: async (headers) => await resolveHostedSession(auth, headers),
      findUserEmailById: async (userId) => {
        const user = database[AUTH_MODEL_NAMES.user]!.find((row) => row.id === userId)
        return typeof user?.email === 'string' ? user.email : null
      },
      findSessionUserIdByToken: async (token) => {
        const session = database[AUTH_MODEL_NAMES.session]!.find((row) => row.token === token)
        return typeof session?.userId === 'string' ? session.userId : null
      },
    },
  })
  return { boundary, database }
}

function cookieHeader(jar: CookieJar): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

function applyCookies(response: Response, jar: CookieJar): void {
  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(';', 1)[0]!
    const separator = pair.indexOf('=')
    const name = pair.slice(0, separator)
    const value = pair.slice(separator + 1)
    if (/Max-Age=0/i.test(raw) || value === '') jar.delete(name)
    else jar.set(name, value)
  }
}

function request(
  path: string,
  init: RequestInit = {},
  jar?: CookieJar,
  ipAddress?: string,
): Request {
  const headers = new Headers(init.headers)
  headers.set('host', 'app.fuma.co.ke')
  if (ipAddress) headers.set('x-forwarded-for', ipAddress)
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  if (jar?.size) headers.set('cookie', cookieHeader(jar))
  if ((init.method ?? 'GET').toUpperCase() !== 'GET') headers.set('origin', ORIGIN)
  return new Request(`${ORIGIN}/api/auth${path}`, { ...init, headers })
}

async function dispatch(
  boundary: ReturnType<typeof createHostedStaffAuthBoundary>,
  path: string,
  init: RequestInit = {},
  jar?: CookieJar,
  ipAddress?: string,
): Promise<Response> {
  const response = await boundary.handle(request(path, init, jar, ipAddress))
  assert(response, `Hosted auth did not own ${path}`)
  if (jar) applyCookies(response, jar)
  return response
}

async function post(
  boundary: ReturnType<typeof createHostedStaffAuthBoundary>,
  path: string,
  body: Record<string, unknown>,
  jar?: CookieJar,
  ipAddress?: string,
): Promise<Response> {
  return await dispatch(boundary, path, {
    method: 'POST',
    body: JSON.stringify(body),
  }, jar, ipAddress)
}

async function signup(
  boundary: ReturnType<typeof createHostedStaffAuthBoundary>,
  email: string,
  password: string,
  name: string,
): Promise<CookieJar> {
  const jar: CookieJar = new Map()
  const response = await post(boundary, '/sign-up/email', { email, password, name }, jar)
  assert(response.status === 200, `Signup returned ${response.status}`)
  const body = await response.clone().text()
  assert(!body.includes('"token"'), 'Signup response exposed a bearer token')
  assert(jar.has(FUMA_STAFF_SESSION_COOKIE), 'Signup did not issue staff session cookie')
  return jar
}

async function signin(
  boundary: ReturnType<typeof createHostedStaffAuthBoundary>,
  email: string,
  password: string,
): Promise<{ response: Response; jar: CookieJar }> {
  const jar: CookieJar = new Map()
  const response = await post(boundary, '/sign-in/email', { email, password }, jar)
  return { response, jar }
}

function decodeBase32(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of value.replace(/=+$/u, '').toUpperCase()) {
    const index = alphabet.indexOf(char)
    assert(index >= 0, 'Invalid base32 secret')
    bits += index.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  }
  return Buffer.from(bytes)
}

function totpCode(secret: string): string {
  const counterBytes = Buffer.alloc(8)
  counterBytes.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBytes).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const value = (
    ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff)
  ) % 1_000_000
  return value.toString().padStart(6, '0')
}

async function enroll(
  boundary: ReturnType<typeof createHostedStaffAuthBoundary>,
  jar: CookieJar,
): Promise<{ backupCodes: string[]; secret: string }> {
  const enabled = await post(boundary, '/two-factor/enable', { password: STAFF_PASSWORD }, jar)
  assert(enabled.status === 200, `MFA enable returned ${enabled.status}: ${await enabled.clone().text()}`)
  const body = await enabled.json() as { backupCodes: string[]; totpURI: string }
  const secret = new URL(body.totpURI).searchParams.get('secret')
  assert(secret, 'MFA URI omitted secret')
  const verified = await post(boundary, '/two-factor/verify-totp', { code: totpCode(secret) }, jar)
  assert(verified.status === 200, `MFA enrollment verify returned ${verified.status}`)
  return { backupCodes: body.backupCodes, secret }
}

async function challenge(
  boundary: ReturnType<typeof createHostedStaffAuthBoundary>,
): Promise<CookieJar> {
  const result = await signin(boundary, STAFF_EMAIL, STAFF_PASSWORD)
  assert(result.response.status === 200, `MFA sign-in returned ${result.response.status}`)
  const body = await result.response.json() as Record<string, unknown>
  assert(body.twoFactorRedirect === true, 'MFA sign-in did not require second factor')
  assert(!result.jar.has(FUMA_STAFF_SESSION_COOKIE), 'MFA challenge issued a staff session early')
  return result.jar
}

function rowForEmail(database: Database, email: string): Row {
  const row = database[AUTH_MODEL_NAMES.user]!.find((entry) => entry.email === email)
  assert(row, `Missing user ${email}`)
  return row
}

async function proveRecoveryReplay(): Promise<void> {
  const { boundary } = fixture()
  const session = await signup(boundary, STAFF_EMAIL, STAFF_PASSWORD, 'Staff')
  const { backupCodes } = await enroll(boundary, session)
  await dispatch(boundary, '/sign-out', { method: 'POST' }, session)

  const first = await challenge(boundary)
  const recovered = await post(boundary, '/two-factor/verify-backup-code', { code: backupCodes[0] }, first)
  assert(recovered.status === 200, `Recovery returned ${recovered.status}`)
  assert(first.has(FUMA_STAFF_SESSION_COOKIE), 'Recovery did not issue a session')
  await dispatch(boundary, '/sign-out', { method: 'POST' }, first)

  const replayJar = await challenge(boundary)
  const replay = await post(boundary, '/two-factor/verify-backup-code', { code: backupCodes[0] }, replayJar)
  assert(replay.status === 401, `Recovery replay returned ${replay.status}`)
  assert(!replayJar.has(FUMA_STAFF_SESSION_COOKIE), 'Recovery replay issued a session')
}

async function proveLockout(): Promise<void> {
  const { boundary, database } = fixture()
  const session = await signup(boundary, STAFF_EMAIL, STAFF_PASSWORD, 'Staff')
  const { secret } = await enroll(boundary, session)
  await dispatch(boundary, '/sign-out', { method: 'POST' }, session)
  const pending = await challenge(boundary)
  for (let attempt = 0; attempt < FUMA_STAFF_MFA_MAX_FAILED_ATTEMPTS; attempt += 1) {
    const invalid = await post(
      boundary,
      '/two-factor/verify-totp',
      { code: '000000' },
      pending,
      `198.51.100.${attempt + 1}`,
    )
    assert(invalid.status === 401, `Invalid MFA attempt returned ${invalid.status}`)
  }

  const factor = database[AUTH_MODEL_NAMES.twoFactor]![0]
  assert(
    factor?.failedVerificationCount === FUMA_STAFF_MFA_MAX_FAILED_ATTEMPTS,
    'Failed MFA attempts did not persist against the account',
  )
  assert(
    factor.lockedUntil instanceof Date
      && factor.lockedUntil.getTime() >= Date.now() + (FUMA_STAFF_MFA_LOCKOUT_SECONDS - 1) * 1_000,
    'MFA account lockout expiry was not persisted',
  )

  const freshChallenge = await challenge(boundary)
  const locked = await post(
    boundary,
    '/two-factor/verify-totp',
    { code: totpCode(secret) },
    freshChallenge,
    '203.0.113.10',
  )
  assert(locked.status === 429, `Locked MFA account returned ${locked.status}`)
  assert(!freshChallenge.has(FUMA_STAFF_SESSION_COOKIE), 'Locked MFA account issued a session')
}

async function proveSessions(): Promise<void> {
  const { boundary, database } = fixture()
  const first = await signup(boundary, STAFF_EMAIL, STAFF_PASSWORD, 'Staff')
  const firstStoredToken = String(database[AUTH_MODEL_NAMES.session]![0]!.token)
  const second = await signin(boundary, STAFF_EMAIL, STAFF_PASSWORD)
  assert(second.response.status === 200, 'Second device login failed')
  const listed = await dispatch(boundary, '/list-sessions', {}, second.jar)
  const sessions = await listed.json() as Array<{ token: string }>
  assert(sessions.length === 2, `Expected two sessions, received ${sessions.length}`)
  assert(sessions.every(({ token }) => /^[a-f0-9]{64}$/.test(token)), 'Session list exposed a replayable bearer')
  assert(sessions.every(({ token }) => token !== first.get(FUMA_STAFF_SESSION_COOKIE)), 'Session list exposed bearer')
  const firstSession = sessions.find(({ token }) => token === firstStoredToken)
  assert(firstSession, 'First device revocation handle was not listed')
  const revoked = await post(boundary, '/revoke-session', { token: firstSession.token }, second.jar)
  assert(revoked.status === 200, `Session revoke returned ${revoked.status}`)
  const revokedDevice = await dispatch(boundary, '/get-session', {}, first)
  assert(await revokedDevice.text() === 'null', 'Revoked device session remained usable')
  const remaining = await dispatch(boundary, '/list-sessions', {}, second.jar)
  assert((await remaining.json() as unknown[]).length === 1, 'Revoked device remained active')
}

async function proveAdminAndStepUp(): Promise<void> {
  const { boundary, database } = fixture()
  const ownerJar = await signup(boundary, OWNER_EMAIL, OWNER_PASSWORD, 'Owner')
  await signup(boundary, STAFF_EMAIL, STAFF_PASSWORD, 'Staff')
  const owner = rowForEmail(database, OWNER_EMAIL)
  const staff = rowForEmail(database, STAFF_EMAIL)
  owner.role = 'admin'
  staff.role = 'admin'

  const ownerSession = database[AUTH_MODEL_NAMES.session]!.find((row) => row.userId === owner.id)
  assert(ownerSession, 'Owner session missing')
  ownerSession.createdAt = new Date(Date.now() - (FUMA_STAFF_FRESH_SESSION_SECONDS + 30) * 1_000)
  const stale = await post(boundary, '/admin/ban-user', { userId: staff.id }, ownerJar)
  assert(stale.status === 401 && await stale.text() === '{"error":"step_up_required"}', 'Stale admin session bypassed step-up')

  const stepped = await signin(boundary, OWNER_EMAIL, OWNER_PASSWORD)
  assert(stepped.response.status === 200, 'Owner reauthentication failed')
  const banned = await post(boundary, '/admin/ban-user', {
    userId: staff.id,
    banReason: 'security review',
  }, stepped.jar)
  assert(banned.status === 200, `Staff ban returned ${banned.status}: ${await banned.clone().text()}`)
  assert(!database[AUTH_MODEL_NAMES.session]!.some((row) => row.userId === staff.id), 'Ban did not revoke sessions')
  const denied = await signin(boundary, STAFF_EMAIL, STAFF_PASSWORD)
  assert(denied.response.status === 403, `Banned login returned ${denied.response.status}`)

  const unbanned = await post(boundary, '/admin/unban-user', { userId: staff.id }, stepped.jar)
  assert(unbanned.status === 200, `Staff unban returned ${unbanned.status}`)
  const staffAdmin = await signin(boundary, STAFF_EMAIL, STAFF_PASSWORD)
  assert(staffAdmin.response.status === 200, 'Staff admin login failed')
  for (const [path, body] of [
    ['/admin/ban-user', { userId: owner.id }],
    ['/admin/revoke-user-session', { sessionToken: ownerSession.token }],
    ['/admin/revoke-user-sessions', { userId: owner.id }],
    ['/admin/set-role', { userId: owner.id, role: 'user' }],
    ['/admin/remove-user', { userId: owner.id }],
  ] as const) {
    const response = await post(boundary, path, body, staffAdmin.jar)
    assert(response.status === 403, `Protected owner ${path} returned ${response.status}`)
  }
  assert(rowForEmail(database, OWNER_EMAIL).role === 'admin', 'Protected owner role changed')
  assert(
    database[AUTH_MODEL_NAMES.session]!.some((row) => row.token === ownerSession.token),
    'Protected owner session was revoked',
  )
}

function proveCutover(): void {
  for (const path of [
    '/admin/api/cms/login',
    '/admin/api/cms/logout',
    '/admin/api/cms/setup/status',
    '/admin/api/cms/auth/step-up',
    '/admin/api/cms/me/mfa/totp/start',
    '/admin/api/cms/users/legacy-user',
    '/admin/api/cms/roles/owner',
  ]) assert(isLegacyHostedAuthPath(path), `Legacy auth path remained: ${path}`)
  for (const path of [
    '/admin/api/cms/media',
    '/admin/api/cms/media/folders',
    '/admin/api/cms/site-document',
    '/admin/api/cms/publish',
  ]) assert(!isLegacyHostedAuthPath(path), `Non-auth CMS path was blocked: ${path}`)
  const response = rejectLegacyHostedAuth(new Request('https://app.fuma.co.ke/admin/api/cms/me'))
  const cookie = response.headers.getSetCookie()[0]
  assert(response.status === 401, 'Legacy auth did not require reauthentication')
  assert(cookie?.startsWith(`${LEGACY_STAFF_SESSION_COOKIE}=`), 'Legacy cookie was not expired')
  assert(cookie.includes('Max-Age=0') && cookie.includes('Secure'), 'Legacy cookie expiry is unsafe')

  const oldCookieRequest = new Request('https://app.fuma.co.ke/admin', {
    headers: { cookie: `${LEGACY_STAFF_SESSION_COOKIE}=old-bearer` },
  })
  const accepted = invalidateLegacyStaffCookie(oldCookieRequest, new Response('ok'))
  const proactiveExpiry = accepted.headers.getSetCookie()[0]
  assert(proactiveExpiry?.includes('Max-Age=0'), 'Accepted hosted request retained legacy cookie')
}

async function proveExactHostAndOriginPolicy(): Promise<void> {
  const { boundary } = fixture()
  const wrongHost = await boundary.handle(new Request(`${ORIGIN}/api/auth/get-session`, {
    headers: { host: 'customer.example' },
  }))
  assert(wrongHost?.status === 404, 'Mismatched Host reached hosted auth')
  assert(wrongHost.headers.getSetCookie().length === 0, 'Mismatched Host received a cookie')

  const wrongUrlOrigin = await boundary.handle(new Request(
    'https://customer.example/api/auth/get-session',
    { headers: { host: 'app.fuma.co.ke' } },
  ))
  assert(wrongUrlOrigin?.status === 404, 'Non-product URL origin reached hosted auth')

  const hostileOrigin = await boundary.handle(new Request(`${ORIGIN}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'app.fuma.co.ke',
      origin: 'https://evil.example',
    },
    body: JSON.stringify({ email: STAFF_EMAIL, password: STAFF_PASSWORD }),
  }))
  assert(hostileOrigin?.status === 403, 'Hostile Origin reached a hosted mutation')
}

await proveRecoveryReplay()
await proveLockout()
await proveSessions()
await proveAdminAndStepUp()
await proveExactHostAndOriginPolicy()
proveCutover()

process.stdout.write(`${JSON.stringify({
  passed: true,
  totp: true,
  recoveryReplayDenied: true,
  lockout: true,
  sessions: true,
  banAndRevoke: true,
  protectedOwner: true,
  stepUp: true,
  tokenBodiesOmitted: true,
  exactHostOriginPolicy: true,
  legacyCookieInvalidated: true,
  legacyAuthRemoved: true,
})}\n`)
