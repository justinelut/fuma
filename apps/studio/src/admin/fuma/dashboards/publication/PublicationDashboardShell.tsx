/**
 * Publication dashboard shell.
 *
 * Follows docs/reference/design/ghost-publication-dashboard.webp: a fixed
 * near-black sidebar carrying a brand mark and search, primary items, a grouped
 * Posts section with a create action and status-dotted children, then Pages,
 * Tags, Members with a count and Offers, with identity, settings and a theme
 * toggle pinned to the bottom. The content region opens with the page title and
 * a right-aligned range control.
 *
 * The shell renders exactly one page. Nothing is stacked beneath it.
 */
import type { ReactNode } from 'react'
import { Link } from '@admin/lib/routing'
import type { ProfileNavigationOutput } from '@core/fuma'
import { cn } from '../../ui/cn'
import { ThemeToggle } from '../../ui/theme'

export type SidebarChild = Readonly<{
  id: string
  label: string
  path: string
  /** Status dot colour, as the reference uses for post visibility. */
  dot?: 'series' | 'series-alt' | 'positive'
  count?: number
}>

export interface PublicationDashboardShellProps {
  publicationName: string
  actorLabel: string
  navigation: ProfileNavigationOutput
  currentPath: string
  accountPath: string
  builderPath: string
  publicUrl: string | null
  postChildren: readonly SidebarChild[]
  title: string
  range: string
  onSignOut?: () => void
  signingOut?: boolean
  children: ReactNode
}

const NAV_ICON = 'size-[15px] shrink-0'

