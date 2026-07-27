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
  FUMA_TRANSITION_COMMAND,
  FumaHostedStartupError,
  assertFumaHostedDatabaseUrl,
  assertFumaHostedStartup,
} from '../../../server/fuma/startupGuard'
import {
  calculateArtifactHash,
  canonicalJson,
  sha256,
  tableContentHash,
  validateLegacyTransitionArtifact,
  type LegacyTransitionArtifact,
} from '../../../server/fuma/transition/artifact'
import { exportLegacySqlite, summarizeLegacyExport } from '../../../server/fuma/transition/exportLegacySqlite'
import {
  LegacyImportCountMismatchError,
  LegacyImportForeignKeyMismatchError,
  LegacyImportHashMismatchError,
  assertLegacyTableValidation,
  importLegacySqliteToPostgres,
} from '../../../server/fuma/transition/importLegacyPostgres'
import { createLegacySqliteTransitionSource } from '../helpers/fuma/legacySqliteTransitionSource'

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

function oneTableArtifact(): LegacyTransitionArtifact {
  const tableWithoutHash = {
    name: 'fixture_items',
    columns: [
      { name: 'id', declaredType: 'TEXT', notNull: true, primaryKeyPosition: 1 },
      { name: 'value', declaredType: 'TEXT', notNull: true, primaryKeyPosition: 0 },
    ],
    foreignKeys: [],
    rows: [{
      id: { kind: 'string' as const, value: 'item-1' },
      value: { kind: 'string' as const, value: 'preserved' },
    }],
  }
  const table = { ...tableWithoutHash, contentHash: tableContentHash(tableWithoutHash) }
  const schemaMigrationIds = ['legacy-001']
  const sourceFingerprint = sha256(canonicalJson({
    schemaMigrationIds,
    tables: [{ name: table.name, contentHash: table.contentHash, rowCount: table.rows.length }],
  }))
  const withoutHash = {
    format: 'fuma-legacy-sqlite-v1' as const,
    sourceFingerprint,
    schemaMigrationIds,
    tables: [table],
  }
  return validateLegacyTransitionArtifact({
    ...withoutHash,
    artifactHash: calculateArtifactHash(withoutHash),
  })
}

function fakeImportDb(): { db: DbClient; rowWrites: () => number } {
  let receipt: { artifact_hash: string; state: 'running' | 'complete' } | null = null
  let progress: { table_name: string; row_count: number; content_hash: string } | null = null
  const items = new Map<string, { id: string; value: string }>()
  let writes = 0
  const fn = (async <Row = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>> => {
    const sql = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase()
    if (sql.includes('select artifact_hash, state from fuma_legacy_imports')) {
      const result = receipt ? [receipt] : []
      return { rows: result as Row[], rowCount: result.length }
    }
    if (sql.includes('from information_schema.columns')) {
      const result = [
        { column_name: 'id', data_type: 'text', is_nullable: 'NO' },
        { column_name: 'value', data_type: 'text', is_nullable: 'NO' },
      ]
      return { rows: result as Row[], rowCount: result.length }
    }
    if (sql.includes('insert into fuma_legacy_imports')) {
      receipt = { artifact_hash: String(values[1]), state: 'running' }
      return noRows<Row>()
    }
    if (sql.includes('select table_name, row_count, content_hash')) {
      const result = progress ? [progress] : []
      return { rows: result as Row[], rowCount: result.length }
    }
    if (sql.includes('insert into fuma_legacy_import_tables')) {
      progress = {
        table_name: String(values[1]),
        row_count: Number(values[2]),
        content_hash: String(values[3]),
      }
      return noRows<Row>()
    }
    if (sql.includes('update fuma_legacy_imports')) {
      if (!receipt) throw new Error('missing fake import receipt')
      receipt.state = 'complete'
      return noRows<Row>()
    }
    return noRows<Row>()
  }) as DbClient
  fn.unsafe = async <Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<DbResult<Row>> => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (normalized.startsWith('insert into "fixture_items"')) {
      items.set(String(params![0]), { id: String(params![0]), value: String(params![1]) })
      writes += 1
      return noRows<Row>()
    }
    if (normalized.startsWith('select count(*) as count from "fixture_items"')) {
      return { rows: [{ count: items.size }] as Row[], rowCount: 1 }
    }
    if (normalized.startsWith('select "id", "value" from "fixture_items"')) {
      const result = [...items.values()].sort((left, right) => left.id.localeCompare(right.id))
      return { rows: result as Row[], rowCount: result.length }
    }
    return noRows<Row>()
  }
  fn.transaction = async <T>(callback: (tx: DbClient) => Promise<T>) => await callback(fn)
  Object.defineProperty(fn, 'dialect', { value: 'postgres' })
  return { db: fn, rowWrites: () => writes }
}

