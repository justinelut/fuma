import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import {
  hostedMigrations,
  HOSTED_MIGRATION_CHECKSUMS,
  runnableHostedMigrations,
} from '../../../server/fuma/db/migrations'
import { runHostedMigrations } from '../../../server/fuma/db/hostedMigrationRunner'
import {
  HostedMigrationError,
  assertHostedMigrationIsAdditive,
  assertHostedMigrationManifest,
  hostedMigrationChecksum,
  nextHostedMigrationId,
  planHostedMigrations,
  type HostedMigration,
  type HostedMigrationHistoryRow,
} from '../../../server/fuma/db/migrationPolicy'
import {
  FumaHostedStartupError,
  assertFumaHostedDatabaseUrl,
  assertFumaHostedStartup,
} from '../../../server/fuma/startupGuard'

function noRows<Row>(): DbResult<Row> {
  return { rows: [], rowCount: 0 }
}

function fakeRunnerDb(initialHistory: readonly HostedMigrationHistoryRow[] = []): {
  db: DbClient
  migrationExecutions: () => number
  history: () => HostedMigrationHistoryRow[]
  historyTableCreated: () => boolean
  lockCalls: () => number
} {
  const rows = initialHistory.map((row) => ({ ...row }))
  let tableCreated = rows.length > 0
  let executions = 0
  let advisoryLockCalls = 0
  let chain: Promise<unknown> = Promise.resolve()

  const fn = (async <Row = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>> => {
    const sql = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase()
    if (sql.includes('select pg_advisory_xact_lock')) {
      advisoryLockCalls += 1
      return noRows<Row>()
    }
    if (sql.includes('select to_regclass')) {
      return { rows: [{ relation_name: tableCreated ? 'fuma_hosted_schema_migrations' : null }] as Row[], rowCount: 1 }
    }
    if (sql.includes('select id, checksum from fuma_hosted_schema_migrations')) {
      return { rows: rows.map((row) => ({ ...row })) as Row[], rowCount: rows.length }
    }
    if (sql.includes('insert into fuma_hosted_schema_migrations')) {
      rows.push({ id: String(values[0]), checksum: String(values[1]) })
      return noRows<Row>()
    }
    return noRows<Row>()
  }) as DbClient

  fn.unsafe = async <Row = Record<string, unknown>>(sql: string): Promise<DbResult<Row>> => {
    if (sql.includes('create table if not exists fuma_hosted_schema_migrations')) tableCreated = true
    if (sql.includes('create table if not exists fuma_legacy_imports')) {
      executions += 1
      await Bun.sleep(5)
    }
    return noRows<Row>()
  }
  fn.transaction = <T>(callback: (tx: DbClient) => Promise<T>): Promise<T> => {
    const result = chain.then(() => callback(fn), () => callback(fn))
    chain = result.then(() => undefined, () => undefined)
    return result
  }
  Object.defineProperty(fn, 'dialect', { value: 'postgres' })
  return {
    db: fn,
    migrationExecutions: () => executions,
    history: () => rows.map((row) => ({ ...row })),
    historyTableCreated: () => tableCreated,
    lockCalls: () => advisoryLockCalls,
  }
}

function migration(id: string, sql: string): HostedMigration {
  return { id, description: id, sql }
}

