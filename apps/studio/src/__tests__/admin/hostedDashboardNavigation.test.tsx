import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from '@admin/lib/routing'
import { PlatformDashboard } from '@admin/fuma/dashboards/PlatformDashboard'
import { WebsiteDashboardShell } from '@admin/fuma/dashboards/website/WebsiteDashboardShell'
import { buildScopedAdminUrl, type AccessibleContextCatalog } from '@core/fuma'

const SELECTION = Object.freeze({
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
})

function catalog(): AccessibleContextCatalog {
  return {
    organizations: [{ id: 'organization-a', name: 'Acacia', status: 'active' }],
    workspaces: [{
      id: 'workspace-a',
      organizationId: 'organization-a',
      name: 'Studio',
      status: 'active',
      isDefault: true,
    }],
    sites: [
      {
        id: 'site-a',
        organizationId: 'organization-a',
        workspaceId: 'workspace-a',
        name: 'Current Digital',
        status: 'active',
        profileId: 'website',
        capabilityOverrides: { grant: [], revoke: [] },
      },
      {
        id: 'site-b',
        organizationId: 'organization-a',
        workspaceId: 'workspace-a',
        name: 'The Weekly',
        status: 'active',
        profileId: 'publication',
        capabilityOverrides: { grant: [], revoke: [] },
      },
    ],
  }
}

const HOME = buildScopedAdminUrl(SELECTION)

function navigation() {
  return Object.freeze([
    Object.freeze({ id: 'nav.home', order: 10, label: 'Dashboard', path: HOME }),
    Object.freeze({ id: 'nav.bookings', order: 55, label: 'Bookings', path: `${HOME}/bookings` }),
    Object.freeze({ id: 'nav.settings', order: 90, label: 'Settings', path: `${HOME}/settings` }),
    Object.freeze({ id: 'nav.domains', order: 85, label: 'Domains', path: `${HOME}/settings/domains` }),
  ])
}

function renderShell(currentPath: string) {
  return render(
    <MemoryRouter initialEntries={[currentPath]}>
      <WebsiteDashboardShell
        siteName="Current Digital"
        organizationName="Acacia"
        workspaceName="Studio"
        actorLabel="Justine Quartz"
        navigation={navigation() as never}
        currentPath={currentPath}
        homePath={HOME}
        accountPath="/admin/account"
        settingsPath={`${HOME}/settings`}
        counts={{ sites: 2, workspaces: 1, organizations: 1 }}
        setup={{ completed: 1, total: 3 }}
      >
        <p>Route body</p>
      </WebsiteDashboardShell>
    </MemoryRouter>,
  )
}

function activeLabels(): readonly string[] {
  const nav = screen.getByRole('navigation', { name: 'Website sections' })
  return within(nav)
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent ?? '')
}

describe('hosted dashboard navigation', () => {
  afterEach(cleanup)

  it('marks exactly the home entry active on the profile home', () => {
    renderShell(HOME)
    expect(activeLabels()).toEqual(['Dashboard'])
  })

  it('moves the active state to the visited route instead of keeping home lit', () => {
    renderShell(`${HOME}/bookings`)
    // The home path is a prefix of every other route, so prefix matching used to
    // leave Dashboard permanently active and light two pills at once.
    expect(activeLabels()).toEqual(['Bookings'])
  })

  it('does not light a parent route when a nested route is open', () => {
    renderShell(`${HOME}/settings/domains`)
    expect(activeLabels()).toEqual(['Domains'])
  })

  it('gives the active entry the primary fill with its own foreground', () => {
    renderShell(`${HOME}/bookings`)
    const nav = screen.getByRole('navigation', { name: 'Website sections' })
    const active = within(nav)
      .getAllByRole('link')
      .find((link) => link.getAttribute('aria-current') === 'page')
    const className = active?.getAttribute('class') ?? ''
    expect(className).toContain('bg-primary')
    expect(className).toContain('text-primary-foreground')
  })
})

describe('platform dashboard', () => {
  afterEach(cleanup)

  it('leads into every site with the dashboard shaped for its profile', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <PlatformDashboard
          catalog={catalog()}
          actorLabel="Justine Quartz"
          accountPath="/admin/account"
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome in, Justine' })).toBeDefined()
    const cards = screen.getAllByRole('link', { name: /Current Digital/ })
    expect(cards.length).toBeGreaterThan(0)
    expect(cards[0]?.getAttribute('href')).toBe(HOME)
    expect(screen.getByText('Website')).toBeDefined()
    expect(screen.getByText('Publication')).toBeDefined()
    // Storage is plan-level and reported here, not repeated per profile.
    expect(screen.getByText('Runtime')).toBeDefined()
  })

  it('creates another site in the same workspace with a chosen profile', async () => {
    const calls: unknown[] = []
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <PlatformDashboard
          catalog={catalog()}
          actorLabel="Justine Quartz"
          accountPath="/admin/account"
          createSite={(input) => {
            calls.push(input)
            return Promise.resolve({
              organizationId: 'organization-a',
              workspaceId: 'workspace-a',
              siteId: 'site-c',
              siteSlug: 'studio-journal',
              host: 'studio-journal.example',
              profileId: 'publication' as const,
              created: { workspace: false, site: true, ownerKey: true, freeHost: true },
            })
          }}
        />
      </MemoryRouter>,
    )

    const name = screen.getByPlaceholderText('Studio journal')
    fireEvent.change(name, { target: { value: 'Studio journal' } })
    fireEvent.click(screen.getByRole('radio', { name: 'publication' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create site' }))

    await waitFor(() => {
      expect(calls).toHaveLength(1)
    })
    // The workspace is left to the server's default, which is what keeps the new
    // site in the same workspace as the others.
    expect(calls[0]).toEqual({
      organizationId: 'organization-a',
      siteName: 'Studio journal',
      profileId: 'publication',
    })
  })
})
