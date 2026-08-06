/**
 * Publication profile dashboard route.
 *
 * Renders on the profile home only, so one route still renders one page. Figures
 * come from the publication readers that already exist; anything the product does
 * not measure is reported as unavailable rather than invented.
 */
import { useEffect, useState } from 'react'
import { buildScopedAdminUrl } from '@core/fuma'
import type { FumaScopedShellReadyContext } from '../../FumaScopedShell'
import {
  emptyPublicationFigures,
  readPublicationFigures,
  trailing30Days,
  type PublicationFigures,
} from '../../publication/publicationFigures'
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
  /** Test seam. Defaults to the live readers. */
  readFigures?: typeof readPublicationFigures
}

export function isPublicationDashboardRoute(shell: FumaScopedShellReadyContext): boolean {
  return shell.resolution.site.profileId === 'publication'
    && shell.profileRelativeSubpath === PUBLICATION_DASHBOARD_SUBPATH
}

function postChildren(postsPath: string, counts: Readonly<{ posts: number | null }>): readonly SidebarChild[] {
  return Object.freeze([
    { id: 'drafts', label: 'Drafts', path: `${postsPath}?status=draft` },
    { id: 'scheduled', label: 'Scheduled', path: `${postsPath}?status=scheduled` },
    {
      id: 'published',
      label: 'Published',
      path: `${postsPath}?status=published`,
      ...(counts.posts === null ? {} : { count: counts.posts }),
    },
    { id: 'free', label: 'Free posts', path: `${postsPath}?access=free`, dot: 'positive' as const },
    { id: 'paid', label: 'Paid posts', path: `${postsPath}?access=paid`, dot: 'series-alt' as const },
  ].map((child) => Object.freeze(child)))
}

function percentage(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null
  return Math.round((numerator / denominator) * 100)
}

function kpis(figures: PublicationFigures): readonly Kpi[] {
  return Object.freeze([
    Object.freeze({
      id: 'members',
      label: 'Total members',
      value: figures.members,
      deltaPercent: null,
    }),
    Object.freeze({
      id: 'subscriptions',
      label: 'Subscriptions',
      value: figures.subscriptions,
      deltaPercent: null,
    }),
    Object.freeze({
      id: 'unsubscriptions',
      label: 'Unsubscribes',
      value: figures.unsubscriptions,
      deltaPercent: null,
    }),
  ])
}

export function PublicationDashboardRoute({
  shell,
  actorLabel,
  accountPath,
  publicUrl = null,
  onSignOut,
  signingOut,
  readFigures = readPublicationFigures,
}: PublicationDashboardRouteProps) {
  const { resolution } = shell
  const [figures, setFigures] = useState<PublicationFigures>(() => emptyPublicationFigures())

  const { organizationId, workspaceId, siteId } = resolution.selection
  useEffect(() => {
    let active = true
    void readFigures(
      { organizationId, workspaceId, siteId, profileId: 'publication' },
      trailing30Days(),
    ).then((result) => {
      if (active) setFigures(result)
    })
    return () => { active = false }
  }, [readFigures, organizationId, workspaceId, siteId])

  const postsPath = shell.navigation.find((entry) => entry.id === 'nav.posts')?.path
    ?? buildScopedAdminUrl(resolution.selection, '/admin/posts')

  const paidShare = percentage(figures.memberReads, figures.siteReads)

  return (
    <PublicationDashboardShell
      publicationName={resolution.site.name}
      actorLabel={actorLabel}
      navigation={shell.navigation}
      currentPath={buildScopedAdminUrl(resolution.selection, shell.profileRelativeSubpath)}
      accountPath={accountPath}
      builderPath={buildScopedAdminUrl(resolution.selection, '/admin/builder')}
      publicUrl={publicUrl}
      postChildren={postChildren(postsPath, { posts: figures.posts.length || null })}
      memberCount={figures.members}
      title="Dashboard"
      range="Past 30 days"
      onSignOut={onSignOut}
      signingOut={signingOut}
    >
      <PublicationDashboardHome
        kpis={kpis(figures)}
        memberSeries={[]}
        reads={{
          total: figures.siteReads,
          postShareSeries: figures.postReads === null
            ? []
            : [{ label: 'Public', value: Math.max(0, figures.siteReads ?? 0) - (figures.memberReads ?? 0) },
               { label: 'Posts', value: figures.postReads }],
          newsletterSeries: figures.newsletterSeries,
          paidShare,
          sources: figures.memberSources,
        }}
        engagement={{
          openRate: percentage(figures.newsletterOpens, figures.subscriptions),
          clickRate: percentage(figures.newsletterClicks, figures.newsletterOpens),
          members: figures.members,
        }}
        recentPosts={figures.posts.map((post) => ({
          id: post.id,
          title: post.title,
          sends: post.reads,
          openRate: post.openRate,
        }))}
      />
    </PublicationDashboardShell>
  )
}
