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
import { GROUP, RELATED_GAP } from '../ui/rhythm'
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

function WebsiteGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.2 6.2h11.6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function PublicationGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <path d="M3.4 2.8h6.2l3 3v7.4H3.4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5.6 8h4.8M5.6 10.4h3.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** Ring gauge, matching the dial the profile dashboards use. */
function Dial({ percent, caption }: { percent: number | null, caption: string }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const dash = ((percent ?? 0) / 100) * circumference
  return (
    <svg
      viewBox="0 0 140 140"
      className="size-[148px]"
      role="img"
      aria-label={`${percent ?? 0}% ${caption}`}
    >
      <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--accent)" strokeWidth="9" />
      <circle
        cx="70"
        cy="70"
        r={radius}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        transform="rotate(-90 70 70)"
      />
      <text
        x="70"
        y="68"
        textAnchor="middle"
        className="fill-foreground"
        style={{ fontSize: '1.55rem', fontWeight: 600, letterSpacing: '-0.02em' }}
      >
        {percent === null ? '—' : `${percent}%`}
      </text>
      <text x="70" y="86" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: '0.6rem' }}>
        {caption}
      </text>
    </svg>
  )
}



/**
 * How many site shortcuts the header strip carries. Bounded because the strip is one row and
 * an unbounded list would either scroll off or wrap the header; the remainder is REPORTED so
 * the bound is visible rather than silent.
 */
