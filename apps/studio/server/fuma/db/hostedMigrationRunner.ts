import type { DbClient } from '../../db/client'
import {
  hostedMigrations,
  HOSTED_MIGRATION_CHECKSUMS,
  runnableHostedMigrations,
} from './migrations'
import {
  HostedMigrationError,
  assertHostedMigrationManifest,
  hostedMigrationChecksum,
  nextHostedMigrationId,
  planHostedMigrations,
  validateHostedMigrationReport,
  type HostedMigrationHistoryRow,
  type HostedMigrationReport,
} from './migrationPolicy'

const HOSTED_MIGRATION_LOCK_KEY = 1_180_060_001

async function historyTableExists(db: DbClient): Promise<boolean> {
  const { rows } = await db<{ relation_name: string | null }>`
    select to_regclass('fuma_hosted_schema_migrations')::text as relation_name
  `
  return rows[0]?.relation_name != null
}

async function readHistory(db: DbClient): Promise<HostedMigrationHistoryRow[]> {
  const { rows } = await db<HostedMigrationHistoryRow>`
    select id, checksum from fuma_hosted_schema_migrations order by id
  `
  return rows
}

function report(
  mode: 'dry-run' | 'apply',
  applied: readonly string[],
  pending: readonly string[],
): HostedMigrationReport {
  return validateHostedMigrationReport({
    mode,
    currentId: applied.at(-1) ?? null,
    nextId: nextHostedMigrationId(hostedMigrations, 'next_migration'),
    applied: [...applied],
    pending: [...pending],
  })
}

export async function runHostedMigrations(
  db: DbClient,
  options: Readonly<{ dryRun?: boolean }> = {},
): Promise<HostedMigrationReport> {
  if (db.dialect !== 'postgres') {
    throw new HostedMigrationError('Fuma hosted migrations require PostgreSQL.')
  }
  assertHostedMigrationManifest(hostedMigrations, HOSTED_MIGRATION_CHECKSUMS)

  if (options.dryRun) {
    const history = await historyTableExists(db) ? await readHistory(db) : []
    const plan = planHostedMigrations(runnableHostedMigrations, history)
    return report('dry-run', plan.applied, plan.pending.map(({ id }) => id))
  }

  return await db.transaction(async (tx) => {
    await tx`select pg_advisory_xact_lock(${HOSTED_MIGRATION_LOCK_KEY})`
    await tx.unsafe(`
      create table if not exists fuma_hosted_schema_migrations (
        id text primary key,
        checksum text not null,
        applied_at timestamptz not null default current_timestamp
      )
    `)

    const plan = planHostedMigrations(runnableHostedMigrations, await readHistory(tx))
    for (const migration of plan.pending) {
      await tx.unsafe(migration.sql)
      await tx`
        insert into fuma_hosted_schema_migrations (id, checksum)
        values (${migration.id}, ${hostedMigrationChecksum(migration.sql)})
      `
    }

    return report(
      'apply',
      [...plan.applied, ...plan.pending.map(({ id }) => id)],
      [],
    )
  })
}
