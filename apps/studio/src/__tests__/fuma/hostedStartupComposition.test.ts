import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import {
  createHostedFumaScopedApi,
  createHostedStaffAuthRuntime,
  type HostedStaffAuthRuntime,
} from '../../../server/auth/hosted/runtime'
import {
  BILLING_DUNNING_JOB,
  QUOTA_USAGE_COLLECTION_JOB,
  createQuotaRuntime,
} from '../../../server/fuma/quotas'

const ORIGIN = 'https://hosted.fuma.test'
const HOST = 'hosted.fuma.test'
const SCOPED_EDITOR_URL = `${ORIGIN}/api/fuma/organizations/org-a/workspaces/workspace-a/sites/site-a/editor/document`

function database(dialect: 'postgres' | 'sqlite'): DbClient {
  const query = (async <Row>(): Promise<DbResult<Row>> => {
    throw new Error('Unexpected database query')
  }) as DbClient
  query.dialect = dialect
  query.unsafe = async <Row>(): Promise<DbResult<Row>> => {
    throw new Error('Unexpected unsafe database query')
  }
  query.transaction = async <T>(_work: (transaction: DbClient) => Promise<T>): Promise<T> => {
    throw new Error('Unexpected database transaction')
  }
  return query
}

function request(path: string, init: RequestInit = {}): Request {
  const allowedHeaders = new Headers(init.headers)
  const NativeResponse = (globalThis as Record<PropertyKey, unknown>)[
    Symbol.for('instatic.test.nativeResponse')
  ] as typeof Response
  const nativeHeaders = new NativeResponse(null, { headers: allowedHeaders }).headers
  nativeHeaders.set('host', HOST)
  function retainHeaders(current: Request): Request {
    const clone = current.clone.bind(current)
    Object.defineProperty(current, 'headers', { value: nativeHeaders })
    Object.defineProperty(current, 'clone', {
      value: () => retainHeaders(clone()),
    })
    return current
  }
  return retainHeaders(new Request(`${ORIGIN}${path}`, { ...init, headers: allowedHeaders }))
}

function runtime(
  resolveSession: HostedStaffAuthRuntime['resolveSession'],
): HostedStaffAuthRuntime {
  const boundary = Object.freeze({
    origin: ORIGIN,
    host: HOST,
    cookieName: '__Host-fuma_staff',
    handlesProductRequest: (candidate: Request) => (
      new URL(candidate.url).origin === ORIGIN
      && candidate.headers.get('host')?.toLowerCase() === HOST
    ),
    handle: async () => null,
  })
  return Object.freeze({
    boundary,
    resolveSession,
    allowsMutationOrigin: (candidate: Request) => (
      boundary.handlesProductRequest(candidate)
      && candidate.headers.get('origin') === boundary.origin
    ),
    close: async () => {},
  })
}

describe('FUMA-027 hosted startup composition', () => {
  it('exposes the Better Auth resolver and exact hosted mutation-origin policy', async () => {
    const auth = createHostedStaffAuthRuntime({
      databaseUrl: 'postgres://localhost:1/fuma_startup_composition',
      productHost: HOST,
      protectedOwnerEmail: 'owner@fuma.test',
      secureCookies: true,
      cookieName: '__Host-fuma_staff',
      secret: 'fuma-startup-composition-secret-32-characters',
      delivery: {
        sendVerification: async () => {},
        sendPasswordReset: async () => {},
      },
    })

    expect(auth.resolveSession).toBeFunction()
    expect(auth.close).toBeFunction()
    const allowedMutation = request('/api/fuma/example', {
      method: 'PUT',
      headers: { origin: ORIGIN },
    })
    expect(allowedMutation.headers.get('host')).toBe(HOST)
    expect(allowedMutation.headers.get('origin')).toBe(ORIGIN)
    expect(auth.boundary.handlesProductRequest(allowedMutation)).toBe(true)
    expect(auth.allowsMutationOrigin(allowedMutation)).toBe(true)
    expect(auth.allowsMutationOrigin(request('/api/fuma/example', {
      method: 'PUT',
      headers: { origin: 'https://attacker.test' },
    }))).toBe(false)
    expect(auth.allowsMutationOrigin(new Request(SCOPED_EDITOR_URL, {
      method: 'PUT',
      headers: { host: 'attacker.test', origin: ORIGIN },
    }))).toBe(false)

    await auth.close()
  })

  it('constructs no hosted authority for self-host SQLite or PostgreSQL', () => {
    expect(createHostedFumaScopedApi({
      db: database('sqlite'),
      hostedStaffAuth: undefined,
    })).toBeUndefined()
    expect(createHostedFumaScopedApi({
      db: database('postgres'),
      hostedStaffAuth: undefined,
    })).toBeUndefined()
  })

  it('mounts production PostgreSQL editor authority with the trusted resolver and origin policy', async () => {
    let resolvedHeaders: Headers | null = null
    let resolveCalls = 0
    const auth = runtime(async (headers) => {
      resolveCalls += 1
      resolvedHeaders = headers
      return null
    })
    const scopedApi = createHostedFumaScopedApi({
      db: database('postgres'),
      hostedStaffAuth: auth,
    })
    expect(scopedApi).toBeDefined()

    const rejectedMutation = request(new URL(SCOPED_EDITOR_URL).pathname, {
      method: 'PUT',
      headers: { origin: 'https://attacker.test' },
    })
    const rejectedResponse = await scopedApi?.handle(rejectedMutation)
    expect(rejectedResponse?.status).toBe(403)
    expect(await rejectedResponse?.json()).toEqual({ error: 'Origin not allowed.' })
    expect(resolveCalls).toBe(0)

    const read = request(new URL(SCOPED_EDITOR_URL).pathname)
    const readResponse = await scopedApi?.handle(read)
    expect(readResponse?.status).toBe(401)
    expect(await readResponse?.json()).toEqual({ error: 'Authentication required.' })
    expect(resolveCalls).toBe(1)
    expect(resolvedHeaders).toBe(read.headers)
  })

  it('rejects a hosted runtime backed by non-PostgreSQL persistence', () => {
    expect(() => createHostedFumaScopedApi({
      db: database('sqlite'),
      hostedStaffAuth: runtime(async () => null),
    })).toThrow('Fuma request-context authority requires PostgreSQL.')
  })

  it('composes quota self-service, forecast, dunning, and continuous collection boundaries', () => {
    const quotas = createQuotaRuntime({ db: database('postgres') })
    expect(quotas.scopedRoutes.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /quotas/self-service',
      'GET /quotas/self-service/export',
      'POST /quotas/forecast',
      'POST /quotas/top-up-requests',
      'POST /billing/cancellation',
    ])
    expect(Object.keys(quotas.jobs).sort()).toEqual([
      BILLING_DUNNING_JOB,
      QUOTA_USAGE_COLLECTION_JOB,
    ].sort())
  })

  it('retains cleanup and injects the scoped API at the server composition root', async () => {
    const source = await Bun.file(new URL('../../../server/index.ts', import.meta.url)).text()
    expect(source).toContain('const hostedStaffAuthRuntime = hostedFumaConfig')
    expect(source).toContain('hostedStaffAuth: hostedStaffAuthRuntime')
    expect(source).toContain('fumaScopedApi,')
    expect(source).toContain('await Promise.all([')
    expect(source).toContain('hostedStaffAuthRuntime?.close(),')
  })
})
