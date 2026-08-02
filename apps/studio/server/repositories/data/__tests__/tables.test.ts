import { describe, expect, it, beforeEach } from 'bun:test'
import { createTestDatabase } from '../../../db/testDatabase'
import type { DbClient } from '../../../db/client'
import { createDataTable, getDataTable, listDataTables } from '../tables'

async function freshDb(): Promise<DbClient> {
  const { db: db } = await createTestDatabase('tables')
  return db
}

describe('data_tables.system column', () => {
  let db: DbClient

  beforeEach(async () => {
    db = await freshDb()
  })

  it('is not-null with a false default — a custom table reads system=false', async () => {
    // createDataTable never sets `system`, so it relies on the column default.
    const table = await createDataTable(db, {
      name: 'Products',
      slug: 'products',
      kind: 'data',
      singularLabel: 'Product',
      pluralLabel: 'Products',
    })
    expect(table.system).toBe(false)

    const reread = await getDataTable(db, table.id)
    expect(reread?.system).toBe(false)
  })

  it('reads system=true for the seeded system tables', async () => {
    for (const id of ['pages', 'posts', 'components', 'layouts']) {
      const table = await getDataTable(db, id)
      expect(table).not.toBeNull()
      expect(table?.system).toBe(true)
    }
  })

  it('stores the column as not-null (no null sneaks through)', async () => {
    // Read the raw PostgreSQL column for every row and assert it is never null.
    const { rows } = await db<{ system: boolean | null }>`select system from data_tables`
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.system).toBeBoolean()
    }
  })

  it('list and read agree on system flags', async () => {
    const tables = await listDataTables(db)
    const systemSlugs = tables.filter((t) => t.system).map((t) => t.slug).sort()
    expect(systemSlugs).toEqual(['components', 'layouts', 'pages', 'posts'])
  })
})
