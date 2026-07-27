import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import {
  FUMA_CONTEXT_PREFERENCE_KEY,
  FumaScopedShell,
  readContextPreference,
  writeContextPreference,
} from '@admin/fuma'
import { MemoryRouter } from '@admin/lib/routing'
import {
  fumaLaunchRegistry,
  type NavigationPermissionState,
} from '@core/fuma'
import {
  buildInvitationAdminUrl,
  buildScopedAdminUrl,
  type AccessibleContextCatalog,
  type StableContextSelection,
} from '@core/fuma'

const ACTOR_LABEL = 'Avery Editor'
const EMPTY_OVERRIDES = { grant: [], revoke: [] }

function catalog(): AccessibleContextCatalog {
  return {
    organizations: [
      { id: 'organization-a', name: 'Acacia', status: 'active' },
      { id: 'organization-b', name: 'Baobab', status: 'active' },
    ],
    workspaces: [
      {
        id: 'shared-workspace',
        organizationId: 'organization-a',
        name: 'Acacia Studio',
        status: 'active',
        isDefault: true,
      },
      {
        id: 'shared-workspace',
        organizationId: 'organization-b',
        name: 'Baobab Studio',
        status: 'active',
        isDefault: true,
      },
    ],
    sites: [
      {
        id: 'a-website',
        organizationId: 'organization-a',
        workspaceId: 'shared-workspace',
        name: 'Acacia Website',
        status: 'active',
        profileId: 'website',
        capabilityOverrides: EMPTY_OVERRIDES,
      },
      {
        id: 'b-publication',
        organizationId: 'organization-a',
        workspaceId: 'shared-workspace',
        name: 'Acacia Publication',
        status: 'active',
        profileId: 'publication',
        capabilityOverrides: EMPTY_OVERRIDES,
      },
      {
        id: 'a-website',
        organizationId: 'organization-b',
        workspaceId: 'shared-workspace',
        name: 'Baobab Website',
        status: 'active',
        profileId: 'website',
        capabilityOverrides: EMPTY_OVERRIDES,
      },
      {
        id: 'b-publication',
        organizationId: 'organization-b',
        workspaceId: 'shared-workspace',
        name: 'Baobab Publication',
        status: 'active',
        profileId: 'publication',
        capabilityOverrides: EMPTY_OVERRIDES,
      },
    ],
  }
}

function selection(
  organizationId: 'organization-a' | 'organization-b',
  profileId: 'website' | 'publication',
): StableContextSelection {
  return {
    organizationId,
    workspaceId: 'shared-workspace',
    siteId: profileId === 'website' ? 'a-website' : 'b-publication',
  }
}

function grantedPermissions(profileId: string): NavigationPermissionState {
  return Object.fromEntries(
    fumaLaunchRegistry.compose(profileId).permissions.map(({ id }) => [id, true]),
  )
}

