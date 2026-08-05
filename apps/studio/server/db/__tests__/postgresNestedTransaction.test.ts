import { describe, expect, test } from 'bun:test'
import { createPostgresClient } from '../postgres'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL

function quote(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe schema identifier.')
  return `"${value}"`
}
function scoped(connection: string, schema: string): string {
  const url = new URL(connection)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

describe('PostgreSQL DbClient nested transactions', () => {
  test.skipIf(!postgresUrl)('uses savepoints and keeps the outer transaction authoritative', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `nested_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await db`create table evidence(id integer primary key)`
      await db.transaction(async (outer) => {
        await outer`insert into evidence values(1)`
        await outer.transaction(async (inner) => { await inner`insert into evidence values(2)` })
      })
      expect((await db<{ count: number }>`select count(*)::int count from evidence`).rows[0]?.count).toBe(2)

      await expect(db.transaction(async (outer) => {
        await outer`insert into evidence values(3)`
        await outer.transaction(async (inner) => { await inner`insert into evidence values(4)` })
        throw new Error('force outer rollback')
      })).rejects.toThrow('force outer rollback')
      expect((await db<{ count: number }>`select count(*)::int count from evidence`).rows[0]?.count).toBe(2)

      await db.transaction(async (outer) => {
        await outer`insert into evidence values(5)`
        await expect(outer.transaction(async (inner) => {
          await inner`insert into evidence values(6)`
          throw new Error('savepoint rollback')
        })).rejects.toThrow('savepoint rollback')
        await outer`insert into evidence values(7)`
      })
      expect((await db<{ ids: number[] }>`select array_agg(id order by id) ids from evidence`).rows[0]?.ids).toEqual([1,2,5,7])
    } finally {
      await db.close?.()
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`).catch(() => {})
      await admin.close?.()
    }
  })
})
