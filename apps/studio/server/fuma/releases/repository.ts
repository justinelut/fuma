import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import {
  FumaRepositoryScopeSchema,
  type FumaRepositoryScope,
} from '../tenancy'
import {
  ActiveReleasePointerSchema,
  ReleaseBuildClaimSchema,
  ReleaseFailureSchema,
  type ActiveReleasePointer,
  type ReleaseBuildClaim,
  type ReleaseFailure,
  type ReleaseRecord,
  type ReleaseRetentionRoot,
  validateActiveReleasePointer,
  validateReleaseRecord,
  validateReleaseRetentionRoot,
} from './contracts'
import { assertReleaseManifest } from './manifest'

interface ReleaseRow {
  platform_id: string
  owner_key: string
  organization_id: string
  workspace_id: string
  site_id: string
  release_id: string
  source_snapshot_hash: string
  status: string
  build_job_id: string | null
  build_job_fence: string | number | bigint | null
  manifest_json: unknown | null
  failure_json: unknown | null
  version: string | number | bigint
  queued_at: string | Date
  building_at: string | Date | null
  ready_at: string | Date | null
  activated_at: string | Date | null
  failed_at: string | Date | null
  updated_at: string | Date
}

interface PointerRow {
  platform_id: string
  owner_key: string
  organization_id: string
  workspace_id: string
  site_id: string
  release_id: string
  version: string | number | bigint
  activated_at: string | Date
}

interface RootRow {
  platform_id: string
  owner_key: string
  organization_id: string
  workspace_id: string
  site_id: string
  root_id: string
  release_id: string
  kind: string
  created_at: string | Date
}

export interface ReleaseRepositoryTransaction {
  get(releaseId: string): Promise<ReleaseRecord | null>
  insert(record: ReleaseRecord): Promise<boolean>
  update(record: ReleaseRecord, expectedVersion: number): Promise<boolean>
  getActivePointer(): Promise<ActiveReleasePointer | null>
  putActivePointer(
    pointer: ActiveReleasePointer,
    expectedVersion: number | null,
  ): Promise<boolean>
  listRetentionRoots(releaseId: string): Promise<readonly ReleaseRetentionRoot[]>
  insertRetentionRoot(root: ReleaseRetentionRoot): Promise<boolean>
  deleteRetentionRoot(rootId: string, kind: 'active' | 'manual'): Promise<boolean>
  deleteRelease(releaseId: string, expectedVersion: number): Promise<boolean>
}

export interface BoundReleaseRepository {
  readonly scope: FumaRepositoryScope
  read(releaseId: string): Promise<ReleaseRecord | null>
  transaction<T>(work: (transaction: ReleaseRepositoryTransaction) => Promise<T>): Promise<T>
}

export interface ReleaseRepository {
  forScope(scope: FumaRepositoryScope): BoundReleaseRepository
}

export type ReleaseRepositoryErrorCode =
  | 'invalid-scope'
  | 'scope-transferring'
  | 'invalid-storage'

export class ReleaseRepositoryError extends Error {
  readonly code: ReleaseRepositoryErrorCode

  constructor(code: ReleaseRepositoryErrorCode, message: string) {
    super(message)
    this.name = 'ReleaseRepositoryError'
    this.code = code
  }
}

function bindScope(scope: FumaRepositoryScope): FumaRepositoryScope {
  const parsed = safeParseValue(FumaRepositoryScopeSchema, scope)
  if (!parsed.ok) {
    throw new ReleaseRepositoryError('invalid-scope', 'A valid release repository scope is required.')
  }
  if (parsed.value.state !== 'active' || parsed.value.transferFence !== null) {
    throw new ReleaseRepositoryError(
      'scope-transferring',
      'Release operations are blocked while site ownership is transferring.',
    )
  }
  return Object.freeze(structuredClone(parsed.value))
}

function positiveInteger(value: string | number | bigint, path: string): number {
  if (typeof value === 'string' && !/^[1-9][0-9]*$/.test(value)) invalid(path)
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric < 1) invalid(path)
  return numeric
}

function positiveFence(value: string | number | bigint | null, path: string): string {
  if (value === null) invalid(path)
  const text = String(value)
  if (!/^[1-9][0-9]*$/.test(text)) invalid(path)
  return text
}

function iso(value: string | Date | null, path: string): string | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) invalid(path)
  return date.toISOString()
}

