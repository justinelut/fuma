import { describe, expect, it } from 'bun:test'
import {
  FUMA_BASE_PERMISSION_CATALOG,
  LAUNCH_PERMISSION_PERSONAS,
  PERMISSION_RESOLUTION_PRECEDENCE,
  PermissionCatalogError,
  PermissionCatalogSchema,
  PermissionResolverInputSchema,
  assertCustomRolePermissions,
  composePermissionCatalog,
  createFumaRegistry,
  fumaLaunchRegistry,
  type CustomRoleDefinition,
  type LaunchPermissionPersona,
  type PermissionId,
  type ScopedPermissionOverride,
  type ScopedRoleAssignment,
} from '@core/fuma'
import {
  LayeredPermissionResolverError,
  resolveLayeredPermissions,
  type LayeredPermissionDecision,
  type LayeredPermissionResolution,
  type LayeredRoleResolverInput,
} from '../../../server/fuma/permissions'

const PLATFORM_SCOPE = {
  kind: 'platform',
  platformId: 'platform-fuma',
} as const

const ORGANIZATION_SCOPE = {
  kind: 'organization',
  platformId: PLATFORM_SCOPE.platformId,
  organizationId: 'organization-acme',
} as const

const SITE_SCOPE = {
  kind: 'site',
  platformId: PLATFORM_SCOPE.platformId,
  organizationId: ORGANIZATION_SCOPE.organizationId,
  workspaceId: 'workspace-main',
  siteId: 'site-primary',
} as const

const PLATFORM_PERMISSION_IDS = [
  'platform.organizations.read',
  'platform.organizations.manage',
  'platform.roles.manage',
  'platform.settings.read',
  'platform.settings.write',
  'support.access',
  'support.organizations.read',
  'support.sessions.revoke',
] as const

const ORGANIZATION_PERMISSION_IDS = [
  'organization.read',
  'organization.update',
  'organization.delete',
  'organization.members.read',
  'organization.members.manage',
  'organization.workspaces.create',
] as const

const WORKSPACE_PERMISSION_IDS = [
  'workspace.read',
  'workspace.update',
  'workspace.delete',
  'workspace.members.read',
  'workspace.members.manage',
  'workspace.sites.create',
] as const

const SITE_MANAGEMENT_PERMISSION_IDS = [
  'site.read',
  'site.update',
  'site.delete',
  'site.members.read',
  'site.members.manage',
  'site.profile.manage',
] as const

const MANAGEMENT_PERMISSION_IDS = [
  ...PLATFORM_PERMISSION_IDS,
  ...ORGANIZATION_PERMISSION_IDS,
  ...WORKSPACE_PERMISSION_IDS,
  ...SITE_MANAGEMENT_PERMISSION_IDS,
] as const

const OWNER_MANAGEMENT_GRANTS = [
  ...ORGANIZATION_PERMISSION_IDS,
  ...WORKSPACE_PERMISSION_IDS,
  ...SITE_MANAGEMENT_PERMISSION_IDS,
] as const

const ADMIN_MANAGEMENT_GRANTS = [
  'organization.read',
  'organization.update',
  'organization.members.read',
  'organization.workspaces.create',
  'workspace.read',
  'workspace.update',
  'workspace.members.read',
  'workspace.sites.create',
  'site.read',
  'site.update',
  'site.members.read',
  'site.profile.manage',
] as const

const MEMBER_MANAGEMENT_GRANTS = [
  'organization.read',
  'workspace.read',
  'site.read',
  'site.update',
] as const

const VIEWER_MANAGEMENT_GRANTS = [
  'organization.read',
  'workspace.read',
  'site.read',
] as const

const MANAGEMENT_GRANTS: Readonly<Record<LaunchPermissionPersona, readonly PermissionId[]>> = {
  'protected-owner': MANAGEMENT_PERMISSION_IDS,
  owner: OWNER_MANAGEMENT_GRANTS,
  admin: ADMIN_MANAGEMENT_GRANTS,
  member: MEMBER_MANAGEMENT_GRANTS,
  viewer: VIEWER_MANAGEMENT_GRANTS,
}

