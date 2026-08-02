import { createTestDatabase } from '../../../server/db/testDatabase'
import type { DbClient } from '../../../server/db/client'

export interface TestDb {
  db: DbClient
  cleanup: () => Promise<void>
}

/** Create a fresh migrated PostgreSQL schema for a test. */
export async function createTestDb(): Promise<TestDb> {
  const testDatabase = await createTestDatabase('cms')
  return { db: testDatabase.db, cleanup: testDatabase.cleanup }
}
