import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import {
  PostgresEditorScopedStorage,
  type EditorScopedStorageKey,
  type EditorScopedStoragePrefix,
} from '../../../server/fuma/editor'
import { editorResourcesMigration } from '../../../server/fuma/db/migrations/000010_editor_resources'
import {
  HOSTED_MIGRATION_CHECKSUMS,
  hostedMigrations,
  runnableHostedMigrations,
} from '../../../server/fuma/db/migrations'
import {
  assertHostedMigrationIsAdditive,
  hostedMigrationChecksum,
  nextHostedMigrationId,
} from '../../../server/fuma/db/migrationPolicy'
import type { FumaRepositoryScopeCoordinate } from '../../../server/fuma/tenancy'

const MIGRATION_CHECKSUM = '71f39c0c8fbbd4fdd1aa6686ad098a5fb53ea01b562ee0548e4458d8ba1027e1'
const COORDINATE: FumaRepositoryScopeCoordinate = {
  platformId: 'platform-fuma',
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
}
const KEY: EditorScopedStorageKey = {
  platformId: COORDINATE.platformId,
  ownerKey: 'owner-a',
  generation: 7,
  resourceKind: 'page',
  logicalId: 'page-a',
}
const PREFIX: EditorScopedStoragePrefix = {
  platformId: KEY.platformId,
  ownerKey: KEY.ownerKey,
  generation: KEY.generation,
  resourceKind: KEY.resourceKind,
}

type CapturedCall = Readonly<{
  sql: string
  parameters: readonly unknown[]
}>

interface ResourceFixture {
  platform_id: string
  owner_key: string
  owner_generation: string | number | bigint
  resource_kind: string
  logical_id: string
  value_json: unknown
}

function result<Row>(rows: Row[]): DbResult<Row> {
  return { rows, rowCount: rows.length }
}

function normalized(sql: string): string {
  return sql.replaceAll(/\s+/g, ' ').trim().toLowerCase()
}

class RecordingEditorDb {
  calls: CapturedCall[] = []
  resources: ResourceFixture[] = []
  authorityGeneration: string | number | bigint = 7n
  transactions = 0
  rollbacks = 0
  readonly client: DbClient

  constructor() {
    const query = (async <Row = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<DbResult<Row>> => {
      const sql = strings.join('?')
      this.calls.push({ sql, parameters: structuredClone(values) })
      const compact = normalized(sql)
      if (compact.includes('from fuma_tenant_owner_keys')) {
        const rows = [{
          platform_id: COORDINATE.platformId,
          organization_id: COORDINATE.organizationId,
          workspace_id: COORDINATE.workspaceId,
          site_id: COORDINATE.siteId,
          owner_key: KEY.ownerKey,
          state: 'active',
          generation: this.authorityGeneration,
          transfer_fence: null,
        }]
        return result(rows as unknown as Row[])
      }
      if (compact.startsWith('select platform_id, owner_key, owner_generation')) {
        const rows = compact.includes('and logical_id = ?')
          ? this.resources.filter((row) => (
              row.platform_id === values[0]
              && row.owner_key === values[1]
              && Number(row.owner_generation) === values[2]
              && row.resource_kind === values[3]
              && row.logical_id === values[4]
            )).slice(0, 1)
          : this.resources.filter((row) => (
              row.platform_id === values[0]
              && row.owner_key === values[1]
              && Number(row.owner_generation) === values[2]
              && row.resource_kind === values[3]
            )).toSorted((left, right) => left.logical_id.localeCompare(right.logical_id))
        return result(structuredClone(rows) as unknown as Row[])
      }
      return result<Row>([])
    }) as DbClient
    query.unsafe = async () => {
      throw new Error('Editor storage must not require unsafe SQL.')
    }
    query.transaction = async <T>(work: (tx: DbClient) => Promise<T>): Promise<T> => {
      this.transactions += 1
      try {
        return await work(query)
      } catch (error) {
        this.rollbacks += 1
        throw error
      }
    }
    this.client = Object.assign(query, { dialect: 'postgres' as const })
  }
}

function resource(logicalId: string, value: unknown): ResourceFixture {
  return {
    platform_id: KEY.platformId,
    owner_key: KEY.ownerKey,
    owner_generation: 7n,
    resource_kind: KEY.resourceKind,
    logical_id: logicalId,
    value_json: value,
  }
}