describe('FUMA-006 hosted migration policy', () => {
  it('plans fresh and contiguous upgrades and generates the next PostgreSQL ID', () => {
    const stream = [
      migration('000001_first', 'create table first_table (id text primary key);'),
      migration('000002_second', 'alter table first_table add column label text;'),
    ]
    expect(planHostedMigrations(stream, []).pending.map(({ id }) => id)).toEqual([
      '000001_first',
      '000002_second',
    ])
    expect(planHostedMigrations(stream, [{
      id: stream[0]!.id,
      checksum: hostedMigrationChecksum(stream[0]!.sql),
    }]).pending.map(({ id }) => id)).toEqual(['000002_second'])
    expect(nextHostedMigrationId(stream, 'Add Import Receipt')).toBe('000003_add_import_receipt')
  })

  it.each([
    'drop table sites;',
    'truncate table sites;',
    'delete from sites;',
    'alter table sites drop column owner_id;',
    'alter table sites rename column owner_id to user_id;',
  ])('rejects destructive SQL before fresh, upgrade, or imported history execution: %s', (sql) => {
    expect(() => assertHostedMigrationIsAdditive(migration('000002_bad', sql)))
      .toThrow(HostedMigrationError)
  })

  it('rejects top-level transaction control without rejecting quoted function bodies', () => {
    for (const sql of [
      'begin; create table items (id text); commit;',
      'rollback;',
      'savepoint before_items;',
    ]) {
      expect(() => assertHostedMigrationIsAdditive(migration('000002_bad', sql)))
        .toThrow(HostedMigrationError)
    }

    expect(() => assertHostedMigrationIsAdditive(migration('000002_trigger', `
      create function reject_item_mutation()
      returns trigger language plpgsql as $body$
      begin
        raise exception 'append-only';
      end;
      $body$;
    `))).not.toThrow()
  })

  it('rejects edited and deleted immutable source history', () => {
    const current = hostedMigrations[0]!
    expect(() => planHostedMigrations(hostedMigrations, [{
      id: current.id,
      checksum: '0'.repeat(64),
    }])).toThrow('edited checksum')
    expect(() => planHostedMigrations(hostedMigrations, [{
      id: '000000_deleted',
      checksum: '0'.repeat(64),
    }])).toThrow('absent from source history')
    expect(() => assertHostedMigrationManifest([], HOSTED_MIGRATION_CHECKSUMS))
      .toThrow('deleted')

    const draft = migration('000001_draft', 'create table draft_items (id text primary key);')
    const finalized = migration('000002_finalized', 'create table finalized_items (id text primary key);')
    expect(() => assertHostedMigrationManifest([draft, finalized], {
      [draft.id]: '0'.repeat(64),
      [finalized.id]: hostedMigrationChecksum(finalized.sql),
    })).toThrow('Finalize checksums in source order')
  })

  it('dry-runs without writes and serializes concurrent runners under one advisory transaction lock', async () => {
    const fake = fakeRunnerDb()
    const expectedIds = runnableHostedMigrations.map(({ id }) => id)
    const dryRun = await runHostedMigrations(fake.db, { dryRun: true })
    expect(dryRun.pending).toEqual(expectedIds)
    expect(fake.historyTableCreated()).toBe(false)

    const [first, second] = await Promise.all([
      runHostedMigrations(fake.db),
      runHostedMigrations(fake.db),
    ])
    expect(first.applied).toEqual(expectedIds)
    expect(second.applied).toEqual(expectedIds)
    expect(fake.migrationExecutions()).toBe(1)
    expect(fake.lockCalls()).toBe(2)
    expect(fake.history()).toHaveLength(expectedIds.length)
  })
})

describe('FUMA-006 hosted startup guard', () => {
  it('accepts PostgreSQL URLs and a PostgreSQL client', async () => {
    const fake = fakeRunnerDb()
    expect(() => assertFumaHostedDatabaseUrl('postgres://fixture.invalid/fuma')).not.toThrow()
    expect(() => assertFumaHostedDatabaseUrl('postgresql://fixture.invalid/fuma')).not.toThrow()
    await expect(assertFumaHostedStartup({
      db: fake.db,
      databaseUrl: 'postgres://fixture.invalid/fuma',
    })).resolves.toBeUndefined()
  })

  it('rejects every non-PostgreSQL database URL', () => {
    for (const value of ['sqlite:./legacy.db', 'file:/tmp/legacy.db', '/tmp/legacy.db', ':memory:']) {
      expect(() => assertFumaHostedDatabaseUrl(value)).toThrow(FumaHostedStartupError)
    }
  })
})
