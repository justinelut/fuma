import type { DbClient } from '../db/client'

export class FumaHostedStartupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FumaHostedStartupError'
  }
}

export function assertFumaHostedDatabaseUrl(databaseUrl: string): void {
  const normalized = databaseUrl.trim()
  if (!normalized.startsWith('postgres:') && !normalized.startsWith('postgresql:')) {
    throw new FumaHostedStartupError('Fuma hosted startup requires a PostgreSQL DATABASE_URL.')
  }
}

export async function assertFumaHostedStartup(input: Readonly<{
  db: DbClient
  databaseUrl: string
}>): Promise<void> {
  assertFumaHostedDatabaseUrl(input.databaseUrl)
  if (input.db.dialect !== 'postgres') {
    throw new FumaHostedStartupError('Fuma hosted startup did not receive a PostgreSQL client.')
  }
}