const WEBSITE_CAPABILITY_PERMISSION_IDS = [
  'site.home.read',
  'website.content.read',
  'content.pages.read',
  'content.pages.write',
  'website.data.read',
  'website.media.read',
  'website.analytics.read',
  'website.design.read',
  'website.design.write',
  'site.settings.read',
  'site.settings.write',
] as const

const PUBLICATION_CAPABILITY_PERMISSION_IDS = [
  'site.home.read',
  'content.pages.read',
  'content.pages.write',
  'publication.posts.read',
  'publication.posts.write',
  'publication.workflow.read',
  'publication.workflow.assign',
  'publication.workflow.review',
  'publication.workflow.approve',
  'publication.posts.schedule',
  'publication.tags.read',
  'publication.tags.write',
  'publication.members.read',
  'publication.members.write',
  'publication.newsletters.read',
  'publication.newsletters.write',
  'publication.newsletters.send',
  'publication.analytics.read',
  'website.design.read',
  'website.design.write',
  'site.settings.read',
  'site.settings.write',
] as const

const WEBSITE_MEMBER_CAPABILITY_GRANTS = [
  'site.home.read',
  'website.content.read',
  'content.pages.read',
  'content.pages.write',
  'website.data.read',
  'website.media.read',
  'website.analytics.read',
  'website.design.read',
  'site.settings.read',
] as const

const WEBSITE_VIEWER_CAPABILITY_GRANTS = [
  'site.home.read',
  'website.content.read',
  'content.pages.read',
  'website.data.read',
  'website.media.read',
  'website.analytics.read',
  'website.design.read',
  'site.settings.read',
] as const

const PUBLICATION_ADMIN_CAPABILITY_GRANTS = PUBLICATION_CAPABILITY_PERMISSION_IDS
  .filter((permissionId) => permissionId !== 'publication.newsletters.send')

const PUBLICATION_MEMBER_CAPABILITY_GRANTS = [
  'site.home.read',
  'content.pages.read',
  'content.pages.write',
  'publication.posts.read',
  'publication.posts.write',
  'publication.workflow.read',
  'publication.workflow.review',
  'publication.tags.read',
  'publication.members.read',
  'publication.newsletters.read',
  'publication.analytics.read',
  'website.design.read',
  'site.settings.read',
] as const

const PUBLICATION_VIEWER_CAPABILITY_GRANTS = [
  'site.home.read',
  'content.pages.read',
  'publication.posts.read',
  'publication.workflow.read',
  'publication.tags.read',
  'publication.members.read',
  'publication.newsletters.read',
  'publication.analytics.read',
  'website.design.read',
  'site.settings.read',
] as const

const PROFILE_CASES = [
  {
    profileId: 'website',
    capabilityPermissionIds: WEBSITE_CAPABILITY_PERMISSION_IDS,
    capabilityGrants: {
      'protected-owner': WEBSITE_CAPABILITY_PERMISSION_IDS,
      owner: WEBSITE_CAPABILITY_PERMISSION_IDS,
      admin: WEBSITE_CAPABILITY_PERMISSION_IDS,
      member: WEBSITE_MEMBER_CAPABILITY_GRANTS,
      viewer: WEBSITE_VIEWER_CAPABILITY_GRANTS,
    },
  },
  {
    profileId: 'publication',
    capabilityPermissionIds: PUBLICATION_CAPABILITY_PERMISSION_IDS,
    capabilityGrants: {
      'protected-owner': PUBLICATION_CAPABILITY_PERMISSION_IDS,
      owner: PUBLICATION_CAPABILITY_PERMISSION_IDS,
      admin: PUBLICATION_ADMIN_CAPABILITY_GRANTS,
      member: PUBLICATION_MEMBER_CAPABILITY_GRANTS,
      viewer: PUBLICATION_VIEWER_CAPABILITY_GRANTS,
    },
  },
] as const

type ProfileId = typeof PROFILE_CASES[number]['profileId']

type MatrixInputOptions = Readonly<{
  capabilityOverrides?: LayeredRoleResolverInput['site']['capabilityOverrides']
  permissionOverrides?: readonly ScopedPermissionOverride[]
  protectedPermissionIds?: readonly PermissionId[]
  organizationStatus?: LayeredRoleResolverInput['organization']['status']
  workspaceStatus?: LayeredRoleResolverInput['workspace']['status']
  siteStatus?: LayeredRoleResolverInput['site']['status']
}>