function query(capture: RecordingEditorDb, prefix: string): CapturedCall {
  const call = capture.calls.find(({ sql }) => normalized(sql).startsWith(prefix))
  if (!call) throw new Error(`Missing recorded query: ${prefix}`)
  return call
}

describe('FUMA-027 PostgreSQL editor scoped storage', () => {
  it('exposes one atomic transaction boundary', async () => {
    expect(Object.getOwnPropertyNames(PostgresEditorScopedStorage.prototype).sort()).toEqual([
      'constructor',
      'transaction',
    ])

    const capture = new RecordingEditorDb()
    const storage = new PostgresEditorScopedStorage(capture.client)
    await expect(storage.transaction(async (transaction) => {
      await transaction.put(KEY, { id: KEY.logicalId })
      throw new Error('injected transaction failure')
    })).rejects.toThrow('injected transaction failure')
    expect(capture.transactions).toBe(1)
    expect(capture.rollbacks).toBe(1)
  })

  it('locks and maps exact active scope authority before repository operations', async () => {
    const capture = new RecordingEditorDb()
    const storage = new PostgresEditorScopedStorage(capture.client)

    const authority = await storage.transaction(async (transaction) => (
      await transaction.loadScopeAuthorityForUpdate(COORDINATE)
    ))

    expect(authority).toEqual({
      ...COORDINATE,
      ownerKey: KEY.ownerKey,
      state: 'active',
      generation: KEY.generation,
      transferFence: null,
    })
    const call = query(capture, 'select platform_id, organization_id')
    expect(normalized(call.sql)).toContain(
      "where platform_id = ? and organization_id = ? and workspace_id = ? and site_id = ? and state = 'active' and transfer_id is null and transfer_lock_id is null and transfer_fence is null for update",
    )
    expect(call.parameters).toEqual(Object.values(COORDINATE))
  })

  it('uses every owner-generation predicate and deterministic list order', async () => {
    const capture = new RecordingEditorDb()
    capture.resources = [
      resource('page-b', { id: 'page-b', title: 'B' }),
      resource('page-a', { id: 'page-a', title: 'A' }),
    ]
    const storage = new PostgresEditorScopedStorage(capture.client)

    const values = await storage.transaction(async (transaction) => {
      const found = await transaction.get(KEY)
      const listed = await transaction.list(PREFIX)
      await transaction.put(KEY, { id: KEY.logicalId, nested: { valid: true } })
      await transaction.delete(KEY)
      await transaction.deletePrefix(PREFIX)
      return { found, listed }
    })

    expect(values.found).toEqual({ id: 'page-a', title: 'A' })
    expect(values.listed.map(({ key }) => key.logicalId)).toEqual(['page-a', 'page-b'])

    const exactPredicates = 'where platform_id = ? and owner_key = ? and owner_generation = ? and resource_kind = ?'
    const getCall = query(capture, 'select platform_id, owner_key, owner_generation')
    expect(normalized(getCall.sql)).toContain(`${exactPredicates} and logical_id = ?`)
    expect(getCall.parameters).toEqual(Object.values(KEY))

    const listCall = capture.calls.find(({ sql }) => normalized(sql).includes('order by logical_id'))!
    expect(normalized(listCall.sql)).toContain(`${exactPredicates} order by logical_id`)
    expect(listCall.parameters).toEqual(Object.values(PREFIX))

    const putCall = query(capture, 'insert into fuma_editor_resources')
    expect(normalized(putCall.sql)).toContain(
      'on conflict ( platform_id, owner_key, owner_generation, resource_kind, logical_id ) do update set value_json = excluded.value_json',
    )
    expect(putCall.parameters.slice(0, 5)).toEqual(Object.values(KEY))
    expect(putCall.parameters[5]).toBe('{"id":"page-a","nested":{"valid":true}}')

    const deletes = capture.calls.filter(({ sql }) => normalized(sql).startsWith(
      'delete from fuma_editor_resources',
    ))
    expect(normalized(deletes[0]!.sql)).toContain(`${exactPredicates} and logical_id = ?`)
    expect(deletes[0]!.parameters).toEqual(Object.values(KEY))
    expect(normalized(deletes[1]!.sql)).toContain(exactPredicates)
    expect(deletes[1]!.parameters).toEqual(Object.values(PREFIX))
  })

  it('rejects malformed keys, writes, authority, and hydrated JSON at the boundary', async () => {
    const capture = new RecordingEditorDb()
    const storage = new PostgresEditorScopedStorage(capture.client)
    const malformedKey = { ...KEY, logicalId: '' } as EditorScopedStorageKey

    await expect(storage.transaction(async (transaction) => (
      await transaction.get(malformedKey)
    ))).rejects.toThrow('Editor storage key failed editor PostgreSQL storage validation.')
    expect(capture.calls).toHaveLength(0)

    await expect(storage.transaction(async (transaction) => (
      await transaction.put(KEY, { id: KEY.logicalId, invalid: 1n })
    ))).rejects.toThrow('Editor resource JSON failed editor PostgreSQL storage validation.')
    expect(capture.calls).toHaveLength(0)

    capture.resources = [resource(KEY.logicalId, { id: KEY.logicalId, invalid: undefined })]
    await expect(storage.transaction(async (transaction) => (
      await transaction.get(KEY)
    ))).rejects.toThrow('Editor resource JSON failed editor PostgreSQL storage validation.')

    capture.authorityGeneration = '9007199254740992'
    await expect(storage.transaction(async (transaction) => (
      await transaction.loadScopeAuthorityForUpdate(COORDINATE)
    ))).rejects.toThrow('Editor owner generation failed editor PostgreSQL storage validation.')
  })
})