describe('FUMA-006 legacy transition validation', () => {
  it('exports the existing branded FUMA-002 fixture with stable counts and hashes', async () => {
    const source = await createLegacySqliteTransitionSource('fuma-006-demo')
    try {
      const artifact = await exportLegacySqlite(source.db)
      const repeatedArtifact = await exportLegacySqlite(source.db)
      const summary = summarizeLegacyExport(artifact)
      expect(repeatedArtifact).toEqual(artifact)
      expect(validateLegacyTransitionArtifact(artifact)).toEqual(artifact)
      expect(summary.tableCount).toBe(33)
      expect(summary.rowCount).toBe(14)
      expect(summary.tableHashes.find(({ table }) => table === 'users')?.rowCount).toBe(1)
      expect(summary.tableHashes.find(({ table }) => table === 'data_rows')?.rowCount).toBe(2)
      expect(summary.sourceFingerprint).toHaveLength(64)
      expect(summary.artifactHash).toHaveLength(64)
      process.stdout.write(`${JSON.stringify(summary)}\n`)
    } finally {
      await source.cleanup()
    }
  })

  it('rejects count, content hash, and foreign-key mismatches independently', () => {
    const valid = {
      table: 'data_rows',
      expectedCount: 2,
      actualCount: 2,
      expectedHash: 'a',
      actualHash: 'a',
      foreignKeyViolations: [{ column: 'table_id', count: 0 }],
    }
    expect(() => assertLegacyTableValidation({ ...valid, actualCount: 1 }))
      .toThrow(LegacyImportCountMismatchError)
    expect(() => assertLegacyTableValidation({ ...valid, actualHash: 'b' }))
      .toThrow(LegacyImportHashMismatchError)
    expect(() => assertLegacyTableValidation({
      ...valid,
      foreignKeyViolations: [{ column: 'table_id', count: 1 }],
    })).toThrow(LegacyImportForeignKeyMismatchError)
  })

  it('resumes a completed duplicate import without writing rows again', async () => {
    const artifact = oneTableArtifact()
    const fake = fakeImportDb()
    const first = await importLegacySqliteToPostgres(fake.db, artifact)
    const writesAfterFirst = fake.rowWrites()
    const resumed = await importLegacySqliteToPostgres(fake.db, artifact)

    expect(first.complete).toBe(true)
    expect(first.importedTables).toEqual(['fixture_items'])
    expect(resumed.complete).toBe(true)
    expect(resumed.importedTables).toEqual([])
    expect(resumed.resumedTables).toEqual(['fixture_items'])
    expect(fake.rowWrites()).toBe(writesAfterFirst)
  })
})

describe('FUMA-006 hosted startup guard', () => {
  it('refuses SQLite after cutover with the actionable transition command', () => {
    expect(() => assertFumaHostedDatabaseUrl('sqlite:./legacy.db')).toThrow(FumaHostedStartupError)
    try {
      assertFumaHostedDatabaseUrl('sqlite:./legacy.db')
    } catch (error) {
      expect((error as FumaHostedStartupError).action).toBe(FUMA_TRANSITION_COMMAND)
      expect((error as Error).message).not.toContain('./legacy.db')
    }
  })

  it('refuses to silently discard a configured SQLite source without a completed receipt', async () => {
    const fn = (async <Row = Record<string, unknown>>(): Promise<DbResult<Row>> => ({
      rows: [{ count: 0 }] as Row[],
      rowCount: 1,
    })) as DbClient
    fn.unsafe = async <Row = Record<string, unknown>>() => noRows<Row>()
    fn.transaction = async <T>(callback: (tx: DbClient) => Promise<T>) => await callback(fn)
    Object.defineProperty(fn, 'dialect', { value: 'postgres' })

    await expect(assertFumaHostedStartup({
      db: fn,
      databaseUrl: 'postgres://fixture.invalid/fuma',
      legacySqliteConfigured: true,
    })).rejects.toThrow('refusing silent data discard')
  })
})

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL

