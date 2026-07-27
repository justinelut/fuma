import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import {
  createFumaScopedRouteBoundaryFactory,
  createPostgresFumaScopedRouteBoundaryFactory,
  type FumaRequestContextAuthorityPorts,
  type FumaSiteAuthorizationInput,
} from '../../../server/fuma/context'
import type {
  FumaRepositoryScopeCoordinate,
  FumaRepositoryScopeOwnerKeyAuthority,
} from '../../../server/fuma/tenancy'

const ORIGIN = 'https://hosted.fuma.test'
const PLATFORM_ID = 'platform-fuma'
const ORGANIZATION_ID = 'organization-http'
const WORKSPACE_ID = 'workspace-http'
const SITE_ID = 'site-http'
const USER_ID = 'user-http'
const BASE_PATH = `/api/fuma/organizations/${ORGANIZATION_ID}/workspaces/${WORKSPACE_ID}/sites/${SITE_ID}`

function authorization(): FumaSiteAuthorizationInput {
  const binding = {
    platformId: PLATFORM_ID,
    organizationId: ORGANIZATION_ID,
    workspaceId: WORKSPACE_ID,
    siteId: SITE_ID,
  }
  return {
    platformOrganizationId: 'organization-platform',
    platform: { id: PLATFORM_ID, status: 'active' },
    organization: {
      id: ORGANIZATION_ID,
      platformId: PLATFORM_ID,
      kind: 'customer',
      status: 'active',
    },
    workspace: {
      id: WORKSPACE_ID,
      platformId: PLATFORM_ID,
      organizationId: ORGANIZATION_ID,
      status: 'active',
    },
    site: {
      id: SITE_ID,
      platformId: PLATFORM_ID,
      organizationId: ORGANIZATION_ID,
      workspaceId: WORKSPACE_ID,
      profileId: 'website',
      status: 'active',
    },
    profile: { ...binding, id: 'website', status: 'active' },
    capabilities: {
      ...binding,
      profileId: 'website',
      overrides: { grant: [], revoke: [] },
    },
    permissions: {
      subjectId: USER_ID,
      scope: { kind: 'site', ...binding },
      protectedOwnerInvariant: null,
      roleAssignments: [{
        id: 'assignment.http',
        subjectId: USER_ID,
        scope: {
          kind: 'organization',
          platformId: PLATFORM_ID,
          organizationId: ORGANIZATION_ID,
        },
        role: { kind: 'launch-persona', persona: 'member' },
      }],
      permissionOverrides: [],
      customRoles: [],
    },
  }
}

function authorityFixture() {
  let sessionCalls = 0
  let authorizationCalls = 0
  const ports: FumaRequestContextAuthorityPorts = {
    sessions: {
      async authenticateSameOriginHostedSession() {
        sessionCalls += 1
        return {
          kind: 'staff',
          userId: USER_ID,
          sessionId: 'session-http',
          impersonator: null,
        }
      },
    },
    authorization: {
      async loadExactSiteAuthorization() {
        authorizationCalls += 1
        return authorization()
      },
    },
  }
  return {
    ports,
    sessionCalls: () => sessionCalls,
    authorizationCalls: () => authorizationCalls,
  }
}

function ownerRecord(coordinate: FumaRepositoryScopeCoordinate) {
  return {
    ownerKey: 'owner-http-stable',
    coordinate: { ...coordinate },
    state: 'active' as const,
    generation: 3,
    transferId: null,
    transferLockId: null,
    transferFence: null,
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
  }
}

function ownerAuthority(seen: FumaRepositoryScopeCoordinate[] = []) {
  const authority: FumaRepositoryScopeOwnerKeyAuthority = {
    async loadOwnerKey(coordinate) {
      seen.push(coordinate)
      return ownerRecord(coordinate)
    },
  }
  return authority
}

function request(
  suffix: string,
  options: Readonly<{
    method?: string
    headers?: Readonly<Record<string, string>>
    body?: unknown
  }> = {},
): Request {
  const headers = new Headers(options.headers)
  const body = options.body === undefined ? undefined : JSON.stringify(options.body)
  if (body !== undefined) headers.set('content-type', 'application/json')
  if ((options.method ?? 'GET') !== 'GET') headers.set('origin', ORIGIN)
  return new Request(`${ORIGIN}${BASE_PATH}${suffix}`, {
    method: options.method ?? 'GET',
    headers,
    body,
  })
}

