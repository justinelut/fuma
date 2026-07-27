import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import {
  FumaRepositoryScopeSchema,
  TenantOwnershipCoordinateSchema,
  type FumaRepositoryScope,
  type FumaRepositoryScopeCoordinate,
} from '../tenancy'
import {
  EditorDraftMutationReceiptSchema,
  EditorDraftStreamKeySchema,
  EditorMutationIdSchema,
  EditorScopedStorageEntrySchema,
  EditorScopedStorageKeySchema,
  EditorScopedStoragePrefixSchema,
  type EditorDraftMutationReceipt,
  type EditorDraftStreamKey,
  type EditorMutationId,
  type EditorScopedStorageEntry,
  type EditorScopedStorageKey,
  type EditorScopedStoragePrefix,
} from './contracts'
import type {
  EditorScopedStorage,
  EditorScopedStorageTransaction,
} from './storage'

const EditorJsonValueSchema = Type.Recursive((Self) => Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String(),
  Type.Array(Self),
  Type.Record(Type.String(), Self),
]))
const EditorStoredJsonObjectSchema = Type.Record(Type.String(), EditorJsonValueSchema)

interface EditorResourceRow {
  platform_id: string
  owner_key: string
  owner_generation: string | number | bigint
  resource_kind: string
  logical_id: string
  value_json: unknown
}

interface EditorScopeAuthorityRow {
  platform_id: string
  organization_id: string
  workspace_id: string
  site_id: string
  owner_key: string
  state: string
  generation: string | number | bigint
  transfer_fence: string | number | bigint | null
}

interface EditorDraftHeadRow {
  sequence: string | number | bigint
}

interface EditorDraftMutationRow {
  request_hash: string
  expected_sequence: string | number | bigint
  accepted_sequence: string | number | bigint
  document_json: unknown
}

function invalidBoundary(label: string): Error {
  return new Error(`${label} failed editor PostgreSQL storage validation.`)
}

function safePositiveInteger(
  value: string | number | bigint,
  label: string,
): number {
  if (typeof value === 'string' && !/^[1-9][0-9]*$/.test(value)) {
    throw invalidBoundary(label)
  }
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric < 1) throw invalidBoundary(label)
  return numeric
}

function parseKey(value: EditorScopedStorageKey): EditorScopedStorageKey {
  const parsed = safeParseValue(EditorScopedStorageKeySchema, value)
  if (!parsed.ok) throw invalidBoundary('Editor storage key')
  return parsed.value
}

function parsePrefix(value: EditorScopedStoragePrefix): EditorScopedStoragePrefix {
  const parsed = safeParseValue(EditorScopedStoragePrefixSchema, value)
  if (!parsed.ok) throw invalidBoundary('Editor storage prefix')
  return parsed.value
}

function parseStreamKey(value: EditorDraftStreamKey): EditorDraftStreamKey {
  const parsed = safeParseValue(EditorDraftStreamKeySchema, value)
  if (!parsed.ok) throw invalidBoundary('Editor draft stream key')
  return parsed.value
}

function parseMutationId(value: EditorMutationId): EditorMutationId {
  const parsed = safeParseValue(EditorMutationIdSchema, value)
  if (!parsed.ok) throw invalidBoundary('Editor mutation ID')
  return parsed.value
}

function parseReceiptInput(value: EditorDraftMutationReceipt): EditorDraftMutationReceipt {
  const parsed = safeParseValue(EditorDraftMutationReceiptSchema, value)
  if (!parsed.ok) throw invalidBoundary('Editor mutation receipt')
  return parsed.value
}

function safeSequence(value: string | number | bigint, label: string): number {
  if (typeof value === 'string' && !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw invalidBoundary(label)
  }
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw invalidBoundary(label)
  return numeric
}

function parseMutationReceipt(
  row: EditorDraftMutationRow,
): EditorDraftMutationReceipt {
  const candidate = {
    requestHash: row.request_hash,
    expectedSequence: safeSequence(row.expected_sequence, 'Editor expected sequence'),
    acceptedSequence: safeSequence(row.accepted_sequence, 'Editor accepted sequence'),
    document: parseJsonObject(row.document_json),
  }
  const parsed = safeParseValue(EditorDraftMutationReceiptSchema, candidate)
  if (!parsed.ok) throw invalidBoundary('Editor mutation receipt')
  return structuredClone(parsed.value)
}

function parseCoordinate(
  value: FumaRepositoryScopeCoordinate,
): FumaRepositoryScopeCoordinate {
  const parsed = safeParseValue(TenantOwnershipCoordinateSchema, value)
  if (!parsed.ok) throw invalidBoundary('Editor scope coordinate')
  return parsed.value
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = safeParseValue(EditorStoredJsonObjectSchema, value)
  if (!parsed.ok) throw invalidBoundary('Editor resource JSON')
  return structuredClone(parsed.value)
}

