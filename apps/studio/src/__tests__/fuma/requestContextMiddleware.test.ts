import { describe, expect, it } from 'bun:test'
import type { FumaRequestContextAuthorityPorts } from '../../../server/fuma/context/requestContext'
import type { FumaSiteAuthorizationInput } from '../../../server/fuma/context/requestContext'
import {
  createFumaScopedRouteBoundary,
  type FumaScopedRouteBoundary,
} from '../../../server/fuma/context/middleware'

const ORIGIN = 'https://hosted.fuma.test'
const PLATFORM_ID = 'platform-fuma'
const PLATFORM_ORGANIZATION_ID = 'organization-platform'
const USER_ID = 'user-editor'
const ROUTE_A = Object.freeze({
  organizationId: 'organization.a',
  workspaceId: 'workspace-collision',
  siteId: 'site-collision',
})
const ROUTE_B = Object.freeze({
  organizationId: 'organization.b',
  workspaceId: 'workspace-collision',
  siteId: 'site-collision',
})

function authorization(
  organizationId = ROUTE_A.organizationId,
): FumaSiteAuthorizationInput {
  const binding = {
    platformId: PLATFORM_ID,
    organizationId,
    workspaceId: ROUTE_A.workspaceId,
    siteId: ROUTE_A.siteId,
  }
  return {
    platformOrganizationId: PLATFORM_ORGANIZATION_ID,
    platform: { id: PLATFORM_ID, status: 'active' },
    organization: {
      id: organizationId,
      platformId: PLATFORM_ID,
      kind: 'customer',
      status: 'active',
    },
    workspace: {
      id: ROUTE_A.workspaceId,
      platformId: PLATFORM_ID,
      organizationId,
      status: 'active',
    },
    site: {
      id: ROUTE_A.siteId,
      platformId: PLATFORM_ID,
      organizationId,
      workspaceId: ROUTE_A.workspaceId,
      profileId: 'website',
      status: 'active',
    },
    profile: {
      ...binding,
      id: 'website',
      status: 'active',
    },
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
        id: `assignment.${organizationId}`,
        subjectId: USER_ID,
        scope: {
          kind: 'organization',
          platformId: PLATFORM_ID,
          organizationId,
        },
        role: { kind: 'launch-persona', persona: 'member' },
      }],
      permissionOverrides: [],
      customRoles: [],
    },
  }
}

