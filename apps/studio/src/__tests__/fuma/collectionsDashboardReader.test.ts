import { describe, expect, test } from 'bun:test'

import { createPostgresClient } from '../../../server/db/postgres'
import { pgMigrations } from '../../../server/db/migrations-pg'
import { runMigrations } from '../../../server/db/runMigrations'
import { readCollectionsStats } from '../../../server/handlers/cms/dashboard/collections'

/**
 * The Collections widget is how an operator confirms that provisioning landed,
 * so its reader must be honest about three things a naive query gets wrong:
 *
 *   1. a freshly provisioned collection with no rows must still appear;
 *   2. editor documents (`page`/`component`/`layout`) are not collections;
 *   3. soft-deleted collections and rows must disappear immediately.
 */

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL

function quote(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}

function scoped(connection: string, schema: string): string {
  const url = new URL(connection)
  url.searchParams.set('options', `-c search_path=${schema}`)
  return url.toString()
}

describe('collections dashboard reader', () => {
  test.skipIf(!postgresUrl)('counts collections and entries, excluding editor documents and deletions', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_collections_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await runMigrations(db, pgMigrations)

      // Core migrations seed the system collections (posts, pages, components,
      // layouts), so measure against that real baseline rather than assuming an
      // empty store.
      const baseline = await readCollectionsStats(db)
      expect(baseline.collections.some((entry) => entry.system)).toBe(true)

      const table = async (
        id: string,
        slug: string,
        kind: string,
        system = false,
      ): Promise<void> => {
        await db`
          insert into data_tables (id, name, slug, kind, route_base, singular_label, plural_label, primary_field_id, system, fields_json)
          values (${id}, ${slug}, ${slug}, ${kind}, ${kind === 'postType' ? `/${slug}` : ''},
                  ${slug}, ${slug}, ${'title'}, ${system}, ${'[]'}::jsonb)
        `
      }
      const row = async (id: string, tableId: string, deleted = false): Promise<void> => {
        await db`
          insert into data_rows (id, table_id, slug, status, cells_json, deleted_at)
          values (${id}, ${tableId}, ${id}, ${'published'}, ${'{}'}::jsonb,
                  ${deleted ? new Date().toISOString() : null})
        `
      }

      // Provisioned content collection with two live rows and one deleted.
      await table('tbl_services', 'services', 'postType')
      await row('svc_1', 'tbl_services')
      await row('svc_2', 'tbl_services')
      await row('svc_3', 'tbl_services', true)

      // Provisioned record collection with one row.
      await table('tbl_team', 'team', 'data')
      await row('team_1', 'tbl_team')

      // Freshly provisioned and still empty: must remain visible.
      await table('tbl_faqs', 'faqs', 'data')

      // Editor documents are not collections.
      await table('tbl_pages_doc', 'page-doc', 'page')
      await table('tbl_component', 'component-doc', 'component')
      await table('tbl_layout', 'layout-doc', 'layout')

      const stats = await readCollectionsStats(db)

      // Three new collections; the three editor documents are excluded.
      expect(stats.total).toBe(baseline.total + 3)
      expect(stats.content).toBe(baseline.content + 1)
      expect(stats.records).toBe(baseline.records + 2)
      // Three live rows added; the soft-deleted row is not counted.
      expect(stats.totalRows).toBe(baseline.totalRows + 3)

      // Read the full set rather than only the bounded summary list.
      const all = await db<{ slug: string; kind: string; system: boolean | null; n: string }>`
        select t.slug, t.kind, t.system, count(r.id) as n
        from data_tables t
        left join data_rows r on r.table_id = t.id and r.deleted_at is null
        where t.deleted_at is null and t.kind in ('postType', 'data')
        group by t.id, t.slug, t.kind, t.system
      `
      const bySlug = new Map(all.rows.map((entry) => [entry.slug, entry]))
      expect(bySlug.get('services')).toMatchObject({ kind: 'postType', n: '2' })
      expect(bySlug.get('team')).toMatchObject({ kind: 'data', n: '1' })
      // Empty collection still surfaces, which is how provisioning is confirmed.
      expect(bySlug.get('faqs')).toMatchObject({ n: '0' })
      expect(bySlug.has('page-doc')).toBe(false)
      expect(bySlug.has('component-doc')).toBe(false)
      expect(bySlug.has('layout-doc')).toBe(false)

      // The busiest collection leads the bounded summary.
      expect(stats.collections[0]?.slug).toBe('services')
      expect(stats.collections[0]?.rows).toBe(2)
      // Seeded system collections are reported but flagged as unmanageable.
      expect(stats.collections.some((entry) => entry.system)).toBe(true)

      // Soft-deleting a collection removes it immediately.
      await db`update data_tables set deleted_at = now() where id = ${'tbl_team'}`
      const afterDelete = await readCollectionsStats(db)
      expect(afterDelete.total).toBe(stats.total - 1)
      expect(afterDelete.totalRows).toBe(stats.totalRows - 1)
      expect(afterDelete.collections.some((entry) => entry.slug === 'team')).toBe(false)
    } finally {
      await db.close?.()
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      await admin.close?.()
    }
  })
})
