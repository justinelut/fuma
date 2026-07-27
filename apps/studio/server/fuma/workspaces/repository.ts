import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import {
  WorkspaceRecordSchema,
  type WorkspaceOrganizationId,
  type WorkspaceRecord,
  type WorkspaceId,
} from './contracts'

interface WorkspaceRow {
  id: string
  organization_id: string
  slug: string
  name: string
  status: string
  is_default: boolean
  created_at: string | Date
  updated_at: string | Date
}

export interface WorkspaceRepositoryTransaction {
  getById(workspaceId: WorkspaceId): Promise<WorkspaceRecord | null>
  list(): Promise<WorkspaceRecord[]>
  insert(record: WorkspaceRecord): Promise<WorkspaceRecord>
  update(record: WorkspaceRecord): Promise<WorkspaceRecord>
}

export interface WorkspaceRepository {
  transaction<T>(
    organizationId: WorkspaceOrganizationId,
    work: (tx: WorkspaceRepositoryTransaction) => Promise<T>,
  ): Promise<T>
  getById(
    organizationId: WorkspaceOrganizationId,
    workspaceId: WorkspaceId,
  ): Promise<WorkspaceRecord | null>
  listByOrganization(organizationId: WorkspaceOrganizationId): Promise<WorkspaceRecord[]>
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value
}

function mapWorkspace(row: WorkspaceRow): WorkspaceRecord {
  const parsed = safeParseValue(WorkspaceRecordSchema, {
    id: row.id,
    organizationId: row.organization_id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    isDefault: row.is_default,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  })
  if (!parsed.ok) throw new Error(`Stored workspace ${row.id} failed schema validation.`)
  return parsed.value
}

class PostgresWorkspaceTransaction implements WorkspaceRepositoryTransaction {
  readonly #db: DbClient
  readonly #organizationId: WorkspaceOrganizationId

  constructor(db: DbClient, organizationId: WorkspaceOrganizationId) {
    this.#db = db
    this.#organizationId = organizationId
  }

  async lockOrganization(): Promise<void> {
    await this.#db`
      select pg_advisory_xact_lock(hashtextextended(${'fuma:workspaces:' + this.#organizationId}, 0))
    `
  }

  async getById(workspaceId: WorkspaceId): Promise<WorkspaceRecord | null> {
    const { rows } = await this.#db<WorkspaceRow>`
      select id, organization_id, slug, name, status, is_default, created_at, updated_at
      from fuma_workspaces
      where organization_id = ${this.#organizationId} and id = ${workspaceId}
    `
    return rows[0] ? mapWorkspace(rows[0]) : null
  }

  async list(): Promise<WorkspaceRecord[]> {
    const { rows } = await this.#db<WorkspaceRow>`
      select id, organization_id, slug, name, status, is_default, created_at, updated_at
      from fuma_workspaces
      where organization_id = ${this.#organizationId}
      order by is_default desc, created_at, id
    `
    return rows.map(mapWorkspace)
  }

  async insert(record: WorkspaceRecord): Promise<WorkspaceRecord> {
    if (record.organizationId !== this.#organizationId) {
      throw new Error(`Workspace ${record.id} insert escaped organization scope.`)
    }
    const { rows } = await this.#db<WorkspaceRow>`
      insert into fuma_workspaces (
        id, organization_id, slug, name, status, is_default, created_at, updated_at
      ) values (
        ${record.id}, ${record.organizationId}, ${record.slug}, ${record.name},
        ${record.status}, ${record.isDefault}, ${record.createdAt}, ${record.updatedAt}
      )
      returning id, organization_id, slug, name, status, is_default, created_at, updated_at
    `
    if (!rows[0]) throw new Error(`Failed to insert workspace ${record.id}.`)
    return mapWorkspace(rows[0])
  }

  async update(record: WorkspaceRecord): Promise<WorkspaceRecord> {
    if (record.organizationId !== this.#organizationId) {
      throw new Error(`Workspace ${record.id} update escaped organization scope.`)
    }
    const { rows } = await this.#db<WorkspaceRow>`
      update fuma_workspaces
      set slug = ${record.slug}, name = ${record.name}, status = ${record.status},
        is_default = ${record.isDefault}, updated_at = ${record.updatedAt}
      where organization_id = ${this.#organizationId} and id = ${record.id}
      returning id, organization_id, slug, name, status, is_default, created_at, updated_at
    `
    if (!rows[0]) throw new Error(`Workspace ${record.id} disappeared during mutation.`)
    return mapWorkspace(rows[0])
  }
}

export class PostgresWorkspaceRepository implements WorkspaceRepository {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') {
      throw new Error('Fuma workspaces require PostgreSQL authority.')
    }
    this.#db = db
  }

  transaction<T>(
    organizationId: WorkspaceOrganizationId,
    work: (tx: WorkspaceRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    return this.#db.transaction(async (db) => {
      const tx = new PostgresWorkspaceTransaction(db, organizationId)
      await tx.lockOrganization()
      return await work(tx)
    })
  }

  getById(
    organizationId: WorkspaceOrganizationId,
    workspaceId: WorkspaceId,
  ): Promise<WorkspaceRecord | null> {
    return new PostgresWorkspaceTransaction(this.#db, organizationId).getById(workspaceId)
  }

  listByOrganization(organizationId: WorkspaceOrganizationId): Promise<WorkspaceRecord[]> {
    return new PostgresWorkspaceTransaction(this.#db, organizationId).list()
  }
}
