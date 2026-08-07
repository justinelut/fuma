/**
 * The site members surface: the tenant's own end users.
 *
 * Lives in shared rather than under publication/ because a WEBSITE-profile site has members too - its
 * people exist as auth identities without publication accounts, and putting the surface in the
 * publication area is exactly why that profile had no members page at all.
 *
 * Composed from shadcn rather than the old admin kit, so it needs no CSS module and inherits the
 * semantic tokens every other converted surface uses.
 */
import { useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import {
  countsFor,
  describeState,
  effectiveState,
  searchMembers,
  type MemberRow,
} from '@core/fuma/memberDirectory'
import { Badge } from '@admin/fuma/ui/badge'
import { Input } from '@admin/fuma/ui/input'
import { RHYTHM } from '@admin/fuma/ui/rhythm'

export type SiteMembersSurfaceProps = Readonly<{
  /** Rows for THIS site only. The caller resolves the scope; this surface never widens it. */
  rows: readonly MemberRow[]
  /**
   * Why the list may be incomplete, or null when it is whole.
   *
   * A REASON rather than a boolean, and shown rather than hidden: a list that silently omits people
   * reads as members having been deleted, which sends somebody looking in the wrong place.
   */
  incompleteReason?: string | null
}>

export function SiteMembersSurface({ rows, incompleteReason = null }: SiteMembersSurfaceProps) {
  const [query, setQuery] = useState('')
  const counts = useMemo(() => countsFor(rows), [rows])
  const result = useMemo(() => searchMembers(rows, query), [rows, query])

  return (
    <section aria-label="Members" className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <Users aria-hidden="true" className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Members</h2>
      </header>

      {/* Counts are shown per state rather than as one total, because a never-activated registration
          inside a members number overstates the audience. */}
      <dl className={`${RHYTHM.TIGHT} flex flex-wrap gap-x-6 gap-y-1.5 text-sm`}>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground">Active</dt>
          <dd className="font-medium">{counts.active}</dd>
        </div>
        {counts.neverActivated > 0 ? (
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Never activated</dt>
            <dd className="font-medium">{counts.neverActivated}</dd>
          </div>
        ) : null}
        {counts.disabled > 0 ? (
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Disabled</dt>
            <dd className="font-medium">{counts.disabled}</dd>
          </div>
        ) : null}
      </dl>

      {incompleteReason !== null ? (
        <p role="status" className="text-sm text-muted-foreground">
          {incompleteReason}
        </p>
      ) : null}

      <Input
        aria-label="Search members by name or email"
        placeholder="Search by name or email"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {result.visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {rows.length === 0
            ? 'Nobody has signed up to this site yet.'
            : 'No members match that search.'}
        </p>
      ) : (
        <ul className={`${RHYTHM.RELATED} flex flex-col gap-1.5`}>
          {result.visible.map((row) => {
            const state = effectiveState(row)
            return (
              <li
                key={row.memberIdentityId}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.displayName}</p>
                  {/* An absent email is stated rather than left blank: a blank cell reads as a member
                      with no address, when the truth is that this listing could not read one. */}
                  <p className="truncate text-xs text-muted-foreground">
                    {row.email ?? 'Email not available in this list'}
                  </p>
                </div>
                {state === 'active' ? null : (
                  <Badge variant="outline" className="shrink-0">
                    {/* The full consequence, not a one-word status: colour alone is not a label and
                        "pending" does not say they cannot sign in. */}
                    {describeState(state)}
                  </Badge>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {result.hidden > 0 ? (
        <p className="text-xs text-muted-foreground">
          {/* Capping is only honest if the cap is visible. */}
          {result.hidden} more {result.hidden === 1 ? 'match' : 'matches'} — keep typing to narrow the
          list.
        </p>
      ) : null}
    </section>
  )
}
