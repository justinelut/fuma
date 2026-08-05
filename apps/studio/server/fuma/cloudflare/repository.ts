import type { DbClient } from '../../db/client'
import { CloudflareBindingSchema, parseCloudflareContract, type CloudflareBinding } from './contracts'
import { sameDomainScope, type DomainScope } from '../domains/contracts'

export type CloudflareWriteOutcome = 'applied' | 'duplicate' | 'conflict'
export interface CloudflareStateRepository {
  exact(scope: DomainScope, domainId: string): Promise<CloudflareBinding | null>
  byOperation(scope: DomainScope, operationId: string): Promise<CloudflareBinding | null>
  create(scope: DomainScope, record: CloudflareBinding): Promise<CloudflareWriteOutcome>
  advance(scope: DomainScope, current: CloudflareBinding, next: CloudflareBinding): Promise<CloudflareWriteOutcome>
  countBillable(): Promise<number>
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}
function scopeKey(scope: DomainScope): string {
  return JSON.stringify([
    scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey,
    scope.generation, scope.state, scope.transferFence, scope.profileId,
  ])
}
function bindingKey(scope: DomainScope, domainId: string): string { return `${scopeKey(scope)}:${domainId}` }
function operationKey(scope: DomainScope, operationId: string): string { return `${scopeKey(scope)}:${operationId}` }
function exactRecord(value: unknown): CloudflareBinding {
  return parseCloudflareContract(CloudflareBindingSchema, value, 'Cloudflare binding') as CloudflareBinding
}
function validAdvance(scope: DomainScope, current: CloudflareBinding, next: CloudflareBinding): boolean {
  return sameDomainScope(scope, current) && sameDomainScope(scope, next)
    && current.domainId === next.domainId && current.hostname === next.hostname
    && current.providerHostnameId === next.providerHostnameId
    && next.version === current.version + 1 && next.reconcileFence === current.reconcileFence + 1
    && next.createdAt === current.createdAt
}

/** Deterministic serialized authority used only by tests and demos. */
export class MemoryCloudflareStateRepository implements CloudflareStateRepository {
  readonly bindings = new Map<string, CloudflareBinding>()
  readonly operations = new Map<string, CloudflareBinding>()
  #tail: Promise<void> = Promise.resolve()

  async #serialized<T>(work: () => T | Promise<T>): Promise<T> {
    const prior = this.#tail
    let release!: () => void
    this.#tail = new Promise<void>((resolve) => { release = resolve })
    await prior
    try { return await work() } finally { release() }
  }
  async exact(scope: DomainScope, domainId: string) {
    return structuredClone(this.bindings.get(bindingKey(scope, domainId)) ?? null)
  }
  async byOperation(scope: DomainScope, operationId: string) {
    return structuredClone(this.operations.get(operationKey(scope, operationId)) ?? null)
  }
  async create(scope: DomainScope, recordInput: CloudflareBinding): Promise<CloudflareWriteOutcome> {
    return await this.#serialized(() => {
      const record = exactRecord(recordInput)
      if (!sameDomainScope(scope, record) || record.version !== 1 || record.reconcileFence !== 1) return 'conflict'
      const operation = this.operations.get(operationKey(scope, record.lastOperationId))
      if (operation) return canonical(operation) === canonical(record) ? 'duplicate' : 'conflict'
      const key = bindingKey(scope, record.domainId)
      const current = this.bindings.get(key)
      if (current) return canonical(current) === canonical(record) ? 'duplicate' : 'conflict'
      this.bindings.set(key, structuredClone(record))
      this.operations.set(operationKey(scope, record.lastOperationId), structuredClone(record))
      return 'applied'
    })
  }
  async advance(scope: DomainScope, currentInput: CloudflareBinding, nextInput: CloudflareBinding): Promise<CloudflareWriteOutcome> {
    return await this.#serialized(() => {
      const current = exactRecord(currentInput)
      const next = exactRecord(nextInput)
      if (!validAdvance(scope, current, next)) return 'conflict'
      const priorOperation = this.operations.get(operationKey(scope, next.lastOperationId))
      if (priorOperation) return canonical(priorOperation) === canonical(next) ? 'duplicate' : 'conflict'
      const key = bindingKey(scope, current.domainId)
      const winner = this.bindings.get(key)
      if (!winner || canonical(winner) !== canonical(current)) return 'conflict'
      this.bindings.set(key, structuredClone(next))
      this.operations.set(operationKey(scope, next.lastOperationId), structuredClone(next))
      return 'applied'
    })
  }
  async countBillable() {
    return [...this.bindings.values()].filter(({ lifecycle }) => lifecycle !== 'deleted').length
  }
}

