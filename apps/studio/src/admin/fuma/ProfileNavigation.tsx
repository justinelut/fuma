import { useState } from 'react'
import { Link } from '@admin/lib/routing'
import type {
  ProfileNavigationDisclosure,
  ProfileNavigationEntry,
  ProfileNavigationOutput,
} from '@core/fuma'

export type ProfileNavigationHandler = (entry: ProfileNavigationEntry) => void

export interface ProfileNavigationProps {
  entries: ProfileNavigationOutput
  currentPath?: string
  onNavigate?: ProfileNavigationHandler
  ariaLabel?: string
}

type NavigationGroup = Readonly<{
  disclosure?: ProfileNavigationDisclosure
  entries: readonly ProfileNavigationEntry[]
}>

function navigationGroups(entries: ProfileNavigationOutput): readonly NavigationGroup[] {
  const grouped = new Map<string, ProfileNavigationEntry[]>()
  for (const entry of entries) {
    if (!entry.disclosure) continue
    const values = grouped.get(entry.disclosure.id) ?? []
    values.push(entry)
    grouped.set(entry.disclosure.id, values)
  }

  const emitted = new Set<string>()
  return entries.flatMap((entry): NavigationGroup[] => {
    const disclosure = entry.disclosure
    if (!disclosure) return [{ entries: [entry] }]
    if (emitted.has(disclosure.id)) return []
    emitted.add(disclosure.id)
    return [{ disclosure, entries: grouped.get(disclosure.id) ?? [] }]
  })
}

function pathSelectsEntry(
  currentPath: string | undefined,
  entryPath: string,
  exact = false,
): boolean {
  if (!currentPath) return false
  const normalizedEntry = entryPath.replace(/\/+$/, '')
  const normalizedCurrent = currentPath.replace(/\/+$/, '')
  return normalizedCurrent === normalizedEntry
    || (!exact && normalizedCurrent.startsWith(`${normalizedEntry}/`))
}

function NavigationLink({
  entry,
  currentPath,
  onNavigate,
}: {
  entry: ProfileNavigationEntry
  currentPath?: string
  onNavigate?: ProfileNavigationHandler
}) {
  const current = pathSelectsEntry(currentPath, entry.path, entry.id === 'nav.home')
  return (
    <li className="min-w-0">
      <Link
        className="flex min-h-11 items-center border-l-2 border-transparent px-8 text-base font-medium text-muted-foreground no-underline hover:bg-accent/50 hover:text-foreground data-[active=true]:border-l-foreground data-[active=true]:bg-accent/50 data-[active=true]:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-border"
        data-active={current ? 'true' : undefined}
        aria-current={current ? 'page' : undefined}
        to={entry.path}
        onClick={() => onNavigate?.(entry)}
      >
        {entry.label}
      </Link>
    </li>
  )
}

function NavigationDisclosure({
  disclosure,
  entries,
  currentPath,
  onNavigate,
}: {
  disclosure: ProfileNavigationDisclosure
  entries: readonly ProfileNavigationEntry[]
  currentPath?: string
  onNavigate?: ProfileNavigationHandler
}) {
  const hasCurrentEntry = entries.some(({ path }) => pathSelectsEntry(currentPath, path))
  const [expanded, setExpanded] = useState(!disclosure.defaultCollapsed)
  const open = expanded || hasCurrentEntry

  return (
    <details
      className="min-w-0"
      open={open}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="min-h-11 cursor-pointer px-8 py-3 text-sm font-semibold text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-border">{disclosure.label}</summary>
      <ul className="grid list-none gap-0.5 p-0 m-0 [&_a]:pl-16">
        {entries.map((entry) => (
          <NavigationLink
            key={entry.id}
            entry={entry}
            currentPath={currentPath}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </details>
  )
}

export function ProfileNavigation({
  entries,
  currentPath,
  onNavigate,
  ariaLabel = 'Profile navigation',
}: ProfileNavigationProps) {
  return (
    <nav className="w-full" aria-label={ariaLabel}>
      <ul className="grid list-none gap-0.5 p-0 m-0">
        {navigationGroups(entries).map((group) => {
          if (!group.disclosure) {
            const entry = group.entries[0]
            return entry ? (
              <NavigationLink
                key={entry.id}
                entry={entry}
                currentPath={currentPath}
                onNavigate={onNavigate}
              />
            ) : null
          }
          return (
            <li className="min-w-0" key={group.disclosure.id}>
              <NavigationDisclosure
                disclosure={group.disclosure}
                entries={group.entries}
                currentPath={currentPath}
                onNavigate={onNavigate}
              />
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
