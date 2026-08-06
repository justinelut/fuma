/**
 * Website profile dashboard route.
 *
 * Renders on the profile home only. Every other route keeps the generic scoped
 * chrome, so one route still renders exactly one page.
 */
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

export const WEBSITE_DASHBOARD_SUBPATH = '/admin'

export interface WebsiteDashboardRouteProps {
  shell: FumaScopedShellReadyContext
  catalog: AccessibleContextCatalog
  actorLabel: string
  accountPath: string
  publicUrl?: string | null
  onSignOut?: () => void
  signingOut?: boolean
}

/** True when the resolved route is the Website profile home. */
export function isWebsiteDashboardRoute(shell: FumaScopedShellReadyContext): boolean {
  return shell.resolution.site.profileId === 'website'
    && shell.profileRelativeSubpath === WEBSITE_DASHBOARD_SUBPATH
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
    </WebsiteDashboardShell>
  )
}