describe('FUMA-027 editor resource hosted migration', () => {
  it('preserves checksum-finalized migration 000010 before later additive migrations', () => {
    const migrationIndex = hostedMigrations.indexOf(editorResourcesMigration)
    expect(migrationIndex).toBe(9)
    expect(nextHostedMigrationId(hostedMigrations.slice(0, migrationIndex), 'editor resources'))
      .toBe(editorResourcesMigration.id)
    expect(hostedMigrations.slice(0, migrationIndex).map(({ id }) => id)).toEqual([
      '000001_transition_bookkeeping',
      '000002_durable_jobs',
      '000003_staff_identity',
      '000004_organizations',
      '000005_workspaces',
      '000006_sites',
      '000007_audit_history',
      '000008_transfer_saga',
      '000009_tenant_keys',
    ])
    expect(HOSTED_MIGRATION_CHECKSUMS[editorResourcesMigration.id])
      .toBe(MIGRATION_CHECKSUM)
    expect(hostedMigrationChecksum(editorResourcesMigration.sql)).toBe(MIGRATION_CHECKSUM)
    expect(runnableHostedMigrations).toEqual(hostedMigrations.slice(0, 77))
    expect(runnableHostedMigrations.at(-1)?.id).toBe('000077_public_handoff_authority')
    expect(() => assertHostedMigrationIsAdditive(editorResourcesMigration)).not.toThrow()
  })

  it('creates one additive JSONB table with strict owner-generation identity', () => {
    const sql = normalized(editorResourcesMigration.sql)
    expect(sql.match(/create table /g)).toHaveLength(1)
    expect(sql).not.toMatch(/\b(?:alter|drop|truncate)\b/)
    expect(sql).not.toContain('delete from')
    expect(sql).toContain('create table fuma_editor_resources')
    expect(sql).toContain(
      'primary key ( platform_id, owner_key, owner_generation, resource_kind, logical_id )',
    )
    expect(sql).toContain('owner_generation bigint not null check (owner_generation > 0)')
    expect(sql).toContain(
      "resource_kind text not null check ( resource_kind in ('site-shell', 'page', 'component', 'layout') )",
    )
    expect(sql).toContain('value_json jsonb not null')
    expect(sql).toContain("jsonb_typeof(value_json) = 'object'")
    expect(sql).toContain(
      'foreign key (platform_id, owner_key) references fuma_tenant_owner_keys(platform_id, owner_key) on update cascade on delete restrict',
    )
    expect(sql).toContain('constraint fuma_editor_resources_identity_nonempty check')
    expect(sql).toContain('create index fuma_editor_resources_logical_identity_idx')
  })
})