type BindingRow = Readonly<{
  platform_id: string; organization_id: string; workspace_id: string; site_id: string; owner_key: string
  owner_generation: string | number | bigint; owner_state: 'active' | 'transferring'; transfer_fence: string | number | bigint | null
  profile_id: string; domain_id: string; hostname: string; provider_hostname_id: string; lifecycle: CloudflareBinding['lifecycle']
  provider_status: CloudflareBinding['providerStatus']; ssl_status: CloudflareBinding['sslStatus']; ownership_verified: boolean
  instructions_json: unknown; diagnostics_json: unknown; version: string | number | bigint; reconcile_fence: string | number | bigint
  last_event_sequence: string | number | bigint; last_operation_id: string; last_operation_sha256: string
  created_at: string | Date; updated_at: string | Date
}>
type OperationRow = Readonly<{ result_json: unknown }>
function integer(value: string | number | bigint): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new TypeError('Cloudflare durable integer is unsafe.')
  return parsed
}
function timestamp(value: string | Date): string { return value instanceof Date ? value.toISOString() : value }
function fromRow(row: BindingRow): CloudflareBinding {
  return exactRecord({
    platformId: row.platform_id, organizationId: row.organization_id, workspaceId: row.workspace_id, siteId: row.site_id,
    ownerKey: row.owner_key, generation: integer(row.owner_generation), state: row.owner_state,
    transferFence: row.transfer_fence === null ? null : integer(row.transfer_fence), profileId: row.profile_id,
    domainId: row.domain_id, hostname: row.hostname, providerHostnameId: row.provider_hostname_id,
    lifecycle: row.lifecycle, providerStatus: row.provider_status, sslStatus: row.ssl_status,
    ownershipVerified: row.ownership_verified, instructions: row.instructions_json, diagnostics: row.diagnostics_json,
    version: integer(row.version), reconcileFence: integer(row.reconcile_fence), lastEventSequence: String(row.last_event_sequence),
    lastOperationId: row.last_operation_id, lastOperationSha256: row.last_operation_sha256,
    createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at),
  })
}
function scopeMatches(scope: DomainScope, record: CloudflareBinding): boolean {
  return sameDomainScope(scope, record)
}

