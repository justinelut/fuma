import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import type { DbClient, DbResult } from '../../../server/db/client'
import type { FumaRequestContext } from '../../../server/fuma/context'
import {
  BetterAuthNextSourceOwnerConfirmation,
  GitHubAppInstallationTokenAuthority,
  GitHubAppNextSourceExportAdapter,
  SafeGitHubZipballFetchPort,
  type HostedNextSourceGitHubConfig,
  type NextSourceScope,
} from '../../../server/fuma/nextSource'
import type { NextSourceGitHubAppTokenPort, NextSourceGitHubTokenRequest, NextSourceTokenLease } from '@core/siteImport'

const NOW = new Date('2026-08-03T10:00:00.000Z')
const COMMIT = 'a'.repeat(40)
const config = (() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return Object.freeze({
    appId: '12345',
    privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    userAgent: 'fuma-next-source-test/1',
  }) satisfies HostedNextSourceGitHubConfig
})()

function result<Row>(rows: Row[]): DbResult<Row> {
  return { rows, rowCount: rows.length }
}

function fakeDb(unsafe: DbClient['unsafe']): DbClient {
  const db = (async () => result([])) as DbClient
  db.unsafe = unsafe
  db.transaction = async <T>(work: (tx: DbClient) => Promise<T>) => await work(db)
  Object.defineProperty(db, 'dialect', { value: 'postgres' })
  return db
}

function context(input: Readonly<{ impersonated?: boolean }> = {}): FumaRequestContext {
  const impersonatedBy = input.impersonated ? 'support-user' : null
  return {
    requestId: 'request-next-source',
    source: { kind: 'staff-session', correlationId: 'correlation-next-source', userId: 'owner-user', sessionId: 'owner-session', impersonatedBy },
    actor: { kind: 'staff', userId: 'owner-user', sessionId: 'owner-session', impersonator: impersonatedBy ? { userId: impersonatedBy } : null },
    scope: {
      platform: { id: 'platform-main', status: 'active' },
      organization: { id: 'organization-main', platformId: 'platform-main', status: 'active' },
      workspace: { id: 'workspace-main', platformId: 'platform-main', organizationId: 'organization-main', status: 'active' },
      site: { id: 'site-main', platformId: 'platform-main', organizationId: 'organization-main', workspaceId: 'workspace-main', profileId: 'website', status: 'active' },
    },
    profile: { id: 'website', status: 'active' },
    capabilities: [],
    permissions: { subjectId: 'owner-user', allow: ['site.structure.edit'], deny: [] },
  }
}

const scope: NextSourceScope = Object.freeze({
  platformId: 'platform-main',
  organizationId: 'organization-main',
  workspaceId: 'workspace-main',
  siteId: 'site-main',
  ownerKey: 'owner-key-main',
  ownerGeneration: 7,
  profileId: 'website',
})

describe('FUMA-077 production GitHub authority', () => {
  test('signs server-side App JWTs and requests one exact repository with exact permissions', async () => {
    let captured: Readonly<{ url: string; init: RequestInit }> | null = null
    const authority = new GitHubAppInstallationTokenAuthority({
      config,
      now: () => NOW,
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        captured = { url: String(input), init: init ?? {} }
        return Response.json({ token: 'installation-token-value', expires_at: '2026-08-03T10:30:00.000Z' }, { status: 201 })
      }) as typeof fetch,
    })

    const lease = await authority.issueInstallationToken({
      installationId: '98765',
      owner: 'CoreBunch',
      repository: 'the-lawyer',
      permissions: { contents: 'read', pullRequests: 'read' },
    })
    expect(captured?.url).toBe('https://api.github.com/app/installations/98765/access_tokens')
    expect(captured?.init.method).toBe('POST')
    expect(captured?.init.redirect).toBe('error')
    expect(captured?.init.credentials).toBe('omit')
    expect(JSON.parse(String(captured?.init.body))).toEqual({
      repositories: ['the-lawyer'],
      permissions: { contents: 'read', pull_requests: 'read' },
    })
    const authorization = new Headers(captured?.init.headers).get('authorization')
    expect(authorization).toStartWith('Bearer ')
    expect(authorization).not.toContain('installation-token-value')
    const jwt = authorization!.slice('Bearer '.length)
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>
    const nowSeconds = Math.floor(NOW.getTime() / 1_000)
    expect(payload).toMatchObject({ iss: '12345', iat: nowSeconds - 30, exp: nowSeconds + 9 * 60 })
    expect(lease.token).toBe('installation-token-value')
    await lease.release()
    expect(() => lease.token).toThrow('released')
  })

  test('rejects malformed repository scope before provider access', async () => {
    let calls = 0
    const authority = new GitHubAppInstallationTokenAuthority({
      config,
      fetch: (async () => { calls += 1; throw new Error('must not call provider') }) as typeof fetch,
    })
    await expect(authority.issueInstallationToken({
      installationId: '1',
      owner: 'CoreBunch',
      repository: '../escape',
      permissions: { contents: 'write', pullRequests: 'write' },
    })).rejects.toThrow('scope is invalid')
    expect(calls).toBe(0)
  })

  test('strips authorization on the exact codeload redirect and rejects every other destination', async () => {
    const requests: Request[] = []
    const transport = new SafeGitHubZipballFetchPort((async (input: string | URL | Request) => {
      const request = input instanceof Request ? input : new Request(input)
      requests.push(request)
      if (requests.length === 1) {
        return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/CoreBunch/the-lawyer/legacy.zip/${COMMIT}` } })
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    }) as typeof fetch)
    const response = await transport.fetch(new Request(`https://api.github.com/repos/CoreBunch/the-lawyer/zipball/${COMMIT}`, {
      headers: { authorization: 'Bearer installation-secret', 'user-agent': config.userAgent },
    }))
    expect(response.status).toBe(200)
    expect(requests).toHaveLength(2)
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer installation-secret')
    expect(requests[1]!.headers.has('authorization')).toBe(false)
    expect(requests[1]!.credentials).toBe('omit')
    expect(requests[1]!.redirect).toBe('error')
  })

  test('releases least-privilege export leases even when provider transport fails', async () => {
    const tokenRequests: NextSourceGitHubTokenRequest[] = []
    let released = 0
    const tokens: NextSourceGitHubAppTokenPort = {
      async issueInstallationToken(request): Promise<NextSourceTokenLease> {
        tokenRequests.push(request)
        return {
          token: 'ephemeral-export-token',
          expiresAt: '2026-08-03T10:30:00.000Z',
          async release() { released += 1 },
        }
      },
    }
    const adapter = new GitHubAppNextSourceExportAdapter({
      tokens,
      installationId: '98765',
      config,
      fetch: (async () => { throw new Error('provider unavailable') }) as typeof fetch,
    })
    await expect(adapter.branchExists('CoreBunch', 'the-lawyer', 'fuma/export')).rejects.toThrow('provider unavailable')
    expect(tokenRequests).toEqual([{
      installationId: '98765',
      owner: 'CoreBunch',
      repository: 'the-lawyer',
      permissions: { contents: 'read', pullRequests: 'read' },
    }])
    expect(released).toBe(1)
  })
})

