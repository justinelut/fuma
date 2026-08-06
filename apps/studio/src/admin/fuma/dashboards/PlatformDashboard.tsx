/**
 * Platform dashboard — the layer above the profile dashboards.
 *
 * Same design language as the Website dashboard: a sticky pill header, a large
 * greeting, a metric strip pairing status chips with large counts, and a bento of
 * cards. What differs is the subject: this page carries plan-level state that no
 * single site owns — storage, database size, media totals — and leads into each
 * site's own dashboard.
 *
 * Themed entirely with the shadcn semantic tokens, so it follows light and dark.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from '@admin/lib/routing'
import { buildScopedAdminUrl, type AccessibleContextCatalog } from '@core/fuma'
import { Avatar, Badge, Button, Card, CardCaption, CardTitle, Stat } from '../ui/primitives'
import { ThemeToggle } from '../ui/theme'
import { cn } from '../ui/cn'
import { useDashboardStore } from './dashboardStore'
import {
  provisionSite,
  type SiteProfileChoice,
} from './siteProvisioning'
import { formatBytes } from './siteOverview'

export interface PlatformDashboardProps {
  catalog: AccessibleContextCatalog
  actorLabel: string
  accountPath: string
  /** Where plan and usage limits are managed, when the visitor may see them. */
  planPath?: string | null
  onSignOut?: () => void
  signingOut?: boolean
  error?: string | null
  /** Test seam. Defaults to the live provisioning endpoint. */
  createSite?: typeof provisionSite
}

const PROFILE_LABEL: Readonly<Record<string, string>> = {
  website: 'Website',
  publication: 'Publication',
}

function firstName(actorLabel: string): string {
  const [first] = actorLabel.trim().split(/\s+/)
  return first && first.length > 0 ? first : actorLabel
}

function SiteIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true" fill="none">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 6h12" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function StackIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true" fill="none">
      <path d="M8 2.5 14 5.5 8 8.5 2 5.5 8 2.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M2 9.5 8 12.5l6-3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function OrgIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true" fill="none">
      <circle cx="5.5" cy="6" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11" cy="6.5" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.2 12.6c.4-1.8 1.7-2.8 3.3-2.8s2.9 1 3.3 2.8M10 10.2c1.4 0 2.5.9 2.9 2.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
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

