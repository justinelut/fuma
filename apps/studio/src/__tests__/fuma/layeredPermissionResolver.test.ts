import { describe, expect, it } from 'bun:test'
import {
  PermissionCatalogError,
  createFumaRegistry,
  fumaLaunchRegistry,
  type CustomRoleDefinition,
  type ScopedPermissionOverride,
  type ScopedRoleAssignment,
} from '@core/fuma'
import {
  LayeredPermissionResolverError,
  resolveLayeredPermissions,
  type LayeredPermissionDecision,
  type LayeredRoleResolverInput,
} from '../../../server/fuma/permissions'

const PLATFORM_SCOPE = {
  kind: 'platform',
  platformId: 'platform-fuma',
} as const

const ORGANIZATION_SCOPE = {
  kind: 'organization',
  platformId: 'platform-fuma',
  organizationId: 'organization-acme',
} as const

const SITE_SCOPE = {
  kind: 'site',
  platformId: 'platform-fuma',
  organizationId: 'organization-acme',
  workspaceId: 'workspace-main',
  siteId: 'site-primary',
} as const

const ORGANIZATION_MEMBER: ScopedRoleAssignment = {
  id: 'assignment.organization-member',
  subjectId: 'user-editor',
  scope: ORGANIZATION_SCOPE,
  role: { kind: 'launch-persona', persona: 'member' },
}

function resolverInput(
  changes: Partial<LayeredRoleResolverInput> = {},
): LayeredRoleResolverInput {
  return {
    subjectId: 'user-editor',
    platformOrganizationId: 'organization-platform',
    scope: SITE_SCOPE,
    organization: {
      id: SITE_SCOPE.organizationId,
      platformId: SITE_SCOPE.platformId,
      kind: 'customer',
      status: 'active',
    },
    workspace: {
      id: SITE_SCOPE.workspaceId,
      platformId: SITE_SCOPE.platformId,
      organizationId: SITE_SCOPE.organizationId,
      status: 'active',
    },
    site: {
      id: SITE_SCOPE.siteId,
      platformId: SITE_SCOPE.platformId,
      organizationId: SITE_SCOPE.organizationId,
      workspaceId: SITE_SCOPE.workspaceId,
      status: 'active',
      profileId: 'website',
      capabilityOverrides: { grant: [], revoke: [] },
    },
    protectedOwnerInvariant: null,
    roleAssignments: [ORGANIZATION_MEMBER],
    permissionOverrides: [],
    customRoles: [],
    ...changes,
  }
}

function permission(
  input: LayeredRoleResolverInput,
  permissionId: string,
): LayeredPermissionDecision {
  const resolved = resolveLayeredPermissions(input)
  const found = resolved.decisions.find((candidate) => (
    candidate.permissionId === permissionId
  ))
  if (!found) throw new Error(`Missing permission decision for ${permissionId}`)
  return found
}

function expectResolverError(
  run: () => unknown,
  code: LayeredPermissionResolverError['code'],
): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(LayeredPermissionResolverError)
    if (!(error instanceof LayeredPermissionResolverError)) throw error
    expect(error.code).toBe(code)
    return
  }
  throw new Error(`Expected LayeredPermissionResolverError with code ${code}`)
}

function permissionOverride(
  id: string,
  scope: ScopedPermissionOverride['scope'],
  grant: readonly string[] = [],
  deny: readonly string[] = [],
): ScopedPermissionOverride {
  return {
    id,
    subjectId: 'user-editor',
    scope,
    permissions: { grant: [...grant], deny: [...deny] },
  }
}

function sitePublisherRole(
  grant: readonly string[] = ['content.pages.write'],
  deny: readonly string[] = ['site.settings.read'],
): CustomRoleDefinition {
  return {
    id: 'role.site-publisher',
    name: 'Site publisher',
    scope: ORGANIZATION_SCOPE,
    constraints: {
      basePersona: 'viewer',
      assignableScopeKinds: ['site'],
    },
    permissionOverrides: { grant: [...grant], deny: [...deny] },
  }
}

