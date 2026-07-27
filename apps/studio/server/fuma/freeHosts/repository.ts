import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import { assertReleaseManifest, type ReleaseManifest } from '../releases'
import {
  FreeHostError,
  FreeHostRecordSchema,
  type ActiveFreeHostRelease,
  type ActiveReleaseResolver,
  type FreeHostAuthority,
  type FreeHostRecord,
  type FreeHostRepository,
} from './service'

interface FreeHostRow {
  host: string
  label: string
  platform_id: string
  organization_id: string
  workspace_id: string
  site_id: string
  owner_key: string
  owner_generation: string | number | bigint | null
  state: string
  canonical_host: string | null
  allocation_version: string | number | bigint
  created_at: string | Date
}

interface ActiveReleaseRow {
  release_id: string
  manifest_json: unknown
}

function positiveInteger(value: string | number | bigint | null): number | null {
  if (value === null) return null
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null
}

function mapRecord(row: FreeHostRow): FreeHostRecord | null {
  const ownerGeneration = positiveInteger(row.owner_generation)
  const version = positiveInteger(row.allocation_version)
  if (ownerGeneration === null || version === null) return null
  const candidate = {
    host: row.host,
    label: row.label,
    platformId: row.platform_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    ownerKey: row.owner_key,
    ownerGeneration,
    state: row.state,
    canonicalHost: row.canonical_host,
    version,
    createdAt: (row.created_at instanceof Date ? row.created_at : new Date(row.created_at)).toISOString(),
  }
  const parsed = safeParseValue(FreeHostRecordSchema, candidate)
  return parsed.ok ? Object.freeze(parsed.value) : null
}

function uniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

function sameAuthority(record: FreeHostRecord, authority: FreeHostAuthority): boolean {
  return record.platformId === authority.platformId
    && record.organizationId === authority.organizationId
    && record.workspaceId === authority.workspaceId
    && record.siteId === authority.siteId
    && record.ownerKey === authority.ownerKey
    && record.ownerGeneration === authority.ownerGeneration
}

function manifestFrom(value: unknown): ReleaseManifest | null {
  let candidate = value
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate) } catch { return null }
  }
  try {
    assertReleaseManifest(candidate)
    return Object.freeze(structuredClone(candidate))
  } catch {
    return null
  }
}

