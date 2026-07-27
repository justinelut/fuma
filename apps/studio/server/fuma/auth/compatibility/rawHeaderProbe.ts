import { memoryAdapter } from 'better-auth/adapters/memory'
import {
  FUMA_STAFF_SESSION_COOKIE,
  createHostedAuth as createCompatibilityAuth,
} from '../../../auth/hosted/auth'
import { AUTH_MODEL_NAMES } from '../../../auth/hosted/schemaManifest'
import { isStoredSessionToken, withHashedSessionTokens } from '../../../auth/hosted/sessionTokenAdapter'

type Row = Record<string, unknown>
type MemoryDatabase = Record<string, Row[]>

const BASE_URL = 'https://app.fuma.co.ke'
const SECRET = 'fuma-010-native-header-probe-secret-at-least-32-characters'
const PASSWORD = 'Fuma-compatibility-password-123!'
const EMAIL = 'fuma-010-native-probe@example.invalid'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function createAuth(database: MemoryDatabase) {
  for (const modelName of Object.values(AUTH_MODEL_NAMES)) database[modelName] ??= []
  return createCompatibilityAuth(
    withHashedSessionTokens(memoryAdapter(database)),
    { baseURL: BASE_URL, secret: SECRET, secureCookies: true },
    { create: async () => {} },
  )
}

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set('origin', BASE_URL)
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  return new Request(`${BASE_URL}/api/auth${path}`, { ...init, headers })
}

function post(path: string, body: Record<string, unknown>, cookie?: string): Request {
  return request(path, {
    method: 'POST',
    headers: cookie ? { cookie } : undefined,
    body: JSON.stringify(body),
  })
}

function sessionCookie(response: Response): { pair: string; raw: string } {
  const raw = response.headers.getSetCookie()
    .find((entry) => entry.includes(FUMA_STAFF_SESSION_COOKIE))
  assert(raw, 'FUMA-010 native probe did not receive a staff session Set-Cookie header')
  return { pair: raw.split(';', 1)[0]!, raw }
}

const database: MemoryDatabase = {}
const first = createAuth(database)
const signUp = await first.handler(post('/sign-up/email', {
  email: EMAIL,
  name: 'FUMA-010 Native Probe',
  password: PASSWORD,
}))
assert(signUp.status === 200, `FUMA-010 native sign-up returned ${signUp.status}`)

const allSetCookies = signUp.headers.getSetCookie()
const cookie = sessionCookie(signUp)
assert(cookie.raw.includes('HttpOnly'), 'Staff cookie is missing HttpOnly')
assert(cookie.raw.includes('SameSite=Lax'), 'Staff cookie is missing SameSite=Lax')
assert(cookie.raw.includes('Path=/'), 'Staff cookie is missing Path=/')
assert(cookie.raw.includes('Secure'), 'Staff cookie is missing Secure')
assert(allSetCookies.every((entry) => !/(?:^|;)\s*Domain=/i.test(entry)), 'Staff cookie is not host-only')

const storedSession = database[AUTH_MODEL_NAMES.session]?.[0]
const storedAccount = database[AUTH_MODEL_NAMES.account]?.[0]
assert(isStoredSessionToken(storedSession?.token), 'Session token is not a SHA-256 at-rest value')
assert(!cookie.pair.includes(storedSession.token), 'Persisted session hash appears in the bearer cookie')
assert(String(storedAccount?.password).startsWith('$argon2id$'), 'Credential is not an Argon2id hash')

const restarted = createAuth(database)
const afterRestart = await restarted.handler(request('/get-session', {
  headers: { cookie: cookie.pair },
}))
assert(afterRestart.status === 200, 'Session lookup after auth reconstruction failed')
assert((await afterRestart.text()).includes(EMAIL), 'Restarted auth instance did not resolve the session')

const signOut = await restarted.handler(request('/sign-out', {
  method: 'POST',
  headers: { cookie: cookie.pair },
}))
assert(signOut.status === 200, 'Session revoke failed')
assert(signOut.headers.getSetCookie().every((entry) => !/(?:^|;)\s*Domain=/i.test(entry)), 'Revoke cookie is not host-only')
assert(database[AUTH_MODEL_NAMES.session]?.length === 0, 'Revoked session remains persisted')

const afterRevoke = await restarted.handler(request('/get-session', {
  headers: { cookie: cookie.pair },
}))
assert(await afterRevoke.text() === 'null', 'Revoked bearer cookie still resolves')

process.stdout.write(`${JSON.stringify({
  passed: true,
  platform: process.platform,
  arch: process.arch,
  hostOnly: true,
  argon2id: true,
  hashedSessionToken: true,
  restart: true,
  revoke: true,
})}\n`)
