import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  FUMA_BASE_PERMISSION_CATALOG,
  PermissionCatalogError,
  PermissionCatalogSchema,
  assertCustomRolePermissions,
  composePermissionCatalog,
  createFumaRegistry,
  fumaLaunchRegistry,
  type CapabilityDefinition,
  type CustomRoleDefinition,
  type LaunchPermissionPersona,
  type PermissionCatalogErrorCode,
  type ProductProfile,
} from '@core/fuma'
import {
  FUMA_EXTENSION_CAPABILITY,
  FUMA_EXTENSION_PROFILE,
  fumaExtensionRegistry,
} from '../helpers/fuma'

const BASE_PERMISSION_METADATA = [
  ['platform.organizations.read', 'platform.organizations', 'read', 'platform', 'platform', false],
  ['platform.organizations.manage', 'platform.organizations', 'manage', 'platform', 'platform', false],
  ['platform.roles.manage', 'platform.roles', 'manage', 'platform', 'protected-owner', false],
  ['platform.settings.read', 'platform.settings', 'read', 'platform', 'platform', false],
  ['platform.settings.write', 'platform.settings', 'write', 'platform', 'protected-owner', false],
  ['support.access', 'support', 'access', 'platform', 'support', false],
  ['support.organizations.read', 'support.organizations', 'read', 'platform', 'support', false],
  ['support.sessions.revoke', 'support.sessions', 'revoke', 'platform', 'support', false],
  ['organization.read', 'organization', 'read', 'organization', 'customer', true],
  ['organization.update', 'organization', 'update', 'organization', 'customer', true],
  ['organization.delete', 'organization', 'delete', 'organization', 'customer', false],
  ['organization.members.read', 'organization.members', 'read', 'organization', 'customer', true],
  ['organization.members.manage', 'organization.members', 'manage', 'organization', 'customer', false],
  ['organization.workspaces.create', 'organization.workspaces', 'create', 'organization', 'customer', true],
  ['workspace.read', 'workspace', 'read', 'workspace', 'customer', true],
  ['workspace.update', 'workspace', 'update', 'workspace', 'customer', true],
  ['workspace.delete', 'workspace', 'delete', 'workspace', 'customer', false],
  ['workspace.members.read', 'workspace.members', 'read', 'workspace', 'customer', true],
  ['workspace.members.manage', 'workspace.members', 'manage', 'workspace', 'customer', false],
  ['workspace.sites.create', 'workspace.sites', 'create', 'workspace', 'customer', true],
  ['site.read', 'site', 'read', 'site', 'customer', true],
  ['site.update', 'site', 'update', 'site', 'customer', true],
  ['site.delete', 'site', 'delete', 'site', 'customer', false],
  ['site.members.read', 'site.members', 'read', 'site', 'customer', true],
  ['site.members.manage', 'site.members', 'manage', 'site', 'customer', false],
  ['site.profile.manage', 'site.profile', 'manage', 'site', 'customer', true],
] as const

const BASE_PERMISSION_IDS = BASE_PERMISSION_METADATA.map(([id]) => id)

const OWNER_GRANTS = [
  'organization.read',
  'organization.update',
  'organization.delete',
  'organization.members.read',
  'organization.members.manage',
  'organization.workspaces.create',
  'workspace.read',
  'workspace.update',
  'workspace.delete',
  'workspace.members.read',
  'workspace.members.manage',
  'workspace.sites.create',
  'site.read',
  'site.update',
  'site.delete',
  'site.members.read',
  'site.members.manage',
  'site.profile.manage',
] as const