function assertScopeIdentity(
  scope: FumaRepositoryScope,
  value: Readonly<{
    platformId: string
    ownerKey: string
    organizationId: string
    workspaceId: string
    siteId: string
  }>,
): void {
  if (value.platformId !== scope.platformId
    || value.ownerKey !== scope.ownerKey
    || value.organizationId !== scope.organizationId
    || value.workspaceId !== scope.workspaceId
    || value.siteId !== scope.siteId) {
    throw new ReleaseRepositoryError(
      'invalid-scope',
      'Release record identity does not match the bound repository scope.',
    )
  }
}

function invalid(path: string): never {
  throw new ReleaseRepositoryError(
    'invalid-storage',
    `Stored release authority failed validation at ${path}.`,
  )
}

function parseBuildClaim(row: ReleaseRow): ReleaseBuildClaim | null {
  if (row.build_job_id === null && row.build_job_fence === null) return null
  const value = {
    jobId: row.build_job_id,
    fence: positiveFence(row.build_job_fence, 'buildClaim.fence'),
  }
  const parsed = safeParseValue(ReleaseBuildClaimSchema, value)
  if (!parsed.ok) invalid('buildClaim')
  return parsed.value
}

function parseStoredJson(value: unknown, path: string): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch (_error) {
    return invalid(path)
  }
}

function parseManifest(value: unknown | null): ReleaseRecord['manifest'] {
  if (value === null) return null
  const decoded = parseStoredJson(value, 'manifest')
  try {
    assertReleaseManifest(decoded)
    return structuredClone(decoded)
  } catch (_error) {
    return invalid('manifest')
  }
}

function parseFailure(value: unknown | null): ReleaseFailure | null {
  if (value === null) return null
  const parsed = safeParseValue(ReleaseFailureSchema, parseStoredJson(value, 'failure'))
  if (!parsed.ok) invalid('failure')
  return parsed.value
}

function mapRelease(row: ReleaseRow): ReleaseRecord {
  return validateReleaseRecord({
    platformId: row.platform_id,
    ownerKey: row.owner_key,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    releaseId: row.release_id,
    sourceSnapshotHashSha256: row.source_snapshot_hash,
    status: row.status,
    buildClaim: parseBuildClaim(row),
    manifest: parseManifest(row.manifest_json),
    failure: parseFailure(row.failure_json),
    version: positiveInteger(row.version, 'version'),
    queuedAt: iso(row.queued_at, 'queuedAt'),
    buildingAt: iso(row.building_at, 'buildingAt'),
    readyAt: iso(row.ready_at, 'readyAt'),
    activatedAt: iso(row.activated_at, 'activatedAt'),
    failedAt: iso(row.failed_at, 'failedAt'),
    updatedAt: iso(row.updated_at, 'updatedAt'),
  })
}

function mapPointer(row: PointerRow): ActiveReleasePointer {
  return validateActiveReleasePointer({
    platformId: row.platform_id,
    ownerKey: row.owner_key,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    releaseId: row.release_id,
    version: positiveInteger(row.version, 'pointer.version'),
    activatedAt: iso(row.activated_at, 'pointer.activatedAt'),
  })
}

function mapRoot(row: RootRow): ReleaseRetentionRoot {
  return validateReleaseRetentionRoot({
    platformId: row.platform_id,
    ownerKey: row.owner_key,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    rootId: row.root_id,
    releaseId: row.release_id,
    kind: row.kind,
    createdAt: iso(row.created_at, 'root.createdAt'),
  })
}

class PostgresReleaseTransaction implements ReleaseRepositoryTransaction {
  readonly #db: DbClient
  readonly #scope: FumaRepositoryScope

  constructor(db: DbClient, scope: FumaRepositoryScope) {
    this.#db = db
    this.#scope = scope
  }

