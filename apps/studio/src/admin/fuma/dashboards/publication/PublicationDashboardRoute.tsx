/**
 * Publication profile dashboard route.
 *
 * Renders on the profile home only, so one route still renders one page.
 * Figures are left unavailable rather than invented; the publication readers
 * fill them in as each is wired.
 */
import { buildScopedAdminUrl } from '@core/fuma'
import type { FumaScopedShellReadyContext } from '../../FumaScopedShell'
import { PublicationDashboardShell, type SidebarChild } from './PublicationDashboardShell'
import { PublicationDashboardHome, type Kpi } from './PublicationDashboardHome'

export const PUBLICATION_DASHBOARD_SUBPATH = '/admin'

export interface PublicationDashboardRouteProps {
  shell: FumaScopedShellReadyContext
  actorLabel: string
  accountPath: string
  publicUrl?: string | null
  onSignOut?: () => void
  signingOut?: boolean
}

export function isPublicationDashboardRoute(shell: FumaScopedShellReadyContext): boolean {
  return shell.resolution.site.profileId === 'publication'
    && shell.profileRelativeSubpath === PUBLICATION_DASHBOARD_SUBPATH
}

const EMPTY_KPIS: readonly Kpi[] = Object.freeze([
  Object.freeze({ id: 'total', label: 'Total members', value: null, deltaPercent: null }),
  Object.freeze({ id: 'paid', label: 'Paid members', value: null, deltaPercent: null }),
  Object.freeze({ id: 'free', label: 'Free members', value: null, deltaPercent: null }),
])

function postChildren(postsPath: string): readonly SidebarChild[] {
  return Object.freeze([
    { id: 'drafts', label: 'Drafts', path: `${postsPath}?status=draft` },
    { id: 'scheduled', label: 'Scheduled', path: `${postsPath}?status=scheduled` },
    { id: 'published', label: 'Published', path: `${postsPath}?status=published` },
    { id: 'free', label: 'Free posts', path: `${postsPath}?access=free`, dot: 'positive' as const },
    { id: 'paid', label: 'Paid posts', path: `${postsPath}?access=paid`, dot: 'series-alt' as const },
  ].map((child) => Object.freeze(child)))
}

export function PublicationDashboardRoute({
  shell,
  actorLabel,
  accountPath,
  publicUrl = null,
  onSignOut,
  signingOut,
}: PublicationDashboardRouteProps) {
  const { resolution } = shell
  const postsPath = shell.navigation.find((entry) => entry.id === 'nav.posts')?.path
    ?? buildScopedAdminUrl(resolution.selection, '/admin/posts')

  return (
    <PublicationDashboardShell
      publicationName={resolution.site.name}
      actorLabel={actorLabel}
      navigation={shell.navigation}
      currentPath={buildScopedAdminUrl(resolution.selection, shell.profileRelativeSubpath)}
      accountPath={accountPath}
      builderPath={buildScopedAdminUrl(resolution.selection, '/admin/builder')}
      publicUrl={publicUrl}
      postChildren={postChildren(postsPath)}
      title="Dashboard"
      range="Past 30 days"
      onSignOut={onSignOut}
      signingOut={signingOut}
    >
      <PublicationDashboardHome
        kpis={EMPTY_KPIS}
        memberSeries={[]}
        revenue={{
          mrrLabel: null,
          mrrDeltaPercent: null,
          mrrSeries: [],
          subscriptionSeries: [],
          monthlyShare: null,
        }}
        engagement={{ engaged30: null, engaged7: null, subscribers: null }}
        recentPosts={[]}
      />
    </PublicationDashboardShell>
  )
}
