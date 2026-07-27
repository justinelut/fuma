import { describe, expect, it } from 'bun:test'
import { memoryAdapter } from 'better-auth/adapters/memory'
import {
  FUMA_STAFF_SESSION_COOKIE,
  createHostedAuth,
} from '../../../server/auth/hosted/auth'
import { createHostedAuthFakeInbox } from '../../../server/auth/hosted/fakeInbox'
import { createHostedStaffAuthBoundary } from '../../../server/auth/hosted/routes'
import { AUTH_MODEL_NAMES } from '../../../server/auth/hosted/schemaManifest'
import { withHashedSessionTokens } from '../../../server/auth/hosted/sessionTokenAdapter'

const ORIGIN = 'https://app.fuma.co.ke'
const SECRET = 'fuma-012-integration-secret-with-at-least-32-characters'
const EMAIL = 'staff@fuma.example'
const PASSWORD = 'Fuma-staff-password-123!'

type MemoryRow = Record<string, unknown>
type MemoryDatabase = Record<string, MemoryRow[]>

function initializedDatabase(): MemoryDatabase {
  return Object.fromEntries(Object.values(AUTH_MODEL_NAMES).map((name) => [name, []]))
}

function fixture() {
  const database = initializedDatabase()
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
  return { boundary, database, inbox }
}

