import { describe, expect, test } from 'bun:test'
import { createDbClient, UnsupportedDatabaseUrlError } from '../../../server/db'
import { pgMigrations } from '../../../server/db/migrations-pg'

describe('createDbClient — PostgreSQL-only DATABASE_URL', () => {
  test('selects the canonical PostgreSQL client and migration stream', () => {
    for (const databaseUrl of [
      'postgres://instatic:secret@127.0.0.1:65432/instatic',
      'postgresql://instatic:secret@127.0.0.1:65432/instatic',
    ]) {
      const { db, migrations } = createDbClient(databaseUrl)
      expect(db.dialect).toBe('postgres')
      expect(migrations).toBe(pgMigrations)
    }
  })

  test('rejects file, bare-path, memory, and non-PostgreSQL URLs without exposing credentials', () => {
    for (const value of [
      'sqlite:./data.db', 'file:/tmp/data.db', '/tmp/data.db', ':memory:',
      'mysql://user:private-secret@localhost/app', '',
    ]) {
      expect(() => createDbClient(value)).toThrow(UnsupportedDatabaseUrlError)
      try { createDbClient(value) } catch (error) {
        expect((error as Error).message).toContain('PostgreSQL is required')
        expect((error as Error).message).not.toContain('private-secret')
      }
    }
  })
})