function authorityFixture(authority: unknown | null = authorization()) {
  const authenticatedScopes: unknown[] = []
  let sessionCalls = 0
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
      async loadExactSiteAuthorization(input) {
        authenticatedScopes.push(input.routeScope)
        return authority
      },
    },
  }
  return {
    ports,
    authenticatedScopes,
    sessionCalls: () => sessionCalls,
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

function scopedPath(
  scope: Readonly<{ organizationId: string; workspaceId: string; siteId: string }>,
  suffix = '/documents',
): string {
  return `/api/fuma/organizations/${scope.organizationId}/workspaces/${scope.workspaceId}/sites/${scope.siteId}${suffix}`
}

function request(
  scope = ROUTE_A,
  options: Readonly<{
    body?: unknown
    headers?: Readonly<Record<string, string>>
    method?: string
    origin?: string | null
    suffix?: string
  }> = {},
): Request {
  const allowedHeaders = new Headers(options.headers)
  let body: string | undefined
  if (options.body !== undefined) {
    allowedHeaders.set('content-type', 'application/json')
    body = JSON.stringify(options.body)
  }
  const NativeResponse = (globalThis as Record<PropertyKey, unknown>)[
    Symbol.for('instatic.test.nativeResponse')
  ] as typeof Response
  const nativeHeaders = new NativeResponse(null, { headers: allowedHeaders }).headers
  const origin = options.origin === undefined ? ORIGIN : options.origin
  if (origin !== null) nativeHeaders.set('origin', origin)

  function retainHeaders(current: Request): Request {
    const clone = current.clone.bind(current)
    Object.defineProperty(current, 'headers', { value: nativeHeaders })
    Object.defineProperty(current, 'clone', {
      value: () => retainHeaders(clone()),
    })
    return current
  }

  return retainHeaders(new Request(`${ORIGIN}${scopedPath(scope, options.suffix)}`, {
    method: options.method ?? 'POST',
    headers: allowedHeaders,
    body,
  }))
}

function boundary(
  fixture: ReturnType<typeof authorityFixture>,
  handler: Parameters<typeof createFumaScopedRouteBoundary>[0]['routes'][number]['handler'],
  permission = 'content.pages.write',
): FumaScopedRouteBoundary {
  return createFumaScopedRouteBoundary({
    ports: fixture.ports,
    ownerKeys: ownerKeyAuthority(),
    allowsMutationOrigin: (candidate) => candidate.headers.get('origin') === ORIGIN,
    generateRequestId: () => 'request-middleware-01',
    routes: [{
      method: 'POST',
      path: '/documents',
      permission,
      handler,
    }],
  })
}

async function dispatch(
  target: FumaScopedRouteBoundary,
  candidate: Request,
): Promise<Response> {
  const response = await target.handle(candidate)
  if (!response) throw new Error('Scoped boundary did not own the request.')
  return response
}

async function responseSignature(response: Response) {
  return {
    status: response.status,
    body: await response.text(),
  }
}

const UNIFORM_DENIAL = {
  status: 404,
  body: JSON.stringify({ error: 'Resource not found.' }),
}

describe('FUMA-021 request-context middleware', () => {
  it('decodes and validates route scope, resolves declared permission, and passes only frozen authority to the handler', async () => {
    const fixture = authorityFixture()
    let handlerCalls = 0
    const target = boundary(fixture, async ({ request: handlerRequest, context, params }) => {
      handlerCalls += 1
      expect(Object.isFrozen(context)).toBe(true)
      expect(Object.isFrozen(context.scope)).toBe(true)
      expect(Object.isFrozen(context.scope.site)).toBe(true)
      expect(Object.isFrozen(context.permissions.allow)).toBe(true)
      expect(Object.isFrozen(params)).toBe(true)
      expect(params).toEqual({})
      expect(context.requestId).toBe('request-middleware-01')
      expect(context.scope.organization.id).toBe(ROUTE_A.organizationId)
      expect(context.permissions.allow).toContain('content.pages.write')
      expect(await handlerRequest.json()).toEqual({ title: 'Trusted body' })
      return Response.json({ ok: true })
    })
    const candidate = request(ROUTE_A, {
      body: { title: 'Trusted body' },
      headers: { 'x-request-id': 'caller-request-id' },
    })

    expect(candidate.headers.get('origin')).toBe(ORIGIN)
    const response = await dispatch(target, candidate)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBe('request-middleware-01')
    expect(await response.json()).toEqual({ ok: true })
    expect(handlerCalls).toBe(1)
    expect(fixture.authenticatedScopes).toEqual([ROUTE_A])
  })

  it('makes two-tenant path, header, body, and permission substitutions indistinguishable and never invokes handlers', async () => {
    const fixture = authorityFixture(authorization(ROUTE_A.organizationId))
    let handlerCalls = 0
    const target = boundary(fixture, async () => {
      handlerCalls += 1
      return Response.json({ leaked: true })
    })

    const pathSubstitution = await dispatch(target, request(ROUTE_B))
    const headerSubstitution = await dispatch(target, request(ROUTE_A, {
      headers: {
        'x-fuma-organization': ROUTE_B.organizationId,
        'x-fuma-workspace': ROUTE_B.workspaceId,
        'x-fuma-site': ROUTE_B.siteId,
        'x-fuma-profile': 'publication',
        'x-fuma-capabilities': 'publication.analytics',
        'x-fuma-permissions': 'site.settings.write',
        'x-fuma-actor': 'user-other-tenant',
      },
    }))
    const bodySubstitution = await dispatch(target, request(ROUTE_A, {
      body: {
        tenant: {
          organizationId: ROUTE_B.organizationId,
          workspaceId: ROUTE_B.workspaceId,
          siteId: ROUTE_B.siteId,
          profileId: 'publication',
          capabilities: ['publication.analytics'],
          permissions: ['site.settings.write'],
          actor: { userId: 'user-other-tenant' },
        },
      },
    }))

    const deniedPermissionFixture = authorityFixture()
    const deniedPermission = await dispatch(
      boundary(deniedPermissionFixture, async () => {
        handlerCalls += 1
        return Response.json({ leaked: true })
      }, 'site.settings.write'),
      request(ROUTE_A),
    )

    expect(await responseSignature(pathSubstitution)).toEqual(UNIFORM_DENIAL)
    expect(await responseSignature(headerSubstitution)).toEqual(UNIFORM_DENIAL)
    expect(await responseSignature(bodySubstitution)).toEqual(UNIFORM_DENIAL)
    expect(await responseSignature(deniedPermission)).toEqual(UNIFORM_DENIAL)
    expect(pathSubstitution.headers.get('x-request-id')).toBe('request-middleware-01')
    expect(headerSubstitution.headers.get('x-request-id')).toBe('request-middleware-01')
    expect(bodySubstitution.headers.get('x-request-id')).toBe('request-middleware-01')
    expect(handlerCalls).toBe(0)
  })

  it('rejects every caller authority header spelling before trusted resolution while ignoring caller request IDs', async () => {
    const authorityHeaders = [
      'x-organization-id',
      'x-workspace-id',
      'x-site-id',
      'x-platform-id',
      'x-profile-id',
      'x-capabilities',
      'x-permissions',
      'x-actor-id',
      'x-fuma-organization-id',
      'x-fuma-workspace-id',
      'x-fuma-site-id',
      'x-fuma-profile-id',
      'x-fuma-capability-id',
      'x-fuma-permission-id',
      'x-fuma-actor-id',
      'x-fuma-role-id',
      'x-fuma-scope',
      'x-fuma-protected-owner-invariant',
      'x-fuma-session-id',
      'x-fuma-job-id',
      'x-fuma-run-id',
      'x-fuma-correlation-id',
      'x-fuma-request-id',
    ] as const
    let handlerCalls = 0

    for (const header of authorityHeaders) {
      const fixture = authorityFixture()
      const target = boundary(fixture, async () => {
        handlerCalls += 1
        return Response.json({ leaked: true })
      })
      const response = await dispatch(target, request(ROUTE_A, {
        headers: { [header]: 'tenant-b-claim' },
      }))
      expect(await responseSignature(response)).toEqual(UNIFORM_DENIAL)
      expect(fixture.sessionCalls()).toBe(0)
    }

    const fixture = authorityFixture()
    const accepted = await dispatch(
      boundary(fixture, async ({ context }) => Response.json({ requestId: context.requestId })),
      request(ROUTE_A, { headers: { 'x-request-id': 'caller-controlled' } }),
    )
    expect(await accepted.json()).toEqual({ requestId: 'request-middleware-01' })
    expect(accepted.headers.get('x-request-id')).toBe('request-middleware-01')
    expect(handlerCalls).toBe(0)
  })

  it('rejects nested role, scope, invariant, and correlation body substitutions before authentication', async () => {
    const authorityBodies = [
      { nested: { role: 'protected-owner' } },
      { nested: { role_assignments: [] } },
      { nested: { permissionOverrides: [] } },
      { nested: { capabilityOverrides: { grant: [], revoke: [] } } },
      { nested: { protectedOwnerInvariant: { subjectId: 'user-other' } } },
      { nested: { scope: { organizationId: ROUTE_B.organizationId } } },
      { nested: { requiredPermission: 'platform.roles.manage' } },
      { nested: { requestId: 'request-attacker' } },
      { nested: { sessionId: 'session-attacker' } },
      { nested: { jobId: 'job-attacker' } },
      { nested: { runId: 'run-attacker' } },
      { nested: { correlationId: 'correlation-attacker' } },
      { nested: { source: { kind: 'internal-job' } } },
    ] as const
    let handlerCalls = 0

    for (const body of authorityBodies) {
      const fixture = authorityFixture()
      const target = boundary(fixture, async () => {
        handlerCalls += 1
        return Response.json({ leaked: true })
      })
      const response = await dispatch(target, request(ROUTE_A, { body }))
      expect(await responseSignature(response)).toEqual(UNIFORM_DENIAL)
      expect(fixture.sessionCalls()).toBe(0)
    }
    expect(handlerCalls).toBe(0)
  })

  it('rejects missing and foreign mutation Origins before authentication or handler work', async () => {
    let handlerCalls = 0
    for (const origin of [null, 'https://tenant-b.fuma.test'] as const) {
      const fixture = authorityFixture()
      const target = boundary(fixture, async () => {
        handlerCalls += 1
        return Response.json({ leaked: true })
      })
      const response = await dispatch(target, request(ROUTE_A, { origin }))
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'Origin not allowed.' })
      expect(response.headers.get('x-request-id')).toBe('request-middleware-01')
      expect(fixture.sessionCalls()).toBe(0)
    }
    expect(handlerCalls).toBe(0)
  })

  it('keeps unauthenticated responses distinct but maps malformed and substituted scope to the non-leaking denial', async () => {
    const unauthenticated: FumaRequestContextAuthorityPorts = {
      sessions: {
        async authenticateSameOriginHostedSession() {
          return null
        },
      },
      authorization: {
        async loadExactSiteAuthorization() {
          throw new Error('Authorization must not run without a session.')
        },
      },
    }
    const target = createFumaScopedRouteBoundary({
      ports: unauthenticated,
      ownerKeys: ownerKeyAuthority(),
      allowsMutationOrigin: (candidate) => candidate.headers.get('origin') === ORIGIN,
      generateRequestId: () => 'request-middleware-01',
      routes: [{
        method: 'POST',
        path: '/documents',
        permission: 'content.pages.write',
        async handler() {
          throw new Error('Handler must not run without a session.')
        },
      }],
    })
    const noSession = await dispatch(target, request())
    expect(noSession.status).toBe(401)
    expect(await noSession.json()).toEqual({ error: 'Authentication required.' })
    expect(noSession.headers.get('x-request-id')).toBe('request-middleware-01')

    const fixture = authorityFixture()
    let handlerCalls = 0
    const malformedTarget = boundary(fixture, async () => {
      handlerCalls += 1
      return Response.json({ leaked: true })
    })
    const malformed = new Request(
      `${ORIGIN}/api/fuma/organizations/organization%2Fa/workspaces/${ROUTE_A.workspaceId}/sites/${ROUTE_A.siteId}/documents`,
      { method: 'POST' },
    )
    const malformedResponse = await dispatch(malformedTarget, malformed)
    expect(await responseSignature(malformedResponse)).toEqual(UNIFORM_DENIAL)
    expect(handlerCalls).toBe(0)
  })
})
