import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import type { TenantObjectStorage } from '../../../server/fuma/objectStorage'
import {
  PostgresReleaseRepository,
  ReleaseRepositoryError,
  createPostgresReleaseComposition,
  validateActiveReleasePointer,
  validateReleaseRecord,
  validateReleaseRetentionRoot,
} from '../../../server/fuma/releases'
import {
  RELEASE_FIXTURE_SCOPE_A,
  RELEASE_FIXTURE_SOURCE_HASH,
  RELEASE_FIXTURE_TIME,
} from '../helpers/fuma/releaseFixture'

type Call = Readonly<{ sql: string; values: readonly unknown[] }>

function result<Row>(rows: Row[], rowCount = rows.length): DbResult<Row> {
  return { rows, rowCount }
}

function compact(sql: string): string {
  return sql.replaceAll(/\s+/g, ' ').trim().toLowerCase()
}

class RecordingReleaseDb {
  calls: Call[] = []
  authorize = true
  transactions = 0
  rollbacks = 0
  readonly client: DbClient

  constructor(dialect: 'postgres' | 'sqlite' = 'postgres') {
    const query = (async <Row = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<DbResult<Row>> => {
      const sql = strings.join('?')
      this.calls.push({ sql, values: structuredClone(values) })
      const normalized = compact(sql)
      if (normalized.startsWith('select 1 as authorized')) {
        return result(this.authorize ? [{ authorized: 1 }] as unknown as Row[] : [])
      }
      if (normalized.startsWith('select platform_id') || normalized.startsWith('select platform_id,')) {
        return result<Row>([])
      }
      return result<Row>([], 1)
    }) as DbClient
    query.unsafe = async () => { throw new Error('release repository must not use unsafe SQL') }
    query.transaction = async <T>(work: (db: DbClient) => Promise<T>): Promise<T> => {
      this.transactions += 1
      try {
        return await work(query)
      } catch (error) {
        this.rollbacks += 1
        throw error
      }
    }
    this.client = Object.assign(query, { dialect })
  }
}

function queued(version = 1) {
  return validateReleaseRecord({
    platformId: RELEASE_FIXTURE_SCOPE_A.platformId,
    ownerKey: RELEASE_FIXTURE_SCOPE_A.ownerKey,
    organizationId: RELEASE_FIXTURE_SCOPE_A.organizationId,
    workspaceId: RELEASE_FIXTURE_SCOPE_A.workspaceId,
    siteId: RELEASE_FIXTURE_SCOPE_A.siteId,
    releaseId: 'release-recording',
    sourceSnapshotHashSha256: RELEASE_FIXTURE_SOURCE_HASH,
    status: 'queued',
    buildClaim: null,
    manifest: null,
    failure: null,
    version,
    queuedAt: RELEASE_FIXTURE_TIME,
    buildingAt: null,
    readyAt: null,
    activatedAt: null,
    failedAt: null,
    updatedAt: RELEASE_FIXTURE_TIME,
  })
}