async function dispatch(
  boundary: ReturnType<ReturnType<typeof createFumaScopedRouteBoundaryFactory>>,
  candidate: Request,
): Promise<Response> {
  const response = await boundary.handle(candidate)
  if (!response) throw new Error('Fuma HTTP boundary did not own the request.')
  return response
}

function postgresDb(rows: readonly Record<string, unknown>[]) {
  const calls: { text: string; values: readonly unknown[] }[] = []
  const query = async <Row = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>> => {
    calls.push({ text: strings.join('?'), values })
    return { rows: rows.map((row) => ({ ...row })) as Row[], rowCount: rows.length }
  }
  const db = Object.assign(query, {
    dialect: 'postgres' as const,
    async unsafe<Row = Record<string, unknown>>(): Promise<DbResult<Row>> {
      return { rows: [], rowCount: 0 }
    },
    async transaction<T>(work: (transaction: DbClient) => Promise<T>): Promise<T> {
      return work(db)
    },
  }) satisfies DbClient
  return { db, calls }
}

function postgresOwnerRow(): Record<string, unknown> {
  return {
    platform_id: PLATFORM_ID,
    owner_key: 'owner-http-stable',
    organization_id: ORGANIZATION_ID,
    workspace_id: WORKSPACE_ID,
    site_id: SITE_ID,
    state: 'active',
    generation: 3,
    transfer_id: null,
    transfer_lock_id: null,
    transfer_fence: null,
    created_at: '2026-07-25T00:00:00.000Z',
    updated_at: '2026-07-25T00:00:00.000Z',
  }
}

