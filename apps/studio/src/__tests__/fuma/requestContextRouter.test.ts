import { describe, expect, it } from 'bun:test'
import {
  FumaScopedRouteDeclarationError,
  createFumaScopedRouteBoundary,
  type FumaScopedRouteBoundaryInput,
} from '../../../server/fuma/context/middleware'
import type {
  FumaRequestContextAuthorityPorts,
  FumaSiteAuthorizationInput,
} from '../../../server/fuma/context/requestContext'

const ORIGIN = 'https://hosted.fuma.test'
const PLATFORM_ID = 'platform-fuma'
const ORGANIZATION_ID = 'organization-a'
const WORKSPACE_ID = 'workspace-a'
const SITE_ID = 'site-a'
const USER_ID = 'user-editor'
const BASE_PATH = `/api/fuma/organizations/${ORGANIZATION_ID}/workspaces/${WORKSPACE_ID}/sites/${SITE_ID}`

function siteAuthorization(): FumaSiteAuthorizationInput {
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
        id: 'assignment.organization-a',
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

function portsFixture() {
  let sessionCalls = 0
  let authorizationCalls = 0
  const ports: FumaRequestContextAuthorityPorts = {
    sessions: {
      async authenticateSameOriginHostedSession() {
        sessionCalls += 1
        return {
          kind: 'staff',
          userId: USER_ID,
          sessionId: 'session-editor',
          impersonator: null,
        }
      },
    },
    authorization: {
      async loadExactSiteAuthorization() {
        authorizationCalls += 1
        return siteAuthorization()
      },
    },
  }
  return {
    ports,
    sessionCalls: () => sessionCalls,
    authorizationCalls: () => authorizationCalls,
  }
}

function ownerKeyAuthority() {
  return {
    async loadOwnerKey(coordinate: Readonly<{
      platformId: string
      organizationId: string
      workspaceId: string
      siteId: string
    }>) {
      return {
        ownerKey: `owner.${coordinate.organizationId}`,
        coordinate: { ...coordinate },
        state: 'active' as const,
        generation: 1,
        transferId: null,
        transferLockId: null,
        transferFence: null,
        createdAt: '2026-07-25T00:00:00.000Z',
        updatedAt: '2026-07-25T00:00:00.000Z',
      }
    },
  }
}

function request(path: string, method = 'GET'): Request {
  return new Request(`${ORIGIN}${path}`, { method })
}

async function ownedResponse(
  boundary: ReturnType<typeof createFumaScopedRouteBoundary>,
  candidate: Request,
): Promise<Response> {
  const response = await boundary.handle(candidate)
  if (!response) throw new Error('Scoped route boundary did not own this request.')
  return response
}

function declarationInput(
  routes: FumaScopedRouteBoundaryInput['routes'],
): FumaScopedRouteBoundaryInput {
  return {
    ports: portsFixture().ports,
    ownerKeys: ownerKeyAuthority(),
    allowsMutationOrigin: () => true,
    generateRequestId: () => 'request-router-01',
    routes,
  }
}

describe('FUMA-021 scoped request router', () => {
  it('dispatches the site root and decoded descendant params through one declarative boundary', async () => {
    const fixture = portsFixture()
    const calls: string[] = []
    const boundary = createFumaScopedRouteBoundary({
      ports: fixture.ports,
      ownerKeys: ownerKeyAuthority(),
      allowsMutationOrigin: () => true,
      generateRequestId: () => 'request-router-01',
      routes: [
        {
          method: 'GET',
          path: '/',
          permission: 'content.pages.write',
          async handler({ context, params }) {
            calls.push('root')
            expect(context.scope.organization.id).toBe(ORGANIZATION_ID)
            expect(context.scope.workspace.id).toBe(WORKSPACE_ID)
            expect(context.scope.site.id).toBe(SITE_ID)
            expect(params).toEqual({})
            return Response.json({ route: 'root' })
          },
        },
        {
          method: 'GET',
          path: '/documents/:documentId/revisions/:revisionId',
          permission: 'content.pages.write',
          async handler({ context, params }) {
            calls.push('revision')
            expect(Object.isFrozen(context)).toBe(true)
            expect(Object.isFrozen(params)).toBe(true)
            expect(params).toEqual({
              documentId: 'document.alpha',
              revisionId: 'revision:1',
            })
            return Response.json({ route: 'revision', params })
          },
        },
      ],
    })

    const root = await ownedResponse(boundary, request(`${BASE_PATH}/`))
    const descendant = await ownedResponse(boundary, request(
      `${BASE_PATH}/documents/document%2Ealpha/revisions/revision%3A1`,
    ))

    expect(await root.json()).toEqual({ route: 'root' })
    expect(await descendant.json()).toEqual({
      route: 'revision',
      params: { documentId: 'document.alpha', revisionId: 'revision:1' },
    })
    expect(root.headers.get('x-request-id')).toBe('request-router-01')
    expect(descendant.headers.get('x-request-id')).toBe('request-router-01')
    expect(calls).toEqual(['root', 'revision'])
    expect(fixture.sessionCalls()).toBe(2)
    expect(fixture.authorizationCalls()).toBe(2)
  })

  it('returns owned non-leaking 404 and 405 responses before context or handler invocation', async () => {
    const fixture = portsFixture()
    let handlerCalls = 0
    const boundary = createFumaScopedRouteBoundary({
      ports: fixture.ports,
      ownerKeys: ownerKeyAuthority(),
      allowsMutationOrigin: () => true,
      generateRequestId: () => 'request-router-01',
      routes: [
        {
          method: 'GET',
          path: '/documents/:documentId',
          permission: 'content.pages.write',
          async handler() {
            handlerCalls += 1
            return Response.json({ method: 'GET' })
          },
        },
        {
          method: 'PATCH',
          path: '/documents/:documentId',
          permission: 'content.pages.write',
          async handler() {
            handlerCalls += 1
            return Response.json({ method: 'PATCH' })
          },
        },
      ],
    })

    const missing = await ownedResponse(boundary, request(`${BASE_PATH}/unknown`))
    const wrongMethod = await ownedResponse(
      boundary,
      request(`${BASE_PATH}/documents/document-a`, 'DELETE'),
    )
    const malformedParam = await ownedResponse(
      boundary,
      request(`${BASE_PATH}/documents/document%2Fa`),
    )

    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'Resource not found.' })
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toBe('GET, PATCH')
    expect(await wrongMethod.json()).toEqual({ error: 'Method not allowed.' })
    expect(malformedParam.status).toBe(404)
    expect(await malformedParam.json()).toEqual({ error: 'Resource not found.' })
    expect(missing.headers.get('x-request-id')).toBe('request-router-01')
    expect(wrongMethod.headers.get('x-request-id')).toBe('request-router-01')
    expect(malformedParam.headers.get('x-request-id')).toBe('request-router-01')
    expect(handlerCalls).toBe(0)
    expect(fixture.sessionCalls()).toBe(0)
    expect(fixture.authorizationCalls()).toBe(0)

    expect(boundary.handles(request('/api/fuma/organizations'))).toBe(false)
    expect(await boundary.handle(request('/api/fuma/organizations'))).toBeNull()
  })

  it('rejects duplicate and semantically overlapping method/route declarations at construction', () => {
    const handler = async () => Response.json({ ok: true })
    const collisions = [
      [
        { method: 'GET', path: '/documents/:id', permission: 'content.pages.write', handler },
        { method: 'GET', path: '/documents/:documentId', permission: 'content.pages.write', handler },
      ],
      [
        { method: 'PATCH', path: '/documents/new', permission: 'content.pages.write', handler },
        { method: 'PATCH', path: '/documents/:documentId', permission: 'content.pages.write', handler },
      ],
      [
        { method: 'POST', path: '/', permission: 'content.pages.write', handler },
        { method: 'POST', path: '/', permission: 'content.pages.write', handler },
      ],
    ] satisfies readonly FumaScopedRouteBoundaryInput['routes'][]

    for (const routes of collisions) {
      expect(() => createFumaScopedRouteBoundary(declarationInput(routes))).toThrow(
        FumaScopedRouteDeclarationError,
      )
      try {
        createFumaScopedRouteBoundary(declarationInput(routes))
      } catch (error) {
        expect(error).toMatchObject({ code: 'route-collision' })
      }
    }

    expect(() => createFumaScopedRouteBoundary(declarationInput([
      { method: 'GET', path: '/documents/:id/:id', permission: 'content.pages.write', handler },
    ]))).toThrow(FumaScopedRouteDeclarationError)

    expect(() => createFumaScopedRouteBoundary(declarationInput([
      { method: 'GET', path: '/documents/:id', permission: 'content.pages.write', handler },
      { method: 'PATCH', path: '/documents/:id', permission: 'content.pages.write', handler },
    ]))).not.toThrow()
  })

  it('rejects malformed route declarations instead of creating an ambiguous router', () => {
    const invalid = [
      [],
      [{
        method: 'TRACE',
        path: '/documents',
        permission: 'content.pages.write',
        handler: async () => Response.json({ ok: true }),
      }],
      [{
        method: 'GET',
        path: '/documents/',
        permission: 'content.pages.write',
        handler: async () => Response.json({ ok: true }),
      }],
      [{
        method: 'GET',
        path: '/documents',
        permission: 'Content Pages Write',
        handler: async () => Response.json({ ok: true }),
      }],
    ]

    for (const routes of invalid) {
      expect(() => createFumaScopedRouteBoundary(declarationInput(
        routes as unknown as FumaScopedRouteBoundaryInput['routes'],
      ))).toThrow(FumaScopedRouteDeclarationError)
    }
  })
})


describe('FUMA-029 scoped WebSocket upgrade authority', () => {
  it('derives exact ancestry and owner generation while denying a substituted site', async () => {
    const target = createFumaScopedRouteBoundary({
      ports: portsFixture().ports,
      ownerKeys: ownerKeyAuthority(),
      allowsMutationOrigin: () => true,
      generateRequestId: () => 'request-presence-01',
      routes: [{ method: 'GET', path: '/placeholder', permission: 'content.pages.write', handler: () => Response.json({ ok: true }) }],
    })
    const trusted = await target.authorize(request(`${BASE_PATH}/publication/presence/socket/page/page-1`), 'content.pages.write', { requireOrigin: true })
    expect(trusted?.repositoryScope).toMatchObject({ organizationId: ORGANIZATION_ID, workspaceId: WORKSPACE_ID, siteId: SITE_ID, ownerKey: `owner.${ORGANIZATION_ID}`, generation: 1 })
    expect(trusted?.context.profile.id).toBe('website')
    expect(await target.authorize(request(`/api/fuma/organizations/${ORGANIZATION_ID}/workspaces/${WORKSPACE_ID}/sites/site-b/publication/presence/socket/page/page-1`), 'content.pages.write', { requireOrigin: true })).toBeNull()
  })
})
