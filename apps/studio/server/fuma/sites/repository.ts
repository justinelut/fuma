import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import {
  FumaRepositoryScopeResolutionError,
  type FumaRepositoryScope,
} from '../tenancy'
import {
  SiteCapabilityOverridesSchema,
  SiteRecordSchema,
  type SiteCapabilityOverrides,
  type SiteId,
  type SiteOrganizationId,
  type SiteRecord,
  type SiteWorkspaceId,
} from './contracts'

interface SiteRow {
  organization_id: string
  workspace_id: string
  id: string
  slug: string
  name: string
  status: string
  profile_id: string
  capability_overrides_json: unknown
  created_at: string | Date
  updated_at: string | Date
}

interface WorkspaceStatusRow {
  status: string
}

interface SiteCountRow {
  count: string | number
}

interface OwnerScopeGuardRow {
  authorized: number
}

export type OwnedWorkspaceStatus = 'active' | 'archived'

export type SiteOwnerScopeAuthority = Readonly<Pick<
  FumaRepositoryScope,
  'platformId' | 'siteId' | 'ownerKey' | 'generation'
>>

export interface SiteRepositoryTransaction {
  getWorkspaceStatus(): Promise<OwnedWorkspaceStatus | null>
  getById(siteId: SiteId): Promise<SiteRecord | null>
  getSites(): Promise<SiteRecord[]>
  assertActiveOwnerScope(authority: SiteOwnerScopeAuthority): Promise<void>
  insert(record: SiteRecord): Promise<SiteRecord>
  update(record: SiteRecord): Promise<SiteRecord>
}