function renderShell(
  pathname: string,
  accessibleCatalog: AccessibleContextCatalog = catalog(),
  options: {
    permissionState?: NavigationPermissionState
    switcherSlot?: React.ComponentProps<typeof FumaScopedShell>['switcherSlot']
  } = {},
) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <FumaScopedShell
        catalog={accessibleCatalog}
        pathname={pathname}
        actorLabel={ACTOR_LABEL}
        permissionState={options.permissionState}
        switcherSlot={options.switcherSlot}
      >
        <p>Scoped route content</p>
      </FumaScopedShell>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('FUMA-018 scoped shell and state presentation', () => {
  it('persists a ready deep-link selection and restores it on refresh/remount', async () => {
    const selected = selection('organization-b', 'publication')
    const deepLink = buildScopedAdminUrl(selected, '/admin/posts')
    const first = renderShell(deepLink, catalog(), {
      permissionState: grantedPermissions('publication'),
    })

    expect(screen.getByRole('heading', { name: 'Baobab Publication' })).toBeTruthy()
    expect(screen.getByText(ACTOR_LABEL)).toBeTruthy()
    expect(screen.getByRole('region', {
      name: 'Organization, workspace, and site',
    })).toBeTruthy()
    await waitFor(() => {
      expect(readContextPreference()?.selection).toEqual(selected)
    })

    first.unmount()
    renderShell('/admin/posts', catalog(), {
      permissionState: grantedPermissions('publication'),
    })

    expect(screen.getByRole('heading', { name: 'Baobab Publication' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Publication navigation' })).toBeTruthy()
  })

  it('lets an explicit URL override stale browser state and replaces it only after ready resolution', async () => {
    const stale = selection('organization-a', 'website')
    const explicit = selection('organization-b', 'publication')
    writeContextPreference(stale)

    renderShell(buildScopedAdminUrl(explicit, '/admin/newsletters'), catalog(), {
      permissionState: grantedPermissions('publication'),
    })

    expect(screen.getByRole('heading', { name: 'Baobab Publication' })).toBeTruthy()
    const current = screen.getByRole('link', { name: 'Newsletters' })
    expect(current.getAttribute('aria-current')).toBe('page')
    expect(current.getAttribute('href')).toBe(
      buildScopedAdminUrl(explicit, '/admin/newsletters'),
    )
    await waitFor(() => {
      expect(readContextPreference()?.selection).toEqual(explicit)
    })
  })

  it('rejects unauthorized ownership substitution instead of opening a catalog default', () => {
    const accessibleCatalog = catalog()
    accessibleCatalog.workspaces.push({
      id: 'baobab-only',
      organizationId: 'organization-b',
      name: 'Baobab Private',
      status: 'active',
      isDefault: false,
    })
    accessibleCatalog.sites.push({
      id: 'private-site',
      organizationId: 'organization-b',
      workspaceId: 'baobab-only',
      name: 'Private Site',
      status: 'active',
      profileId: 'website',
      capabilityOverrides: EMPTY_OVERRIDES,
    })

    renderShell(buildScopedAdminUrl({
      organizationId: 'organization-a',
      workspaceId: 'baobab-only',
      siteId: 'private-site',
    }), accessibleCatalog)

    expect(screen.getByText('Workspace access unavailable')).toBeTruthy()
    expect(screen.getByText(/No substitute context was opened/)).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(readContextPreference()).toBeNull()
  })

  it('ignores stale and corrupt storage and uses the deterministic accessible default', () => {
    localStorage.setItem(FUMA_CONTEXT_PREFERENCE_KEY, JSON.stringify({
      version: 1,
      selection: {
        organizationId: 'organization-b',
        workspaceId: 'shared-workspace',
        siteId: 'deleted-site',
      },
    }))
    const staleView = renderShell('/admin', catalog(), {
      permissionState: grantedPermissions('website'),
    })
    expect(screen.getByRole('heading', { name: 'Acacia Website' })).toBeTruthy()

    staleView.unmount()
    localStorage.setItem(FUMA_CONTEXT_PREFERENCE_KEY, '{not valid json')
    renderShell('/admin', catalog(), {
      permissionState: grantedPermissions('website'),
    })
    expect(screen.getByRole('heading', { name: 'Acacia Website' })).toBeTruthy()
  })

  it('renders missing context and site states as panels', () => {
    const missingContext = renderShell('/admin/organizations/organization-a', catalog())
    expect(screen.getByText('No scoped context is available')).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()

    missingContext.unmount()
    renderShell(buildScopedAdminUrl({
      ...selection('organization-a', 'website'),
      siteId: 'missing-site',
    }), catalog())
    expect(screen.getByText('Site not found')).toBeTruthy()
  })

  it('renders organization suspension, workspace archive, and site archive without persisting them', async () => {
    const preferred = selection('organization-b', 'publication')
    const selected = selection('organization-a', 'website')
    const cases = [
      {
        title: 'Organization suspended',
        mutate(value: AccessibleContextCatalog) {
          const organization = value.organizations.find(({ id }) => id === selected.organizationId)
          if (organization) organization.status = 'suspended'
        },
      },
      {
        title: 'Workspace archived',
        mutate(value: AccessibleContextCatalog) {
          const workspace = value.workspaces.find((entry) => (
            entry.organizationId === selected.organizationId
            && entry.id === selected.workspaceId
          ))
          if (workspace) workspace.status = 'archived'
        },
      },
      {
        title: 'Site archived',
        mutate(value: AccessibleContextCatalog) {
          const site = value.sites.find((entry) => (
            entry.organizationId === selected.organizationId
            && entry.workspaceId === selected.workspaceId
            && entry.id === selected.siteId
          ))
          if (site) site.status = 'archived'
        },
      },
    ]

    for (const entry of cases) {
      cleanup()
      writeContextPreference(preferred)
      const accessibleCatalog = catalog()
      entry.mutate(accessibleCatalog)
      renderShell(buildScopedAdminUrl(selected), accessibleCatalog)
      expect(screen.getByText(entry.title)).toBeTruthy()
      expect(screen.queryByRole('navigation')).toBeNull()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(readContextPreference()?.selection).toEqual(preferred)
    }
  })

  it('supports an immutable ready-context renderer while preserving static children', () => {
    const selected = selection('organization-a', 'website')
    const pathname = buildScopedAdminUrl(selected, '/admin/pages')
    const permissionState = grantedPermissions('website')
    const callbackView = render(
      <MemoryRouter initialEntries={[pathname]}>
        <FumaScopedShell
          catalog={catalog()}
          pathname={pathname}
          actorLabel={ACTOR_LABEL}
          permissionState={permissionState}
        >
          {(context) => (
            <output data-testid="ready-context">
              {JSON.stringify({
                selection: context.resolution.selection,
                subpath: context.profileRelativeSubpath,
                navigationPath: context.navigation.find(({ id }) => id === 'nav.pages')?.path,
                pagesAllowed: context.permissionState['content.pages.read'],
                frozen: Object.isFrozen(context)
                  && Object.isFrozen(context.resolution)
                  && Object.isFrozen(context.navigation)
                  && Object.isFrozen(context.permissionState),
              })}
            </output>
          )}
        </FumaScopedShell>
      </MemoryRouter>,
    )

    expect(JSON.parse(screen.getByTestId('ready-context').textContent ?? '')).toEqual({
      selection: selected,
      subpath: '/admin/pages',
      navigationPath: pathname,
      pagesAllowed: true,
      frozen: true,
    })

    callbackView.unmount()
    renderShell(pathname, catalog(), { permissionState })
    expect(screen.getByText('Scoped route content')).toBeTruthy()
  })

  it('renders invitation entry without consulting or replacing the ready preference', async () => {
    const preferred = selection('organization-a', 'website')
    const invitationId = 'invite/customer-editor-token'
    writeContextPreference(preferred)

    renderShell(buildInvitationAdminUrl(invitationId), catalog())

    expect(screen.getByText('Invitation entry')).toBeTruthy()
    expect(screen.getByText(invitationId)).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readContextPreference()?.selection).toEqual(preferred)
  })

  it('supplies deterministic scoped targets through the injected switcher slot', () => {
    const selected = selection('organization-a', 'website')
    const path = buildScopedAdminUrl(selected, '/admin/design')
    renderShell(path, catalog(), {
      permissionState: grantedPermissions('website'),
      switcherSlot: (model) => (
        <output data-testid="switcher-target">
          {model.siteTarget(selection('organization-b', 'publication'))}
        </output>
      ),
    })

    expect(screen.getByLabelText('Context switchers')).toBeTruthy()
    expect(screen.getByTestId('switcher-target').textContent).toBe(
      buildScopedAdminUrl(selection('organization-b', 'publication'), '/admin/design'),
    )
  })

  it('renders authorized managed-client workspaces as a read-only scoped app view', () => {
    const accessibleCatalog = catalog()
    accessibleCatalog.managedClients = [{
      organizationId: 'organization-a',
      workspaceId: 'shared-workspace',
      intendedOrganizationId: 'organization-provisional-client',
      intendedOrganizationName: 'Provisional Client',
    }]
    const selected = selection('organization-a', 'website')
    renderShell(
      buildScopedAdminUrl(selected, '/admin/managed-clients'),
      accessibleCatalog,
      { permissionState: grantedPermissions('website') },
    )

    expect(screen.getByRole('heading', { name: 'Managed clients' })).toBeTruthy()
    expect(screen.getByText((_, node) => (
      node?.textContent === 'Intended destination: Provisional Client'
    ))).toBeTruthy()
    expect(screen.getByText(/do not change current ownership/)).toBeTruthy()
    const siteLinks = screen.getAllByRole('link', { name: 'Open site' })
    expect(siteLinks).toHaveLength(2)
    expect(siteLinks.map((link) => link.getAttribute('href'))).toEqual([
      buildScopedAdminUrl(selection('organization-a', 'publication')),
      buildScopedAdminUrl(selection('organization-a', 'website')),
    ])
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/offer|grant|billing|price/i)).toBeNull()
    expect(screen.queryByRole('region', { name: 'Website onboarding' })).toBeNull()
  })

  it('renders distinct Website and Publication navigation and onboarding models', () => {

    const websiteSelection = selection('organization-a', 'website')
    const websiteView = renderShell(
      buildScopedAdminUrl(websiteSelection),
      catalog(),
      { permissionState: grantedPermissions('website') },
    )
    const websiteNavigation = within(
      screen.getByRole('navigation', { name: 'Website navigation' }),
    ).getAllByRole('link').map((link) => link.textContent)
    const websiteOnboarding = within(
      screen.getByRole('region', { name: 'Website onboarding' }),
    ).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(websiteNavigation).toContain('Content')
    expect(websiteNavigation).not.toContain('Posts')

    websiteView.unmount()
    renderShell(
      buildScopedAdminUrl(selection('organization-a', 'publication')),
      catalog(),
      { permissionState: grantedPermissions('publication') },
    )
    const publicationNavigation = within(
      screen.getByRole('navigation', { name: 'Publication navigation' }),
    ).getAllByRole('link').map((link) => link.textContent)
    const publicationOnboarding = within(
      screen.getByRole('region', { name: 'Publication onboarding' }),
    ).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)

    expect(publicationNavigation).toContain('Posts')
    expect(publicationNavigation).not.toEqual(websiteNavigation)
    expect(publicationOnboarding).not.toEqual(websiteOnboarding)
  })
})
