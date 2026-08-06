/**
 * Website dashboard shell.
 *
 * Follows docs/reference/design/dribbble-website-dashboard.png: a rounded
 * application surface washed warm ivory, a centre pill navigation whose active
 * item is a solid near-black pill, a right cluster of settings, notifications
 * and identity, a large greeting, and a metric strip pairing status chips with
 * three large counts.
 *
 * The shell renders exactly one page in its content region. Nothing is stacked
 * beneath it.
 */
import type { ReactNode } from 'react'
import { Link } from '@admin/lib/routing'
import type { ProfileNavigationOutput } from '@core/fuma'
import { Avatar, Badge, Button, Stat } from '../../ui/primitives'
import { cn } from '../../ui/cn'
import { ThemeToggle } from '../../ui/theme'

export interface WebsiteDashboardShellProps {
  siteName: string
  organizationName: string
  workspaceName: string
  actorLabel: string
  /** Already scoped to the active organization/workspace/site. */
  navigation: ProfileNavigationOutput
  currentPath: string
  accountPath: string
  settingsPath: string | null
  counts: Readonly<{ sites: number, workspaces: number, organizations: number }>
  setup: Readonly<{ completed: number, total: number }>
  onSignOut?: () => void
  signingOut?: boolean
  children: ReactNode
}

function firstName(actorLabel: string): string {
  const [first] = actorLabel.trim().split(/\s+/)
  return first && first.length > 0 ? first : actorLabel
}

function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true" fill="none">
      <circle cx="8" cy="8" r="2.25" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true" fill="none">
      <path
        d="M4.2 6.6a3.8 3.8 0 0 1 7.6 0v2.5l1.1 1.9H3.1l1.1-1.9V6.6Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M6.6 13a1.6 1.6 0 0 0 2.8 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
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

export function WebsiteDashboardShell({
  siteName,
  organizationName,
  workspaceName,
  actorLabel,
  navigation,
  currentPath,
  accountPath,
  settingsPath,
  counts,
  setup,
  onSignOut,
  signingOut = false,
  children,
}: WebsiteDashboardShellProps) {
  const setupPercent = setup.total === 0
    ? 100
    : Math.round((setup.completed / setup.total) * 100)

  return (
    // `html, body, #root` are height-locked with `overflow: hidden` for the
    // builder canvas, so the dashboard owns its own scroll container. Without
    // this it silently clipped instead of scrolling.
    <div
      className={cn(
        'fuma-hosted h-full overflow-y-auto',
        'bg-background bg-[radial-gradient(120%_100%_at_92%_108%,var(--surface-wash)_0%,transparent_60%)]',
      )}
    >
      <div className="mx-auto w-full max-w-[1680px] px-3 py-4 sm:px-6 sm:py-6 xl:px-10 xl:py-8">
        <header className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <p
            className={cn(
              'inline-flex h-10 min-w-0 max-w-[60vw] items-center rounded-full border border-border',
              'px-4 text-sm font-semibold tracking-tight text-foreground',
              'sm:h-11 sm:px-5 sm:text-[0.95rem]',
            )}
          >
            <span className="truncate">{siteName}</span>
          </p>

          <nav
            aria-label="Website sections"
            className="order-3 w-full lg:order-none lg:w-auto"
          >
            <ul
              className={cn(
                'flex items-center gap-0.5 overflow-x-auto rounded-full border border-border',
                'bg-card/70 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
              )}
            >
              {navigation.map((entry) => {
                const active = currentPath === entry.path
                  || (entry.path !== '/admin' && currentPath.startsWith(`${entry.path}/`))
                return (
                  <li key={entry.id}>
                    <Link
                      to={entry.path}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'inline-flex h-9 shrink-0 items-center rounded-full px-3 text-[0.8125rem]',
                        'whitespace-nowrap transition-colors sm:px-3.5',
                        active
                          ? 'bg-foreground font-medium text-background'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      {entry.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>

          <div className="flex items-center gap-2">
            {settingsPath ? (
              <Link
                to={settingsPath}
                className={cn(
                  'inline-flex size-10 items-center justify-center gap-2 rounded-full border border-border',
                  'text-muted-foreground transition-colors hover:text-foreground',
                  'sm:size-auto sm:h-11 sm:px-4 sm:text-[0.8125rem]',
                )}
              >
                <GearIcon />
                <span className="hidden sm:inline">Setting</span>
              </Link>
            ) : null}
            <span
              className={cn(
                'hidden size-11 items-center justify-center rounded-full',
                'border border-border text-muted-foreground sm:inline-flex',
              )}
              title="Notifications"
            >
              <BellIcon />
              <span className="sr-only">Notifications</span>
            </span>
            <Link
              to={accountPath}
              className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              title={actorLabel}
            >
              <Avatar name={actorLabel} className="size-10 border border-border bg-card sm:size-11" />
              <span className="sr-only">Account</span>
            </Link>
            <ThemeToggle className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-ring" />
            {onSignOut ? (
              <Button variant="quiet" size="sm" onClick={onSignOut} disabled={signingOut} aria-busy={signingOut}>
                {signingOut ? 'Signing out' : 'Sign out'}
              </Button>
            ) : null}
          </div>
        </header>

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
              <dt className="text-xs text-muted-foreground">Setup</dt>
              <dd className="mt-2">
                <Badge variant="solid" size="md">{setupPercent}%</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Profile</dt>
              <dd className="mt-2">
                <Badge variant="accent" size="md">Website</Badge>
              </dd>
            </div>
            <div className="min-w-[180px] flex-1">
              <dt className="text-xs text-muted-foreground">{workspaceName}</dt>
              <dd className="mt-2">
                <div
                  className="h-8 w-full overflow-hidden rounded-full"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(115deg, var(--accent) 0 6px, transparent 6px 11px)',
                  }}
                >
                  <div
                    className="h-full rounded-full bg-primary/30"
                    style={{ width: `${setupPercent}%` }}
                  />
                </div>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Organization</dt>
              <dd className="mt-2">
                <Badge variant="outline" size="md">{organizationName}</Badge>
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-end gap-6 sm:gap-9">
            <Stat value={counts.sites} label="Sites" icon={<SiteIcon />} />
            <Stat value={counts.workspaces} label="Workspaces" icon={<StackIcon />} />
            <Stat value={counts.organizations} label="Organizations" icon={<OrgIcon />} />
          </div>
        </div>

        <main className="mt-6 sm:mt-7">{children}</main>
      </div>
    </div>
  )
}
