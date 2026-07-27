import { safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import {
  OrganizationBootstrapReceiptRecordSchema,
  OrganizationBootstrapUserSchema,
  OrganizationLimitsRecordSchema,
  OrganizationMembershipRecordSchema,
  OrganizationPlacementRecordSchema,
  OrganizationProfileRecordSchema,
  OrganizationRecordSchema,
  type OrganizationBootstrapReceiptRecord,
  type OrganizationBootstrapUser,
  type OrganizationLimitsRecord,
  type OrganizationMembershipRecord,
  type OrganizationPlacementRecord,
  type OrganizationProfileRecord,
  type OrganizationRecord,
} from './contracts'

interface UserRow {
  id: string
  email: string
  role: string | null
  banned: boolean | null
}

interface OrganizationRow {
  id: string
  name: string
  slug: string
}

interface MembershipRow {
  id: string
  organization_id: string
  user_id: string
  role: string
}

interface ProfileRow {
  organization_id: string
  kind: string
  status: string
}

interface LimitsRow {
  organization_id: string
  max_workspaces: number
  max_sites: number
  max_staff: number
}

interface PlacementRow {
  organization_id: string
  placement_class: string
  placement_key: string
}

interface ReceiptRow {
  bootstrap_key: string
  organization_id: string
  owner_user_id: string
}

export interface OrganizationBootstrapTransaction {
  acquireBootstrapLock(lockKey: string): Promise<void>
  findUsersByNormalizedEmail(normalizedEmail: string): Promise<readonly OrganizationBootstrapUser[]>
  enforceProtectedAdmin(userId: string, now: Date): Promise<void>
  findPlatformOrganizations(id: string, slug: string): Promise<readonly OrganizationRecord[]>
  insertOrganization(record: OrganizationRecord, now: Date): Promise<void>
  findPlatformMemberships(id: string, organizationId: string, userId: string): Promise<readonly OrganizationMembershipRecord[]>
  insertMembership(record: OrganizationMembershipRecord, now: Date): Promise<void>
  findOrganizationProfile(organizationId: string): Promise<OrganizationProfileRecord | null>
  insertOrganizationProfile(record: OrganizationProfileRecord, now: Date): Promise<void>
  findOrganizationLimits(organizationId: string): Promise<OrganizationLimitsRecord | null>
  insertOrganizationLimits(record: OrganizationLimitsRecord, now: Date): Promise<void>
  findOrganizationPlacement(organizationId: string): Promise<OrganizationPlacementRecord | null>
  insertOrganizationPlacement(record: OrganizationPlacementRecord, now: Date): Promise<void>
  findBootstrapReceipts(
    bootstrapKey: string,
    organizationId: string,
  ): Promise<readonly OrganizationBootstrapReceiptRecord[]>
  insertBootstrapReceipt(record: OrganizationBootstrapReceiptRecord, now: Date): Promise<void>
}

export interface OrganizationBootstrapRepository {
  transaction<T>(work: (tx: OrganizationBootstrapTransaction) => Promise<T>): Promise<T>
}

function parseStored<T extends TSchema>(schema: T, candidate: unknown, label: string): Static<T> {
  const parsed = safeParseValue(schema, candidate)
  if (!parsed.ok) throw new Error(`Stored ${label} failed schema validation.`)
  return parsed.value
}

function mapUser(row: UserRow): OrganizationBootstrapUser {
  return parseStored(OrganizationBootstrapUserSchema, row, `auth user ${row.id}`)
}

function mapOrganization(row: OrganizationRow): OrganizationRecord {
  return parseStored(OrganizationRecordSchema, row, `organization ${row.id}`)
}

function mapMembership(row: MembershipRow): OrganizationMembershipRecord {
  return parseStored(OrganizationMembershipRecordSchema, {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role,
  }, `organization membership ${row.id}`)
}

function mapProfile(row: ProfileRow): OrganizationProfileRecord {
  return parseStored(OrganizationProfileRecordSchema, {
    organizationId: row.organization_id,
    kind: row.kind,
    status: row.status,
  }, `organization profile ${row.organization_id}`)
}

function mapLimits(row: LimitsRow): OrganizationLimitsRecord {
  return parseStored(OrganizationLimitsRecordSchema, {
    organizationId: row.organization_id,
    maxWorkspaces: Number(row.max_workspaces),
    maxSites: Number(row.max_sites),
    maxStaff: Number(row.max_staff),
  }, `organization limits ${row.organization_id}`)
}

function mapPlacement(row: PlacementRow): OrganizationPlacementRecord {
  return parseStored(OrganizationPlacementRecordSchema, {
    organizationId: row.organization_id,
    placementClass: row.placement_class,
    placementKey: row.placement_key,
  }, `organization placement ${row.organization_id}`)
}

function mapReceipt(row: ReceiptRow): OrganizationBootstrapReceiptRecord {
  return parseStored(OrganizationBootstrapReceiptRecordSchema, {
    bootstrapKey: row.bootstrap_key,
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id,
  }, `organization bootstrap receipt ${row.bootstrap_key}`)
}

class PostgresOrganizationBootstrapTransaction implements OrganizationBootstrapTransaction {
  readonly #db: DbClient

  constructor(db: DbClient) {
    this.#db = db
  }

  async acquireBootstrapLock(lockKey: string): Promise<void> {
    await this.#db`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
  }

  async findUsersByNormalizedEmail(normalizedEmail: string): Promise<readonly OrganizationBootstrapUser[]> {
    const { rows } = await this.#db<UserRow>`
      select id, email, role, banned
      from auth_users
      where lower(btrim(email)) = ${normalizedEmail}
      order by id
    `
    return rows.map(mapUser)
  }

  async enforceProtectedAdmin(userId: string, now: Date): Promise<void> {
    const result = await this.#db`
      update auth_users
      set role = 'admin', banned = false, ban_reason = null, ban_expires = null, updated_at = ${now.toISOString()}
      where id = ${userId}
    `
    if (result.rowCount !== 1) throw new Error(`Protected owner ${userId} disappeared during bootstrap.`)
  }

  async findPlatformOrganizations(id: string, slug: string): Promise<readonly OrganizationRecord[]> {
    const { rows } = await this.#db<OrganizationRow>`
      select id, name, slug from auth_organizations
      where id = ${id} or slug = ${slug}
      order by id
    `
    return rows.map(mapOrganization)
  }

  async insertOrganization(record: OrganizationRecord, now: Date): Promise<void> {
    await this.#db`
      insert into auth_organizations (id, name, slug, logo, created_at, metadata)
      values (${record.id}, ${record.name}, ${record.slug}, null, ${now.toISOString()}, null)
    `
  }

  async findPlatformMemberships(
    id: string,
    organizationId: string,
    userId: string,
  ): Promise<readonly OrganizationMembershipRecord[]> {
    const { rows } = await this.#db<MembershipRow>`
      select id, organization_id, user_id, role from auth_members
      where id = ${id} or (organization_id = ${organizationId} and user_id = ${userId})
      order by id
    `
    return rows.map(mapMembership)
  }

  async insertMembership(record: OrganizationMembershipRecord, now: Date): Promise<void> {
    await this.#db`
      insert into auth_members (id, organization_id, user_id, role, created_at)
      values (${record.id}, ${record.organizationId}, ${record.userId}, ${record.role}, ${now.toISOString()})
    `
  }

  async findOrganizationProfile(organizationId: string): Promise<OrganizationProfileRecord | null> {
    const { rows } = await this.#db<ProfileRow>`
      select organization_id, kind, status from fuma_organization_profiles where organization_id = ${organizationId}
    `
    return rows[0] ? mapProfile(rows[0]) : null
  }

  async insertOrganizationProfile(record: OrganizationProfileRecord, now: Date): Promise<void> {
    await this.#db`
      insert into fuma_organization_profiles (organization_id, kind, status, created_at, updated_at)
      values (${record.organizationId}, ${record.kind}, ${record.status}, ${now.toISOString()}, ${now.toISOString()})
    `
  }

  async findOrganizationLimits(organizationId: string): Promise<OrganizationLimitsRecord | null> {
    const { rows } = await this.#db<LimitsRow>`
      select organization_id, max_workspaces, max_sites, max_staff
      from fuma_organization_limits where organization_id = ${organizationId}
    `
    return rows[0] ? mapLimits(rows[0]) : null
  }

  async insertOrganizationLimits(record: OrganizationLimitsRecord): Promise<void> {
    await this.#db`
      insert into fuma_organization_limits (
        organization_id, max_workspaces, max_sites, max_staff
      ) values (
        ${record.organizationId}, ${record.maxWorkspaces}, ${record.maxSites}, ${record.maxStaff}
      )
    `
  }

  async findOrganizationPlacement(organizationId: string): Promise<OrganizationPlacementRecord | null> {
    const { rows } = await this.#db<PlacementRow>`
      select organization_id, placement_class, placement_key
      from fuma_organization_placements where organization_id = ${organizationId}
    `
    return rows[0] ? mapPlacement(rows[0]) : null
  }

  async insertOrganizationPlacement(record: OrganizationPlacementRecord, now: Date): Promise<void> {
    await this.#db`
      insert into fuma_organization_placements (
        organization_id, placement_class, placement_key, created_at, updated_at
      ) values (
        ${record.organizationId}, ${record.placementClass}, ${record.placementKey},
        ${now.toISOString()}, ${now.toISOString()}
      )
    `
  }

  async findBootstrapReceipts(
    bootstrapKey: string,
    organizationId: string,
  ): Promise<readonly OrganizationBootstrapReceiptRecord[]> {
    const { rows } = await this.#db<ReceiptRow>`
      select bootstrap_key, organization_id, owner_user_id
      from fuma_organization_bootstrap_receipts
      where bootstrap_key = ${bootstrapKey} or organization_id = ${organizationId}
      order by bootstrap_key
    `
    return rows.map(mapReceipt)
  }

  async insertBootstrapReceipt(record: OrganizationBootstrapReceiptRecord, now: Date): Promise<void> {
    await this.#db`
      insert into fuma_organization_bootstrap_receipts (bootstrap_key, organization_id, owner_user_id, created_at)
      values (${record.bootstrapKey}, ${record.organizationId}, ${record.ownerUserId}, ${now.toISOString()})
    `
  }
}

export class PostgresOrganizationBootstrapRepository implements OrganizationBootstrapRepository {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new Error('Fuma organization bootstrap requires PostgreSQL authority.')
    this.#db = db
  }

  transaction<T>(work: (tx: OrganizationBootstrapTransaction) => Promise<T>): Promise<T> {
    return this.#db.transaction(async (db) => await work(new PostgresOrganizationBootstrapTransaction(db)))
  }
}