function flattenNestedTransactions(db: DbClient): DbClient {
  const fn = (async <Row = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>> => await db<Row>(strings, ...values)) as DbClient
  fn.unsafe = async <Row = Record<string, unknown>>(sql: string, params?: unknown[]) => (
    params === undefined ? await db.unsafe<Row>(sql) : await db.unsafe<Row>(sql, params)
  )
  fn.transaction = async <T>(callback: (tx: DbClient) => Promise<T>): Promise<T> => await callback(fn)
  Object.defineProperty(fn, 'dialect', { value: 'postgres' })
  return fn
}

it.skipIf(postgresUrl === undefined)(
  'FUMA-006 live PostgreSQL: branded legacy fixture imports with preserved links and resumes without duplicate writes',
  async () => {
    if (postgresUrl === undefined) throw new Error('FUMA_TEST_POSTGRES_URL is required')
    const [{ createPostgresClient }, { pgMigrations }, { runMigrations }, { importLegacySqliteToPostgres }] = await Promise.all([
      import('../../../server/db/postgres'),
      import('../../../server/db/migrations-pg'),
      import('../../../server/db/runMigrations'),
      import('../../../server/fuma/transition/importLegacyPostgres'),
    ])
    const admin = createPostgresClient(postgresUrl)
    const source = await createLegacySqliteTransitionSource('fuma-006-live-demo')
    const rollback = new Error('rollback-fuma-006-live-demo')
    let demonstrated = false

    try {
      await admin.transaction(async (transaction) => {
        const schema = `fuma_transition_${process.pid}`
        await transaction.unsafe(`create schema "${schema}"`)
        await transaction.unsafe(`set local search_path to "${schema}"`)
        const db = flattenNestedTransactions(transaction)
        await runMigrations(db, pgMigrations)
        await runHostedMigrations(db)
        const artifact = await exportLegacySqlite(source.db)
        const first = await importLegacySqliteToPostgres(db, artifact)
        const resumed = await importLegacySqliteToPostgres(db, artifact)
        await assertFumaHostedStartup({
          db,
          databaseUrl: postgresUrl,
          legacySqliteConfigured: true,
        })

        const users = await db<{ id: string }>`select id from users where id = ${source.stableIds.ownerUserId}`
        const legacyCredential = await source.db<{ password_hash: string }>`
          select password_hash from users where id = ${source.stableIds.ownerUserId}
        `
        const identityLinks = await db<{ legacy_user_id: string; auth_user_id: string; password: string }>`
          select links.legacy_user_id, links.auth_user_id, accounts.password
          from auth_legacy_identity_links links
          join auth_accounts accounts on accounts.user_id = links.auth_user_id
          where links.legacy_user_id = ${source.stableIds.ownerUserId}
            and accounts.provider_id = 'credential'
        `
        const rows = await db<{ id: string; active_version_id: string | null; author_user_id: string | null }>`
          select id, active_version_id, author_user_id from data_rows
          where id in (${source.stableIds.pageRowId}, ${source.stableIds.postRowId})
          order by id
        `
        expect(first.complete).toBe(true)
        expect(first.importedTables).toHaveLength(33)
        expect(resumed.complete).toBe(true)
        expect(resumed.importedTables).toEqual([])
        expect(resumed.resumedTables).toHaveLength(33)
        expect(users.rows).toEqual([{ id: source.stableIds.ownerUserId }])
        expect(identityLinks.rows).toEqual([{
          legacy_user_id: source.stableIds.ownerUserId,
          auth_user_id: source.stableIds.ownerUserId,
          password: legacyCredential.rows[0]!.password_hash,
        }])
        expect(identityLinks.rows[0]!.password).toStartWith('$argon2id$')
        expect(rows.rows).toHaveLength(2)
        expect(rows.rows.find(({ id }) => id === source.stableIds.postRowId)?.active_version_id)
          .toBe(source.stableIds.postVersionId)
        expect(rows.rows.find(({ id }) => id === source.stableIds.postRowId)?.author_user_id)
          .toBe(source.stableIds.ownerUserId)
        demonstrated = true
        process.stdout.write(`${JSON.stringify({
          tableCount: first.tableCount,
          rowCount: first.rowCount,
          importedTables: first.importedTables.length,
          resumedTables: resumed.resumedTables.length,
          idsPreserved: true,
          authLinksPreserved: true,
          contentHashesValidated: true,
          foreignKeysValidated: true,
        })}\n`)
        throw rollback
      })
    } catch (error) {
      if (error !== rollback) throw error
    } finally {
      await source.cleanup()
    }
    expect(demonstrated).toBe(true)
  },
)