/** Proportional bar of the storage mix, in the reference's card vocabulary. */
function StorageMix({
  parts,
  total,
}: {
  parts: readonly Readonly<{ label: string, bytes: number, className: string }>[]
  total: number
}) {
  if (total <= 0) {
    return <p className="mt-3 text-xs text-muted-foreground">Nothing stored yet</p>
  }
  return (
    <>
      <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-accent">
        {parts.filter((part) => part.bytes > 0).map((part) => (
          <span
            key={part.label}
            className={part.className}
            style={{ width: `${(part.bytes / total) * 100}%` }}
            title={`${part.label}: ${formatBytes(part.bytes)}`}
          />
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-y-2 text-[0.6875rem] sm:grid-cols-3">
        {parts.map((part) => (
          <div key={part.label} className="flex items-center gap-1.5">
            <span className={cn('size-1.5 shrink-0 rounded-full', part.className)} />
            <dt className="text-muted-foreground">{part.label}</dt>
            <dd className="ml-auto pr-3 text-foreground">{formatBytes(part.bytes)}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

function HeaderShell({
  actorLabel,
  accountPath,
  onSignOut,
  signingOut,
  children,
}: {
  actorLabel: string
  accountPath: string
  onSignOut?: () => void
  signingOut: boolean
  children: ReactNode
}) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 -mx-3 flex flex-wrap items-center justify-between gap-2',
        'border-b border-border/70 bg-background/85 px-3 py-2.5 backdrop-blur-md',
        'sm:-mx-6 sm:gap-3 sm:px-6 xl:-mx-10 xl:px-10',
      )}
    >
      <p
        className={cn(
          'inline-flex h-10 min-w-0 max-w-[60vw] items-center rounded-full border border-border',
          'px-4 text-sm font-semibold tracking-tight text-foreground',
          'sm:h-11 sm:px-5 sm:text-[0.95rem]',
        )}
      >
        <span className="truncate">Platform</span>
      </p>
      {children}
      <div className="flex items-center gap-2">
        <ThemeToggle className="text-muted-foreground hover:bg-accent hover:text-foreground" />
        <a
          href={accountPath}
          className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          title={actorLabel}
        >
          <Avatar name={actorLabel} className="size-10 border border-border bg-card sm:size-11" />
          <span className="sr-only">Account</span>
        </a>
        {onSignOut ? (
          <Button
            variant="quiet"
            size="sm"
            disabled={signingOut}
            aria-busy={signingOut}
            onClick={onSignOut}
          >
            {signingOut ? 'Signing out' : 'Sign out'}
          </Button>
        ) : null}
      </div>
    </header>
  )
}

export function PlatformDashboard({
  catalog,
  actorLabel,
  accountPath,
  planPath = null,
  onSignOut,
  signingOut = false,
  error = null,
  createSite = provisionSite,
}: PlatformDashboardProps) {
  const status = useDashboardStore((state) => state.status)
  const overview = useDashboardStore((state) => state.overview)
  const loadOverview = useDashboardStore((state) => state.loadOverview)

  useEffect(() => { void loadOverview() }, [loadOverview])

  const navigate = useNavigate()
  const [newSiteName, setNewSiteName] = useState('')
  const [newSiteProfile, setNewSiteProfile] = useState<SiteProfileChoice>('website')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const firstOrganizationId = catalog.organizations[0]?.id ?? null

  async function submitNewSite(): Promise<void> {
    if (creating || !firstOrganizationId || !newSiteName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const provisioned = await createSite({
        organizationId: firstOrganizationId,
        siteName: newSiteName,
        profileId: newSiteProfile,
      })
      setNewSiteName('')
      navigate(buildScopedAdminUrl({
        organizationId: provisioned.organizationId,
        workspaceId: provisioned.workspaceId,
        siteId: provisioned.siteId,
      }))
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : 'The site could not be created')
    } finally {
      setCreating(false)
    }
  }

  const { storage } = overview
  const loading = status !== 'ready'
  const sites = catalog.sites.filter((site) => site.status === 'active')
  const workspaces = catalog.workspaces.filter((workspace) => workspace.status === 'active')
  const mediaBytes = storage
    ? storage.imageBytes + storage.videoBytes + storage.documentBytes
    : null

  return (
    <div
      className={cn(
        'fuma-hosted h-full overflow-y-auto',
        'bg-background bg-[radial-gradient(120%_100%_at_92%_108%,var(--surface-wash)_0%,transparent_60%)]',
      )}
    >
      <div className="mx-auto w-full max-w-[1680px] px-3 py-4 sm:px-6 sm:py-6 xl:px-10 xl:py-8">
        <HeaderShell
          actorLabel={actorLabel}
          accountPath={accountPath}
          onSignOut={onSignOut}
          signingOut={signingOut}
        >
          <nav aria-label="Platform sections" className="order-3 w-full lg:order-none lg:w-auto">
            <ul
              className={cn(
                'flex items-center gap-0.5 overflow-x-auto rounded-full border border-border',
                'bg-card/70 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
              )}
            >
              <li>
                <span
                  aria-current="page"
                  className={cn(
                    'inline-flex h-9 shrink-0 items-center rounded-full bg-primary px-3',
                    'text-[0.8125rem] font-medium whitespace-nowrap text-primary-foreground sm:px-3.5',
                  )}
                >
                  Overview
                </span>
              </li>
              {sites.slice(0, 5).map((site) => (
                <li key={site.id}>
                  <Link
                    to={buildScopedAdminUrl({
                      organizationId: site.organizationId,
                      workspaceId: site.workspaceId,
                      siteId: site.id,
                    })}
                    className={cn(
                      'inline-flex h-9 shrink-0 items-center rounded-full px-3 text-[0.8125rem]',
                      'whitespace-nowrap text-muted-foreground transition-colors',
                      'hover:bg-accent hover:text-foreground sm:px-3.5',
                    )}
                  >
                    {site.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </HeaderShell>

        <h1
          className={cn(
            'mt-5 text-[1.75rem] leading-tight font-semibold tracking-tight text-foreground',
            'sm:mt-7 sm:text-[2.4rem] sm:leading-none xl:text-[2.75rem]',
          )}
        >
          Welcome in, {firstName(actorLabel)}
        </h1>

        <div className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-5 sm:mt-6 sm:gap-x-8">
          <dl className="flex min-w-0 flex-wrap items-end gap-4 sm:gap-6">
            <div>
              <dt className="text-xs text-muted-foreground">Storage</dt>
              <dd className="mt-2">
                <Badge variant="solid" size="md">{formatBytes(storage?.totalBytes ?? null)}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Database</dt>
              <dd className="mt-2">
                <Badge variant="accent" size="md">{formatBytes(storage?.databaseBytes ?? null)}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Media</dt>
              <dd className="mt-2">
                <Badge variant="outline" size="md">{formatBytes(mediaBytes)}</Badge>
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-end gap-6 sm:gap-9">
            <Stat value={sites.length} label="Sites" icon={<SiteIcon />} />
            <Stat value={workspaces.length} label="Workspaces" icon={<StackIcon />} />
            <Stat value={catalog.organizations.length} label="Organizations" icon={<OrgIcon />} />
          </div>
        </div>

        {error ? (
          <p className="mt-4 text-sm text-destructive" role="alert">{error}</p>
        ) : null}

        <main className="mt-6 grid items-start gap-4 sm:mt-7 lg:grid-cols-4">
          <Card className="lg:col-span-2">
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
            <StorageMix
              total={storage?.totalBytes ?? 0}
              parts={[
                { label: 'Images', bytes: storage?.imageBytes ?? 0, className: 'bg-chart-1' },
                { label: 'Videos', bytes: storage?.videoBytes ?? 0, className: 'bg-chart-2' },
                { label: 'Documents', bytes: storage?.documentBytes ?? 0, className: 'bg-chart-5' },
                { label: 'Plugins', bytes: storage?.pluginBytes ?? 0, className: 'bg-chart-4' },
                { label: 'Database', bytes: storage?.databaseBytes ?? 0, className: 'bg-muted-foreground' },
              ]}
            />
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

          <Card tone="warm">
            <CardTitle>Capacity</CardTitle>
            <dl className="mt-4 space-y-4">
              <Figure
                label="Total used"
                value={formatBytes(storage?.totalBytes ?? null)}
                detail="Across every site on this plan"
              />
              <Figure
                label="Plugins"
                value={formatBytes(storage?.pluginBytes ?? null)}
                detail="Installed extension packages"
              />
            </dl>
          </Card>

          <Card>
            <CardTitle>Scope</CardTitle>
            <dl className="mt-4 space-y-4">
              <Figure
                label="Organizations"
                value={String(catalog.organizations.length)}
                detail="Billing and membership boundaries"
              />
              <Figure
                label="Workspaces"
                value={String(workspaces.length)}
                detail="Groupings of sites"
              />
            </dl>
          </Card>

          <Card className="lg:col-span-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <CardTitle>Your sites</CardTitle>
              <CardCaption>Each site opens the dashboard shaped for what it is</CardCaption>
            </div>
            <form
              className="mt-4 flex flex-wrap items-end gap-2"
              onSubmit={(event) => { event.preventDefault(); void submitNewSite() }}
            >
              <label className="min-w-0 flex-1 basis-56">
                <span className="block text-xs text-muted-foreground">New site name</span>
                <input
                  className={cn(
                    'mt-1.5 h-10 w-full rounded-full border border-border bg-card px-4',
                    'text-sm text-foreground placeholder:text-muted-foreground',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  )}
                  value={newSiteName}
                  onChange={(event) => setNewSiteName(event.target.value)}
                  placeholder="Studio journal"
                  disabled={!firstOrganizationId}
                />
              </label>
              <fieldset className="min-w-0">
                <legend className="block text-xs text-muted-foreground">Type</legend>
                <div
                  className={cn(
                    'mt-1.5 inline-flex items-center gap-0.5 rounded-full border border-border',
                    'bg-card p-1',
                  )}
                >
                  {(['website', 'publication'] as const).map((choice) => (
                    <label
                      key={choice}
                      className={cn(
                        'inline-flex h-8 cursor-pointer items-center rounded-full px-3 text-xs capitalize',
                        newSiteProfile === choice
                          ? 'bg-primary font-medium text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <input
                        className="sr-only"
                        type="radio"
                        name="new-site-profile"
                        value={choice}
                        checked={newSiteProfile === choice}
                        onChange={() => setNewSiteProfile(choice)}
                      />
                      {choice}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Button
                type="submit"
                variant="solid"
                size="md"
                disabled={creating || !firstOrganizationId || !newSiteName.trim()}
                aria-busy={creating}
              >
                {creating ? 'Creating' : 'Create site'}
              </Button>
            </form>
            {createError ? (
              <p className="mt-2 text-xs text-destructive" role="alert">{createError}</p>
            ) : null}

            {sites.length === 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">
                No sites yet. Create one above to get started.
              </p>
            ) : (
              <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {sites.map((site) => {
                  const workspace = catalog.workspaces.find((entry) => entry.id === site.workspaceId)
                  const organization = catalog.organizations.find(
                    (entry) => entry.id === site.organizationId,
                  )
                  return (
                    <li key={site.id}>
                      <Link
                        to={buildScopedAdminUrl({
                          organizationId: site.organizationId,
                          workspaceId: site.workspaceId,
                          siteId: site.id,
                        })}
                        className={cn(
                          'flex h-full flex-col justify-between gap-4 rounded-[var(--radius-md)]',
                          'border border-border bg-background p-3.5 transition-colors',
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
          </Card>
        </main>
      </div>
    </div>
  )
}
