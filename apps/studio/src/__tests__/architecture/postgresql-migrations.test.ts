import { describe, expect, it } from 'bun:test'
import { pgMigrations } from '../../../server/db/migrations-pg'

describe('canonical PostgreSQL migrations', () => {
  it('keeps migration IDs unique, ordered, and non-empty', () => {
    const ids = pgMigrations.map(({ id }) => id)
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([...ids].sort((left, right) => left.localeCompare(right)))
    for (const migration of pgMigrations) {
      expect(migration.id.length).toBeGreaterThan(0)
      expect(migration.sql.trim().length).toBeGreaterThan(0)
    }
  })
})
