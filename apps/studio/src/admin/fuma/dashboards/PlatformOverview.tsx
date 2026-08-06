/**
 * Platform overview — the shared layer above the profile dashboards.
 *
 * Storage, database size, AI credits and plan limits belong to the plan, not to
 * any one site, so they are measured and presented once here instead of being
 * repeated inside both the Website and Publication dashboards. Each site is a
 * card that leads into its own profile dashboard.
 *
 * Everything is themed with the shadcn semantic tokens, so it follows the
 * visitor's light or dark choice without a parallel palette.
 */
import { useEffect } from 'react'
import { Link } from '@admin/lib/routing'
import { buildScopedAdminUrl, type AccessibleContextCatalog } from '@core/fuma'
import { Badge, Card, CardCaption, CardTitle } from '../ui/primitives'
import { cn } from '../ui/cn'
import { useDashboardStore } from './dashboardStore'
import { formatBytes } from './siteOverview'

export interface PlatformOverviewProps {
  catalog: AccessibleContextCatalog
  /** Where plan and usage limits are managed. */
  planPath: string | null
}

const PROFILE_LABEL: Readonly<Record<string, string>> = {
  website: 'Website',
  publication: 'Publication',
}

function Figure({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xl leading-none font-semibold tracking-tight text-foreground">
        {value}
      </p>
      {detail ? (
        <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  )
}

export function PlatformOverview({ catalog, planPath }: PlatformOverviewProps) {
  const status = useDashboardStore((state) => state.status)
  const overview = useDashboardStore((state) => state.overview)
  const loadOverview = useDashboardStore((state) => state.loadOverview)

  useEffect(() => { void loadOverview() }, [loadOverview])

  const { storage } = overview
  const loading = status !== 'ready'
  const sites = catalog.sites.filter((site) => site.status === 'active')

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Runtime</CardTitle>
          <CardCaption>
            {loading
              ? 'Reading measurements'
              : storage
                ? `Measured · ${storage.dialect}`
                : 'Measurements unavailable'}
          </CardCaption>
        </div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label="Storage used"
            value={formatBytes(storage?.totalBytes ?? null)}
            detail="Across every site on this plan"
          />
          <Figure
            label="Database"
            value={formatBytes(storage?.databaseBytes ?? null)}
            detail="Content, data and audit history"
          />
          <Figure
            label="Media"
            value={formatBytes(
              storage
                ? storage.imageBytes + storage.videoBytes + storage.documentBytes
                : null,
            )}
            detail="Images, video and documents"
          />
          <Figure
            label="Plugins"
            value={formatBytes(storage?.pluginBytes ?? null)}
            detail="Installed extension packages"
          />
        </dl>
        {planPath ? (
          <p className="mt-5 text-xs text-muted-foreground">
            Limits follow your plan.{' '}
            <Link
              to={planPath}
              className="font-medium text-foreground underline decoration-primary decoration-2 underline-offset-4"
            >
              Review plan and usage
            </Link>
          </p>
        ) : null}
      </Card>

      <div>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">Your sites</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Each site opens its own dashboard, shaped by what it is for.
        </p>
        {sites.length === 0 ? (
          <Card className="mt-3">
            <CardCaption>No sites yet.</CardCaption>
          </Card>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sites.map((site) => {
              const workspace = catalog.workspaces.find((entry) => entry.id === site.workspaceId)
              const organization = catalog.organizations.find(
                (entry) => entry.id === site.organizationId,
              )
              const target = buildScopedAdminUrl({
                organizationId: site.organizationId,
                workspaceId: site.workspaceId,
                siteId: site.id,
              })
              return (
                <li key={site.id}>
                  <Link
                    to={target}
                    className={cn(
                      'flex h-full flex-col justify-between gap-4 rounded-[var(--radius-lg)]',
                      'border border-border bg-card p-4 transition-colors',
                      'hover:border-primary/40 hover:bg-accent',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {site.name}
                      </span>
                      <span className="mt-1 block truncate text-[0.6875rem] text-muted-foreground">
                        {organization?.name ?? site.organizationId} / {workspace?.name ?? site.workspaceId}
                      </span>
                    </span>
                    <Badge variant="outline" size="sm">
                      {PROFILE_LABEL[site.profileId] ?? site.profileId}
                    </Badge>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