function mapAuthority(row: EditorScopeAuthorityRow): FumaRepositoryScope {
  const candidate = {
    platformId: row.platform_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    ownerKey: row.owner_key,
    state: row.state,
    generation: safePositiveInteger(row.generation, 'Editor owner generation'),
    transferFence: row.transfer_fence === null
      ? null
      : safePositiveInteger(row.transfer_fence, 'Editor transfer fence'),
  }
  const parsed = safeParseValue(FumaRepositoryScopeSchema, candidate)
  if (!parsed.ok) throw invalidBoundary('Stored editor scope authority')
  return structuredClone(parsed.value)
}

function mapEntry(row: EditorResourceRow): EditorScopedStorageEntry {
  const candidate = {
    key: {
      platformId: row.platform_id,
      ownerKey: row.owner_key,
      generation: safePositiveInteger(row.owner_generation, 'Editor resource generation'),
      resourceKind: row.resource_kind,
      logicalId: row.logical_id,
    },
    value: parseJsonObject(row.value_json),
  }
  const parsed = safeParseValue(EditorScopedStorageEntrySchema, candidate)
  if (!parsed.ok) throw invalidBoundary('Stored editor resource')
  return structuredClone(parsed.value)
}

class PostgresEditorScopedStorageTransaction
implements EditorScopedStorageTransaction {
  readonly #db: DbClient

  constructor(db: DbClient) {
    this.#db = db
  }

  async loadScopeAuthorityForUpdate(
    input: FumaRepositoryScopeCoordinate,
  ): Promise<FumaRepositoryScope | null> {
    const coordinate = parseCoordinate(input)
    const { rows } = await this.#db<EditorScopeAuthorityRow>`
      select platform_id, organization_id, workspace_id, site_id, owner_key,
        state, generation, transfer_fence
      from fuma_tenant_owner_keys
      where platform_id = ${coordinate.platformId}
        and organization_id = ${coordinate.organizationId}
        and workspace_id = ${coordinate.workspaceId}
        and site_id = ${coordinate.siteId}
        and state = 'active'
        and transfer_id is null
        and transfer_lock_id is null
        and transfer_fence is null
      for update
    `
    return rows[0] ? mapAuthority(rows[0]) : null
  }

  async get(input: EditorScopedStorageKey): Promise<unknown | null> {
    const key = parseKey(input)
    const { rows } = await this.#db<EditorResourceRow>`
      select platform_id, owner_key, owner_generation, resource_kind, logical_id,
        value_json
      from fuma_editor_resources
      where platform_id = ${key.platformId}
        and owner_key = ${key.ownerKey}
        and owner_generation = ${key.generation}
        and resource_kind = ${key.resourceKind}
        and logical_id = ${key.logicalId}
    `
    return rows[0] ? mapEntry(rows[0]).value : null
  }

  async list(
    input: EditorScopedStoragePrefix,
  ): Promise<readonly EditorScopedStorageEntry[]> {
    const prefix = parsePrefix(input)
    const { rows } = await this.#db<EditorResourceRow>`
      select platform_id, owner_key, owner_generation, resource_kind, logical_id,
        value_json
      from fuma_editor_resources
      where platform_id = ${prefix.platformId}
        and owner_key = ${prefix.ownerKey}
        and owner_generation = ${prefix.generation}
        and resource_kind = ${prefix.resourceKind}
      order by logical_id
    `
    return rows.map(mapEntry)
  }

  async put(input: EditorScopedStorageKey, value: unknown): Promise<void> {
    const key = parseKey(input)
    const valueJson = JSON.stringify(parseJsonObject(value))
    await this.#db`
      insert into fuma_editor_resources (
        platform_id, owner_key, owner_generation, resource_kind, logical_id,
        value_json
      ) values (
        ${key.platformId}, ${key.ownerKey}, ${key.generation},
        ${key.resourceKind}, ${key.logicalId}, ${valueJson}
      )
      on conflict (
        platform_id, owner_key, owner_generation, resource_kind, logical_id
      ) do update set
        value_json = excluded.value_json,
        updated_at = current_timestamp
    `
  }

  async delete(input: EditorScopedStorageKey): Promise<void> {
    const key = parseKey(input)
    await this.#db`
      delete from fuma_editor_resources
      where platform_id = ${key.platformId}
        and owner_key = ${key.ownerKey}
        and owner_generation = ${key.generation}
        and resource_kind = ${key.resourceKind}
        and logical_id = ${key.logicalId}
    `
  }

  async deletePrefix(input: EditorScopedStoragePrefix): Promise<void> {
    const prefix = parsePrefix(input)
    await this.#db`
      delete from fuma_editor_resources
      where platform_id = ${prefix.platformId}
        and owner_key = ${prefix.ownerKey}
        and owner_generation = ${prefix.generation}
        and resource_kind = ${prefix.resourceKind}
    `
  }

  async lockDraftSequence(input: EditorDraftStreamKey): Promise<number> {
    const key = parseStreamKey(input)
    await this.#db`
      insert into fuma_editor_draft_heads (
        platform_id, owner_key, owner_generation, profile_id, resource_kind,
        logical_id, sequence
      ) values (
        ${key.platformId}, ${key.ownerKey}, ${key.generation}, ${key.profileId},
        ${key.resourceKind}, ${key.logicalId}, 0
      )
      on conflict (
        platform_id, owner_key, owner_generation, profile_id, resource_kind,
        logical_id
      ) do nothing
    `
    const { rows } = await this.#db<EditorDraftHeadRow>`
      select sequence
      from fuma_editor_draft_heads
      where platform_id = ${key.platformId}
        and owner_key = ${key.ownerKey}
        and owner_generation = ${key.generation}
        and profile_id = ${key.profileId}
        and resource_kind = ${key.resourceKind}
        and logical_id = ${key.logicalId}
      for update
    `
    if (rows.length !== 1) throw invalidBoundary('Editor draft head')
    return safeSequence(rows[0]!.sequence, 'Editor draft sequence')
  }

  async setDraftSequence(
    input: EditorDraftStreamKey,
    expectedSequence: number,
    sequence: number,
  ): Promise<void> {
    const key = parseStreamKey(input)
    const expected = safeSequence(expectedSequence, 'Editor expected sequence')
    const next = safeSequence(sequence, 'Editor next sequence')
    if (next !== expected + 1) throw invalidBoundary('Editor sequence transition')
    const result = await this.#db`
      update fuma_editor_draft_heads
      set sequence = ${next}, updated_at = current_timestamp
      where platform_id = ${key.platformId}
        and owner_key = ${key.ownerKey}
        and owner_generation = ${key.generation}
        and profile_id = ${key.profileId}
        and resource_kind = ${key.resourceKind}
        and logical_id = ${key.logicalId}
        and sequence = ${expected}
    `
    if (result.rowCount !== 1) throw invalidBoundary('Editor sequence compare-and-swap')
  }

  async getDraftMutationReceipt(
    input: EditorDraftStreamKey,
    rawMutationId: EditorMutationId,
  ): Promise<EditorDraftMutationReceipt | null> {
    const key = parseStreamKey(input)
    const mutationId = parseMutationId(rawMutationId)
    const { rows } = await this.#db<EditorDraftMutationRow>`
      select request_hash, expected_sequence, accepted_sequence, document_json
      from fuma_editor_draft_mutations
      where platform_id = ${key.platformId}
        and owner_key = ${key.ownerKey}
        and owner_generation = ${key.generation}
        and profile_id = ${key.profileId}
        and resource_kind = ${key.resourceKind}
        and logical_id = ${key.logicalId}
        and mutation_id = ${mutationId}
    `
    return rows[0] ? parseMutationReceipt(rows[0]) : null
  }

  async putDraftMutationReceipt(
    input: EditorDraftStreamKey,
    rawMutationId: EditorMutationId,
    rawReceipt: EditorDraftMutationReceipt,
  ): Promise<void> {
    const key = parseStreamKey(input)
    const mutationId = parseMutationId(rawMutationId)
    const receipt = parseReceiptInput(rawReceipt)
    const documentJson = JSON.stringify(parseJsonObject(receipt.document))
    await this.#db`
      insert into fuma_editor_draft_mutations (
        platform_id, owner_key, owner_generation, profile_id, resource_kind,
        logical_id, mutation_id, request_hash, expected_sequence,
        accepted_sequence, document_json
      ) values (
        ${key.platformId}, ${key.ownerKey}, ${key.generation}, ${key.profileId},
        ${key.resourceKind}, ${key.logicalId}, ${mutationId},
        ${receipt.requestHash}, ${receipt.expectedSequence},
        ${receipt.acceptedSequence}, ${documentJson}
      )
    `
  }
}

/** PostgreSQL-only atomic persistence for owner-generation-scoped editor data. */
export class PostgresEditorScopedStorage implements EditorScopedStorage {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') {
      throw new Error('Fuma editor storage requires PostgreSQL authority.')
    }
    this.#db = db
  }

  transaction<T>(
    work: (transaction: EditorScopedStorageTransaction) => Promise<T>,
  ): Promise<T> {
    return this.#db.transaction(async (db) => (
      await work(new PostgresEditorScopedStorageTransaction(db))
    ))
  }
}
