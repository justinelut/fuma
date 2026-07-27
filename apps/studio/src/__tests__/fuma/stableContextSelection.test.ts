import { describe, expect, it } from 'bun:test'
import { composeManagedClientsView, fumaLaunchRegistry } from '@core/fuma'
import { Value } from '@core/utils/typeboxHelpers'
import { createFumaTwoTenantMatrix } from '../helpers/fuma/fixtures'
import {
  AccessibleContextCatalogSchema,
  BrowserContextPreferenceSchema,
  InvitationEntrySchema,
  ManagedClientCatalogEntrySchema,
  ManagedClientsViewSchema,
  OrganizationCatalogEntrySchema,
  ProfileRelativeSubpathSchema,
  ScopedContextResolutionSchema,
  SiteCatalogEntrySchema,
  StableContextSelectionSchema,
  WorkspaceCatalogEntrySchema,
  buildInvitationAdminUrl,
  buildOrganizationSwitchTarget,
  buildScopedAdminUrl,
  buildSiteSwitchTarget,
  buildWorkspaceSwitchTarget,
  parseScopedAdminUrl,
  resolveScopedAdminContext,
  validateProfileRelativeSubpath,
  type AccessibleContextCatalog,
  type StableContextSelection,
} from '@core/fuma'

const matrix = createFumaTwoTenantMatrix('stable-context-selection')

function catalog(): AccessibleContextCatalog {
  return {
    organizations: matrix.organizations.map((organization) => ({
      id: organization.id,
      name: organization.label,
      status: 'active' as const,
    })),
    workspaces: matrix.workspaces.map((workspace) => ({
      id: workspace.id,
      organizationId: workspace.organizationId,
      name: workspace.label,
      status: 'active' as const,
      isDefault: true,
    })),
    sites: matrix.sites.map((site) => ({
      id: site.id,
      organizationId: site.organizationId,
      workspaceId: site.workspaceId,
      name: site.label,
      status: 'active' as const,
      profileId: site.profileId,
      capabilityOverrides: { grant: [], revoke: [] },
    })),
  }
}

function selection(
  organizationIndex: number,
  profileId: 'website' | 'publication',
): StableContextSelection {
  const organization = matrix.organizations[organizationIndex]
  const workspace = matrix.workspaces.find((entry) => (
    entry.organizationId === organization.id
  ))
  const site = matrix.sites.find((entry) => (
    entry.organizationId === organization.id && entry.profileId === profileId
  ))
  if (!workspace || !site) throw new Error('Fixture context is incomplete')
  return {
    organizationId: organization.id,
    workspaceId: workspace.id,
    siteId: site.id,
  }
}

function resolve(
  url: string,
  accessibleCatalog: AccessibleContextCatalog = catalog(),
  browserPreference?: unknown,
) {
  return resolveScopedAdminContext({
    url,
    catalog: accessibleCatalog,
    browserPreference,
  }, fumaLaunchRegistry)
}

function withStatus(
  mutate: (value: AccessibleContextCatalog) => void,
): AccessibleContextCatalog {
  const value = structuredClone(catalog())
  mutate(value)
  return value
}