const NAV_SITE_LIMIT = 5

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
        // NOT flex-wrap. A sticky element has whatever height its content gives it, so
        // wrapping the nav onto its own row made this header several rows tall on a narrow
        // viewport and it covered the surface underneath. One row at every width instead.
        'sticky top-0 z-30 -mx-3 flex items-center justify-between gap-2',
        // Translucent because the page carries a radial gradient wash and an opaque strip
        // over a gradient shows as a seam at its edge.
        'border-b border-border bg-background/85 backdrop-blur-sm px-3 py-3',
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
  const mix = Object.freeze([
    { label: 'Images', short: 'Img', bytes: storage?.imageBytes ?? 0, className: 'bg-chart-1' },
    { label: 'Videos', short: 'Vid', bytes: storage?.videoBytes ?? 0, className: 'bg-chart-2' },
    { label: 'Documents', short: 'Doc', bytes: storage?.documentBytes ?? 0, className: 'bg-chart-5' },
    { label: 'Plugins', short: 'Plg', bytes: storage?.pluginBytes ?? 0, className: 'bg-chart-4' },
    { label: 'Database', short: 'DB', bytes: storage?.databaseBytes ?? 0, className: 'bg-muted-foreground' },
  ] as const)
  const mixTotal = mix.reduce((total, part) => total + part.bytes, 0)
  const largestBytes = mix.reduce((largest, part) => Math.max(largest, part.bytes), 0)
  const databaseShare = storage && storage.totalBytes > 0
    ? Math.round((storage.databaseBytes / storage.totalBytes) * 100)
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
          {/* These are SITE shortcuts, not platform sections - the previous accessible name
              said "Platform sections" while the list read out site names.
              Hidden below lg rather than moved into a sheet (which is what the website and
              publication shells needed): there the sidebar was the ONLY route to those
              destinations, whereas every one of these sites is also listed in the "Your sites"
              card on this same page. Hiding a duplicate costs nothing; hiding a sole route
              would strand somebody. */}
          <nav aria-label="Jump to a site" className="hidden lg:block">
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
              {sites.slice(0, NAV_SITE_LIMIT).map((site) => (
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
              {sites.length > NAV_SITE_LIMIT ? (
                <li>
                  {/* A cap is only honest if it is visible. Without this, sites past the
                      fifth simply are not here and read as deleted. */}
                  <span className="inline-flex h-9 shrink-0 items-center px-3 text-[0.8125rem] whitespace-nowrap text-muted-foreground">
                    +{sites.length - NAV_SITE_LIMIT} more below
                  </span>
                </li>
              ) : null}
            </ul>
          </nav>
        </HeaderShell>

        <h1
          className={cn(
            'mt-6 text-[1.75rem] leading-tight font-semibold tracking-tight text-foreground',
            'sm:mt-10 sm:mt-12 sm:text-[2.4rem] sm:leading-none xl:text-[2.75rem]',
          )}
        >
          Welcome in, {firstName(actorLabel)}
        </h1>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-6 sm:mt-10 sm:mt-12 sm:gap-x-12">
          <dl className="flex min-w-0 flex-wrap items-end gap-5 sm:gap-8">
            <div>
              <dt className="text-xs text-muted-foreground">Storage</dt>
              <dd className="mt-3">
                <Badge variant="solid" size="md">{formatBytes(storage?.totalBytes ?? null)}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Database</dt>
              <dd className="mt-3">
                <Badge variant="accent" size="md">{formatBytes(storage?.databaseBytes ?? null)}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Media</dt>
              <dd className="mt-3">
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
          <p className="mt-6 text-sm text-destructive" role="alert">{error}</p>
        ) : null}

        <main className="mt-10 sm:mt-12 grid items-start gap-4 sm:mt-10 sm:mt-12 sm:gap-5 lg:grid-cols-4">
          {/* Feature card: what the plan is carrying right now. */}
          <Card className="flex min-h-[248px] flex-col justify-between">
            <div>
              <Badge variant="accent" size="sm">Runtime</Badge>
              <p className="mt-6 text-[1.75rem] leading-none font-semibold tracking-tight text-foreground">
                {formatBytes(storage?.totalBytes ?? null)}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {loading
                  ? 'Reading measurements from the runtime.'
                  : storage
                    ? `Stored across every site on this plan, on ${storage.dialect}.`
                    : 'Storage measurements are not available right now.'}
              </p>
            </div>
            {planPath ? (
              <Link
                to={planPath}
                className={cn(
                  'mt-6 inline-flex h-10 items-center justify-center self-start rounded-full',
                  'bg-primary px-4 text-sm font-medium text-primary-foreground',
                  'transition-[filter] hover:brightness-110',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                )}
              >
                Review plan and usage
              </Link>
            ) : (
              <p className="mt-6 text-[0.6875rem] text-muted-foreground">
                Limits follow your plan.
              </p>
            )}
          </Card>

          {/* Bar chart of the storage mix, largest series highlighted. */}
          <Card className="flex min-h-[248px] flex-col">
            <CardTitle>Storage mix</CardTitle>
            <div className="mt-3 flex items-end gap-2">
              <p className="text-[1.9rem] leading-none font-semibold tracking-tight text-foreground">
                {mix.length}
              </p>
              <p className="pb-0.5 text-[0.6875rem] leading-tight text-muted-foreground">
                kinds
                <br />
                measured
              </p>
            </div>
            {mixTotal <= 0 ? (
              <p className="mt-auto pb-4 text-xs text-muted-foreground">Nothing stored yet</p>
            ) : (
              <div className="mt-auto flex h-[104px] items-end gap-3">
                {mix.map((part) => (
                  <div key={part.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                    <span
                      className={cn(
                        'w-[5px] rounded-full',
                        part.bytes === largestBytes ? 'bg-primary' : 'bg-accent',
                      )}
                      style={{ height: `${Math.max(6, (part.bytes / mixTotal) * 100)}%` }}
                      title={`${part.label}: ${formatBytes(part.bytes)}`}
                    />
                    <span className="max-w-full truncate text-[0.625rem] text-muted-foreground">
                      {part.short}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Dial: how much of what is stored is the database itself. */}
          <Card tone="warm" className="flex min-h-[248px] flex-col">
            <CardTitle>Composition</CardTitle>
            <div className="grid flex-1 place-items-center">
              <Dial
                percent={databaseShare}
                caption="database"
              />
            </div>
            <CardCaption>
              {databaseShare === null
                ? 'Composition appears once something is stored'
                : `${formatBytes(storage?.databaseBytes ?? null)} of ${formatBytes(storage?.totalBytes ?? null)}`}
            </CardCaption>
          </Card>

          {/* Tall panel: the sites this plan carries. */}
          <Card className="flex flex-col lg:row-span-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>Your sites</CardTitle>
                <CardCaption className="mt-1.5">
                  Each opens the dashboard shaped for what it is
                </CardCaption>
              </div>
              <span className="shrink-0 text-2xl leading-none font-semibold tracking-tight text-foreground">
                {sites.length}
              </span>
            </div>
            {sites.length === 0 ? (
              <div className={cn('flex flex-col items-start', GROUP, RELATED_GAP)}>
                <p className="text-xs text-muted-foreground">
                  Nothing here yet. Your first site is the next step.
                </p>
                {/* The ACTION, not a direction to look elsewhere. The previous copy said
                    "create one below", which is only true while the form happens to render
                    beneath this card - the component cannot know that, and a first-run
                    instruction that is wrong is worse than none. */}
                <a
                  href="#add-a-site"
                  className={cn(
                    'inline-flex h-9 items-center rounded-full bg-primary px-4',
                    'text-[0.8125rem] font-medium text-primary-foreground',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  )}
                >
                  Create your first site
                </a>
              </div>
            ) : (
              <ul className="mt-6 flex-1 space-y-2">
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
                          'flex items-center gap-3 rounded-[var(--radius-md)] border border-border',
                          'bg-muted/60 p-3 transition-colors hover:border-primary/45 hover:bg-primary/[0.06]',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                        )}
                      >
                        <span
                          className={cn(
                            'inline-flex size-9 shrink-0 items-center justify-center',
                            'rounded-[0.5rem] border border-border bg-card text-muted-foreground',
                          )}
                          aria-hidden="true"
                        >
                          {site.profileId === 'publication' ? <PublicationGlyph /> : <WebsiteGlyph />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.8125rem] font-medium text-foreground">
                            {site.name}
                          </span>
                          <span className="mt-1.5 block truncate text-[0.6875rem] text-muted-foreground">
                            {organization?.name ?? site.organizationId} / {workspace?.name ?? site.workspaceId}
                          </span>
                        </span>
                        <Badge variant="outline" size="sm" className="shrink-0">
                          {PROFILE_LABEL[site.profileId] ?? site.profileId}
                        </Badge>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          {/* A list under a heading; the rows carry the meaning, not a panel. */}
          <section>
            <h2 className="px-1 text-[0.9375rem] leading-snug font-semibold tracking-tight text-foreground">
              Measured
            </h2>
            <dl className="mt-3 divide-y divide-border border-y border-border">
              {mix.map((part) => (
                <div key={part.label} className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="flex min-w-0 items-center gap-2 text-[0.8125rem] text-muted-foreground">
                    <span className={cn('size-1.5 shrink-0 rounded-full', part.className)} />
                    <span className="truncate">{part.label}</span>
                  </dt>
                  <dd className="shrink-0 text-[0.8125rem] font-medium tabular-nums text-foreground">
                    {formatBytes(part.bytes)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Creating a site is an action, so it reads as a form under a heading. */}
          <section id="add-a-site" className="lg:col-span-2 scroll-mt-24">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
              <h2 className="text-[0.9375rem] leading-snug font-semibold tracking-tight text-foreground">
                Add a site
              </h2>
              <p className="text-[0.6875rem] text-muted-foreground">
                Lands in this workspace alongside the others
              </p>
            </div>
            <form
              className="mt-6 flex flex-wrap items-end gap-3"
              onSubmit={(event) => { event.preventDefault(); void submitNewSite() }}
            >
              <label className="min-w-0 flex-1 basis-56">
                <span className="block text-xs text-muted-foreground">Name</span>
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
              <p className="mt-3 text-xs text-destructive" role="alert">{createError}</p>
            ) : null}
            <p className="mt-3 px-1 text-[0.6875rem] text-muted-foreground">
              A website gets the site dashboard; a publication gets the editorial one.
            </p>
          </section>
        </main>
      </div>
    </div>
  )
}