describe('FUMA-048 PostgreSQL release repository', () => {
  it('requires PostgreSQL and denies stale current owner authority before work', async () => {
    expect(() => new PostgresReleaseRepository(new RecordingReleaseDb('sqlite').client))
      .toThrow('Fuma releases require PostgreSQL authority.')
    const capture = new RecordingReleaseDb()
    capture.authorize = false
    const repository = new PostgresReleaseRepository(capture.client)
    let invoked = false
    await expect(repository.forScope(RELEASE_FIXTURE_SCOPE_A).transaction(async () => {
      invoked = true
    })).rejects.toBeInstanceOf(ReleaseRepositoryError)
    expect(invoked).toBe(false)
    expect(capture.rollbacks).toBe(1)
  })

  it('revalidates exact ancestry, stable owner, generation, and null transfer authority', async () => {
    const capture = new RecordingReleaseDb()
    const repository = new PostgresReleaseRepository(capture.client)
    await repository.forScope(RELEASE_FIXTURE_SCOPE_A).read('release-recording')

    const authority = capture.calls.find(({ sql }) => compact(sql).startsWith('select 1 as authorized'))!
    expect(compact(authority.sql)).toContain(
      "where platform_id = ? and owner_key = ? and organization_id = ? and workspace_id = ? and site_id = ? and generation = ? and state = 'active' and transfer_id is null and transfer_lock_id is null and transfer_fence is null for share",
    )
    expect(authority.values).toEqual([
      RELEASE_FIXTURE_SCOPE_A.platformId,
      RELEASE_FIXTURE_SCOPE_A.ownerKey,
      RELEASE_FIXTURE_SCOPE_A.organizationId,
      RELEASE_FIXTURE_SCOPE_A.workspaceId,
      RELEASE_FIXTURE_SCOPE_A.siteId,
      RELEASE_FIXTURE_SCOPE_A.generation,
    ])
    const read = capture.calls.find(({ sql }) => compact(sql).includes('from fuma_releases'))!
    expect(compact(read.sql)).toContain(
      'where platform_id = ? and owner_key = ? and organization_id = ? and workspace_id = ? and site_id = ? and release_id = ? for update',
    )
  })

  it('rejects foreign record coordinates at the bound repository boundary', async () => {
    const capture = new RecordingReleaseDb()
    const bound = new PostgresReleaseRepository(capture.client).forScope(RELEASE_FIXTURE_SCOPE_A)
    const foreign = { ...queued(), organizationId: 'organization-foreign' }
    await expect(bound.transaction(async (transaction) => (
      await transaction.insert(foreign)
    ))).rejects.toBeInstanceOf(ReleaseRepositoryError)
    expect(capture.calls.some(({ sql }) => compact(sql).startsWith('insert into fuma_releases')))
      .toBe(false)
  })

  it('keeps records, pointer, roots, and deletion inside one rollback-capable transaction', async () => {
    const capture = new RecordingReleaseDb()
    const repository = new PostgresReleaseRepository(capture.client)
    const bound = repository.forScope(RELEASE_FIXTURE_SCOPE_A)
    const record = queued()
    const updated = queued(2)
    const pointer = validateActiveReleasePointer({
      platformId: record.platformId,
      ownerKey: record.ownerKey,
      organizationId: record.organizationId,
      workspaceId: record.workspaceId,
      siteId: record.siteId,
      releaseId: record.releaseId,
      version: 1,
      activatedAt: RELEASE_FIXTURE_TIME,
    })
    const root = validateReleaseRetentionRoot({
      platformId: record.platformId,
      ownerKey: record.ownerKey,
      organizationId: record.organizationId,
      workspaceId: record.workspaceId,
      siteId: record.siteId,
      releaseId: record.releaseId,
      rootId: 'rollback-window',
      kind: 'manual',
      createdAt: RELEASE_FIXTURE_TIME,
    })

    await expect(bound.transaction(async (transaction) => {
      expect(await transaction.insert(record)).toBe(true)
      expect(await transaction.update(updated, 1)).toBe(true)
      expect(await transaction.putActivePointer(pointer, null)).toBe(true)
      expect(await transaction.insertRetentionRoot(root)).toBe(true)
      expect(await transaction.deleteRetentionRoot(root.rootId, 'manual')).toBe(true)
      expect(await transaction.deleteRelease(record.releaseId, 2)).toBe(true)
      throw new Error('injected rollback')
    })).rejects.toThrow('injected rollback')
    expect(capture.transactions).toBe(1)
    expect(capture.rollbacks).toBe(1)

    for (const call of capture.calls.filter(({ sql }) => /(?:update|delete) fuma_|delete from fuma_/.test(compact(sql)))) {
      expect(compact(call.sql)).toContain('platform_id = ?')
      expect(compact(call.sql)).toContain('owner_key = ?')
      expect(compact(call.sql)).toContain('organization_id = ?')
      expect(compact(call.sql)).toContain('workspace_id = ?')
      expect(compact(call.sql)).toContain('site_id = ?')
    }
  })

  it('composes the production service with the durable PostgreSQL repository only', () => {
    const postgres = new RecordingReleaseDb('postgres')
    const composition = createPostgresReleaseComposition({
      db: postgres.client,
      objectStorage: {} as TenantObjectStorage,
      now: () => new Date(RELEASE_FIXTURE_TIME),
    })
    expect(Object.isFrozen(composition)).toBe(true)
    expect(composition.repository).toBeInstanceOf(PostgresReleaseRepository)
    expect(() => createPostgresReleaseComposition({
      db: new RecordingReleaseDb('sqlite').client,
      objectStorage: {} as TenantObjectStorage,
    })).toThrow('Fuma releases require PostgreSQL authority.')
  })
})