function matrixInput(
  profileId: string,
  persona: LaunchPermissionPersona,
  options: MatrixInputOptions = {},
): LayeredRoleResolverInput {
  const subjectId = `user-${persona}`
  const roleAssignment: ScopedRoleAssignment = {
    id: `assignment-${persona}`,
    subjectId,
    scope: persona === 'protected-owner' ? PLATFORM_SCOPE : ORGANIZATION_SCOPE,
    role: { kind: 'launch-persona', persona },
  }

  return {
    subjectId,
    platformOrganizationId: 'organization-platform',
    scope: SITE_SCOPE,
    organization: {
      id: SITE_SCOPE.organizationId,
      platformId: SITE_SCOPE.platformId,
      kind: 'customer',
      status: options.organizationStatus ?? 'active',
    },
    workspace: {
      id: SITE_SCOPE.workspaceId,
      platformId: SITE_SCOPE.platformId,
      organizationId: SITE_SCOPE.organizationId,
      status: options.workspaceStatus ?? 'active',
    },
    site: {
      id: SITE_SCOPE.siteId,
      platformId: SITE_SCOPE.platformId,
      organizationId: SITE_SCOPE.organizationId,
      workspaceId: SITE_SCOPE.workspaceId,
      status: options.siteStatus ?? 'active',
      profileId,
      capabilityOverrides: options.capabilityOverrides ?? { grant: [], revoke: [] },
    },
    protectedOwnerInvariant: persona === 'protected-owner'
      ? {
          subjectId,
          platformId: PLATFORM_SCOPE.platformId,
          permissionIds: options.protectedPermissionIds
            ? [...options.protectedPermissionIds]
            : [
                'platform.roles.manage',
                'platform.settings.write',
              ],
        }
      : null,
    roleAssignments: [roleAssignment],
    permissionOverrides: [...(options.permissionOverrides ?? [])],
    customRoles: [],
  }
}

function decision(
  resolution: LayeredPermissionResolution,
  permissionId: PermissionId,
): LayeredPermissionDecision {
  const found = resolution.decisions.find((entry) => entry.permissionId === permissionId)
  if (!found) throw new Error(`Missing decision for ${permissionId}`)
  return found
}

function permissionOverride(
  persona: LaunchPermissionPersona,
  id: string,
  scope: ScopedPermissionOverride['scope'],
  grant: readonly PermissionId[] = [],
  deny: readonly PermissionId[] = [],
): ScopedPermissionOverride {
  return {
    id,
    subjectId: `user-${persona}`,
    scope,
    permissions: { grant: [...grant], deny: [...deny] },
  }
}

function includesPermission(
  permissionIds: readonly PermissionId[],
  permissionId: PermissionId,
): boolean {
  return permissionIds.includes(permissionId)
}

function expectedScopeKind(permissionId: PermissionId) {
  if (includesPermission(PLATFORM_PERMISSION_IDS, permissionId)) return 'platform'
  if (includesPermission(ORGANIZATION_PERMISSION_IDS, permissionId)) return 'organization'
  if (includesPermission(WORKSPACE_PERMISSION_IDS, permissionId)) return 'workspace'
  return 'site'
}

function expectedDecision(
  profileCase: typeof PROFILE_CASES[number],
  persona: LaunchPermissionPersona,
  permissionId: PermissionId,
) {
  return includesPermission(MANAGEMENT_GRANTS[persona], permissionId)
    || includesPermission(profileCase.capabilityGrants[persona], permissionId)
    ? 'allow'
    : 'deny'
}

function resolutionDecisions(
  resolutions: ReadonlyMap<LaunchPermissionPersona, LayeredPermissionResolution>,
  permissionId: PermissionId,
) {
  return {
    'protected-owner': decision(
      requireResolution(resolutions, 'protected-owner'),
      permissionId,
    ).decision,
    owner: decision(requireResolution(resolutions, 'owner'), permissionId).decision,
    admin: decision(requireResolution(resolutions, 'admin'), permissionId).decision,
    member: decision(requireResolution(resolutions, 'member'), permissionId).decision,
    viewer: decision(requireResolution(resolutions, 'viewer'), permissionId).decision,
  }
}

