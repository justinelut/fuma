import postgres from 'postgres'
import {
  FUMA_STAFF_SESSION_COOKIE,
  createPostgresHostedAuth as createPostgresCompatibilityAuth,
} from '../../../auth/hosted/auth'
import { isStoredSessionToken } from '../../../auth/hosted/sessionTokenAdapter'
import { installCompatibilitySchema } from './postgresGateSchema'

const BASE_URL = 'https://app.trimly.co.ke'
const SECRET = 'fuma-010-postgres-probe-secret-at-least-32-characters'
const PASSWORD = 'Fuma-compatibility-password-123!'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
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

function sessionCookie(response: Response): string {
  const raw = response.headers.getSetCookie()
    .find((entry) => entry.includes(FUMA_STAFF_SESSION_COOKIE))
  assert(raw, 'FUMA-010 PostgreSQL probe did not receive a staff session cookie')
  return raw.split(';', 1)[0]!
}

const databaseUrl = process.env.FUMA_AUTH_COMPAT_POSTGRES_URL
assert(databaseUrl, 'FUMA_AUTH_COMPAT_POSTGRES_URL is required')

const adminClient = postgres(databaseUrl, { max: 1 })
const schema = `fuma_auth_compat_${process.pid}_${Date.now()}`
const email = `fuma-010-postgres-${Date.now()}@example.invalid`
const input = {
  baseURL: BASE_URL,
  secret: SECRET,
  secureCookies: true,
  databaseUrl,
  searchPath: schema,
}
let active: ReturnType<typeof createPostgresCompatibilityAuth> | undefined

try {
  await installCompatibilitySchema(schema, async (statement) => await adminClient.unsafe(statement))

  active = createPostgresCompatibilityAuth(input)
  const createResponse = await active.auth.handler(post('/sign-up/email', {
    email,
    name: 'FUMA-010 PostgreSQL Probe',
    password: PASSWORD,
  }))
  assert(createResponse.status === 200, `PostgreSQL sign-up returned ${createResponse.status}`)
  assert(createResponse.headers.getSetCookie().every((entry) => !/(?:^|;)\s*Domain=/i.test(entry)), 'Create cookie has Domain')
  await active.close()
  active = undefined

  active = createPostgresCompatibilityAuth(input)
  const loginResponse = await active.auth.handler(post('/sign-in/email', {
    email,
    password: PASSWORD,
  }))
  assert(loginResponse.status === 200, `PostgreSQL login returned ${loginResponse.status}`)
  const cookie = sessionCookie(loginResponse)
  await active.close()
  active = undefined

  active = createPostgresCompatibilityAuth(input)
  const restartedSession = await active.auth.handler(request('/get-session', {
    headers: { cookie },
  }))
  assert(restartedSession.status === 200, 'PostgreSQL restarted session lookup failed')
  assert((await restartedSession.text()).includes(email), 'PostgreSQL restarted auth did not resolve the session')

  const storedSessions = await adminClient.unsafe<{ token: string }[]>(
    `select token from "${schema}".auth_sessions order by created_at desc`,
  )
  const storedAccounts = await adminClient.unsafe<{ password: string }[]>(
    `select password from "${schema}".auth_accounts where provider_id = 'credential'`,
  )
  assert(storedSessions.length > 0, 'PostgreSQL probe found no persisted session')
  assert(storedSessions.every(({ token }) => isStoredSessionToken(token)), 'PostgreSQL contains a raw session token')
  assert(storedSessions.every(({ token }) => !cookie.includes(token)), 'PostgreSQL session hash is replayable as the cookie')
  assert(storedAccounts[0]?.password.startsWith('$argon2id$'), 'PostgreSQL credential is not Argon2id')

  const revoke = await active.auth.handler(request('/sign-out', {
    method: 'POST',
    headers: { cookie },
  }))
  assert(revoke.status === 200, 'PostgreSQL session revoke failed')
  const afterRevoke = await active.auth.handler(request('/get-session', {
    headers: { cookie },
  }))
  assert(await afterRevoke.text() === 'null', 'PostgreSQL revoked cookie still resolves')

  const remaining = await adminClient.unsafe<{ count: number }[]>(
    `select count(*)::int as count from "${schema}".auth_sessions`,
  )
  assert(remaining[0]?.count === 0, 'PostgreSQL revoked session remains persisted')

  process.stdout.write(`${JSON.stringify({
    passed: true,
    postgres: true,
    create: true,
    login: true,
    restart: true,
    revoke: true,
    hostOnly: true,
    argon2id: true,
    hashedSessionToken: true,
  })}\n`)
} finally {
  await active?.close()
  await adminClient.unsafe(`drop schema if exists "${schema}" cascade`)
  await adminClient.end({ timeout: 5 })
}