/** PostgreSQL authority for the unregistered FUMA-060 candidate schema. */
export class PostgresCloudflareStateRepository implements CloudflareStateRepository {
  readonly db: DbClient
  constructor(db: DbClient) { this.db = db }
  async exact(scope: DomainScope, domainId: string): Promise<CloudflareBinding | null> {
    const result = await this.db<BindingRow>`select * from fuma_cloudflare_hostname_authority_v2 where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and owner_state=${scope.state} and transfer_fence is not distinct from ${scope.transferFence} and profile_id=${scope.profileId} and domain_id=${domainId} limit 2`
    if (result.rows.length > 1) throw new TypeError('Cloudflare binding authority is ambiguous.')
    return result.rows[0] ? fromRow(result.rows[0]) : null
  }
  async byOperation(scope: DomainScope, operationId: string): Promise<CloudflareBinding | null> {
    return await this.byOperationWith(this.db, scope, operationId)
  }
  async create(scope: DomainScope, recordInput: CloudflareBinding): Promise<CloudflareWriteOutcome> {
    const record = exactRecord(recordInput)
    if (!scopeMatches(scope, record) || record.version !== 1 || record.reconcileFence !== 1) return 'conflict'
    return await this.db.transaction(async (db) => {
      const prior = await this.byOperationWith(db, scope, record.lastOperationId)
      if (prior) return canonical(prior) === canonical(record) ? 'duplicate' : 'conflict'
      const inserted = await db`insert into fuma_cloudflare_hostname_authority_v2(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,owner_state,transfer_fence,profile_id,domain_id,hostname,provider_hostname_id,lifecycle,provider_status,ssl_status,ownership_verified,instructions_json,diagnostics_json,version,reconcile_fence,last_event_sequence,last_operation_id,last_operation_sha256,created_at,updated_at) values(${record.platformId},${record.organizationId},${record.workspaceId},${record.siteId},${record.ownerKey},${record.generation},${record.state},${record.transferFence},${record.profileId},${record.domainId},${record.hostname},${record.providerHostnameId},${record.lifecycle},${record.providerStatus},${record.sslStatus},${record.ownershipVerified},${JSON.stringify(record.instructions)}::text::jsonb,${JSON.stringify(record.diagnostics)}::text::jsonb,${record.version},${record.reconcileFence},${record.lastEventSequence},${record.lastOperationId},${record.lastOperationSha256},${record.createdAt},${record.updatedAt}) on conflict do nothing`
      if (inserted.rowCount !== 1) {
        const winner = await this.byOperationWith(db, scope, record.lastOperationId)
        return winner && canonical(winner) === canonical(record) ? 'duplicate' : 'conflict'
      }
      await this.insertOperation(db, record)
      return 'applied'
    })
  }
  async advance(scope: DomainScope, currentInput: CloudflareBinding, nextInput: CloudflareBinding): Promise<CloudflareWriteOutcome> {
    const current = exactRecord(currentInput)
    const next = exactRecord(nextInput)
    if (!validAdvance(scope, current, next)) return 'conflict'
    return await this.db.transaction(async (db) => {
      const prior = await this.byOperationWith(db, scope, next.lastOperationId)
      if (prior) return canonical(prior) === canonical(next) ? 'duplicate' : 'conflict'
      const updated = await db`update fuma_cloudflare_hostname_authority_v2 set lifecycle=${next.lifecycle},provider_status=${next.providerStatus},ssl_status=${next.sslStatus},ownership_verified=${next.ownershipVerified},instructions_json=${JSON.stringify(next.instructions)}::text::jsonb,diagnostics_json=${JSON.stringify(next.diagnostics)}::text::jsonb,version=${next.version},reconcile_fence=${next.reconcileFence},last_event_sequence=${next.lastEventSequence},last_operation_id=${next.lastOperationId},last_operation_sha256=${next.lastOperationSha256},updated_at=${next.updatedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and owner_state=${scope.state} and transfer_fence is not distinct from ${scope.transferFence} and profile_id=${scope.profileId} and domain_id=${current.domainId} and version=${current.version} and reconcile_fence=${current.reconcileFence} and last_operation_id=${current.lastOperationId} and last_operation_sha256=${current.lastOperationSha256}`
      if (updated.rowCount !== 1) {
        const winner = await this.byOperationWith(db, scope, next.lastOperationId)
        return winner && canonical(winner) === canonical(next) ? 'duplicate' : 'conflict'
      }
      await this.insertOperation(db, next)
      return 'applied'
    })
  }
  async countBillable(): Promise<number> {
    const result = await this.db<{ count: string | number | bigint }>`select count(*) as count from fuma_cloudflare_hostname_authority_v2 where lifecycle<>'deleted'`
    return integer(result.rows[0]?.count ?? 0)
  }
  private async byOperationWith(db: DbClient, scope: DomainScope, operationId: string): Promise<CloudflareBinding | null> {
    const result = await db<OperationRow>`select result_json from fuma_cloudflare_hostname_operations_v2 where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and operation_id=${operationId} limit 2`
    if (result.rows.length > 1) throw new TypeError('Cloudflare operation authority is ambiguous.')
    const record = result.rows[0] ? exactRecord(result.rows[0].result_json) : null
    if (record && !scopeMatches(scope, record)) throw new TypeError('Cloudflare operation result has foreign authority.')
    return record
  }
  private async insertOperation(db: DbClient, record: CloudflareBinding): Promise<void> {
    const result = await db`insert into fuma_cloudflare_hostname_operations_v2(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,operation_id,operation_sha256,domain_id,resulting_version,result_json,occurred_at) values(${record.platformId},${record.organizationId},${record.workspaceId},${record.siteId},${record.ownerKey},${record.generation},${record.profileId},${record.lastOperationId},${record.lastOperationSha256},${record.domainId},${record.version},${JSON.stringify(record)}::text::jsonb,${record.updatedAt}) on conflict do nothing`
    if (result.rowCount !== 1) throw new TypeError('Cloudflare operation receipt conflicted.')
  }
}
