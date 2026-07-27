import type { DbClient } from '../../db/client'
import type {
  TenantOwnerKeyRecord,
} from './contracts'
import type {
  FumaRepositoryScopeCoordinate,
  FumaRepositoryScopeOwnerKeyAuthority,
} from './repositoryScope'

interface TenantOwnerKeyRow {
  platform_id: string
  owner_key: string
  organization_id: string
  workspace_id: string
  site_id: string
  state: string
  generation: string | number | bigint
  transfer_id: string | null
  transfer_lock_id: string | null
  transfer_fence: string | number | bigint | null
  created_at: string | Date
  updated_at: string | Date
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value
}

function safePositiveInteger(
  value: string | number | bigint,
  field: string,
): number {
  if (typeof value === 'string' && !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Stored tenant owner-key ${field} is invalid.`)
  }
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric < 1) {
    throw new Error(`Stored tenant owner-key ${field} is invalid.`)
  }
  return numeric
}

function mapOwnerKey(row: TenantOwnerKeyRow): TenantOwnerKeyRecord {
  if (row.state !== 'active' && row.state !== 'transferring') {
    throw new Error(`Stored tenant owner-key state for ${row.owner_key} is invalid.`)
  }
  return {
    ownerKey: row.owner_key,
    coordinate: {
      platformId: row.platform_id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      siteId: row.site_id,
    },
    state: row.state,
    generation: safePositiveInteger(row.generation, 'generation'),
    transferId: row.transfer_id,
    transferLockId: row.transfer_lock_id,
    transferFence: row.transfer_fence === null
      ? null
      : safePositiveInteger(row.transfer_fence, 'transfer fence'),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

/** PostgreSQL-backed stable owner-key authority for repository scope derivation. */
export class PostgresFumaRepositoryScopeOwnerKeyAuthority
implements FumaRepositoryScopeOwnerKeyAuthority {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') {
      throw new Error('Fuma repository scope owner keys require PostgreSQL authority.')
    }
    this.#db = db
  }

  async loadOwnerKey(
    coordinate: FumaRepositoryScopeCoordinate,
  ): Promise<TenantOwnerKeyRecord | null> {
    const { rows } = await this.#db<TenantOwnerKeyRow>`
      select platform_id, owner_key, organization_id, workspace_id, site_id,
        state, generation, transfer_id, transfer_lock_id, transfer_fence,
        created_at, updated_at
      from fuma_tenant_owner_keys
      where platform_id = ${coordinate.platformId}
        and organization_id = ${coordinate.organizationId}
        and workspace_id = ${coordinate.workspaceId}
        and site_id = ${coordinate.siteId}
    `
    return rows[0] ? mapOwnerKey(rows[0]) : null
  }
}
