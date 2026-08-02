import { describe, test, expect } from 'bun:test'
import { createTestDb } from '../helpers/createTestDb'

/**
 * PostgreSQL contract: `rowCount` reports the number of affected rows for
 * non-RETURNING writes and returned rows for SELECT / RETURNING statements.
 *
 * Regression guard for ISS-023: the Postgres adapter previously returned
 * `rows.length` (always 0 for a non-RETURNING write), so every repository that
 * branches on `result.rowCount` (session revocation, schedule claiming, user
 * mutations, deletes) silently reported failure on a Postgres install.
 *
 * Runs against an isolated PostgreSQL test schema, where the original adapter
 * bug was observable.
 */
describe('DB adapter rowCount', () => {
  test('reports affected-row count for non-RETURNING writes', async () => {
    const { db, cleanup } = await createTestDb()
    try {
      await db`create table rc_probe (id integer primary key, n integer)`
      await db`insert into rc_probe (id, n) values (1, 1), (2, 2), (3, 3)`

      const noMatch = await db`update rc_probe set n = n + 1 where id = 999`
      expect(noMatch.rowCount).toBe(0)

      const oneMatch = await db`update rc_probe set n = n + 1 where id = 1`
      expect(oneMatch.rowCount).toBe(1)

      const deleted = await db`delete from rc_probe where id <= 2`
      expect(deleted.rowCount).toBe(2)

      const inserted = await db`insert into rc_probe (id, n) values (10, 10), (11, 11)`
      expect(inserted.rowCount).toBe(2)

      const selected = await db<{ id: number }>`select id from rc_probe order by id`
      expect(selected.rowCount).toBe(selected.rows.length)
    } finally {
      await cleanup()
    }
  })
})