describe('FUMA-020 layered role resolver', () => {
  it('inherits the nearest applicable role and denies every permission without membership', () => {
    expect(permission(resolverInput(), 'content.pages.write')).toMatchObject({
      decision: 'allow',
      precedence: 'launch-persona',
      reason: 'launch-persona-grant',
      source: {
        kind: 'launch-persona-assignment',
        assignmentId: ORGANIZATION_MEMBER.id,
        persona: 'member',
      },
    })
    expect(permission(resolverInput(), 'site.settings.write')).toMatchObject({
      decision: 'deny',
      precedence: 'launch-persona',
      reason: 'launch-persona-deny',
    })

    const withoutMembership = resolverInput({
      roleAssignments: [],
      permissionOverrides: [permissionOverride(
        'override.orphan-grant',
        ORGANIZATION_SCOPE,
        ['content.pages.write'],
      )],
    })
    expect(permission(withoutMembership, 'content.pages.write')).toEqual({
      permissionId: 'content.pages.write',
      scope: SITE_SCOPE,
      decision: 'deny',
      precedence: 'membership-required',
      source: {
        kind: 'membership',
        reason: 'role-assignment-required',
      },
      reason: 'no-membership',
    })
  })

  it('uses only role layers that can own the permission resource', () => {
    const siteViewer: ScopedRoleAssignment = {
      id: 'assignment.site-viewer',
      subjectId: 'user-editor',
      scope: SITE_SCOPE,
      role: { kind: 'launch-persona', persona: 'viewer' },
    }
    const input = resolverInput({
      roleAssignments: [ORGANIZATION_MEMBER, siteViewer],
    })

    expect(permission(input, 'organization.read')).toMatchObject({
      decision: 'allow',
      source: { assignmentId: ORGANIZATION_MEMBER.id },
    })
    expect(permission(input, 'content.pages.write')).toMatchObject({
      decision: 'deny',
      source: { assignmentId: siteViewer.id },
    })
  })

  it('applies explicit deny before explicit grant and both before role defaults', () => {
    const denyWins = resolverInput({
      permissionOverrides: [
        permissionOverride(
          'override.organization-grant',
          ORGANIZATION_SCOPE,
          ['site.settings.write'],
        ),
        permissionOverride(
          'override.site-deny',
          SITE_SCOPE,
          [],
          ['site.settings.write'],
        ),
      ],
    })
    expect(permission(denyWins, 'site.settings.write')).toMatchObject({
      decision: 'deny',
      precedence: 'explicit-deny',
      reason: 'explicit-deny',
      source: {
        kind: 'permission-override',
        overrideId: 'override.site-deny',
      },
    })

    const broadDenyStillWins = resolverInput({
      permissionOverrides: [
        permissionOverride(
          'override.organization-deny',
          ORGANIZATION_SCOPE,
          [],
          ['site.settings.write'],
        ),
        permissionOverride(
          'override.site-grant',
          SITE_SCOPE,
          ['site.settings.write'],
        ),
      ],
    })
    expect(permission(broadDenyStillWins, 'site.settings.write')).toMatchObject({
      decision: 'deny',
      source: { overrideId: 'override.organization-deny' },
    })

    const grantBeatsDefault = resolverInput({
      permissionOverrides: [permissionOverride(
        'override.organization-grant',
        ORGANIZATION_SCOPE,
        ['site.settings.write'],
      )],
    })
    expect(permission(grantBeatsDefault, 'site.settings.write')).toMatchObject({
      decision: 'allow',
      precedence: 'explicit-grant',
      reason: 'explicit-grant',
    })
  })

  it('denies mutations in suspended or archived descendants while preserving reads', () => {
    const suspended = resolverInput({
      organization: {
        id: SITE_SCOPE.organizationId,
        platformId: SITE_SCOPE.platformId,
        kind: 'customer',
        status: 'suspended',
      },
    })
    expect(permission(suspended, 'content.pages.write')).toMatchObject({
      decision: 'deny',
      precedence: 'lifecycle',
      reason: 'organization-suspended',
      source: {
        kind: 'lifecycle',
        resource: 'organization',
        status: 'suspended',
      },
    })
    expect(permission(suspended, 'content.pages.read')).toMatchObject({
      decision: 'allow',
      reason: 'launch-persona-grant',
    })

    const archivedWorkspace = resolverInput({
      workspace: {
        id: SITE_SCOPE.workspaceId,
        platformId: SITE_SCOPE.platformId,
        organizationId: SITE_SCOPE.organizationId,
        status: 'archived',
      },
    })
    expect(permission(archivedWorkspace, 'content.pages.write')).toMatchObject({
      decision: 'deny',
      reason: 'workspace-archived',
    })

    const archivedSite = resolverInput({
      site: {
        ...resolverInput().site,
        status: 'archived',
      },
    })
    expect(permission(archivedSite, 'site.update')).toMatchObject({
      decision: 'deny',
      reason: 'site-archived',
    })
    expect(permission(archivedSite, 'site.read')).toMatchObject({
      decision: 'allow',
    })
  })

  it('applies custom-role policy over its base persona and enforces the catalog ceiling', () => {
    const role = sitePublisherRole()
    const customAssignment: ScopedRoleAssignment = {
      id: 'assignment.site-publisher',
      subjectId: 'user-editor',
      scope: SITE_SCOPE,
      role: { kind: 'custom-role', roleId: role.id },
    }
    const input = resolverInput({
      roleAssignments: [ORGANIZATION_MEMBER, customAssignment],
      customRoles: [role],
    })

    expect(permission(input, 'content.pages.write')).toMatchObject({
      decision: 'allow',
      precedence: 'custom-role',
      reason: 'custom-role-grant',
      source: {
        kind: 'custom-role-assignment',
        assignmentId: customAssignment.id,
        roleId: role.id,
      },
    })
    expect(permission(input, 'site.settings.read')).toMatchObject({
      decision: 'deny',
      precedence: 'custom-role',
      reason: 'custom-role-deny',
    })

    const aboveCeiling = sitePublisherRole(['site.delete'], [])
    expect(() => resolveLayeredPermissions(resolverInput({
      roleAssignments: [{
        ...customAssignment,
        role: { kind: 'custom-role', roleId: aboveCeiling.id },
      }],
      customRoles: [aboveCeiling],
    }))).toThrow(PermissionCatalogError)
  })

  it('prevents customer roles and explicit grants from synthesizing internal-console authority', () => {
    const customerPlatformAssignment: ScopedRoleAssignment = {
      id: 'assignment.customer-platform-owner',
      subjectId: 'user-editor',
      scope: PLATFORM_SCOPE,
      role: { kind: 'launch-persona', persona: 'owner' },
    }
    const input = resolverInput({
      roleAssignments: [customerPlatformAssignment],
      permissionOverrides: [permissionOverride(
        'override.customer-internal-grant',
        PLATFORM_SCOPE,
        [
          'platform.organizations.manage',
          'platform.roles.manage',
          'support.access',
        ],
      )],
    })

    for (const permissionId of [
      'platform.organizations.manage',
      'platform.roles.manage',
      'support.access',
    ]) {
      expect(permission(input, permissionId), permissionId).toMatchObject({
        decision: 'deny',
        precedence: 'default-deny',
        reason: 'default-deny',
        source: { kind: 'default-deny' },
      })
    }
  })

  it('makes protected-owner authority absolute and rejects platform-organization demotion', () => {
    const platformSiteScope = {
      ...SITE_SCOPE,
      organizationId: 'organization-platform',
    } as const
    const protectedAssignment: ScopedRoleAssignment = {
      id: 'assignment.protected-owner',
      subjectId: 'user-protected-owner',
      scope: PLATFORM_SCOPE,
      role: { kind: 'launch-persona', persona: 'protected-owner' },
    }
    const protectedInput = resolverInput({
      subjectId: 'user-protected-owner',
      scope: platformSiteScope,
      organization: {
        id: platformSiteScope.organizationId,
        platformId: platformSiteScope.platformId,
        kind: 'platform',
        status: 'active',
      },
      workspace: {
        id: platformSiteScope.workspaceId,
        platformId: platformSiteScope.platformId,
        organizationId: platformSiteScope.organizationId,
        status: 'active',
      },
      site: {
        ...resolverInput().site,
        organizationId: platformSiteScope.organizationId,
      },
      protectedOwnerInvariant: {
        subjectId: 'user-protected-owner',
        platformId: PLATFORM_SCOPE.platformId,
        permissionIds: ['platform.roles.manage'],
      },
      roleAssignments: [protectedAssignment],
      permissionOverrides: [{
        id: 'override.platform-deny',
        subjectId: 'user-protected-owner',
        scope: PLATFORM_SCOPE,
        permissions: {
          grant: [],
          deny: ['platform.roles.manage'],
        },
      }],
    })

    expect(permission(protectedInput, 'platform.roles.manage')).toMatchObject({
      decision: 'allow',
      precedence: 'protected-owner-invariant',
      reason: 'protected-owner-invariant',
      source: {
        kind: 'protected-owner-invariant',
        subjectId: 'user-protected-owner',
      },
    })

    expectResolverError(() => resolveLayeredPermissions({
      ...protectedInput,
      roleAssignments: [
        protectedAssignment,
        {
          id: 'assignment.protected-owner-demotion',
          subjectId: 'user-protected-owner',
          scope: platformSiteScope,
          role: { kind: 'launch-persona', persona: 'viewer' },
        },
      ],
    }), 'protected-owner-demotion')

    expectResolverError(() => resolveLayeredPermissions({
      ...protectedInput,
      organization: {
        ...protectedInput.organization,
        kind: 'customer',
      },
    }), 'platform-organization-invariant')
  })

  it('fails closed for scope substitutions, malformed input, and unknown overrides', () => {
    for (const input of [
      resolverInput({
        organization: {
          ...resolverInput().organization,
          platformId: 'platform-other',
        },
      }),
      resolverInput({
        workspace: {
          ...resolverInput().workspace,
          platformId: 'platform-other',
        },
      }),
      resolverInput({
        site: {
          ...resolverInput().site,
          platformId: 'platform-other',
        },
      }),
    ]) {
      expectResolverError(() => resolveLayeredPermissions(input), 'scope-mismatch')
    }

    expectResolverError(() => resolveLayeredPermissions(resolverInput({
      workspace: {
        id: SITE_SCOPE.workspaceId,
        platformId: SITE_SCOPE.platformId,
        organizationId: 'organization-other',
        status: 'active',
      },
    })), 'scope-mismatch')

    expect(() => resolveLayeredPermissions(resolverInput({
      roleAssignments: [{
        ...ORGANIZATION_MEMBER,
        scope: {
          ...ORGANIZATION_SCOPE,
          organizationId: 'organization-other',
        },
      }],
    }))).toThrow(expect.objectContaining({ code: 'scope-mismatch' }))

    expectResolverError(() => resolveLayeredPermissions(resolverInput({
      permissionOverrides: [permissionOverride(
        'override.unknown',
        ORGANIZATION_SCOPE,
        ['fixture.unknown.write'],
      )],
    })), 'unknown-permission')

    expectResolverError(() => resolveLayeredPermissions(resolverInput({
      permissionOverrides: [permissionOverride(
        'override.scope-substitution',
        SITE_SCOPE,
        ['organization.update'],
      )],
    })), 'scope-mismatch')

    expectResolverError(() => resolveLayeredPermissions({
      ...resolverInput(),
      unexpected: true,
    }), 'invalid-contract')

    expect(() => resolveLayeredPermissions(resolverInput({
      site: {
        ...resolverInput().site,
        capabilityOverrides: {
          grant: ['fixture.unknown-capability'],
          revoke: [],
        },
      },
    }))).toThrow(expect.objectContaining({ code: 'invalid-capability-override' }))
  })

  it('rejects inactive capability permissions that collide with core authority', () => {
    const registry = createFumaRegistry({
      capabilities: [
        { id: 'fixture.active' },
        {
          id: 'fixture.inactive-collision',
          permissions: [{
            id: 'platform.roles.manage',
            label: 'Colliding platform roles',
            description: 'Must not be masked by the active core permission.',
          }],
        },
      ],
      profiles: [{
        id: 'fixture.active',
        label: 'Active fixture',
        capabilityPreset: ['fixture.active'],
        navigationPreset: [],
        onboardingPreset: [],
        starterTemplatePreset: [],
      }],
    })
    const input = resolverInput({
      site: {
        ...resolverInput().site,
        profileId: 'fixture.active',
      },
    })

    expect(() => resolveLayeredPermissions(input, registry)).toThrow(
      expect.objectContaining({
        name: 'PermissionCatalogError',
        code: 'duplicate-permission-id',
        path: 'registry.capabilities.1.permissions.0',
      }),
    )
  })

  it('derives Website and Publication permission differences only from registry composition', () => {
    const website = resolveLayeredPermissions(resolverInput())
    const publication = resolveLayeredPermissions(resolverInput({
      site: {
        ...resolverInput().site,
        profileId: 'publication',
      },
    }))
    const websiteDecision = (permissionId: string) => website.decisions.find((entry) => (
      entry.permissionId === permissionId
    ))
    const publicationDecision = (permissionId: string) => publication.decisions.find((entry) => (
      entry.permissionId === permissionId
    ))

    expect(websiteDecision('website.data.read')).toMatchObject({
      decision: 'allow',
      reason: 'launch-persona-grant',
    })
    expect(websiteDecision('publication.posts.write')).toMatchObject({
      decision: 'deny',
      precedence: 'capability-unavailable',
      reason: 'capability-disabled',
    })
    expect(publicationDecision('publication.posts.write')).toMatchObject({
      decision: 'allow',
      reason: 'launch-persona-grant',
    })
    expect(publicationDecision('website.data.read')).toMatchObject({
      decision: 'deny',
      precedence: 'capability-unavailable',
      reason: 'capability-disabled',
    })

    expect(website.activeCapabilityIds).toEqual(
      fumaLaunchRegistry.compose('website').capabilities.map(({ id }) => id),
    )
    expect(publication.activeCapabilityIds).toEqual(
      fumaLaunchRegistry.compose('publication').capabilities.map(({ id }) => id),
    )
  })

  it('returns deeply immutable, auditable resolution snapshots without freezing caller input', () => {
    const input = resolverInput()
    const resolved = resolveLayeredPermissions(input)
    const pagesWrite = resolved.decisions.find(({ permissionId }) => (
      permissionId === 'content.pages.write'
    ))
    if (!pagesWrite) throw new Error('Missing content.pages.write decision')

    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(input.scope)).toBe(false)
    expect(Object.isFrozen(input.roleAssignments)).toBe(false)
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.scope)).toBe(true)
    expect(Object.isFrozen(resolved.activeCapabilityIds)).toBe(true)
    expect(Object.isFrozen(resolved.decisions)).toBe(true)
    expect(Object.isFrozen(pagesWrite)).toBe(true)
    expect(Object.isFrozen(pagesWrite.source)).toBe(true)
    expect(Object.isFrozen(resolved.allowedPermissionIds)).toBe(true)
    expect(Object.isFrozen(resolved.deniedPermissionIds)).toBe(true)
  })
})
