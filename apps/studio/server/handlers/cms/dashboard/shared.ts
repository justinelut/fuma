/**
 * Shared SQL + coercion helpers used by multiple dashboard widget readers.
 *
 * Anything in this module is consumed by 2+ readers. One-reader helpers
 * stay co-located in their reader's file so the call site is obvious and
 * the surface here doesn't bloat into a junk drawer.
 *
 *   • `readStatusCounts`        — Pages, Posts
 *   • `readPublishedSinceCount` — Pages (Posts uses the histogram instead)
 *   • `coerceCount`             — every reader that calls `count(*)`
 *   • `coerceBytes`             — Media, Storage
 *   • `buildRowPath`            — Publish lineup, Activity
 */
import type { DbClient } from '../../../db/client'

/**
 * Coerce a PostgreSQL `count(*)` result into a plain JavaScript number.
 * BIGINT counts normally arrive as strings and may be null in synthetic rows;
 * this helper normalizes those shapes with a zero default.
 */
export function coerceCount(raw: number | string | null | undefined): number {
  if (raw === null || raw === undefined) return 0
  if (typeof raw === 'string') return parseInt(raw, 10) || 0
  return raw
}

/**
 * Coerce a PostgreSQL `sum(...)` byte total into a plain JavaScript number.
 * BIGINT sums arrive as strings and can be null for an empty set. This alias
 * keeps byte-count call sites self-explanatory.
 */
export const coerceBytes = coerceCount

/**
 * Group counts of `data_rows.status` for a single table. Returns
 * {draft, published, scheduled, total} so the handler can derive
 * everything from one round-trip per table.
 */
export async function readStatusCounts(
  db: DbClient,
  tableId: string,
): Promise<{ total: number; published: number; drafts: number; scheduled: number }> {
  const { rows } = await db<{ status: string; count: number | string }>`
    select status, count(*) as count
    from data_rows
    where table_id = ${tableId}
      and deleted_at is null
    group by status
  `
  let published = 0
  let drafts = 0
  let scheduled = 0
  for (const r of rows) {
    const n = coerceCount(r.count)
    if (r.status === 'published') published += n
    else if (r.status === 'draft') drafts += n
    else if (r.status === 'scheduled') scheduled += n
  }
  return {
    total: published + drafts + scheduled,
    published,
    drafts,
    scheduled,
  }
}

/**
 * Count `data_rows` whose `published_at` lies in the trailing window,
 * for one table. Used by the Pages widget's "+N this week" delta.
 */
export async function readPublishedSinceCount(
  db: DbClient,
  tableId: string,
  sinceIso: string,
): Promise<number> {
  const { rows } = await db<{ count: number | string }>`
    select count(*) as count
    from data_rows
    where table_id = ${tableId}
      and deleted_at is null
      and status = 'published'
      and published_at is not null
      and published_at >= ${sinceIso}
  `
  return coerceCount(rows[0]?.count)
}

/**
 * Build the public path for a content row from its table's route_base
 * and the row's slug. Shared by the Publish lineup and Activity widgets
 * so both render the same `/blog/<slug>` style label.
 *
 *   • Falls back to `/${tableId}/<slug>` when route_base is missing
 *     (collection still being set up, or a system table without a
 *     route prefix yet).
 *   • An empty slug renders as the literal `(no slug)` placeholder so
 *     the row stays clickable in the widget instead of dropping a
 *     trailing slash that looks like a broken link.
 */
export function buildRowPath(routeBase: string | null, tableId: string, slug: string): string {
  const safeSlug = slug || '(no slug)'
  const base = routeBase && routeBase.trim().length > 0 ? routeBase : `/${tableId}`
  const normalizedBase = base.startsWith('/') ? base : `/${base}`
  const trimmedBase = normalizedBase.endsWith('/') ? normalizedBase.slice(0, -1) : normalizedBase
  return `${trimmedBase}/${safeSlug}`
}