/** Durable FUMA-050 authority. Every write and release read repeats exact owner generation and transfer predicates. */
export class PostgresFreeHostRepository implements FreeHostRepository, ActiveReleaseResolver {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Hosted free hosts require PostgreSQL authority.')
    this.#db = db
  }

  async insert(record: FreeHostRecord): Promise<boolean> {
    const parsed = safeParseValue(FreeHostRecordSchema, record)
    if (!parsed.ok) throw new FreeHostError('malformed', 'Free-host allocation failed validation.')
    try {
      return await this.#db.transaction(async (db) => {
        await db`select pg_advisory_xact_lock(hashtextextended(${'fuma-free-host:' + record.host}, 0))`
        await db`select pg_advisory_xact_lock(hashtextextended(${'fuma-free-site:' + record.platformId + ':' + record.siteId}, 0))`
        const owner = await db<{ authorized: number }>`
          select 1 as authorized from fuma_tenant_owner_keys
          where platform_id = ${record.platformId}
            and organization_id = ${record.organizationId}
            and workspace_id = ${record.workspaceId}
            and site_id = ${record.siteId}
            and owner_key = ${record.ownerKey}
            and generation = ${record.ownerGeneration}
            and state = 'active'
            and transfer_id is null
            and transfer_lock_id is null
            and transfer_fence is null
          for share
        `
        if (owner.rows.length !== 1) throw new FreeHostError('stale-authority', 'Current owner generation denied.')
        const result = await db`
          insert into fuma_free_hosts (
            host, label, platform_id, owner_key, organization_id, workspace_id,
            site_id, owner_generation, state, canonical_host, allocation_version,
            created_at, state_updated_at
          ) values (
            ${record.host}, ${record.label}, ${record.platformId}, ${record.ownerKey},
            ${record.organizationId}, ${record.workspaceId}, ${record.siteId},
            ${record.ownerGeneration}, ${record.state}, ${record.canonicalHost},
            ${record.version}, ${record.createdAt}, ${record.createdAt}
          ) on conflict do nothing
        `
        return result.rowCount === 1
      })
    } catch (error) {
      if (uniqueConflict(error)) return false
      throw error
    }
  }

  async exact(host: string): Promise<FreeHostRecord | null> {
    return await this.#db.transaction(async (db) => {
      const result = await db<FreeHostRow>`
        select host, label, platform_id, organization_id, workspace_id, site_id,
          owner_key, owner_generation, state, canonical_host, allocation_version, created_at
        from fuma_free_hosts where host = ${host}
      `
      return result.rows[0] ? mapRecord(result.rows[0]) : null
    })
  }

  async setState(input: Readonly<{
    host: string
    state: FreeHostRecord['state']
    authority: FreeHostAuthority
    expectedVersion: number
  }>): Promise<FreeHostRecord | null> {
    return await this.#db.transaction(async (db) => {
      const current = await db<FreeHostRow>`
        select host, label, platform_id, organization_id, workspace_id, site_id,
          owner_key, owner_generation, state, canonical_host, allocation_version, created_at
        from fuma_free_hosts where host = ${input.host} for update
      `
      const record = current.rows[0] ? mapRecord(current.rows[0]) : null
      if (!record || record.version !== input.expectedVersion || !sameAuthority(record, input.authority)) return null
      const owner = await db<{ authorized: number }>`
        select 1 as authorized from fuma_tenant_owner_keys
        where platform_id = ${record.platformId}
          and organization_id = ${record.organizationId}
          and workspace_id = ${record.workspaceId}
          and site_id = ${record.siteId}
          and owner_key = ${record.ownerKey}
          and generation = ${record.ownerGeneration}
          and state = 'active'
          and transfer_id is null
          and transfer_lock_id is null
          and transfer_fence is null
        for share
      `
      if (owner.rows.length !== 1) return null
      const updated = await db<FreeHostRow>`
        update fuma_free_hosts set state = ${input.state},
          allocation_version = allocation_version + 1,
          state_updated_at = current_timestamp
        where host = ${record.host} and allocation_version = ${record.version}
        returning host, label, platform_id, organization_id, workspace_id, site_id,
          owner_key, owner_generation, state, canonical_host, allocation_version, created_at
      `
      return updated.rows[0] ? mapRecord(updated.rows[0]) : null
    })
  }

  async exactSite(scope: Readonly<FreeHostAuthority & { host: string }>): Promise<ActiveFreeHostRelease | null> {
    return await this.#db.transaction(async (db) => {
      const result = await db<ActiveReleaseRow>`
      select pointer.release_id, release.manifest_json
      from fuma_free_hosts free_host
      join fuma_tenant_owner_keys owner
        on owner.platform_id = free_host.platform_id
        and owner.owner_key = free_host.owner_key
        and owner.organization_id = free_host.organization_id
        and owner.workspace_id = free_host.workspace_id
        and owner.site_id = free_host.site_id
        and owner.generation = free_host.owner_generation
      join fuma_release_active_pointers pointer
        on pointer.platform_id = free_host.platform_id
        and pointer.owner_key = free_host.owner_key
        and pointer.organization_id = free_host.organization_id
        and pointer.workspace_id = free_host.workspace_id
        and pointer.site_id = free_host.site_id
      join fuma_releases release
        on release.platform_id = pointer.platform_id
        and release.owner_key = pointer.owner_key
        and release.organization_id = pointer.organization_id
        and release.workspace_id = pointer.workspace_id
        and release.site_id = pointer.site_id
        and release.release_id = pointer.release_id
      where free_host.host = ${scope.host}
        and free_host.platform_id = ${scope.platformId}
        and free_host.organization_id = ${scope.organizationId}
        and free_host.workspace_id = ${scope.workspaceId}
        and free_host.site_id = ${scope.siteId}
        and free_host.owner_key = ${scope.ownerKey}
        and free_host.owner_generation = ${scope.ownerGeneration}
        and free_host.state = 'active'
        and owner.state = 'active'
        and owner.transfer_id is null
        and owner.transfer_lock_id is null
        and owner.transfer_fence is null
        and release.status = 'active'
        and release.manifest_json is not null
    `
      const row = result.rows[0]
      if (!row) return null
      const manifest = manifestFrom(row.manifest_json)
      if (!manifest || manifest.releaseId !== row.release_id
        || manifest.ownerKey !== scope.ownerKey || manifest.siteId !== scope.siteId) return null
      return Object.freeze({ releaseId: row.release_id, manifest })
    })
  }
}