function authRequest(
  pathOrUrl: string,
  init: RequestInit = {},
  options: Readonly<{ host?: string; origin?: string | null }> = {},
): Request {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${ORIGIN}/api/auth${pathOrUrl}`
  const NativeResponse = (globalThis as Record<PropertyKey, unknown>)[Symbol.for('instatic.test.nativeResponse')] as typeof Response
  const allowedHeaders = new Headers(init.headers)
  if (init.body !== undefined) allowedHeaders.set('content-type', 'application/json')
  const nativeHeaders = new NativeResponse(null, { headers: allowedHeaders }).headers
  nativeHeaders.set('host', options.host ?? new URL(url).host)
  if ((init.method ?? 'GET') !== 'GET' && options.origin !== null) {
    nativeHeaders.set('origin', options.origin ?? ORIGIN)
  }
  function retainHeaders(current: Request): Request {
    const clone = current.clone.bind(current)
    Object.defineProperty(current, 'headers', { value: nativeHeaders })
    Object.defineProperty(current, 'clone', {
      value: () => retainHeaders(clone()),
    })
    return current
  }
  return retainHeaders(new Request(url, { ...init, headers: allowedHeaders }))
}

function post(
  path: string,
  body: Record<string, unknown>,
  cookie?: string,
  options?: Readonly<{ host?: string; origin?: string | null }>,
): Request {
  return authRequest(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: cookie ? { cookie } : undefined,
  }, options)
}

function setCookies(response: Response): readonly string[] {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  if (typeof getSetCookie === 'function') return getSetCookie.call(response.headers)
  const cookie = response.headers.get('set-cookie')
  return cookie ? [cookie] : []
}

async function dispatch(
  boundary: ReturnType<typeof createHostedStaffAuthBoundary>,
  request: Request,
): Promise<Response> {
  const response = await boundary.handle(request)
  if (!response) throw new Error('Hosted auth boundary did not own the request')
  return response
}

async function signUpAndVerify() {
  const current = fixture()
  const signup = await dispatch(current.boundary, post('/sign-up/email', {
    name: 'Fuma Staff',
    email: EMAIL,
    password: PASSWORD,
    callbackURL: '/admin?verified=true',
  }))
  expect(signup.status).toBe(200)
  expect(setCookies(signup)).toHaveLength(0)

  const message = current.inbox.latest(EMAIL, 'verification')
  expect(message).not.toBeNull()
  const verification = await dispatch(current.boundary, authRequest(message!.url))
  expect(verification.status).toBe(302)
  expect(verification.headers.get('location')).toBe('/admin?verified=true')
  return current
}

async function runNativeProbe(): Promise<string> {
  const child = Bun.spawn({
    cmd: [process.execPath, 'server/auth/hosted/hostedStaffAuthProbe.ts'],
    cwd: import.meta.dir.endsWith('/src/__tests__/fuma')
      ? `${import.meta.dir}/../../..`
      : import.meta.dir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`Native hosted auth probe failed: ${stderr || stdout}`)
  return stdout
}

describe('FUMA-012 same-origin hosted staff auth', () => {
  it('completes signup, fake-inbox verification, reload, reset revocation, login, and logout', async () => {
    const evidence = await runNativeProbe()
    expect(evidence).toContain('"passed":true')
    expect(evidence).toContain('"cookiePolicy":true')
    expect(evidence).toContain('"domainOmitted":true')
    expect(evidence).toContain('"bearerBodyOmitted":true')
    expect(evidence).toContain('"revocation":true')
    expect(evidence).toContain('"customerHostDenied":true')
    expect(evidence).toContain('"marketingHostDenied":true')
  }, 20_000)

  it('keeps signup and verification resend enumeration-safe', async () => {
    const { boundary } = await signUpAndVerify()
    const duplicate = await dispatch(boundary, post('/sign-up/email', {
      name: 'Other Name',
      email: EMAIL.toUpperCase(),
      password: 'Different-safe-password-789!',
      callbackURL: '/admin?verified=true',
    }))
    expect(duplicate.status).toBe(200)
    expect(setCookies(duplicate)).toHaveLength(0)

    const existing = await dispatch(boundary, post('/send-verification-email', {
      email: EMAIL,
      callbackURL: '/admin?verified=true',
    }))
    const missing = await dispatch(boundary, post('/send-verification-email', {
      email: 'missing@fuma.example',
      callbackURL: '/admin?verified=true',
    }))
    expect(existing.status).toBe(200)
    expect(missing.status).toBe(200)
    expect(await existing.text()).toBe(await missing.text())
  }, 20_000)

  it('denies hostile origins, Host mismatches, customer hosts, marketing hosts, and deferred endpoint surfaces', async () => {
    const { boundary, database } = fixture()
    const beforeUsers = database[AUTH_MODEL_NAMES.user]!.length

    const hostileOrigin = await dispatch(boundary, post('/sign-up/email', {
      name: 'Attacker',
      email: 'attacker@example.com',
      password: PASSWORD,
    }, undefined, { origin: 'https://evil.example' }))
    expect(hostileOrigin.status).toBe(403)
    expect(setCookies(hostileOrigin)).toHaveLength(0)

    const missingOrigin = await dispatch(boundary, post('/sign-up/email', {
      name: 'Attacker',
      email: 'attacker@example.com',
      password: PASSWORD,
    }, undefined, { origin: null }))
    expect(missingOrigin.status).toBe(403)
    expect(setCookies(missingOrigin)).toHaveLength(0)

    const hostMismatch = await dispatch(boundary, post('/sign-in/email', {
      email: EMAIL,
      password: PASSWORD,
    }, undefined, { host: 'evil.example' }))
    expect(hostMismatch.status).toBe(404)
    expect(setCookies(hostMismatch)).toHaveLength(0)

    for (const host of ['customer.example', 'fuma.co.ke']) {
      const wrongHost = await dispatch(boundary, authRequest(
        `https://${host}/api/auth/get-session`,
        {},
        { host },
      ))
      expect(wrongHost.status).toBe(404)
      expect(setCookies(wrongHost)).toHaveLength(0)
    }

    const memberOrAdminSurface = await dispatch(boundary, post('/admin/create-user', {
      email: 'member@example.com',
      password: PASSWORD,
      name: 'Member',
    }))
    expect(memberOrAdminSurface.status).toBe(404)
    expect(setCookies(memberOrAdminSurface)).toHaveLength(0)
    expect(database[AUTH_MODEL_NAMES.user]).toHaveLength(beforeUsers)
  })
})