describe('FUMA-077 Better Auth owner confirmation', () => {
  test('re-proves exact fresh direct session, current ban state, receipt ancestry, and owner generation', async () => {

    let sql = ''
    let parameters: readonly unknown[] = []
    const db = fakeDb(async <Row>(query: string, values?: readonly unknown[]) => {
      sql = query
      parameters = values ?? []
      return result([{ generation: '7', organization_role: 'owner', workspace_access: null, workspace_role: null } as Row])
    })
    const confirmation = new BetterAuthNextSourceOwnerConfirmation({
      db,
      context: context(),
      requestHeaders: new Headers({ cookie: '__Host-fuma_staff=opaque' }),
      resolveSession: async () => ({
        userId: 'owner-user',
        sessionId: 'owner-session',
        impersonatedBy: null,
        email: 'owner@example.com',
        createdAt: new Date(Date.now() - 30_000),
      }),
      scope,
    })
    const decision = await confirmation.verifyOwner({
      receiptId: 'next-fix:receipt',
      actorId: 'owner-user',
      destination: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, siteId: scope.siteId },
      expectedOwnerGeneration: scope.ownerGeneration,
    })
    expect(decision).toEqual({ active: true, direct: true, impersonating: false, ownerGeneration: 7 })
    expect(sql).toContain('join auth_sessions current_session')
    expect(sql).toContain('join auth_users current_user')
    expect(sql).toContain('current_session.expires_at>current_timestamp')
    expect(sql).toContain('current_user.banned is not true')
    expect(sql).toContain('revision.revision_id=(select source_revision_id')
    expect(parameters).toContain('next-fix:receipt')
    expect(parameters).toContain('owner-session')
    expect(parameters).toContain(7)
  })

  test('fails closed for impersonated, stale, or internal-job authority without owner SQL', async () => {
    let calls = 0
    const db = fakeDb(async <Row>() => { calls += 1; return result<Row>([]) })
    const request = {
      receiptId: 'next-fix:receipt',
      actorId: 'owner-user',
      destination: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, siteId: scope.siteId },
      expectedOwnerGeneration: scope.ownerGeneration,
    }
    const impersonated = new BetterAuthNextSourceOwnerConfirmation({
      db,
      context: context({ impersonated: true }),
      requestHeaders: new Headers(),
      resolveSession: async () => ({ userId: 'owner-user', sessionId: 'owner-session', impersonatedBy: 'support-user', email: 'owner@example.com', createdAt: new Date() }),
      scope,
    })
    expect((await impersonated.verifyOwner(request)).active).toBe(false)

    const stale = new BetterAuthNextSourceOwnerConfirmation({
      db,
      context: context(),
      requestHeaders: new Headers(),
      resolveSession: async () => ({ userId: 'owner-user', sessionId: 'owner-session', impersonatedBy: null, email: 'owner@example.com', createdAt: new Date(Date.now() - 10 * 60_000) }),
      scope,
    })
    expect((await stale.verifyOwner(request)).active).toBe(false)

    const internalContext = { ...context(), actor: { kind: 'internal-job' as const, jobId: 'job', runId: 'run' }, source: { kind: 'internal-job' as const, correlationId: 'correlation', jobId: 'job', runId: 'run' } } as FumaRequestContext
    const internal = new BetterAuthNextSourceOwnerConfirmation({ db, context: internalContext, requestHeaders: new Headers(), resolveSession: async () => null, scope })
    expect((await internal.verifyOwner(request)).active).toBe(false)
    expect(calls).toBe(0)
  })
})
