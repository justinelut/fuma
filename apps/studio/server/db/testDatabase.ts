import { SQL } from 'bun'
import { createPostgresClient } from './postgres'
import { pgMigrations } from './migrations-pg'
import { runMigrations } from './runMigrations'
import { DEFAULT_LOCAL_DATABASE_URL } from './databaseUrl'
import type { DbClient } from './client'

export type PostgresTestDatabase = Readonly<{
  db: DbClient
  schema: string
  cleanup(): Promise<void>
}>

type PendingDatabase = Readonly<{ connection: string; db: DbClient }>

const pendingSchemas = new Map<string, PendingDatabase>()
let cleanupHookInstalled = false

function testPostgresUrl(): string {
  const value = process.env.TEST_POSTGRES_URL
    ?? process.env.FUMA_TEST_POSTGRES_URL
    ?? process.env.DATABASE_URL
    ?? DEFAULT_LOCAL_DATABASE_URL
  const url = new URL(value)
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new TypeError('Tests require TEST_POSTGRES_URL, FUMA_TEST_POSTGRES_URL, or DATABASE_URL to use PostgreSQL.')
  }
  return url.toString()
}

function quoteSchema(schema: string): string {
  if (!/^test_[a-z0-9_]+$/.test(schema)) throw new TypeError('Unsafe PostgreSQL test schema name.')
  return `"${schema}"`
}

function scopedUrl(connection: string, schema: string): string {
  const url = new URL(connection)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

async function dropSchema(connection: string, schema: string): Promise<void> {
  const admin = new SQL(connection)
  try {
    await admin.unsafe(`drop schema if exists ${quoteSchema(schema)} cascade`)
  } finally {
    await admin.close()
  }
}

async function closeAndDrop(schema: string, pending: PendingDatabase): Promise<void> {
  try {
    await pending.db.close?.()
  } finally {
    await dropSchema(pending.connection, schema)
  }
}

async function cleanupPendingSchemas(): Promise<void> {
  const entries = [...pendingSchemas.entries()]
  pendingSchemas.clear()
  const errors: unknown[] = []
  const cleanupConcurrency = 4
  for (let index = 0; index < entries.length; index += cleanupConcurrency) {
    const results = await Promise.allSettled(
      entries.slice(index, index + cleanupConcurrency)
        .map(([schema, pending]) => closeAndDrop(schema, pending)),
    )
    for (const result of results) {
      if (result.status === 'rejected') errors.push(result.reason)
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Failed to clean up PostgreSQL test schemas.')
  }
}

function installCleanupHook(): void {
  if (cleanupHookInstalled) return
  cleanupHookInstalled = true
  process.once('beforeExit', () => {
    if (pendingSchemas.size > 0) {
      void cleanupPendingSchemas().catch((error: unknown) => {
        console.error('[testDatabase] PostgreSQL cleanup failed before exit.', error)
      })
    }
  })
}

/** Create a migrated, isolated PostgreSQL schema for one test or suite. */
export async function createTestDatabase(label = 'db'): Promise<PostgresTestDatabase> {
  const connection = testPostgresUrl()
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'db'
  const schema = `test_${safeLabel}_${process.pid}_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = new SQL(connection)
  try {
    await admin.unsafe(`create schema ${quoteSchema(schema)}`)
  } finally {
    await admin.close()
  }

  const db = createPostgresClient(scopedUrl(connection, schema), {
    max: 1,
    idleTimeout: 1,
  })
  const pending = { connection, db }
  pendingSchemas.set(schema, pending)
  installCleanupHook()
  try {
    await runMigrations(db, pgMigrations)
  } catch (error) {
    pendingSchemas.delete(schema)
    await closeAndDrop(schema, pending)
    throw error
  }

  let cleaned = false
  return Object.freeze({
    db,
    schema,
    cleanup: async () => {
      if (cleaned) return
      cleaned = true
      pendingSchemas.delete(schema)
      await closeAndDrop(schema, pending)
    },
  })
}

/** Drop every PostgreSQL schema allocated by this test process. */
export async function cleanupTestDatabases(): Promise<void> {
  await cleanupPendingSchemas()
}
