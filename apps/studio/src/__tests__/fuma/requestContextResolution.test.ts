import { describe, expect, it } from 'bun:test'
import { fumaLaunchRegistry } from '@core/fuma'
import {
  FumaRequestContextResolutionError,
  deriveFumaRequestContext,
  type FumaRequestContextAuthorityPorts,
  type FumaSiteAuthorizationInput,
} from '../../../server/fuma/context/requestContext'
import type { FumaStaffActor } from '../../../server/fuma/context/contracts'

const PLATFORM_ID = 'platform-fuma'
const PLATFORM_ORGANIZATION_ID = 'organization-platform'
const SHARED_WORKSPACE_ID = 'workspace-collision'
const SHARED_SITE_ID = 'site-collision'
const USER_ID = 'user-editor'

const ROUTE_A = {
  organizationId: 'organization-a',
  workspaceId: SHARED_WORKSPACE_ID,
  siteId: SHARED_SITE_ID,
}

const ROUTE_B = {
  organizationId: 'organization-b',
  workspaceId: SHARED_WORKSPACE_ID,
  siteId: SHARED_SITE_ID,
}

function actor(userId = USER_ID): FumaStaffActor {
  return {
    kind: 'staff',
    userId,
    sessionId: `session-${userId}`,
    impersonator: null,
  }
}

function tenantAuthorization(
  organizationId: string,
  profileId: 'website' | 'publication',
): FumaSiteAuthorizationInput {
  const siteBinding = {
    platformId: PLATFORM_ID,
    organizationId,
    workspaceId: SHARED_WORKSPACE_ID,
    siteId: SHARED_SITE_ID,
  }
  const scope = {
    kind: 'site' as const,
    ...siteBinding,
  }
  return {
    platformOrganizationId: PLATFORM_ORGANIZATION_ID,
    platform: {
      id: PLATFORM_ID,
      status: 'active',
    },
    organization: {
      id: organizationId,
      platformId: PLATFORM_ID,
      kind: 'customer',
      status: 'active',
    },
    workspace: {
      id: SHARED_WORKSPACE_ID,
      platformId: PLATFORM_ID,
      organizationId,
      status: 'active',
    },
    site: {
      id: SHARED_SITE_ID,
      platformId: PLATFORM_ID,
      organizationId,
      workspaceId: SHARED_WORKSPACE_ID,
      profileId,
      status: 'active',
    },
    profile: {
      ...siteBinding,
      id: profileId,
      status: 'active',
    },
    capabilities: {
      ...siteBinding,
      profileId,
      overrides: profileId === 'website'
        ? { grant: [], revoke: [] }
        : { grant: [], revoke: ['publication.analytics'] },
    },
    permissions: {
      subjectId: USER_ID,
      scope,
      protectedOwnerInvariant: null,
      roleAssignments: [{
        id: `assignment.${organizationId}`,
        subjectId: USER_ID,
        scope: {
          kind: 'organization',
          platformId: PLATFORM_ID,
          organizationId,
        },
        role: {
          kind: 'launch-persona',
          persona: 'member',
        },
      }],
      permissionOverrides: [],
      customRoles: [],
    },
  }
}

function ports(
  authenticatedActor: unknown | null,
  authorization: unknown | null,
): FumaRequestContextAuthorityPorts {
  return {
    sessions: {
      async authenticateSameOriginHostedSession() {
        return authenticatedActor
      },
    },
    authorization: {
      async loadExactSiteAuthorization() {
        return authorization
      },
    },
  }
}

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://hosted.fuma.test/admin/pages', { headers })
}

function derive(
  authorization: unknown | null,
  changes: Partial<Parameters<typeof deriveFumaRequestContext>[0]> = {},
) {
  return deriveFumaRequestContext({
    request: request(),
    routeScope: ROUTE_A,
    requiredPermission: 'content.pages.write',
    ports: ports(actor(), authorization),
    generateRequestId: () => 'request-generated-01',
    ...changes,
  })
}

const UNIFORM_DENIAL = {
  name: 'FumaRequestContextResolutionError',
  code: 'denied',
  status: 404,
  message: 'Resource not found.',
}

