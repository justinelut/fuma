/**
 * Collections widget reader — the operator's view of the content model.
 *
 * Bounded collection provisioning lets Site AI define collections, so operators
 * need somewhere to see what actually got modelled and how much lives in each
 * one. This reader answers that from the universal store only:
 *
 *   • how many editable collections exist, split into content and records
 *   • the busiest collections by row count, newest activity first
 *
 * Only `kind: 'postType'` and `kind: 'data'` tables are reported. `page`,
 * `component` and `layout` tables are editor documents rather than collections
 * an operator manages, and reporting them would misrepresent the model.
 *
 * Soft-deleted tables and rows are excluded so a removed collection stops
 * appearing immediately.
 */
import type { DbClient } from '../../../db/client'
import type { CollectionsStats, CollectionSummary } from './types'

const SUMMARY_LIMIT = 6

type CollectionRow = {
  slug: string
  name: string
  kind: string
  system: boolean | null
  row_count: string | number | null
}

function count(value: string | number | null): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export async function readCollectionsStats(db: DbClient): Promise<CollectionsStats> {
  // One pass: every operator-managed collection with its live row count.
  // `left join` keeps a freshly provisioned, still-empty collection visible.
  const { rows } = await db<CollectionRow>`
    select
      t.slug,
      t.name,
      t.kind,
      t.system,
      count(r.id) as row_count
    from data_tables t
    left join data_rows r
      on r.table_id = t.id
     and r.deleted_at is null
    where t.deleted_at is null
      and t.kind in ('postType', 'data')
    group by t.id, t.slug, t.name, t.kind, t.system
    order by count(r.id) desc, t.slug asc
  `

  let content = 0
  let records = 0
  let totalRows = 0
  const summaries: CollectionSummary[] = []

  for (const row of rows) {
    const rowCount = count(row.row_count)
    totalRows += rowCount
    if (row.kind === 'postType') content += 1
    else records += 1
    if (summaries.length < SUMMARY_LIMIT) {
      summaries.push({
        slug: row.slug,
        name: row.name,
        shape: row.kind === 'postType' ? 'content' : 'records',
        rows: rowCount,
        // System collections are reported but flagged, because an operator
        // cannot restructure them the way they can a provisioned one.
        system: row.system === true,
      })
    }
  }

  return {
    total: rows.length,
    content,
    records,
    totalRows,
    collections: summaries,
  }
}
