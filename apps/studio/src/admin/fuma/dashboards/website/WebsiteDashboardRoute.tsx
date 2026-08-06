/**
 * Website profile dashboard route.
 *
 * Renders on the profile home only. Every other route keeps the generic scoped
 * chrome, so one route still renders exactly one page.
 */
import type { ReactNode } from 'react'
import { buildScopedAdminUrl } from '@core/fuma'
import type { AccessibleContextCatalog } from '@core/fuma'
import type { FumaScopedShellReadyContext } from '../../FumaScopedShell'
import { WebsiteDashboardShell } from './WebsiteDashboardShell'
import {
  WebsiteDashboardHome,
  type PlatformArea,
  type SetupStep,
} from './WebsiteDashboardHome'
import { SiteOverviewCards } from './SiteOverviewCards'
import { BookingsDashboard } from '../bookings/BookingsDashboard'

export const WEBSITE_DASHBOARD_SUBPATH = '/admin'

/**
 * Subpaths the Website dashboard renders as its own page inside its own shell.
 * Each one replaces the content region entirely — nothing stacks.
 */
const WEBSITE_DASHBOARD_PAGES: ReadonlySet<string> = new Set([
  WEBSITE_DASHBOARD_SUBPATH,
  '/admin/bookings',
])

export interface WebsiteDashboardRouteProps {
  shell: FumaScopedShellReadyContext
  catalog: AccessibleContextCatalog
  actorLabel: string
  accountPath: string
  publicUrl?: string | null
  onSignOut?: () => void
  signingOut?: boolean
  /**
   * Route content for subpaths the dashboard does not render itself. Hosting it
   * here keeps every Website route inside one designed shell with one
   * navigation, instead of some routes falling back to generic chrome.
   */
  children?: ReactNode
}

/** True when the Website dashboard shell should host the resolved route. */
export function isWebsiteDashboardRoute(shell: FumaScopedShellReadyContext): boolean {
  return shell.resolution.site.profileId === 'website'
}

/** True when the dashboard renders the route's body itself. */
function ownsBody(shell: FumaScopedShellReadyContext): boolean {
  return WEBSITE_DASHBOARD_PAGES.has(shell.profileRelativeSubpath)
}

function platformAreas(
  shell: FumaScopedShellReadyContext,
): readonly PlatformArea[] {
  const detail: Readonly<Record<string, string>> = {
    'nav.domains': 'Connect a custom domain, verify DNS and manage certificates.',
    'nav.team': 'Invite people, set roles and manage the organization.',
    'nav.website-analytics': 'Traffic and engagement for this site.',
    'nav.bookings': 'Services, availability and the day schedule.',
    'nav.settings': 'Site name, profile behaviour and platform settings.',
  }
  return Object.freeze(
    shell.navigation
      .filter((entry) => entry.id in detail)
      .map((entry) => Object.freeze({
        id: entry.id,
        label: entry.label,
        detail: detail[entry.id] ?? '',
        path: entry.path,
      })),
  )
}

function setupSteps(shell: FumaScopedShellReadyContext): readonly SetupStep[] {
  // Onboarding state is composed by the scoped shell, so the dashboard and the
  // setup page can never disagree about what is done.
  const done = new Set(shell.onboarding.progress.completedStepIds)
  return Object.freeze(shell.onboarding.steps.map((step) => Object.freeze({
    id: step.id,
    title: step.title,
    description: step.description,
    completed: done.has(step.id),
  })))
}

export function WebsiteDashboardRoute({
  shell,
  catalog,
  actorLabel,
  accountPath,
  publicUrl = null,
  onSignOut,
  signingOut,
  children,
}: WebsiteDashboardRouteProps) {
  const { resolution } = shell
  const builderPath = buildScopedAdminUrl(resolution.selection, '/admin/builder')
  const settingsEntry = shell.navigation.find((entry) => entry.id === 'nav.settings')
  const steps = setupSteps(shell)
  const completed = steps.filter((step) => step.completed).length

  return (
    <WebsiteDashboardShell
      siteName={resolution.site.name}
      organizationName={resolution.organization.name}
      workspaceName={resolution.workspace.name}
      actorLabel={actorLabel}
      navigation={shell.navigation}
      currentPath={buildScopedAdminUrl(resolution.selection, shell.profileRelativeSubpath)}
      homePath={buildScopedAdminUrl(resolution.selection)}
      accountPath={accountPath}
      settingsPath={settingsEntry?.path ?? null}
      counts={{
        sites: catalog.sites.filter((site) => site.status === 'active').length,
        workspaces: catalog.workspaces.filter((workspace) => workspace.status === 'active').length,
        organizations: catalog.organizations.length,
      }}
      setup={{ completed, total: steps.length }}
      onSignOut={onSignOut}
      signingOut={signingOut}
    >
      {!ownsBody(shell) ? (
        children
      ) : shell.profileRelativeSubpath === '/admin/bookings' ? (
        <BookingsDashboard
          scope={resolution.selection}
          manageBookingsPath={buildScopedAdminUrl(resolution.selection, '/admin/bookings/manage')}
        />
      ) : (
        <div className="space-y-4">
          <WebsiteDashboardHome
            siteName={resolution.site.name}
            builderPath={builderPath}
            publicUrl={publicUrl}
            steps={steps}
            areas={platformAreas(shell)}
          />
          <SiteOverviewCards builderPath={builderPath} />
        </div>
      )}
    </WebsiteDashboardShell>
  )
}