const ADMIN_GRANTS = [
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

const MEMBER_GRANTS = [
  'organization.read',
  'workspace.read',
  'site.read',
  'site.update',
] as const

const VIEWER_GRANTS = [
  'organization.read',
  'workspace.read',
  'site.read',
] as const

const WEBSITE_CAPABILITY_PERMISSIONS = [
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

const PUBLICATION_CAPABILITY_PERMISSIONS = [
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

const PUBLICATION_ADMIN_CAPABILITY_GRANTS = PUBLICATION_CAPABILITY_PERMISSIONS
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

const SITE_SCOPE = {
  kind: 'site',
  platformId: 'platform-fuma',
  organizationId: 'organization-acme',
  workspaceId: 'workspace-main',
  siteId: 'site-primary',
} as const

function expectCatalogError(run: () => unknown, code: PermissionCatalogErrorCode): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(PermissionCatalogError)
    if (!(error instanceof PermissionCatalogError)) throw error
    expect(error.code).toBe(code)
    return
  }
  throw new Error(`Expected PermissionCatalogError with code ${code}`)
}

function fixtureRegistry(permissions: CapabilityDefinition['permissions']) {
  const capability: CapabilityDefinition = {
    id: 'fixture.permission-collision',
    permissions,
  }
  const profile: ProductProfile = {
    id: 'fixture.permission-collision',
    label: 'Permission collision fixture',
    capabilityPreset: [capability.id],
    navigationPreset: [],
    onboardingPreset: [],
    starterTemplatePreset: [],
  }
  return createFumaRegistry({ capabilities: [capability], profiles: [profile] })
}

function customRole(grant: readonly string[], deny: readonly string[] = []): CustomRoleDefinition {
  return {
    id: 'role.fixture-editor',
    name: 'Fixture editor',
    scope: SITE_SCOPE,
    constraints: {
      basePersona: 'member',
      assignableScopeKinds: ['site'],
    },
    permissionOverrides: { grant, deny },
  }
}

function capabilityPermissionIds(catalog: ReturnType<typeof composePermissionCatalog>): string[] {
  return catalog.permissions
    .filter(({ source }) => source.kind === 'capability')
    .map(({ id }) => id)
}

function capabilityDefaultGrants(
  catalog: ReturnType<typeof composePermissionCatalog>,
  persona: LaunchPermissionPersona,
): string[] {
  const capabilityPermissions = new Set(capabilityPermissionIds(catalog))
  return catalog.defaultGrants[persona].filter((permissionId) => (
    capabilityPermissions.has(permissionId)
  ))
}

describe('FUMA-020 permission catalog', () => {
  it('pins the exact management catalog, least-privilege defaults, and custom-role ceiling', () => {
    expect(FUMA_BASE_PERMISSION_CATALOG.permissions.map((permission) => [
      permission.id,
      permission.resource,
      permission.action,
      permission.scopeKind,
      permission.authority,
      permission.assignableToCustomRoles,
    ])).toEqual(BASE_PERMISSION_METADATA)
    expect(FUMA_BASE_PERMISSION_CATALOG.permissions.every(({ source }) => (
      source.kind === 'core'
    ))).toBe(true)
    expect(FUMA_BASE_PERMISSION_CATALOG.permissions.every(({ defaultDecision }) => (
      defaultDecision === 'deny'
    ))).toBe(true)

    expect(FUMA_BASE_PERMISSION_CATALOG.defaultGrants).toEqual({
      'protected-owner': BASE_PERMISSION_IDS,
      owner: OWNER_GRANTS,
      admin: ADMIN_GRANTS,
      member: MEMBER_GRANTS,
      viewer: VIEWER_GRANTS,
    })
    expect(FUMA_BASE_PERMISSION_CATALOG.customRoleAssignablePermissionIds)
      .toEqual(ADMIN_GRANTS)
    expect(Value.Check(PermissionCatalogSchema, FUMA_BASE_PERMISSION_CATALOG)).toBe(true)
    expect(Object.isFrozen(FUMA_BASE_PERMISSION_CATALOG)).toBe(true)
    expect(Object.isFrozen(FUMA_BASE_PERMISSION_CATALOG.permissions)).toBe(true)
  })

  it('never gives a customer launch persona platform, support, or protected-owner authority', () => {
    const byId = new Map(FUMA_BASE_PERMISSION_CATALOG.permissions.map((entry) => [entry.id, entry]))
    for (const persona of ['owner', 'admin', 'member', 'viewer'] as const) {
      expect(FUMA_BASE_PERMISSION_CATALOG.defaultGrants[persona].every((permissionId) => (
        byId.get(permissionId)?.authority === 'customer'
      )), persona).toBe(true)
    }

    expect(FUMA_BASE_PERMISSION_CATALOG.defaultGrants['protected-owner'])
      .toContain('platform.roles.manage')
    expect(FUMA_BASE_PERMISSION_CATALOG.defaultGrants['protected-owner'])
      .toContain('support.access')
  })

  it('composes the exact Website and Publication capability permissions without profile branching', () => {
    const website = composePermissionCatalog(fumaLaunchRegistry.compose('website'))
    const publication = composePermissionCatalog(fumaLaunchRegistry.compose('publication'))

    expect(capabilityPermissionIds(website)).toEqual(WEBSITE_CAPABILITY_PERMISSIONS)
    expect(capabilityPermissionIds(publication)).toEqual(PUBLICATION_CAPABILITY_PERMISSIONS)
    expect(website.permissions.map(({ id }) => id)).toEqual([
      ...BASE_PERMISSION_IDS,
      ...WEBSITE_CAPABILITY_PERMISSIONS,
    ])
    expect(publication.permissions.map(({ id }) => id)).toEqual([
      ...BASE_PERMISSION_IDS,
      ...PUBLICATION_CAPABILITY_PERMISSIONS,
    ])

    expect(capabilityDefaultGrants(website, 'protected-owner'))
      .toEqual(WEBSITE_CAPABILITY_PERMISSIONS)
    expect(capabilityDefaultGrants(website, 'owner')).toEqual(WEBSITE_CAPABILITY_PERMISSIONS)
    expect(capabilityDefaultGrants(website, 'admin')).toEqual(WEBSITE_CAPABILITY_PERMISSIONS)
    expect(capabilityDefaultGrants(website, 'member'))
      .toEqual(WEBSITE_MEMBER_CAPABILITY_GRANTS)
    expect(capabilityDefaultGrants(website, 'viewer'))
      .toEqual(WEBSITE_VIEWER_CAPABILITY_GRANTS)

    expect(capabilityDefaultGrants(publication, 'protected-owner'))
      .toEqual(PUBLICATION_CAPABILITY_PERMISSIONS)
    expect(capabilityDefaultGrants(publication, 'owner'))
      .toEqual(PUBLICATION_CAPABILITY_PERMISSIONS)
    expect(capabilityDefaultGrants(publication, 'admin'))
      .toEqual(PUBLICATION_ADMIN_CAPABILITY_GRANTS)
    expect(capabilityDefaultGrants(publication, 'member'))
      .toEqual(PUBLICATION_MEMBER_CAPABILITY_GRANTS)
    expect(capabilityDefaultGrants(publication, 'viewer'))
      .toEqual(PUBLICATION_VIEWER_CAPABILITY_GRANTS)

    for (const catalog of [website, publication]) {
      expect(Value.Check(PermissionCatalogSchema, catalog)).toBe(true)
      expect(Object.isFrozen(catalog)).toBe(true)
      expect(catalog.permissions
        .filter(({ source }) => source.kind === 'capability')
        .every(({ scopeKind, authority, defaultDecision }) => (
          scopeKind === 'site'
          && authority === 'customer'
          && defaultDecision === 'deny'
        ))).toBe(true)
    }
  })

  it('follows cross-profile capability grants from registry composition', () => {
    const websiteWithEditorialScheduling = composePermissionCatalog(
      fumaLaunchRegistry.compose('website', {
        grant: ['publication.editorial.schedule'],
        revoke: [],
      }),
    )
    expect(capabilityPermissionIds(websiteWithEditorialScheduling)).toEqual([
      ...WEBSITE_CAPABILITY_PERMISSIONS,
      'publication.posts.read',
      'publication.posts.write',
      'publication.workflow.read',
      'publication.workflow.assign',
      'publication.workflow.review',
      'publication.workflow.approve',
      'publication.posts.schedule',
    ])
    expect(websiteWithEditorialScheduling.permissions.find(({ id }) => (
      id === 'publication.posts.schedule'
    ))).toMatchObject({
      source: {
        kind: 'capability',
        capabilityId: 'publication.editorial.schedule',
      },
      defaultDecision: 'deny',
    })
    expect(capabilityDefaultGrants(websiteWithEditorialScheduling, 'admin'))
      .toContain('publication.posts.schedule')
    expect(capabilityDefaultGrants(websiteWithEditorialScheduling, 'member'))
      .not.toContain('publication.posts.schedule')

    const publicationWithWebsiteData = composePermissionCatalog(
      fumaLaunchRegistry.compose('publication', {
        grant: ['website.data'],
        revoke: [],
      }),
    )
    expect(capabilityPermissionIds(publicationWithWebsiteData))
      .toEqual([...PUBLICATION_CAPABILITY_PERMISSIONS, 'website.data.read'])
    expect(capabilityDefaultGrants(publicationWithWebsiteData, 'viewer'))
      .toContain('website.data.read')
  })

  it('rejects duplicate permission IDs and resources with conflicting ownership metadata', () => {
    const duplicate = fixtureRegistry([{
      id: 'site.read',
      label: 'Colliding site read',
      description: 'Attempts to replace a core permission.',
    }]).compose('fixture.permission-collision')
    expectCatalogError(
      () => composePermissionCatalog(duplicate),
      'duplicate-permission-id',
    )

    const conflictingResource = fixtureRegistry([{
      id: 'organization.archive',
      label: 'Archive organization',
      description: 'Attempts to claim an organization resource from a site capability.',
    }]).compose('fixture.permission-collision')
    expectCatalogError(
      () => composePermissionCatalog(conflictingResource),
      'conflicting-permission-resource',
    )

    for (const permissionId of [
      'platform.audit.read',
      'internal.console.access',
      'admin.console.access',
      'console.access',
    ]) {
      const synthesizedInternalAuthority = fixtureRegistry([{
        id: permissionId,
        label: 'Synthesized internal authority',
        description: 'Attempts to synthesize protected internal-console authority from a site capability.',
      }]).compose('fixture.permission-collision')
      expectCatalogError(
        () => composePermissionCatalog(synthesizedInternalAuthority),
        'conflicting-permission-resource',
      )
    }
  })

  it('keeps an extension permission deny-by-default until a role or declared default grants it', () => {
    const extensionPermission = FUMA_EXTENSION_CAPABILITY.permissions?.[0]
    if (!extensionPermission) throw new Error('Extension permission fixture is unavailable')
    const extensionPermissionId = extensionPermission.id

    const composed = fumaExtensionRegistry.compose(FUMA_EXTENSION_PROFILE.id)
    const catalog = composePermissionCatalog(composed)
    const extension = catalog.permissions.find(({ id }) => id === extensionPermissionId)

    expect(extension).toEqual({
      ...extensionPermission,
      resource: 'fixture.content-review',
      action: 'read',
      scopeKind: 'site',
      authority: 'customer',
      source: {
        kind: 'capability',
        capabilityId: FUMA_EXTENSION_CAPABILITY.id,
      },
      defaultDecision: 'deny',
      assignableToCustomRoles: true,
    })
    for (const persona of Object.keys(catalog.defaultGrants) as LaunchPermissionPersona[]) {
      expect(catalog.defaultGrants[persona]).not.toContain(extensionPermissionId)
    }
    expect(() => assertCustomRolePermissions(
      customRole([extensionPermissionId]),
      catalog,
    )).not.toThrow()

    const withMemberDefault = composePermissionCatalog(composed, {
      capabilityDefaultGrants: { member: [extensionPermissionId] },
    })
    for (const persona of ['protected-owner', 'owner', 'admin', 'member'] as const) {
      expect(withMemberDefault.defaultGrants[persona]).toContain(extensionPermissionId)
    }
    expect(withMemberDefault.defaultGrants.viewer).not.toContain(extensionPermissionId)
  })

  it('requires known custom-role permissions below the customer-assignable ceiling', () => {
    const catalog = composePermissionCatalog(fumaLaunchRegistry.compose('website'))

    expect(() => assertCustomRolePermissions(
      customRole(['content.pages.write'], ['site.settings.write']),
      catalog,
    )).not.toThrow()
    expectCatalogError(
      () => assertCustomRolePermissions(customRole(['fixture.unknown.read']), catalog),
      'unknown-permission',
    )
    expectCatalogError(
      () => assertCustomRolePermissions(customRole(['platform.roles.manage']), catalog),
      'permission-above-custom-role-ceiling',
    )
    expectCatalogError(
      () => assertCustomRolePermissions(customRole(['support.access']), catalog),
      'permission-above-custom-role-ceiling',
    )
    expectCatalogError(
      () => assertCustomRolePermissions(customRole(['organization.delete']), catalog),
      'permission-above-custom-role-ceiling',
    )
    expectCatalogError(
      () => assertCustomRolePermissions(customRole(['organization.update']), catalog),
      'permission-outside-custom-role-scope',
    )
  })
})