async function denial(run: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await run
  } catch (error) {
    expect(error).toBeInstanceOf(FumaRequestContextResolutionError)
    if (!(error instanceof FumaRequestContextResolutionError)) throw error
    return {
      name: error.name,
      code: error.code,
      status: error.status,
      message: error.message,
    }
  }
  throw new Error('Expected request-context derivation to deny')
}

function tenantBSubstitutions(
  tenantA: FumaSiteAuthorizationInput,
  tenantB: FumaSiteAuthorizationInput,
): readonly [string, FumaSiteAuthorizationInput][] {
  const organization = structuredClone(tenantA)
  organization.organization = structuredClone(tenantB.organization)

  const workspace = structuredClone(tenantA)
  workspace.workspace = structuredClone(tenantB.workspace)

  const site = structuredClone(tenantA)
  site.site = structuredClone(tenantB.site)

  const profile = structuredClone(tenantA)
  profile.profile = structuredClone(tenantB.profile)

  const capabilities = structuredClone(tenantA)
  capabilities.capabilities = structuredClone(tenantB.capabilities)

  const permissions = structuredClone(tenantA)
  permissions.permissions = structuredClone(tenantB.permissions)

  return [
    ['organization', organization],
    ['workspace', workspace],
    ['site', site],
    ['profile', profile],
    ['capabilities', capabilities],
    ['permissions', permissions],
  ]
}