export interface SiteRepository {
  transaction<T>(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
    work: (tx: SiteRepositoryTransaction) => Promise<T>,
  ): Promise<T>
  getWorkspaceStatus(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<OwnedWorkspaceStatus | null>
  getById(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
    siteId: SiteId,
  ): Promise<SiteRecord | null>
  listByWorkspace(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<SiteRecord[]>
  countActiveOwnedSites(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<number>
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value
}

function parseCapabilityOverrides(row: SiteRow): SiteCapabilityOverrides {
  const parsed = safeParseValue(
    SiteCapabilityOverridesSchema,
    row.capability_overrides_json,
  )
  if (!parsed.ok) {
    throw new Error(`Stored capability overrides for site ${row.id} failed schema validation.`)
  }
  return parsed.value
}

function mapSite(row: SiteRow): SiteRecord {
  const parsed = safeParseValue(SiteRecordSchema, {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    profileId: row.profile_id,
    capabilityOverrides: parseCapabilityOverrides(row),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  })
  if (!parsed.ok) throw new Error(`Stored site ${row.id} failed schema validation.`)
  return parsed.value
}

function workspaceStatus(row: WorkspaceStatusRow | undefined): OwnedWorkspaceStatus | null {
  if (!row) return null
  if (row.status !== 'active' && row.status !== 'archived') {
    throw new Error('Stored workspace status failed schema validation.')
  }
  return row.status
}

class PostgresSiteTransaction implements SiteRepositoryTransaction {
  readonly #db: DbClient
  readonly #organizationId: SiteOrganizationId
  readonly #workspaceId: SiteWorkspaceId

  constructor(
    db: DbClient,
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ) {
    this.#db = db
    this.#organizationId = organizationId
    this.#workspaceId = workspaceId
  }

  async getWorkspaceStatus(): Promise<OwnedWorkspaceStatus | null> {
    const { rows } = await this.#db<WorkspaceStatusRow>`
      select status
      from fuma_workspaces
      where organization_id = ${this.#organizationId} and id = ${this.#workspaceId}
    `
    return workspaceStatus(rows[0])
  }

  async getById(siteId: SiteId): Promise<SiteRecord | null> {
    const { rows } = await this.#db<SiteRow>`
      select organization_id, workspace_id, id, slug, name, status, profile_id,
        capability_overrides_json, created_at, updated_at
      from fuma_sites
      where organization_id = ${this.#organizationId}
        and workspace_id = ${this.#workspaceId}
        and id = ${siteId}
    `
    return rows[0] ? mapSite(rows[0]) : null
  }

  async getSites(): Promise<SiteRecord[]> {
    const { rows } = await this.#db<SiteRow>`
      select organization_id, workspace_id, id, slug, name, status, profile_id,
        capability_overrides_json, created_at, updated_at
      from fuma_sites
      where organization_id = ${this.#organizationId}
        and workspace_id = ${this.#workspaceId}
      order by created_at, id
    `
    return rows.map(mapSite)
  }

  async assertActiveOwnerScope(authority: SiteOwnerScopeAuthority): Promise<void> {
    const { rows } = await this.#db<OwnerScopeGuardRow>`
      select 1 as authorized
      from fuma_tenant_owner_keys
      where platform_id = ${authority.platformId}
        and organization_id = ${this.#organizationId}
        and workspace_id = ${this.#workspaceId}
        and site_id = ${authority.siteId}
        and owner_key = ${authority.ownerKey}
        and generation = ${authority.generation}
        and state = 'active'
        and transfer_id is null
        and transfer_lock_id is null
        and transfer_fence is null
      for share
    `
    if (!rows[0]) throw new FumaRepositoryScopeResolutionError()
  }

  #assertRecordCoordinates(record: SiteRecord): void {
    if (
      record.organizationId !== this.#organizationId
      || record.workspaceId !== this.#workspaceId
    ) {
      throw new Error('Site record coordinates diverge from the bound transaction scope.')
    }
  }

  async insert(record: SiteRecord): Promise<SiteRecord> {
    this.#assertRecordCoordinates(record)
    const capabilityOverridesJson = { ...record.capabilityOverrides }
    const { rows } = await this.#db<SiteRow>`
      insert into fuma_sites (
        organization_id, workspace_id, id, slug, name, status, profile_id,
        capability_overrides_json, created_at, updated_at
      ) values (
        ${record.organizationId}, ${record.workspaceId}, ${record.id}, ${record.slug},
        ${record.name}, ${record.status}, ${record.profileId}, ${capabilityOverridesJson},
        ${record.createdAt}, ${record.updatedAt}
      )
      returning organization_id, workspace_id, id, slug, name, status, profile_id,
        capability_overrides_json, created_at, updated_at
    `
    if (!rows[0]) throw new Error(`Failed to insert site ${record.id}.`)
    return mapSite(rows[0])
  }

  async update(record: SiteRecord): Promise<SiteRecord> {
    this.#assertRecordCoordinates(record)
    const capabilityOverridesJson = { ...record.capabilityOverrides }
    const { rows } = await this.#db<SiteRow>`
      update fuma_sites
      set slug = ${record.slug}, name = ${record.name}, status = ${record.status},
        capability_overrides_json = ${capabilityOverridesJson}, updated_at = ${record.updatedAt}
      where organization_id = ${record.organizationId}
        and workspace_id = ${record.workspaceId}
        and id = ${record.id}
      returning organization_id, workspace_id, id, slug, name, status, profile_id,
        capability_overrides_json, created_at, updated_at
    `
    if (!rows[0]) throw new Error(`Site ${record.id} disappeared during mutation.`)
    return mapSite(rows[0])
  }
}

export class PostgresSiteRepository implements SiteRepository {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') {
      throw new Error('Fuma sites require PostgreSQL authority.')
    }
    this.#db = db
  }

  transaction<T>(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
    work: (tx: SiteRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    return this.#db.transaction(async (db) => {
      const lockKey = `fuma:sites:${organizationId}:${workspaceId}`
      await db`
        select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
      `
      return await work(new PostgresSiteTransaction(db, organizationId, workspaceId))
    })
  }

  getWorkspaceStatus(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<OwnedWorkspaceStatus | null> {
    return new PostgresSiteTransaction(this.#db, organizationId, workspaceId)
      .getWorkspaceStatus()
  }

  getById(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
    siteId: SiteId,
  ): Promise<SiteRecord | null> {
    return new PostgresSiteTransaction(this.#db, organizationId, workspaceId).getById(siteId)
  }

  listByWorkspace(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<SiteRecord[]> {
    return new PostgresSiteTransaction(this.#db, organizationId, workspaceId).getSites()
  }

  async countActiveOwnedSites(
    organizationId: SiteOrganizationId,
    workspaceId: SiteWorkspaceId,
  ): Promise<number> {
    const { rows } = await this.#db<SiteCountRow>`
      select count(*) as count
      from fuma_sites
      where organization_id = ${organizationId}
        and workspace_id = ${workspaceId}
        and status = 'active'
    `
    const count = Number(rows[0]?.count)
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('Stored active site count failed validation.')
    }
    return count
  }
}