describe('FUMA-026 HTTP repository-scope boundary', () => {
  it('derives one frozen repository scope from trusted context before handler dispatch', async () => {
    const fixture = authorityFixture()
    const seen: FumaRepositoryScopeCoordinate[] = []
    const createBoundary = createFumaScopedRouteBoundaryFactory({
      ports: fixture.ports,
      ownerKeys: ownerAuthority(seen),
      allowsMutationOrigin: () => true,
      generateRequestId: () => 'request-http-01',
    })
    let handlerCalls = 0
    const boundary = createBoundary([{
      method: 'GET',
      path: '/documents',
      permission: 'content.pages.write',
      async handler({ context, repositoryScope, params }) {
        handlerCalls += 1
        expect(Object.isFrozen(context)).toBe(true)
        expect(Object.isFrozen(repositoryScope)).toBe(true)
        expect(Object.isFrozen(params)).toBe(true)
        expect(repositoryScope).toEqual({
          platformId: PLATFORM_ID,
          organizationId: ORGANIZATION_ID,
          workspaceId: WORKSPACE_ID,
          siteId: SITE_ID,
          ownerKey: 'owner-http-stable',
          state: 'active',
          generation: 3,
          transferFence: null,
        })
        return Response.json({ ownerKey: repositoryScope.ownerKey })
      },
    }])

    const response = await dispatch(boundary, request('/documents'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ownerKey: 'owner-http-stable' })
    expect(seen).toEqual([{
      platformId: PLATFORM_ID,
      organizationId: ORGANIZATION_ID,
      workspaceId: WORKSPACE_ID,
      siteId: SITE_ID,
    }])
    expect(handlerCalls).toBe(1)
  })

  it('rejects caller tenant IDs and owner keys before authentication or owner lookup', async () => {
    const hostileRequests = [
      request('/documents', { headers: { 'x-tenant-id': 'tenant-attacker' } }),
      request('/documents', { headers: { 'x-owner-key': 'owner-attacker' } }),
      request('/documents', { headers: { 'owner-key': 'owner-attacker' } }),
      request('/documents', { headers: { 'x-tenant-owner-key': 'owner-attacker' } }),
      request('/documents', { headers: { 'x-fuma-owner-key': 'owner-attacker' } }),
      request('/documents', {
        method: 'POST',
        body: { nested: { tenantIds: ['tenant-attacker'] } },
      }),
      request('/documents', {
        method: 'POST',
        body: { nested: { ownerKey: 'owner-attacker' } },
      }),
    ]

    for (const hostile of hostileRequests) {
      const fixture = authorityFixture()
      let ownerCalls = 0
      const createBoundary = createFumaScopedRouteBoundaryFactory({
        ports: fixture.ports,
        ownerKeys: {
          async loadOwnerKey() {
            ownerCalls += 1
            throw new Error('Owner authority must not run for caller claims.')
          },
        },
        allowsMutationOrigin: () => true,
        generateRequestId: () => 'request-http-02',
      })
      const method = hostile.method === 'POST' ? 'POST' : 'GET'
      const boundary = createBoundary([{
        method,
        path: '/documents',
        permission: 'content.pages.write',
        async handler() {
          throw new Error('Handler must not run for caller claims.')
        },
      }])

      const response = await dispatch(boundary, hostile)
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Resource not found.' })
      expect(fixture.sessionCalls()).toBe(0)
      expect(fixture.authorizationCalls()).toBe(0)
      expect(ownerCalls).toBe(0)
    }
  })

  it('collapses missing and transferring owner authority to the same denial before handler dispatch', async () => {
    const ownerRecords = [
      null,
      {
        ...ownerRecord({
          platformId: PLATFORM_ID,
          organizationId: ORGANIZATION_ID,
          workspaceId: WORKSPACE_ID,
          siteId: SITE_ID,
        }),
        state: 'transferring' as const,
        transferId: 'transfer-http-hostile',
        transferLockId: 'transfer-lock-http-hostile',
        transferFence: 41,
      },
    ]
    const signatures: { status: number; body: string }[] = []
    let handlerCalls = 0

    for (const owner of ownerRecords) {
      const fixture = authorityFixture()
      const createBoundary = createFumaScopedRouteBoundaryFactory({
        ports: fixture.ports,
        ownerKeys: { async loadOwnerKey() { return owner } },
        allowsMutationOrigin: () => true,
        generateRequestId: () => 'request-http-03',
      })
      const boundary = createBoundary([{
        method: 'GET',
        path: '/documents',
        permission: 'content.pages.write',
        async handler() {
          handlerCalls += 1
          return Response.json({ leaked: true })
        },
      }])

      const response = await dispatch(boundary, request('/documents'))
      signatures.push({ status: response.status, body: await response.text() })
      expect(response.headers.get('x-request-id')).toBe('request-http-03')
    }

    expect(signatures).toEqual([
      { status: 404, body: JSON.stringify({ error: 'Resource not found.' }) },
      { status: 404, body: JSON.stringify({ error: 'Resource not found.' }) },
    ])
    expect(handlerCalls).toBe(0)
  })

  it('composes PostgreSQL owner authority and does not mount undeclared future routes', async () => {
    const fixture = authorityFixture()
    const capture = postgresDb([postgresOwnerRow()])
    const createBoundary = createPostgresFumaScopedRouteBoundaryFactory({
      db: capture.db,
      ports: fixture.ports,
      allowsMutationOrigin: () => true,
      generateRequestId: () => 'request-http-04',
    })
    const boundary = createBoundary([{
      method: 'GET',
      path: '/documents',
      permission: 'content.pages.write',
      async handler({ repositoryScope }) {
        return Response.json(repositoryScope)
      },
    }])

    const unrelated = await dispatch(boundary, request('/future-plugin-routes'))
    expect(unrelated.status).toBe(404)
    expect(fixture.sessionCalls()).toBe(0)
    expect(capture.calls).toHaveLength(0)

    const response = await dispatch(boundary, request('/documents'))
    expect(response.status).toBe(200)
    expect((await response.json()).ownerKey).toBe('owner-http-stable')
    expect(capture.calls).toHaveLength(1)
    expect(capture.calls[0]!.text).toContain('from fuma_tenant_owner_keys')
    expect(capture.calls[0]!.text).toContain('where platform_id = ?')
    expect(capture.calls[0]!.text).toContain('and organization_id = ?')
    expect(capture.calls[0]!.text).toContain('and workspace_id = ?')
    expect(capture.calls[0]!.text).toContain('and site_id = ?')
    expect(capture.calls[0]!.values).toEqual([
      PLATFORM_ID,
      ORGANIZATION_ID,
      WORKSPACE_ID,
      SITE_ID,
    ])
  })
})
