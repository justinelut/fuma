import type { DbClient } from '../db/client'
import { isSqliteUrl } from '../db'

export const FUMA_TRANSITION_COMMAND = 'bun run fuma:transition -- --source="$FUMA_LEGACY_SQLITE_PATH" --target="$DATABASE_URL"'

export class FumaHostedStartupError extends Error {
  readonly action: string

  constructor(message: string) {
    super(`${message} Run: ${FUMA_TRANSITION_COMMAND}`)
    this.name = 'FumaHostedStartupError'
    this.action = FUMA_TRANSITION_COMMAND
  }
}

export function assertFumaHostedDatabaseUrl(databaseUrl: string): void {
  if (isSqliteUrl(databaseUrl)) {
    throw new FumaHostedStartupError(
      'Fuma hosted startup refuses SQLite after cutover; preserve the legacy database and import it into PostgreSQL.',
    )
  }
  if (!databaseUrl.startsWith('postgres:') && !databaseUrl.startsWith('postgresql:')) {
    throw new FumaHostedStartupError('Fuma hosted startup requires a PostgreSQL DATABASE_URL.')
  }
}

export async function assertFumaHostedStartup(input: Readonly<{
  db: DbClient
  databaseUrl: string
  legacySqliteConfigured: boolean
}>): Promise<void> {
  assertFumaHostedDatabaseUrl(input.databaseUrl)
  if (input.db.dialect !== 'postgres') {
    throw new FumaHostedStartupError('Fuma hosted startup did not receive a PostgreSQL client.')
  }
  if (!input.legacySqliteConfigured) return
  const result = await input.db<{ count: number | bigint }>`
    select count(*) as count from fuma_legacy_imports where state = ${'complete'}
  `
  if (Number(result.rows[0]?.count ?? 0) === 0) {
    throw new FumaHostedStartupError(
      'A legacy SQLite source is configured but no validated PostgreSQL import receipt exists; refusing silent data discard.',
    )
  }
}
