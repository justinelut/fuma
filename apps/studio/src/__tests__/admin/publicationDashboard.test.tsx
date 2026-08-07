import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from '@admin/lib/routing'
import { PublicationDashboardRoute } from '@admin/fuma/dashboards/publication/PublicationDashboardRoute'
import {
  emptyPublicationFigures,
  trailing30Days,
  type PublicationFigures,
} from '@admin/fuma/publication/publicationFigures'
import type { FumaScopedShellReadyContext } from '@admin/fuma/FumaScopedShell'
import { buildScopedAdminUrl, fumaLaunchRegistry } from '@core/fuma'

const SELECTION = Object.freeze({
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'site-publication',
})

function shellContext(): FumaScopedShellReadyContext {
  const profile = fumaLaunchRegistry.compose('publication')
  const permissionState = Object.fromEntries(
    profile.permissions.map((permission) => [permission.id, true]),
  )
  const navigation = profile.navigation.map((entry) => Object.freeze({
    ...entry,
    path: buildScopedAdminUrl(SELECTION, entry.path as '/admin'),
  }))
  return Object.freeze({
    resolution: Object.freeze({
      selection: SELECTION,
      organization: { id: SELECTION.organizationId, name: 'Acacia', status: 'active' },
      workspace: {
        id: SELECTION.workspaceId,
        organizationId: SELECTION.organizationId,
        name: 'Studio',
        status: 'active',
        isDefault: true,
      },
      site: {
        id: SELECTION.siteId,
        organizationId: SELECTION.organizationId,
        workspaceId: SELECTION.workspaceId,
        name: 'The Weekly',
        status: 'active',
        profileId: 'publication',
        capabilityOverrides: { grant: [], revoke: [] },
      },
      profile: Object.freeze({ profile: Object.freeze({ id: 'publication', label: 'Publication' }) }),
      profileRelativeSubpath: '/admin',
    }),
    navigation: Object.freeze(navigation),
    permissionState,
    profileRelativeSubpath: '/admin',
    routeAccess: Object.freeze({ kind: 'allowed' }),
    onboarding: Object.freeze({
      steps: [],
      progress: Object.freeze({
        organizationId: SELECTION.organizationId,
        workspaceId: SELECTION.workspaceId,
        siteId: SELECTION.siteId,
        profileId: 'publication',
        compositionFingerprint: 'fingerprint',
        completedStepIds: [],
        cursor: 0,
      }),
      currentStepId: null,
      complete: true,
    }),
  }) as unknown as FumaScopedShellReadyContext
}

function figures(overrides: Partial<PublicationFigures> = {}): PublicationFigures {
  return Object.freeze({ ...emptyPublicationFigures(trailing30Days()), ...overrides })
}

function renderRoute(result: PublicationFigures) {
  return render(
    <MemoryRouter initialEntries={[buildScopedAdminUrl(SELECTION)]}>
      <PublicationDashboardRoute
        shell={shellContext()}
        actorLabel="Justine Quartz"
        accountPath="/admin/account"
        readFigures={() => Promise.resolve(result)}
      />
    </MemoryRouter>,
  )
}

describe('publication dashboard route', () => {
  afterEach(cleanup)

  it('renders the Ghost sidebar with the publication name and grouped posts', async () => {
    renderRoute(figures())
    const navigation = screen.getByRole('navigation', { name: 'Publication navigation' })
    expect(navigation).toBeDefined()
    // The name appears on both the wide sidebar and the narrow-viewport bar. The narrow bar showed
    // only the publication's first letter before, which does not tell you which publication you are
    // in — so the duplication is deliberate, following the same getAllByText handling this file
    // already uses for the KPI/chart label pair below.
    expect(screen.getAllByText('The Weekly').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'New post' })).toBeDefined()
    for (const child of ['Drafts', 'Scheduled', 'Published', 'Free posts', 'Paid posts']) {
      expect(screen.getByText(child)).toBeDefined()
    }
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeDefined()
  })

  it('reports unmeasured figures as unavailable instead of zero', async () => {
    renderRoute(figures())
    await waitFor(() => {
      // The label appears on both the KPI cell and the chart selector.
      expect(screen.getAllByText('Total members').length).toBeGreaterThan(0)
    })
    // Nothing measured yet, so every headline is an em dash rather than a zero
    // that would read as a real count.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getByText('No posts yet. Write the first one to see how it performs.')).toBeDefined()
  })

  it('renders measured figures and derives rates from them', async () => {
    renderRoute(figures({
      members: 1284,
      subscriptions: 96,
      unsubscriptions: 7,
      siteReads: 4000,
      postReads: 2500,
      memberReads: 1000,
      newsletterOpens: 48,
      newsletterClicks: 12,
      memberSources: [{ source: 'paid', reads: 600 }, { source: 'registered', reads: 400 }],
      newsletterSeries: [{ label: 'Weekly', value: 30 }, { label: 'Monthly', value: 18 }],
      posts: [{
        id: 'post-1',
        title: 'Subscription metrics explained',
        publishedAt: '2026-08-01T00:00:00.000Z',
        reads: 1200,
        openRate: null,
      }],
    }))

    await waitFor(() => {
      // The member count appears as the KPI headline, the engagement figure and
      // the sidebar count on the Members entry.
      expect(screen.getAllByText('1,284').length).toBe(3)
    })
    expect(screen.getByText('96')).toBeDefined()
    expect(screen.getByText('7')).toBeDefined()
    expect(screen.getByText('4,000')).toBeDefined()
    // Open rate is opens over subscriptions; click rate is clicks over opens.
    expect(screen.getByText('50%')).toBeDefined()
    expect(screen.getByText('25%')).toBeDefined()
    expect(screen.getByText('Subscription metrics explained')).toBeDefined()
    expect(screen.getByText('1,200')).toBeDefined()
  })
})