describe('FUMA-018 stable scoped-context selection', () => {
  it('publishes strict TypeBox-derived catalog, selection, preference, invitation, and resolution contracts', () => {
    const accessibleCatalog = catalog()
    const selected = selection(0, 'website')
    const preference = { version: 1 as const, selection: selected }
    const invitation = { kind: 'invitation' as const, invitationId: 'invite-42' }
    const resolution = resolve(buildScopedAdminUrl(selected))

    expect(Value.Check(OrganizationCatalogEntrySchema, accessibleCatalog.organizations[0])).toBe(true)
    expect(Value.Check(WorkspaceCatalogEntrySchema, accessibleCatalog.workspaces[0])).toBe(true)
    expect(Value.Check(SiteCatalogEntrySchema, accessibleCatalog.sites[0])).toBe(true)
    expect(Value.Check(AccessibleContextCatalogSchema, accessibleCatalog)).toBe(true)
    expect(Value.Check(StableContextSelectionSchema, selected)).toBe(true)
    expect(Value.Check(BrowserContextPreferenceSchema, preference)).toBe(true)
    expect(Value.Check(InvitationEntrySchema, invitation)).toBe(true)
    expect(Value.Check(ScopedContextResolutionSchema, resolution)).toBe(true)
    expect(Value.Check(BrowserContextPreferenceSchema, { ...preference, version: 2 })).toBe(false)
    expect(Value.Check(SiteCatalogEntrySchema, {
      ...accessibleCatalog.sites[0],
      unexpected: true,
    })).toBe(false)
  })

  it('round-trips a fully explicit canonical deep link and preserves tenant scope across refresh', () => {
    const acaciaWebsite = selection(0, 'website')
    const baobabWebsite = selection(1, 'website')

    // The lower-scope IDs intentionally collide; the organization keeps the route unambiguous.
    expect(acaciaWebsite.workspaceId).toBe(baobabWebsite.workspaceId)
    expect(acaciaWebsite.siteId).toBe(baobabWebsite.siteId)

    const deepLink = buildScopedAdminUrl(baobabWebsite, '/admin/pages')
    expect(deepLink).toContain('/admin/organizations/')
    expect(parseScopedAdminUrl(deepLink)).toEqual({
      kind: 'selection',
      selection: baobabWebsite,
      profileRelativeSubpath: '/admin/pages',
    })

    const preferenceForOtherTenant = { version: 1, selection: acaciaWebsite }
    const firstLoad = resolve(deepLink, catalog(), preferenceForOtherTenant)
    const refresh = resolve(deepLink, catalog(), preferenceForOtherTenant)

    expect(firstLoad.kind).toBe('ready')
    expect(firstLoad).toEqual(refresh)
    if (firstLoad.kind !== 'ready') throw new Error('Expected ready context')
    expect(firstLoad.source).toBe('url')
    expect(firstLoad.selection).toEqual(baobabWebsite)
    expect(firstLoad.organization.id).toBe(baobabWebsite.organizationId)
    expect(firstLoad.profileRelativeSubpath).toBe('/admin/pages')
  })

  it('rejects ambiguous lower-scope routes and unauthorized ownership substitutions', () => {
    const accessibleCatalog = structuredClone(catalog())
    const firstOrganization = accessibleCatalog.organizations[0]
    const secondOrganization = accessibleCatalog.organizations[1]
    const firstWorkspace = accessibleCatalog.workspaces.find(({ organizationId }) => (
      organizationId === firstOrganization.id
    ))
    if (!firstWorkspace) throw new Error('Fixture workspace is missing')

    const foreignWorkspaceId = 'workspace-only-in-second-organization'
    accessibleCatalog.workspaces.push({
      id: foreignWorkspaceId,
      organizationId: secondOrganization.id,
      name: 'Foreign workspace',
      status: 'active',
      isDefault: false,
    })
    accessibleCatalog.sites.push({
      id: 'site-only-in-foreign-workspace',
      organizationId: secondOrganization.id,
      workspaceId: foreignWorkspaceId,
      name: 'Foreign site',
      status: 'active',
      profileId: 'website',
      capabilityOverrides: { grant: [], revoke: [] },
    })

    expect(parseScopedAdminUrl(`/admin/sites/${encodeURIComponent(selection(0, 'website').siteId)}`)).toBeNull()
    expect(parseScopedAdminUrl(`/admin/workspaces/${encodeURIComponent(firstWorkspace.id)}`)).toBeNull()

    const workspaceSubstitution = resolve(buildScopedAdminUrl({
      organizationId: firstOrganization.id,
      workspaceId: foreignWorkspaceId,
      siteId: 'site-only-in-foreign-workspace',
    }), accessibleCatalog)
    expect(workspaceSubstitution).toMatchObject({
      kind: 'unauthorized',
      scope: 'workspace',
      source: 'url',
    })

    const siteSubstitution = resolve(buildScopedAdminUrl({
      organizationId: firstOrganization.id,
      workspaceId: firstWorkspace.id,
      siteId: 'site-only-in-foreign-workspace',
    }), accessibleCatalog)
    expect(siteSubstitution).toMatchObject({
      kind: 'unauthorized',
      scope: 'site',
      source: 'url',
    })
  })

  it('distinguishes missing, unauthorized, suspended, and archived resolution states', () => {
    const selected = selection(0, 'website')

    expect(resolve(buildScopedAdminUrl({
      ...selected,
      siteId: 'missing-site',
    }))).toEqual({ kind: 'missing', source: 'url', scope: 'site' })

    expect(resolve(buildScopedAdminUrl({
      ...selected,
      organizationId: 'inaccessible-organization',
    }))).toMatchObject({ kind: 'unauthorized', scope: 'organization' })

    const suspended = withStatus((value) => {
      const organization = value.organizations.find(({ id }) => id === selected.organizationId)
      if (organization) organization.status = 'suspended'
      const workspace = value.workspaces.find(({ id }) => id === selected.workspaceId)
      if (workspace) workspace.status = 'archived'
    })
    expect(resolve(buildScopedAdminUrl(selected), suspended).kind).toBe('organization-suspended')

    const archivedWorkspace = withStatus((value) => {
      const workspace = value.workspaces.find((entry) => (
        entry.organizationId === selected.organizationId && entry.id === selected.workspaceId
      ))
      if (workspace) workspace.status = 'archived'
    })
    expect(resolve(buildScopedAdminUrl(selected), archivedWorkspace).kind).toBe('workspace-archived')

    const archivedSite = withStatus((value) => {
      const site = value.sites.find((entry) => (
        entry.organizationId === selected.organizationId
        && entry.workspaceId === selected.workspaceId
        && entry.id === selected.siteId
      ))
      if (site) site.status = 'archived'
    })
    expect(resolve(buildScopedAdminUrl(selected), archivedSite).kind).toBe('site-archived')
  })

  it('uses validated browser preference only for unscoped URLs and ignores stale or corrupt state', () => {
    const preferred = selection(1, 'publication')
    const explicit = selection(0, 'website')
    const preference = { version: 1, selection: preferred }

    const unscoped = resolve('/admin/posts', catalog(), preference)
    expect(unscoped).toMatchObject({
      kind: 'ready',
      source: 'browser-preference',
      selection: preferred,
      profileRelativeSubpath: '/admin/posts',
    })

    const deepLink = resolve(buildScopedAdminUrl(explicit, '/admin/design'), catalog(), preference)
    expect(deepLink).toMatchObject({ kind: 'ready', source: 'url', selection: explicit })

    const stale = resolve('/admin', catalog(), {
      version: 1,
      selection: { ...preferred, siteId: 'deleted-site' },
    })
    const corrupt = resolve('/admin', catalog(), { version: 'one', selection: preferred })
    expect(stale.kind).toBe('ready')
    expect(corrupt.kind).toBe('ready')
    if (stale.kind !== 'ready' || corrupt.kind !== 'ready') {
      throw new Error('Expected deterministic catalog defaults')
    }
    expect(stale.source).toBe('catalog-default')
    expect(corrupt.source).toBe('catalog-default')
    expect(stale.selection).toEqual(corrupt.selection)
  })

  it('ignores suspended and archived browser preferences on unscoped entry', () => {
    const preferred = selection(1, 'publication')
    const preference = { version: 1, selection: preferred }

    for (const mutate of [
      (value: AccessibleContextCatalog) => {
        const organization = value.organizations.find(({ id }) => id === preferred.organizationId)
        if (organization) organization.status = 'suspended'
      },
      (value: AccessibleContextCatalog) => {
        const workspace = value.workspaces.find((entry) => (
          entry.organizationId === preferred.organizationId
          && entry.id === preferred.workspaceId
        ))
        if (workspace) workspace.status = 'archived'
      },
      (value: AccessibleContextCatalog) => {
        const site = value.sites.find((entry) => (
          entry.organizationId === preferred.organizationId
          && entry.workspaceId === preferred.workspaceId
          && entry.id === preferred.siteId
        ))
        if (site) site.status = 'archived'
      },
    ]) {
      const accessibleCatalog = catalog()
      mutate(accessibleCatalog)
      const resolved = resolve('/admin', accessibleCatalog, preference)
      expect(resolved.kind).toBe('ready')
      if (resolved.kind !== 'ready') throw new Error('Expected active catalog fallback')
      expect(resolved.source).toBe('catalog-default')
      expect(resolved.selection).not.toEqual(preferred)
    }
  })

  it('treats invitation entry as URL authority without consulting browser context', () => {
    const invitationId = `invite/customer+editor@example.invalid/${'token'.repeat(60)}`
    const url = buildInvitationAdminUrl(invitationId)
    expect(parseScopedAdminUrl(url)).toEqual({ kind: 'invitation', invitationId })

    const resolution = resolve(url, catalog(), {
      version: 1,
      selection: selection(0, 'website'),
    })
    expect(resolution).toEqual({
      kind: 'invitation',
      source: 'url',
      invitation: { kind: 'invitation', invitationId },
    })
  })

  it('builds deterministic switch targets and composes the selected profile shell through the registry', () => {
    const website = selection(0, 'website')
    const publication = selection(0, 'publication')
    const profileSubpath = validateProfileRelativeSubpath('/admin/design')
    if (!profileSubpath) throw new Error('Expected valid profile-relative subpath')

    const siteTarget = buildSiteSwitchTarget(publication, profileSubpath)
    const workspaceTarget = buildWorkspaceSwitchTarget(
      catalog(),
      publication.organizationId,
      publication.workspaceId,
      profileSubpath,
    )
    const organizationTarget = buildOrganizationSwitchTarget(
      catalog(),
      publication.organizationId,
      profileSubpath,
    )

    expect(Value.Check(ProfileRelativeSubpathSchema, profileSubpath)).toBe(true)
    expect(siteTarget).toBe(buildScopedAdminUrl(publication, '/admin/design'))
    expect(workspaceTarget).toBe(organizationTarget)
    expect(workspaceTarget).toContain('/design')
    expect(() => buildSiteSwitchTarget(website, '/admin/../settings')).toThrow()

    const switched = resolve(siteTarget)
    expect(switched.kind).toBe('ready')
    if (switched.kind !== 'ready') throw new Error('Expected ready switched context')
    expect(switched.profile.profile.id).toBe('publication')
    expect(switched.profileRelativeSubpath).toBe('/admin/design')
    expect(switched.profile.navigation.map(({ label }) => label)).toContain('Posts')
  })

  it('projects authorized managed-client workspaces and canonical site targets without ownership transfer claims', () => {
    const accessibleCatalog = catalog()
    const organization = accessibleCatalog.organizations[0]
    const workspace = accessibleCatalog.workspaces.find((entry) => (
      entry.organizationId === organization.id
    ))
    if (!workspace) throw new Error('Managed-client fixture workspace is missing')

    accessibleCatalog.managedClients = [{
      organizationId: organization.id,
      workspaceId: workspace.id,
      intendedOrganizationId: 'provisional-client-organization',
      intendedOrganizationName: 'Acacia Client Destination',
    }]
    const archivedSite = accessibleCatalog.sites.find((site) => (
      site.organizationId === organization.id
      && site.workspaceId === workspace.id
      && site.profileId === 'publication'
    ))
    if (!archivedSite) throw new Error('Managed-client fixture site is missing')
    archivedSite.status = 'archived'

    const model = composeManagedClientsView(accessibleCatalog)
    expect(Value.Check(ManagedClientCatalogEntrySchema, accessibleCatalog.managedClients[0])).toBe(true)
    expect(Value.Check(ManagedClientsViewSchema, model)).toBe(true)
    expect(model.entries).toHaveLength(1)
    expect(model.entries[0]).toMatchObject({
      organizationId: organization.id,
      workspaceId: workspace.id,
      intendedOrganizationId: 'provisional-client-organization',
      intendedOrganizationName: 'Acacia Client Destination',
    })
    expect(model.entries[0]?.sites).toHaveLength(2)
    const activeSite = model.entries[0]?.sites.find(({ status }) => status === 'active')
    const unavailableSite = model.entries[0]?.sites.find(({ status }) => status === 'archived')
    expect(activeSite?.target).toBe(activeSite
      ? buildScopedAdminUrl(activeSite.selection)
      : null)
    expect(unavailableSite?.target).toBeNull()
    expect(JSON.stringify(model)).not.toMatch(/offer|grant|billing|price/i)

    const invalidCatalog = structuredClone(accessibleCatalog)
    invalidCatalog.managedClients = [{
      organizationId: organization.id,
      workspaceId: workspace.id,
      intendedOrganizationId: organization.id,
      intendedOrganizationName: organization.name,
    }]
    expect(() => composeManagedClientsView(invalidCatalog)).toThrow(
      'destination cannot be its current owner',
    )
  })

  it('keeps selection and switching profile-neutral with no profile-ID decision branches', async () => {
    const sourceUrl = new URL('../../core/fuma/selection.ts', import.meta.url)
    const source = await Bun.file(sourceUrl).text()

    expect(source).not.toContain("'website'")
    expect(source).not.toContain("'publication'")
    expect(source).not.toMatch(/profileId\s*(?:===|!==)/)
    expect(source).not.toMatch(/switch\s*\(\s*[^)]*profile/i)
  })
})
