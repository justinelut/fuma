import { createPostgresClient } from './postgres'
import { pgMigrations } from './migrations-pg'
import {
  DEFAULT_LOCAL_DATABASE_URL,
  isPostgresDatabaseUrl,
} from './databaseUrl'
import type { DbClient, DbResult } from './client'
import type { Migration } from './runMigrations'

export type { DbClient, DbResult }
export { DEFAULT_LOCAL_DATABASE_URL }

export class UnsupportedDatabaseUrlError extends Error {
  constructor(databaseUrl: string) {
    const prefix = /^[a-zA-Z][a-zA-Z0-9+\-.]*:/.exec(databaseUrl)?.[0] ?? '(missing scheme)'
    super(`Unsupported DATABASE_URL: ${prefix}. PostgreSQL is required; expected postgres://... or postgresql://...`)
    this.name = 'UnsupportedDatabaseUrlError'
  }
}

/** Create the platform's sole PostgreSQL client and canonical migration list. */
export function createDbClient(databaseUrl: string): { db: DbClient; migrations: Migration[] } {
  const normalized = databaseUrl.trim()
  if (!isPostgresDatabaseUrl(normalized)) throw new UnsupportedDatabaseUrlError(normalized)
  return {
    db: createPostgresClient(normalized),
    migrations: pgMigrations,
  }
}