  async get(releaseId: string): Promise<ReleaseRecord | null> {
    const { rows } = await this.#db<ReleaseRow>`
      select platform_id, owner_key, organization_id, workspace_id, site_id,
        release_id, source_snapshot_hash, status, build_job_id, build_job_fence,
        manifest_json, failure_json, version, queued_at, building_at, ready_at,
        activated_at, failed_at, updated_at
      from fuma_releases
      where platform_id = ${this.#scope.platformId}
        and owner_key = ${this.#scope.ownerKey}
        and organization_id = ${this.#scope.organizationId}
        and workspace_id = ${this.#scope.workspaceId}
        and site_id = ${this.#scope.siteId}
        and release_id = ${releaseId}
      for update
    `
    return rows[0] ? mapRelease(rows[0]) : null
  }

  async insert(record: ReleaseRecord): Promise<boolean> {
    assertScopeIdentity(this.#scope, record)
    validateReleaseRecord(record)
    const { rowCount } = await this.#db`
      insert into fuma_releases (
        platform_id, owner_key, organization_id, workspace_id, site_id, release_id,
        source_snapshot_hash, status, build_job_id, build_job_fence, manifest_json,
        failure_json, version, queued_at, building_at, ready_at, activated_at,
        failed_at, updated_at
      ) values (
        ${record.platformId}, ${record.ownerKey}, ${record.organizationId},
        ${record.workspaceId}, ${record.siteId}, ${record.releaseId},
        ${record.sourceSnapshotHashSha256}, ${record.status},
        ${record.buildClaim?.jobId ?? null}, ${record.buildClaim?.fence ?? null},
        ${record.manifest === null ? null : JSON.stringify(record.manifest)}::text::jsonb,
        ${record.failure === null ? null : JSON.stringify(record.failure)}::text::jsonb,
        ${record.version}, ${record.queuedAt}, ${record.buildingAt}, ${record.readyAt},
        ${record.activatedAt}, ${record.failedAt}, ${record.updatedAt}
      ) on conflict (platform_id, owner_key, release_id) do nothing
    `
    return rowCount === 1
  }

  async update(record: ReleaseRecord, expectedVersion: number): Promise<boolean> {
    assertScopeIdentity(this.#scope, record)
    validateReleaseRecord(record)
    const { rowCount } = await this.#db`
      update fuma_releases set
        status = ${record.status},
        build_job_id = ${record.buildClaim?.jobId ?? null},
        build_job_fence = ${record.buildClaim?.fence ?? null},
        manifest_json = ${record.manifest === null ? null : JSON.stringify(record.manifest)}::text::jsonb,
        manifest_hash = ${record.manifest?.manifestHashSha256 ?? null},
        failure_json = ${record.failure === null ? null : JSON.stringify(record.failure)}::text::jsonb,
        version = ${record.version},
        building_at = ${record.buildingAt},
        ready_at = ${record.readyAt},
        activated_at = ${record.activatedAt},
        failed_at = ${record.failedAt},
        updated_at = ${record.updatedAt}
      where platform_id = ${this.#scope.platformId}
        and owner_key = ${this.#scope.ownerKey}
        and organization_id = ${this.#scope.organizationId}
        and workspace_id = ${this.#scope.workspaceId}
        and site_id = ${this.#scope.siteId}
        and release_id = ${record.releaseId}
        and version = ${expectedVersion}
    `
    return rowCount === 1
  }

  async getActivePointer(): Promise<ActiveReleasePointer | null> {
    const { rows } = await this.#db<PointerRow>`
      select platform_id, owner_key, organization_id, workspace_id, site_id,
        release_id, version, activated_at
      from fuma_release_active_pointers
      where platform_id = ${this.#scope.platformId}
        and owner_key = ${this.#scope.ownerKey}
        and organization_id = ${this.#scope.organizationId}
        and workspace_id = ${this.#scope.workspaceId}
        and site_id = ${this.#scope.siteId}
      for update
    `
    return rows[0] ? mapPointer(rows[0]) : null
  }

  async putActivePointer(
    pointer: ActiveReleasePointer,
    expectedVersion: number | null,
  ): Promise<boolean> {
    assertScopeIdentity(this.#scope, pointer)
    const parsed = safeParseValue(ActiveReleasePointerSchema, pointer)
    if (!parsed.ok) invalid('activePointer')
    if (expectedVersion === null) {
      const { rowCount } = await this.#db`
        insert into fuma_release_active_pointers (
          platform_id, owner_key, organization_id, workspace_id, site_id,
          release_id, version, activated_at
        ) values (
          ${pointer.platformId}, ${pointer.ownerKey}, ${pointer.organizationId},
          ${pointer.workspaceId}, ${pointer.siteId}, ${pointer.releaseId},
          ${pointer.version}, ${pointer.activatedAt}
        ) on conflict (platform_id, owner_key) do nothing
      `
      return rowCount === 1
    }
    const { rowCount } = await this.#db`
      update fuma_release_active_pointers set
        release_id = ${pointer.releaseId},
        version = ${pointer.version},
        activated_at = ${pointer.activatedAt}
      where platform_id = ${this.#scope.platformId}
        and owner_key = ${this.#scope.ownerKey}
        and organization_id = ${this.#scope.organizationId}
        and workspace_id = ${this.#scope.workspaceId}
        and site_id = ${this.#scope.siteId}
        and version = ${expectedVersion}
    `
    return rowCount === 1
  }

  async listRetentionRoots(releaseId: string): Promise<readonly ReleaseRetentionRoot[]> {
    const { rows } = await this.#db<RootRow>`
      select platform_id, owner_key, organization_id, workspace_id, site_id,
        root_id, release_id, kind, created_at
      from fuma_release_retention_roots
      where platform_id = ${this.#scope.platformId}
        and owner_key = ${this.#scope.ownerKey}
        and organization_id = ${this.#scope.organizationId}
        and workspace_id = ${this.#scope.workspaceId}
        and site_id = ${this.#scope.siteId}
        and release_id = ${releaseId}
      order by kind, root_id
      for update
    `
    return rows.map(mapRoot)
  }

  async insertRetentionRoot(root: ReleaseRetentionRoot): Promise<boolean> {
    assertScopeIdentity(this.#scope, root)
    validateReleaseRetentionRoot(root)
    const { rowCount } = await this.#db`
      insert into fuma_release_retention_roots (
        platform_id, owner_key, organization_id, workspace_id, site_id,
        root_id, release_id, kind, created_at
      ) values (
        ${root.platformId}, ${root.ownerKey}, ${root.organizationId},
        ${root.workspaceId}, ${root.siteId}, ${root.rootId}, ${root.releaseId},
        ${root.kind}, ${root.createdAt}
      ) on conflict (platform_id, owner_key, root_id) do nothing
    `
    return rowCount === 1
  }

  async deleteRetentionRoot(rootId: string, kind: 'active' | 'manual'): Promise<boolean> {
    const { rowCount } = await this.#db`
      delete from fuma_release_retention_roots
      where platform_id = ${this.#scope.platformId}
        and owner_key = ${this.#scope.ownerKey}
        and organization_id = ${this.#scope.organizationId}
        and workspace_id = ${this.#scope.workspaceId}
        and site_id = ${this.#scope.siteId}
        and root_id = ${rootId}
        and kind = ${kind}
    `
    return rowCount === 1
  }

  async deleteRelease(releaseId: string, expectedVersion: number): Promise<boolean> {
    const { rowCount } = await this.#db`
      delete from fuma_releases
      where platform_id = ${this.#scope.platformId}
        and owner_key = ${this.#scope.ownerKey}
        and organization_id = ${this.#scope.organizationId}
        and workspace_id = ${this.#scope.workspaceId}
        and site_id = ${this.#scope.siteId}
        and release_id = ${releaseId}
        and version = ${expectedVersion}
        and status <> 'active'
    `
    return rowCount === 1
  }
}

class BoundPostgresReleaseRepository implements BoundReleaseRepository {
  readonly scope: FumaRepositoryScope
  readonly #db: DbClient

  constructor(db: DbClient, scope: FumaRepositoryScope) {
    this.#db = db
    this.scope = bindScope(scope)
    Object.freeze(this)
  }

  read(releaseId: string): Promise<ReleaseRecord | null> {
    return this.transaction(async (transaction) => await transaction.get(releaseId))
  }

  transaction<T>(
    work: (transaction: ReleaseRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    return this.#db.transaction(async (db) => {
      await db`select pg_advisory_xact_lock(hashtextextended(${'fuma-release:' + this.scope.platformId + ':' + this.scope.ownerKey}, 0))`
      const authority = await db<{ authorized: number }>`
        select 1 as authorized
        from fuma_tenant_owner_keys
        where platform_id = ${this.scope.platformId}
          and owner_key = ${this.scope.ownerKey}
          and organization_id = ${this.scope.organizationId}
          and workspace_id = ${this.scope.workspaceId}
          and site_id = ${this.scope.siteId}
          and generation = ${this.scope.generation}
          and state = 'active'
          and transfer_id is null
          and transfer_lock_id is null
          and transfer_fence is null
        for share
      `
      if (authority.rows.length !== 1) {
        throw new ReleaseRepositoryError('invalid-scope', 'Current release owner authority denied.')
      }
      return await work(new PostgresReleaseTransaction(db, this.scope))
    })
  }
}

export class PostgresReleaseRepository implements ReleaseRepository {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') {
      throw new Error('Fuma releases require PostgreSQL authority.')
    }
    this.#db = db
  }

  forScope(scope: FumaRepositoryScope): BoundReleaseRepository {
    return new BoundPostgresReleaseRepository(this.#db, scope)
  }
}