function requireResolution(
  resolutions: ReadonlyMap<LaunchPermissionPersona, LayeredPermissionResolution>,
  persona: LaunchPermissionPersona,
): LayeredPermissionResolution {
  const found = resolutions.get(persona)
  if (!found) throw new Error(`Missing resolution for ${persona}`)
  return found
}

function createPermissionRoleMatrixDemo() {
  return {
    schemaVersion: 1,
    personaOrder: [...LAUNCH_PERMISSION_PERSONAS],
    profiles: PROFILE_CASES.map((profileCase) => {
      const catalog = composePermissionCatalog(
        fumaLaunchRegistry.compose(profileCase.profileId),
      )
      const resolutions = new Map(LAUNCH_PERMISSION_PERSONAS.map((persona) => [
        persona,
        resolveLayeredPermissions(matrixInput(profileCase.profileId, persona)),
      ] as const))
      return {
        profileId: profileCase.profileId,
        activePermissionIds: catalog.permissions.map(({ id }) => id),
        rows: catalog.permissions.map((entry) => ({
          permissionId: entry.id,
          scopeKind: entry.scopeKind,
          source: entry.source.kind === 'core' ? 'core' : entry.source.capabilityId,
          decisions: resolutionDecisions(resolutions, entry.id),
        })),
      }
    }),
  }
}

function allowedIds(profileId: ProfileId, persona: LaunchPermissionPersona): PermissionId[] {
  const profile = createPermissionRoleMatrixDemo().profiles.find((entry) => (
    entry.profileId === profileId
  ))
  if (!profile) throw new Error(`Missing matrix profile ${profileId}`)
  return profile.rows
    .filter((row) => row.decisions[persona] === 'allow')
    .map(({ permissionId }) => permissionId)
}

function isProperSubset(subset: readonly PermissionId[], superset: readonly PermissionId[]): boolean {
  const upper = new Set(superset)
  return subset.length < superset.length && subset.every((permissionId) => upper.has(permissionId))
}

function customRole(permissionIds: readonly PermissionId[]): CustomRoleDefinition {
  return {
    id: 'role.matrix-custom',
    name: 'Matrix custom role',
    scope: ORGANIZATION_SCOPE,
    constraints: {
      basePersona: 'viewer',
      assignableScopeKinds: ['site'],
    },
    permissionOverrides: { grant: [...permissionIds], deny: [] },
  }
}

function expectCatalogCeilingError(permissionId: PermissionId): void {
  const catalog = composePermissionCatalog(fumaLaunchRegistry.compose('website'))
  try {
    assertCustomRolePermissions(customRole([permissionId]), catalog)
  } catch (error) {
    expect(error).toBeInstanceOf(PermissionCatalogError)
    if (!(error instanceof PermissionCatalogError)) throw error
    expect(error.code).toBe('permission-above-custom-role-ceiling')
    return
  }
  throw new Error(`Expected custom-role ceiling rejection for ${permissionId}`)
}

function expectResolverError(run: () => unknown, code: LayeredPermissionResolverError['code']): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(LayeredPermissionResolverError)
    if (!(error instanceof LayeredPermissionResolverError)) throw error
    expect(error.code).toBe(code)
    return
  }
  throw new Error(`Expected resolver error ${code}`)
}