describe('FUMA-021 trusted request-context resolution', () => {
  it('derives actor, exact ancestry, registry profile/capabilities, and FUMA-020 permissions', async () => {
    const authorization = tenantAuthorization(ROUTE_A.organizationId, 'website')
    const context = await derive(authorization)
    const composedCapabilityIds = fumaLaunchRegistry
      .compose('website', authorization.capabilities.overrides)
      .capabilities
      .map(({ id }) => id)

    expect(context).toMatchObject({
      requestId: 'request-generated-01',
      source: {
        kind: 'staff-session',
        correlationId: 'request-generated-01',
        userId: USER_ID,
        sessionId: `session-${USER_ID}`,
        impersonatedBy: null,
      },
      actor: actor(),
      scope: {
        platform: { id: PLATFORM_ID, status: 'active' },
        organization: {
          id: ROUTE_A.organizationId,
          platformId: PLATFORM_ID,
          status: 'active',
        },
        workspace: {
          id: SHARED_WORKSPACE_ID,
          platformId: PLATFORM_ID,
          organizationId: ROUTE_A.organizationId,
          status: 'active',
        },
        site: {
          id: SHARED_SITE_ID,
          platformId: PLATFORM_ID,
          organizationId: ROUTE_A.organizationId,
          workspaceId: SHARED_WORKSPACE_ID,
          profileId: 'website',
          status: 'active',
        },
      },
      profile: { id: 'website', status: 'active' },
      capabilities: composedCapabilityIds,
      permissions: {
        subjectId: USER_ID,
      },
    })
    expect(context.permissions.allow).toContain('content.pages.write')
    expect(context.permissions.deny).toContain('site.settings.write')
  })

  it('uses 401 only when the trusted hosted session is genuinely absent', async () => {
    const result = derive(tenantAuthorization(ROUTE_A.organizationId, 'website'), {
      ports: ports(null, tenantAuthorization(ROUTE_A.organizationId, 'website')),
    })

    await expect(result).rejects.toMatchObject({
      name: 'FumaRequestContextResolutionError',
      code: 'unauthenticated',
      status: 401,
      message: 'Authentication required.',
    })
  })

  it('collapses missing tenant, actor substitution, no membership, and missing permission to one denial', async () => {
    const noMembership = tenantAuthorization(ROUTE_A.organizationId, 'website')
    noMembership.permissions.roleAssignments = []

    const outcomes = await Promise.all([
      denial(derive(null)),
      denial(derive(tenantAuthorization(ROUTE_A.organizationId, 'website'), {
        ports: ports(actor('user-other'), tenantAuthorization(ROUTE_A.organizationId, 'website')),
      })),
      denial(derive(noMembership)),
      denial(derive(tenantAuthorization(ROUTE_A.organizationId, 'website'), {
        requiredPermission: 'site.settings.write',
      })),
      denial(derive(tenantAuthorization(ROUTE_A.organizationId, 'website'), {
        routeScope: ROUTE_B,
      })),
    ])

    for (const outcome of outcomes) expect(outcome).toEqual(UNIFORM_DENIAL)
  })

  it('denies every Site B authority component replayed into Site A despite colliding lower IDs', async () => {
    const tenantA = tenantAuthorization(ROUTE_A.organizationId, 'website')
    const tenantB = tenantAuthorization(ROUTE_B.organizationId, 'publication')

    expect(tenantA.workspace.id).toBe(tenantB.workspace.id)
    expect(tenantA.site.id).toBe(tenantB.site.id)

    for (const [component, authorization] of tenantBSubstitutions(tenantA, tenantB)) {
      const outcome = await denial(derive(authorization))
      expect(outcome, component).toEqual(UNIFORM_DENIAL)
    }

    const wholeTenantReplay = await denial(derive(tenantB))
    expect(wholeTenantReplay).toEqual(UNIFORM_DENIAL)
  })

  it('rejects Site B tenant authority headers uniformly instead of treating them as claims', async () => {
    const tenantA = tenantAuthorization(ROUTE_A.organizationId, 'website')
    const claims = [
      ['x-fuma-organization-id', ROUTE_B.organizationId],
      ['x-fuma-organization', ROUTE_B.organizationId],
      ['x-fuma-workspace-id', SHARED_WORKSPACE_ID],
      ['x-fuma-workspace', SHARED_WORKSPACE_ID],
      ['x-fuma-site-id', SHARED_SITE_ID],
      ['x-fuma-site', SHARED_SITE_ID],
      ['x-fuma-profile-id', 'publication'],
      ['x-fuma-profile', 'publication'],
      ['x-fuma-capabilities', 'publication.editorial'],
      ['x-fuma-permissions', 'publication.posts.write'],
      ['x-fuma-role-id', 'protected-owner'],
      ['x-fuma-scope', 'platform'],
      ['x-fuma-protected-owner-invariant', 'platform.roles.manage'],
      ['x-fuma-session-id', 'session-other'],
      ['x-fuma-job-id', 'job-other'],
      ['x-fuma-correlation-id', 'correlation-other'],
      ['x-fuma-request-id', 'request-other'],
      ['x-fuma-actor', 'user-other'],
      ['x-actor-id', 'user-other'],
    ] as const

    for (const [name, value] of claims) {
      const outcome = await denial(derive(tenantA, {
        request: request({ [name]: value }),
      }))
      expect(outcome, name).toEqual(UNIFORM_DENIAL)
    }
  })

  it('never derives request identity or tenant authority from caller headers or body', async () => {
    const callerBody = JSON.stringify({
      organizationId: ROUTE_B.organizationId,
      workspaceId: SHARED_WORKSPACE_ID,
      siteId: SHARED_SITE_ID,
      profileId: 'publication',
      capabilities: ['publication.editorial'],
      permissions: ['publication.posts.write'],
    })
    const callerRequest = new Request('https://hosted.fuma.test/admin/pages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'request-attacker-supplied',
      },
      body: callerBody,
    })

    const context = await derive(tenantAuthorization(ROUTE_A.organizationId, 'website'), {
      request: callerRequest,
      generateRequestId: () => 'request-server-generated',
    })

    expect(context.requestId).toBe('request-server-generated')
    expect(context.source.correlationId).toBe('request-server-generated')
    expect(context.scope.organization.id).toBe(ROUTE_A.organizationId)
    expect(context.profile.id).toBe('website')
    expect(context.capabilities).not.toContain('publication.editorial')
    expect(context.permissions.allow).not.toContain('publication.posts.write')
    expect(await callerRequest.text()).toBe(callerBody)
  })

  it('uniformly denies suspended, archived, and inactive authority at every layer', async () => {
    const lifecycleInputs: FumaSiteAuthorizationInput[] = []

    const suspendedPlatform = tenantAuthorization(ROUTE_A.organizationId, 'website')
    suspendedPlatform.platform.status = 'suspended'
    lifecycleInputs.push(suspendedPlatform)

    const suspendedOrganization = tenantAuthorization(ROUTE_A.organizationId, 'website')
    suspendedOrganization.organization.status = 'suspended'
    lifecycleInputs.push(suspendedOrganization)

    const archivedOrganization = tenantAuthorization(ROUTE_A.organizationId, 'website')
    archivedOrganization.organization.status = 'archived'
    lifecycleInputs.push(archivedOrganization)

    const archivedWorkspace = tenantAuthorization(ROUTE_A.organizationId, 'website')
    archivedWorkspace.workspace.status = 'archived'
    lifecycleInputs.push(archivedWorkspace)

    const archivedSite = tenantAuthorization(ROUTE_A.organizationId, 'website')
    archivedSite.site.status = 'archived'
    lifecycleInputs.push(archivedSite)

    const inactiveProfile = tenantAuthorization(ROUTE_A.organizationId, 'website')
    inactiveProfile.profile.status = 'inactive'
    lifecycleInputs.push(inactiveProfile)

    for (const authorization of lifecycleInputs) {
      expect(await denial(derive(authorization))).toEqual(UNIFORM_DENIAL)
    }
  })

  it('returns a detached deeply immutable context without freezing any caller-owned object', async () => {
    const callerActor = actor()
    const callerRoute = structuredClone(ROUTE_A)
    const callerAuthorization = tenantAuthorization(ROUTE_A.organizationId, 'website')
    const context = await derive(callerAuthorization, {
      routeScope: callerRoute,
      ports: ports(callerActor, callerAuthorization),
    })

    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.source)).toBe(true)
    expect(Object.isFrozen(context.actor)).toBe(true)
    expect(Object.isFrozen(context.scope)).toBe(true)
    expect(Object.isFrozen(context.scope.organization)).toBe(true)
    expect(Object.isFrozen(context.scope.site)).toBe(true)
    expect(Object.isFrozen(context.profile)).toBe(true)
    expect(Object.isFrozen(context.capabilities)).toBe(true)
    expect(Object.isFrozen(context.permissions)).toBe(true)
    expect(Object.isFrozen(context.permissions.allow)).toBe(true)
    expect(Object.isFrozen(context.permissions.deny)).toBe(true)

    expect(Object.isFrozen(callerActor)).toBe(false)
    expect(Object.isFrozen(callerRoute)).toBe(false)
    expect(Object.isFrozen(callerAuthorization)).toBe(false)
    expect(Object.isFrozen(callerAuthorization.organization)).toBe(false)
    expect(Object.isFrozen(callerAuthorization.profile)).toBe(false)
    expect(Object.isFrozen(callerAuthorization.capabilities)).toBe(false)
    expect(Object.isFrozen(callerAuthorization.capabilities.overrides)).toBe(false)
    expect(Object.isFrozen(callerAuthorization.permissions)).toBe(false)
    expect(Object.isFrozen(callerAuthorization.permissions.roleAssignments)).toBe(false)

    callerAuthorization.site.profileId = 'publication'
    callerAuthorization.profile.id = 'publication'
    callerAuthorization.permissions.roleAssignments = []
    expect(context.profile.id).toBe('website')
    expect(context.permissions.allow).toContain('content.pages.write')
  })

  it('rejects malformed trusted actors without misclassifying them as unauthenticated', async () => {
    const result = derive(tenantAuthorization(ROUTE_A.organizationId, 'website'), {
      ports: ports({
        kind: 'staff',
        userId: USER_ID,
        sessionId: 'session-invalid',
      }, tenantAuthorization(ROUTE_A.organizationId, 'website')),
    })

    await expect(result).rejects.toMatchObject({
      name: 'FumaRequestContextResolutionError',
      code: 'invalid-trusted-authority',
      status: 500,
    })
  })

  it('validates the server request-ID generator and never falls back to caller input', async () => {
    const result = derive(tenantAuthorization(ROUTE_A.organizationId, 'website'), {
      request: request({ 'x-request-id': 'valid-but-untrusted' }),
      generateRequestId: () => 'invalid request id',
    })

    await expect(result).rejects.toMatchObject({
      name: 'FumaRequestContextResolutionError',
      code: 'invalid-trusted-authority',
      status: 500,
      message: 'Trusted request ID generator returned an invalid identifier.',
    })
  })
})