function HomeIcon() {
  return (
    <svg viewBox="0 0 16 16" className={NAV_ICON} fill="none" aria-hidden="true">
      <path d="M2.5 7 8 2.5 13.5 7v6a.9.9 0 0 1-.9.9H3.4a.9.9 0 0 1-.9-.9V7Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" className={NAV_ICON} fill="none" aria-hidden="true">
      <path d="M3 4.5h10M3 8h10M3 11.5h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function PenIcon() {
  return (
    <svg viewBox="0 0 16 16" className={NAV_ICON} fill="none" aria-hidden="true">
      <path d="M10.8 2.9l2.3 2.3-7.4 7.4-3 .7.7-3 7.4-7.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function TagIcon() {
  return (
    <svg viewBox="0 0 16 16" className={NAV_ICON} fill="none" aria-hidden="true">
      <path d="M8.4 2.5H13v4.6l-6 6-4.6-4.6 6-6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="10.6" cy="5.4" r=".9" fill="currentColor" />
    </svg>
  )
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 16 16" className={NAV_ICON} fill="none" aria-hidden="true">
      <circle cx="6.2" cy="6" r="2.1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.6 13c.3-2 1.8-3.2 3.6-3.2S9.5 11 9.8 13M10.8 4.4a2 2 0 0 1 0 3.9M11.6 9.9c1.2.3 2 1.4 2.2 3.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg viewBox="0 0 16 16" className={NAV_ICON} fill="none" aria-hidden="true">
      <rect x="2.2" y="3.6" width="11.6" height="8.8" rx="1.1" stroke="currentColor" strokeWidth="1.2" />
      <path d="m2.6 4.6 5.4 4 5.4-4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 16 16" className={NAV_ICON} fill="none" aria-hidden="true">
      <path d="M3 12.5V9M6.6 12.5V5.5M10.2 12.5v-5M13.8 12.5v-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 16 16" className={NAV_ICON} fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.6 8h10.8M8 2.5c1.6 1.6 1.6 9.4 0 11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <circle cx="7.2" cy="7.2" r="4.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="m10.4 10.4 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

const NAV_ICONS: Readonly<Record<string, () => ReactNode>> = {
  'nav.home': HomeIcon,
  'nav.builder': PenIcon,
  'nav.posts': ListIcon,
  'nav.tags': TagIcon,
  'nav.members': PeopleIcon,
  'nav.newsletters': MailIcon,
  'nav.publication-analytics': ChartIcon,
  'nav.domains': GlobeIcon,
  'nav.team': PeopleIcon,
  'nav.settings': GearIcon,
}

const DOT_COLOUR: Readonly<Record<string, string>> = {
  series: 'bg-ghost-series',
  'series-alt': 'bg-ghost-series-alt',
  positive: 'bg-ghost-positive',
}

function itemClass(active: boolean): string {
  return cn(
    'flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[0.8125rem] transition-colors',
    active
      ? 'bg-ghost-hairline text-ghost-ink'
      : 'text-ghost-ink-soft hover:bg-ghost-hairline/60 hover:text-ghost-ink',
  )
}

export function PublicationDashboardShell({
  publicationName,
  actorLabel,
  navigation,
  currentPath,
  accountPath,
  builderPath,
  publicUrl,
  postChildren,
  title,
  range,
  onSignOut,
  signingOut = false,
  children,
}: PublicationDashboardShellProps) {
  const postsEntry = navigation.find((entry) => entry.id === 'nav.posts')
  const primary = navigation.filter((entry) => entry.id === 'nav.home')
  const secondary = navigation.filter((entry) => (
    entry.id !== 'nav.home' && entry.id !== 'nav.posts' && entry.id !== 'nav.builder'
  ))
  const initials = actorLabel.trim().charAt(0).toUpperCase() || '·'

  return (
    <div className="fuma-hosted flex min-h-dvh bg-ghost-canvas text-ghost-ink">
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh w-[200px] shrink-0 flex-col',
          'border-r border-ghost-hairline bg-ghost-sidebar px-3 py-4 lg:flex',
        )}
      >
        <div className="flex items-center gap-2 px-1.5">
          <span className="inline-flex size-6 items-center justify-center rounded-full border border-ghost-hairline text-[0.625rem] font-semibold">
            {publicationName.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold tracking-tight">
            {publicationName}
          </span>
          <span className="text-ghost-ink-muted" title="Search"><SearchIcon /></span>
        </div>

        <nav aria-label="Publication navigation" className="mt-6 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
          <ul className="space-y-0.5">
            {primary.map((entry) => {
              const Icon = NAV_ICONS[entry.id] ?? ListIcon
              return (
                <li key={entry.id}>
                  <Link
                    to={entry.path}
                    aria-current={currentPath === entry.path ? 'page' : undefined}
                    className={itemClass(currentPath === entry.path)}
                  >
                    <Icon />
                    {entry.label}
                  </Link>
                </li>
              )
            })}
            {publicUrl ? (
              <li>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={itemClass(false)}
                >
                  <GlobeIcon />
                  View site
                </a>
              </li>
            ) : null}
          </ul>

          {postsEntry ? (
            <div>
              <div className="flex items-center justify-between gap-2">
                <Link
                  to={postsEntry.path}
                  aria-current={currentPath === postsEntry.path ? 'page' : undefined}
                  className={cn(itemClass(currentPath === postsEntry.path), 'flex-1')}
                >
                  <PenIcon />
                  {postsEntry.label}
                </Link>
                <Link
                  to={`${postsEntry.path}/new`}
                  className="rounded-md p-1.5 text-ghost-ink-muted transition-colors hover:bg-ghost-hairline hover:text-ghost-ink"
                  aria-label="New post"
                >
                  <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
                    <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </Link>
              </div>
              <ul className="mt-0.5 space-y-0.5 pl-[26px]">
                {postChildren.map((child) => (
                  <li key={child.id}>
                    <Link
                      to={child.path}
                      aria-current={currentPath === child.path ? 'page' : undefined}
                      className={cn(
                        'flex items-center justify-between gap-2 rounded-md px-2.5 py-[6px]',
                        'text-[0.8125rem] transition-colors',
                        currentPath === child.path
                          ? 'text-ghost-ink'
                          : 'text-ghost-ink-soft hover:text-ghost-ink',
                      )}
                    >
                      <span className="truncate">{child.label}</span>
                      {child.dot ? (
                        <span className={cn('size-1.5 shrink-0 rounded-full', DOT_COLOUR[child.dot])} />
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <ul className="space-y-0.5">
            {secondary.map((entry) => {
              const Icon = NAV_ICONS[entry.id] ?? ListIcon
              const active = currentPath === entry.path
              return (
                <li key={entry.id}>
                  <Link
                    to={entry.path}
                    aria-current={active ? 'page' : undefined}
                    className={cn(itemClass(active), 'justify-between')}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon />
                      {entry.label}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>

          <ul className="space-y-0.5">
            <li>
              <Link to={builderPath} className={itemClass(false)}>
                <PenIcon />
                Design
              </Link>
            </li>
          </ul>
        </nav>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-ghost-hairline pt-3">
          <Link
            to={accountPath}
            className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-ghost-ink-soft transition-colors hover:text-ghost-ink"
          >
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-ghost-hairline text-[0.625rem] font-semibold">
              {initials}
            </span>
            <span className="truncate text-[0.75rem]">{actorLabel}</span>
          </Link>
          <div className="flex items-center gap-1">
            <span className="p-1.5 text-ghost-ink-muted" title="Settings"><GearIcon /></span>
            <ThemeToggle className="text-ghost-ink-muted hover:bg-ghost-hairline hover:text-ghost-ink focus-visible:outline-ghost-ink" />
            {onSignOut ? (
              <button
                type="button"
                onClick={onSignOut}
                disabled={signingOut}
                aria-busy={signingOut}
                className="rounded-md px-2 py-1 text-[0.6875rem] text-ghost-ink-muted transition-colors hover:bg-ghost-hairline hover:text-ghost-ink"
              >
                {signingOut ? 'Signing out' : 'Sign out'}
              </button>
            ) : null}
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1000px] px-5 py-7 sm:px-8">
          <header className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="text-[1.875rem] leading-none font-semibold tracking-tight">{title}</h1>
            <p className="text-xs text-ghost-ink-soft">{range}</p>
          </header>
          <main className="mt-6 space-y-4">{children}</main>
        </div>
      </div>
    </div>
  )
}