describe('FUMA-020 exhaustive permission role matrix', () => {
  it('exports the public permission contracts, catalog, and precedence through @core/fuma', () => {
    expect(PermissionResolverInputSchema).toBeDefined()
    expect(PermissionCatalogSchema).toBeDefined()
    expect(FUMA_BASE_PERMISSION_CATALOG.permissions.map(({ id }) => id))
      .toEqual(MANAGEMENT_PERMISSION_IDS)
    expect(PERMISSION_RESOLUTION_PRECEDENCE).toEqual([
      'capability-unavailable',
      'protected-owner-invariant',
      'explicit-deny',
      'explicit-grant',
      'custom-role',
      'launch-persona',
      'default-deny',
    ])
  })

  it('resolves every active management and capability permission for all personas and profiles', () => {
    const output = createPermissionRoleMatrixDemo()

    expect(output.schemaVersion).toBe(1)
    expect(output.personaOrder).toEqual([
      'protected-owner',
      'owner',
      'admin',
      'member',
      'viewer',
    ])

    for (const profileCase of PROFILE_CASES) {
      const profile = output.profiles.find((entry) => entry.profileId === profileCase.profileId)
      if (!profile) throw new Error(`Missing profile matrix ${profileCase.profileId}`)
      const expectedPermissionIds = [
        ...MANAGEMENT_PERMISSION_IDS,
        ...profileCase.capabilityPermissionIds,
      ]
      expect(profile.activePermissionIds, profileCase.profileId)
        .toEqual(expectedPermissionIds)
      expect(profile.rows.map(({ permissionId }) => permissionId), profileCase.profileId)
        .toEqual(expectedPermissionIds)

      for (const row of profile.rows) {
        expect(row.scopeKind, `${profileCase.profileId}:${row.permissionId}`)
          .toBe(expectedScopeKind(row.permissionId))
        for (const persona of LAUNCH_PERMISSION_PERSONAS) {
          expect(
            row.decisions[persona],
            `${profileCase.profileId}:${persona}:${row.permissionId}`,
          ).toBe(expectedDecision(profileCase, persona, row.permissionId))
        }
      }
    }
  })

  it('emits a deterministic JSON-safe demo structure for deferred command execution', () => {
    const first = createPermissionRoleMatrixDemo()
    const second = createPermissionRoleMatrixDemo()

    expect(JSON.stringify(first, null, 2)).toBe(JSON.stringify(second, null, 2))
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
    expect(first.profiles.map(({ profileId, rows }) => ({
      profileId,
      rowCount: rows.length,
    }))).toEqual([
      { profileId: 'website', rowCount: 37 },
      { profileId: 'publication', rowCount: 48 },
    ])
  })

  it('proves strict least-privilege ordering and excludes platform authority from customer personas', () => {
    for (const { profileId } of PROFILE_CASES) {
      const protectedOwner = allowedIds(profileId, 'protected-owner')
      const owner = allowedIds(profileId, 'owner')
      const admin = allowedIds(profileId, 'admin')
      const member = allowedIds(profileId, 'member')
      const viewer = allowedIds(profileId, 'viewer')

      expect(isProperSubset(viewer, member), profileId).toBe(true)
      expect(isProperSubset(member, admin), profileId).toBe(true)
      expect(isProperSubset(admin, owner), profileId).toBe(true)
      expect(isProperSubset(owner, protectedOwner), profileId).toBe(true)
      for (const persona of ['owner', 'admin', 'member', 'viewer'] as const) {
        expect(allowedIds(profileId, persona).some((permissionId) => (
          includesPermission(PLATFORM_PERMISSION_IDS, permissionId)
        )), `${profileId}:${persona}`).toBe(false)
      }
    }
  })

  it('pins Website and Publication differences to their composed capabilities', () => {
    const website = new Set<PermissionId>(WEBSITE_CAPABILITY_PERMISSION_IDS)
    const publication = new Set<PermissionId>(PUBLICATION_CAPABILITY_PERMISSION_IDS)

    expect(WEBSITE_CAPABILITY_PERMISSION_IDS.filter((id) => !publication.has(id))).toEqual([
      'website.content.read',
      'website.data.read',
      'website.media.read',
      'website.analytics.read',
    ])
    expect(PUBLICATION_CAPABILITY_PERMISSION_IDS.filter((id) => !website.has(id))).toEqual([
      'publication.posts.read',
      'publication.posts.write',
      'publication.workflow.read',
      'publication.workflow.assign',
      'publication.workflow.review',
      'publication.workflow.approve',
      'publication.posts.schedule',
      'publication.tags.read',
      'publication.tags.write',
      'publication.members.read',
      'publication.members.write',
      'publication.newsletters.read',
      'publication.newsletters.write',
      'publication.newsletters.send',
      'publication.analytics.read',
    ])
  })

  it('applies permission policy to cross-profile capability grants without profile branching', () => {
    const editorialExpected: Readonly<Record<LaunchPermissionPersona, readonly PermissionId[]>> = {
      'protected-owner': [
        'publication.posts.read',
        'publication.posts.write',
        'publication.workflow.read',
        'publication.workflow.assign',
        'publication.workflow.review',
        'publication.workflow.approve',
        'publication.posts.schedule',
      ],
      owner: [
        'publication.posts.read',
        'publication.posts.write',
        'publication.workflow.read',
        'publication.workflow.assign',
        'publication.workflow.review',
        'publication.workflow.approve',
        'publication.posts.schedule',
      ],
      admin: [
        'publication.posts.read',
        'publication.posts.write',
        'publication.workflow.read',
        'publication.workflow.assign',
        'publication.workflow.review',
        'publication.workflow.approve',
        'publication.posts.schedule',
      ],
      member: [
        'publication.posts.read',
        'publication.posts.write',
        'publication.workflow.read',
        'publication.workflow.review',
      ],
      viewer: ['publication.posts.read', 'publication.workflow.read'],
    }

    for (const persona of LAUNCH_PERMISSION_PERSONAS) {
      const website = resolveLayeredPermissions(matrixInput('website', persona, {
        capabilityOverrides: {
          grant: ['publication.editorial.schedule'],
          revoke: [],
        },
      }))
      for (const permissionId of [
        'publication.posts.read',
        'publication.posts.write',
        'publication.workflow.read',
        'publication.workflow.assign',
        'publication.workflow.review',
        'publication.workflow.approve',
        'publication.posts.schedule',
      ] as const) {
        expect(decision(website, permissionId).decision, `${persona}:${permissionId}`)
          .toBe(includesPermission(editorialExpected[persona], permissionId) ? 'allow' : 'deny')
      }

      const publication = resolveLayeredPermissions(matrixInput('publication', persona, {
        capabilityOverrides: { grant: ['website.data'], revoke: [] },
      }))
      expect(decision(publication, 'website.data.read').decision, persona).toBe('allow')
    }
  })

  it('denies undeclared extension defaults for every persona', () => {
    const extensionPermissionId = 'fixture.review.read'
    const extensionRegistry = createFumaRegistry({
      capabilities: [{
        id: 'fixture.review',
        permissions: [{
          id: extensionPermissionId,
          label: 'Read review fixture',
          description: 'Read the deterministic permission matrix fixture.',
        }],
      }],
      profiles: [{
        id: 'fixture.review',
        label: 'Review fixture',
        capabilityPreset: ['fixture.review'],
        navigationPreset: [],
        onboardingPreset: [],
        starterTemplatePreset: [],
      }],
    })
    const catalog = composePermissionCatalog(extensionRegistry.compose('fixture.review'))

    for (const persona of LAUNCH_PERMISSION_PERSONAS) {
      expect(catalog.defaultGrants[persona]).not.toContain(extensionPermissionId)
      const resolved = resolveLayeredPermissions(
        matrixInput('fixture.review', persona),
        extensionRegistry,
      )
      expect(decision(resolved, extensionPermissionId)).toMatchObject({
        decision: 'deny',
        precedence: 'launch-persona',
        reason: 'launch-persona-deny',
      })
    }
  })

  it('gives explicit deny precedence over explicit grant and launch defaults for every matrix cell', () => {
    for (const { profileId } of PROFILE_CASES) {
      for (const persona of LAUNCH_PERMISSION_PERSONAS) {
        const resolved = resolveLayeredPermissions(matrixInput(profileId, persona, {
          permissionOverrides: [
            permissionOverride(
              persona,
              'override-organization-grant',
              ORGANIZATION_SCOPE,
              ['site.settings.read'],
            ),
            permissionOverride(
              persona,
              'override-site-deny',
              SITE_SCOPE,
              [],
              ['site.settings.read'],
            ),
          ],
        }))
        expect(decision(resolved, 'site.settings.read'), `${profileId}:${persona}`)
          .toMatchObject({
            decision: 'deny',
            precedence: 'explicit-deny',
            reason: 'explicit-deny',
            source: {
              kind: 'permission-override',
              overrideId: 'override-site-deny',
            },
          })
      }
    }
  })

  it('denies lifecycle mutations before persona policy while preserving reads', () => {
    const lifecycleCases = [
      { options: { organizationStatus: 'suspended' }, reason: 'organization-suspended' },
      { options: { organizationStatus: 'archived' }, reason: 'organization-archived' },
      { options: { workspaceStatus: 'archived' }, reason: 'workspace-archived' },
      { options: { siteStatus: 'archived' }, reason: 'site-archived' },
    ] as const

    for (const { profileId } of PROFILE_CASES) {
      for (const persona of LAUNCH_PERMISSION_PERSONAS) {
        for (const lifecycleCase of lifecycleCases) {
          const resolved = resolveLayeredPermissions(matrixInput(
            profileId,
            persona,
            lifecycleCase.options,
          ))
          expect(
            decision(resolved, 'site.update'),
            `${profileId}:${persona}:${lifecycleCase.reason}`,
          ).toMatchObject({
            decision: 'deny',
            precedence: 'lifecycle',
            reason: lifecycleCase.reason,
          })
          expect(decision(resolved, 'site.read').decision).toBe('allow')
        }
      }
    }
  })

  it('pins the custom-role ceiling to customer permissions below owner-only authority', () => {
    for (const { profileId, capabilityPermissionIds } of PROFILE_CASES) {
      const catalog = composePermissionCatalog(fumaLaunchRegistry.compose(profileId))
      expect(catalog.customRoleAssignablePermissionIds).toEqual([
        ...ADMIN_MANAGEMENT_GRANTS,
        ...capabilityPermissionIds,
      ])
      expect(() => assertCustomRolePermissions(
        customRole(catalog.customRoleAssignablePermissionIds),
        catalog,
      )).not.toThrow()
    }

    for (const permissionId of [
      'platform.roles.manage',
      'support.access',
      'organization.delete',
      'organization.members.manage',
      'site.delete',
    ] as const) {
      expectCatalogCeilingError(permissionId)
    }
  })

  it('preserves protected-owner invariants below capability availability and rejects demotion', () => {
    for (const { profileId } of PROFILE_CASES) {
      const protectedOwner = matrixInput(profileId, 'protected-owner', {
        permissionOverrides: [permissionOverride(
          'protected-owner',
          'override-protected-owner-deny',
          PLATFORM_SCOPE,
          [],
          ['platform.roles.manage'],
        )],
      })
      expect(decision(
        resolveLayeredPermissions(protectedOwner),
        'platform.roles.manage',
      )).toMatchObject({
        decision: 'allow',
        precedence: 'protected-owner-invariant',
        reason: 'protected-owner-invariant',
      })
    }

    const unavailable = matrixInput('website', 'protected-owner', {
      protectedPermissionIds: [
        'platform.roles.manage',
        'publication.newsletters.send',
      ],
    })
    expect(decision(
      resolveLayeredPermissions(unavailable),
      'publication.newsletters.send',
    )).toMatchObject({
      decision: 'deny',
      precedence: 'capability-unavailable',
      reason: 'capability-disabled',
    })

    for (const { profileId } of PROFILE_CASES) {
      const base = matrixInput(profileId, 'protected-owner')
      const platformSiteScope = {
        ...SITE_SCOPE,
        organizationId: 'organization-platform',
      } as const
      expectResolverError(() => resolveLayeredPermissions({
        ...base,
        scope: platformSiteScope,
        organization: {
          id: platformSiteScope.organizationId,
          platformId: platformSiteScope.platformId,
          kind: 'platform',
          status: 'active',
        },
        workspace: {
          ...base.workspace,
          organizationId: platformSiteScope.organizationId,
        },
        site: {
          ...base.site,
          organizationId: platformSiteScope.organizationId,
        },
        roleAssignments: [
          ...base.roleAssignments,
          {
            id: 'assignment-protected-owner-demotion',
            subjectId: base.subjectId,
            scope: platformSiteScope,
            role: { kind: 'launch-persona', persona: 'viewer' },
          },
        ],
      }), 'protected-owner-demotion')
    }
  })
})
