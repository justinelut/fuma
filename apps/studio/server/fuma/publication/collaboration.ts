import {
  CollaborationAcceptedReceiptSchema,
  CollaborationOperationSchema,
  CollaborationReconcileCommandSchema,
  CollaborationSocketServerMessageSchema,
  PublicationPresenceStateSchema,
  PublicationRestoreCommandSchema,
  PublicationRevisionSchema,
  applyCollaborationOperationBatch,
  parsePublicationContract,
  type CollaborationAcceptedReceipt,
  type CollaborationCatchUp,
  type CollaborationOperation,
  type CollaborationReconcileCommand,
  type CollaborationReconcileResult,
  type CollaborationSocketServerMessage,
  type PublicationPresenceState,
  type PublicationRestoreCommand,
  type PublicationRevision,
} from '@core/fuma/publication'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import type { FumaRedisCoordination } from '../redis'
import type { PublicationRepositoryScope } from './scope'

export type CollaborationHead = Readonly<{ sequence: number; document: unknown }>
export type CollaborationMutationRecord = Readonly<{
  command: CollaborationReconcileCommand
  actorSessionId: string
  receipt: CollaborationAcceptedReceipt
  document: unknown
}>

export interface PublicationCollaborationTransaction {
  lockHead(resourceKind: string, resourceId: string): Promise<CollaborationHead | null>
  insertHead(resourceKind: string, resourceId: string, document: unknown): Promise<void>
  listOperations(resourceKind: string, resourceId: string, afterSequence: number): Promise<readonly CollaborationOperation[]>
  appendOperation(resourceKind: string, resourceId: string, operation: CollaborationOperation): Promise<boolean>
  getMutation(resourceKind: string, resourceId: string, mutationId: string): Promise<CollaborationMutationRecord | null>
  appendMutation(resourceKind: string, resourceId: string, record: CollaborationMutationRecord): Promise<boolean>
  updateHead(resourceKind: string, resourceId: string, expectedSequence: number, document: unknown): Promise<boolean>
  getRevision(resourceKind: string, resourceId: string, revisionId: string): Promise<PublicationRevision | null>
  appendRevision(revision: PublicationRevision): Promise<boolean>
}

export interface PublicationCollaborationStore {
  transaction<T>(scope: PublicationRepositoryScope, work: (tx: PublicationCollaborationTransaction) => Promise<T>): Promise<T>
}

export class PublicationCollaborationError extends Error {
  readonly code: 'invalid-operation' | 'sequence-conflict' | 'mutation-conflict' | 'revision-conflict' | 'not-found'
  constructor(code: PublicationCollaborationError['code'], message: string) {
    super(message)
    this.name = 'PublicationCollaborationError'
    this.code = code
  }
}

function cloneJson<T>(value: T): T { return structuredClone(value) }
function sameMutation(left: CollaborationReconcileCommand, right: CollaborationReconcileCommand): boolean { return JSON.stringify(left) === JSON.stringify(right) }

/** Backward-compatible server export; the implementation is shared with the browser coordinator. */
export function applyCollaborationOperations(document: unknown, operations: Parameters<typeof applyCollaborationOperationBatch>[1]): unknown {
  try { return applyCollaborationOperationBatch(document, operations) }
  catch (error) {
    throw new PublicationCollaborationError('invalid-operation', error instanceof Error ? error.message : 'Collaboration operation is invalid.')
  }
}

export function publicationPresenceRoom(scope: PublicationRepositoryScope, kind: string, id: string): string {
  return [
    'publication', scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId,
    scope.ownerKey, String(scope.generation), scope.profileId, kind, id,
  ].map(encodeURIComponent).join(':')
}

export class PublicationPresenceService {
  readonly #redis: FumaRedisCoordination
  constructor(redis: FumaRedisCoordination) { this.#redis = redis }

  async heartbeat(scope: PublicationRepositoryScope, input: PublicationPresenceState, ttlMs = 30_000): Promise<boolean> {
    const state = parsePublicationContract('presence', PublicationPresenceStateSchema, input)
    return await this.#redis.heartbeatPresence(publicationPresenceRoom(scope, state.resourceKind, state.resourceId), state.sessionId, JSON.stringify(state), ttlMs)
  }
  leave(scope: PublicationRepositoryScope, resourceKind: PublicationPresenceState['resourceKind'], resourceId: string, sessionId: string): Promise<boolean> {
    return this.#redis.removePresence(publicationPresenceRoom(scope, resourceKind, resourceId), sessionId)
  }
  async allowUpdate(scope: PublicationRepositoryScope, resourceKind: PublicationPresenceState['resourceKind'], resourceId: string, sessionId: string): Promise<boolean> {
    return (await this.#redis.consumeLimit(`presence-update:${publicationPresenceRoom(scope, resourceKind, resourceId)}:${sessionId}`, { limit: 30, windowMs: 10_000 })).allowed
  }
  publishChanged(scope: PublicationRepositoryScope, resourceKind: PublicationPresenceState['resourceKind'], resourceId: string): Promise<number> {
    return this.#redis.publish(`presence-events:${publicationPresenceRoom(scope, resourceKind, resourceId)}`, 'changed')
  }
  subscribeChanged(scope: PublicationRepositoryScope, resourceKind: PublicationPresenceState['resourceKind'], resourceId: string, listener: () => void): Promise<() => Promise<void>> {
    return this.#redis.subscribe(`presence-events:${publicationPresenceRoom(scope, resourceKind, resourceId)}`, listener)
  }
  async list(scope: PublicationRepositoryScope, resourceKind: PublicationPresenceState['resourceKind'], resourceId: string): Promise<readonly PublicationPresenceState[]> {
    const entries = await this.#redis.listPresence(publicationPresenceRoom(scope, resourceKind, resourceId))
    return Object.freeze(entries.flatMap(({ payload }) => {
      try { const parsed = safeParseValue(PublicationPresenceStateSchema, JSON.parse(payload)); return parsed.ok ? [Object.freeze(parsed.value)] : [] }
      catch { return [] }
    }).toSorted((left, right) => left.actorId.localeCompare(right.actorId) || left.sessionId.localeCompare(right.sessionId)))
  }
}

export class PublicationCollaborationEvents {
  readonly #redis: FumaRedisCoordination
  constructor(redis: FumaRedisCoordination) { this.#redis = redis }
  publish(scope: PublicationRepositoryScope, resourceKind: string, resourceId: string, message: CollaborationSocketServerMessage): Promise<number> {
    return this.#redis.publish(`collaboration-events:${publicationPresenceRoom(scope, resourceKind, resourceId)}`, JSON.stringify(message))
  }
  subscribe(scope: PublicationRepositoryScope, resourceKind: string, resourceId: string, listener: (message: CollaborationSocketServerMessage) => void): Promise<() => Promise<void>> {
    return this.#redis.subscribe(`collaboration-events:${publicationPresenceRoom(scope, resourceKind, resourceId)}`, (payload) => {
      try {
        const parsed = safeParseValue(CollaborationSocketServerMessageSchema, JSON.parse(payload))
        if (parsed.ok && parsed.value.type === 'collaboration-accepted') listener(parsed.value)
      } catch { /* durable catch-up repairs a missed advisory notification */ }
    })
  }
}

export class PublicationCollaborationService {
  readonly #store: PublicationCollaborationStore
  readonly #now: () => Date
  readonly #events: PublicationCollaborationEvents | null
  constructor(store: PublicationCollaborationStore, now: () => Date = () => new Date(), events: PublicationCollaborationEvents | null = null) {
    this.#store = store; this.#now = now; this.#events = events
  }

  subscribeChanged(scope: PublicationRepositoryScope, resourceKind: string, resourceId: string, listener: (message: CollaborationSocketServerMessage) => void): Promise<() => Promise<void>> {
    return this.#events?.subscribe(scope, resourceKind, resourceId, listener) ?? Promise.resolve(async () => {})
  }

  async catchUp(scope: PublicationRepositoryScope, resourceKind: CollaborationReconcileCommand['resourceKind'], resourceId: string, afterSequence: number): Promise<CollaborationCatchUp> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new PublicationCollaborationError('invalid-operation', 'Catch-up sequence is invalid.')
    return await this.#store.transaction(scope, async (tx) => {
      const head = await tx.lockHead(resourceKind, resourceId)
      if (!head) throw new PublicationCollaborationError('not-found', 'Collaborative resource was not found.')
      return Object.freeze({ sequence: head.sequence, document: cloneJson(head.document), operationsSinceBase: await tx.listOperations(resourceKind, resourceId, afterSequence) })
    })
  }

  async reconcile(
    scope: PublicationRepositoryScope,
    input: CollaborationReconcileCommand,
    authority: Readonly<{ actorSessionId: string; createdAt?: string }>,
  ): Promise<CollaborationReconcileResult> {
    const command = parsePublicationContract('reconcile command', CollaborationReconcileCommandSchema, input)
    const createdAt = authority.createdAt ?? this.#now().toISOString()
    let shouldPublish = false
    const result = await this.#store.transaction(scope, async (tx) => {
      const prior = await tx.getMutation(command.resourceKind, command.resourceId, command.mutationId)
      if (prior) {
        if (prior.actorSessionId !== authority.actorSessionId || !sameMutation(prior.command, command)) {
          throw new PublicationCollaborationError('mutation-conflict', 'Mutation identity was reused with different immutable input.')
        }
        return Object.freeze({ outcome: 'accepted' as const, replayed: true, receipt: prior.receipt, document: cloneJson(prior.document) })
      }
      const head = await tx.lockHead(command.resourceKind, command.resourceId)
      if (!head) throw new PublicationCollaborationError('not-found', 'Collaborative resource was not found.')
      if (head.sequence !== command.expectedSequence) {
        return Object.freeze({ outcome: 'rebase-required' as const, mutationId: command.mutationId, sequence: head.sequence, document: cloneJson(head.document), operationsSinceBase: await tx.listOperations(command.resourceKind, command.resourceId, command.expectedSequence) })
      }
      const seen = new Set<string>()
      for (const operation of command.operations) {
        if (operation.baseSequence !== command.expectedSequence || seen.has(operation.operationId)) throw new PublicationCollaborationError('invalid-operation', 'Operation base sequence or identity is invalid.')
        seen.add(operation.operationId)
      }
      const document = applyCollaborationOperations(head.document, command.operations)
      const acceptedSequence = head.sequence + 1
      const operations = command.operations.map((operation, operationIndex): CollaborationOperation => Object.freeze({
        ...cloneJson(operation), mutationId: command.mutationId, actorSessionId: authority.actorSessionId,
        acceptedSequence, operationIndex, createdAt,
      }))
      for (const operation of operations) {
        parsePublicationContract('accepted operation', CollaborationOperationSchema, operation)
        if (!await tx.appendOperation(command.resourceKind, command.resourceId, operation)) throw new PublicationCollaborationError('sequence-conflict', 'Operation identity was already used.')
      }
      if (!await tx.updateHead(command.resourceKind, command.resourceId, head.sequence, document)) throw new PublicationCollaborationError('sequence-conflict', 'Collaborative head changed concurrently.')
      const receipt = parsePublicationContract('accepted receipt', CollaborationAcceptedReceiptSchema, {
        mutationId: command.mutationId, sequence: acceptedSequence,
        operationIds: operations.map(({ operationId }) => operationId), operations,
      })
      const record = Object.freeze({ command, actorSessionId: authority.actorSessionId, receipt, document: cloneJson(document) })
      if (!await tx.appendMutation(command.resourceKind, command.resourceId, record)) throw new PublicationCollaborationError('sequence-conflict', 'Mutation receipt identity was already used.')
      shouldPublish = true
      return Object.freeze({ outcome: 'accepted' as const, replayed: false, receipt, document })
    })
    if (shouldPublish && result.outcome === 'accepted') {
      await this.#events?.publish(scope, command.resourceKind, command.resourceId, {
        type: 'collaboration-accepted', replayed: false, receipt: result.receipt, document: result.document,
      })
    }
    return result
  }

  async checkpoint(scope: PublicationRepositoryScope, input: PublicationRevision): Promise<PublicationRevision> {
    const revision = parsePublicationContract('revision', PublicationRevisionSchema, input)
    await this.#store.transaction(scope, async (tx) => {
      const head = await tx.lockHead(revision.resourceKind, revision.resourceId)
      if (!head || head.sequence !== revision.sequence) throw new PublicationCollaborationError('revision-conflict', 'Revision sequence is not the current head.')
      if (!await tx.appendRevision(revision)) throw new PublicationCollaborationError('revision-conflict', 'Revision identity already exists.')
    })
    return revision
  }

  async restore(scope: PublicationRepositoryScope, resourceKind: PublicationRevision['resourceKind'], resourceId: string, actorId: string, input: PublicationRestoreCommand): Promise<PublicationRevision> {
    const command = parsePublicationContract('restore command', PublicationRestoreCommandSchema, input)
    return await this.#store.transaction(scope, async (tx) => {
      const source = await tx.getRevision(resourceKind, resourceId, command.revisionId)
      const expectedHead = await tx.getRevision(resourceKind, resourceId, command.expectedHeadRevisionId)
      const head = await tx.lockHead(resourceKind, resourceId)
      if (!source || !expectedHead || !head || expectedHead.sequence !== head.sequence) throw new PublicationCollaborationError('revision-conflict', 'Restore head changed or revision was not found.')
      const sequence = head.sequence + 1
      if (!await tx.updateHead(resourceKind, resourceId, head.sequence, source.document)) throw new PublicationCollaborationError('revision-conflict', 'Restore lost its compare-and-swap.')
      const restored = parsePublicationContract('restored revision', PublicationRevisionSchema, { ...source, revisionId: command.restoreRevisionId, sequence, parentRevisionId: expectedHead.revisionId, actorId, reason: 'restore', createdAt: this.#now().toISOString() })
      if (!await tx.appendRevision(restored)) throw new PublicationCollaborationError('revision-conflict', 'Restore revision identity already exists.')
      return restored
    })
  }
}

interface HeadRow { sequence: string | number | bigint; document_json: unknown }
interface OperationRow { operation_json: unknown }
interface MutationRow { command_json: unknown; actor_session_id: string; receipt_json: unknown; document_json: unknown }
interface RevisionRow { revision_id: string; resource_kind: string; resource_id: string; sequence: string | number | bigint; parent_revision_id: string | null; actor_id: string; reason: string; document_json: unknown; checksum_sha256: string; created_at: string | Date }
function sequence(value: string | number | bigint): number { const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) throw new PublicationCollaborationError('invalid-operation', 'Stored sequence is invalid.'); return result }

class PostgresCollaborationTransaction implements PublicationCollaborationTransaction {
  readonly #db: DbClient; readonly #scope: PublicationRepositoryScope
  constructor(db: DbClient, scope: PublicationRepositoryScope) { this.#db = db; this.#scope = scope }
  async lockHead(resourceKind: string, resourceId: string): Promise<CollaborationHead | null> {
    const { rows } = await this.#db<HeadRow>`select sequence, document_json from fuma_publication_collaboration_heads where platform_id=${this.#scope.platformId} and organization_id=${this.#scope.organizationId} and workspace_id=${this.#scope.workspaceId} and site_id=${this.#scope.siteId} and owner_key=${this.#scope.ownerKey} and owner_generation=${this.#scope.generation} and profile_id=${this.#scope.profileId} and resource_kind=${resourceKind} and resource_id=${resourceId} for update`
    return rows[0] ? { sequence: sequence(rows[0].sequence), document: cloneJson(rows[0].document_json) } : null
  }
  async insertHead(resourceKind: string, resourceId: string, document: unknown): Promise<void> {
    await this.#db`insert into fuma_publication_collaboration_heads (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,resource_kind,resource_id,sequence,document_json) values (${this.#scope.platformId},${this.#scope.organizationId},${this.#scope.workspaceId},${this.#scope.siteId},${this.#scope.ownerKey},${this.#scope.generation},${this.#scope.profileId},${resourceKind},${resourceId},0,${JSON.stringify(document)}) on conflict do nothing`
  }
  async listOperations(resourceKind: string, resourceId: string, afterSequence: number): Promise<readonly CollaborationOperation[]> {
    const { rows } = await this.#db<OperationRow>`select operation_json from fuma_publication_collaboration_operations where platform_id=${this.#scope.platformId} and organization_id=${this.#scope.organizationId} and workspace_id=${this.#scope.workspaceId} and site_id=${this.#scope.siteId} and owner_key=${this.#scope.ownerKey} and owner_generation=${this.#scope.generation} and profile_id=${this.#scope.profileId} and resource_kind=${resourceKind} and resource_id=${resourceId} and accepted_sequence>${afterSequence} order by accepted_sequence, operation_index limit 1024`
    return rows.map((row) => parsePublicationContract('stored operation', CollaborationOperationSchema, row.operation_json))
  }
  async appendOperation(resourceKind: string, resourceId: string, operation: CollaborationOperation): Promise<boolean> {
    const { rowCount } = await this.#db`insert into fuma_publication_collaboration_operations (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,resource_kind,resource_id,mutation_id,operation_id,operation_index,actor_session_id,base_sequence,accepted_sequence,operation_json,created_at) values (${this.#scope.platformId},${this.#scope.organizationId},${this.#scope.workspaceId},${this.#scope.siteId},${this.#scope.ownerKey},${this.#scope.generation},${this.#scope.profileId},${resourceKind},${resourceId},${operation.mutationId},${operation.operationId},${operation.operationIndex},${operation.actorSessionId},${operation.baseSequence},${operation.acceptedSequence},${JSON.stringify(operation)},${operation.createdAt}) on conflict do nothing`
    return rowCount === 1
  }
  async getMutation(resourceKind: string, resourceId: string, mutationId: string): Promise<CollaborationMutationRecord | null> {
    const { rows } = await this.#db<MutationRow>`select command_json,actor_session_id,receipt_json,document_json from fuma_publication_collaboration_mutations where platform_id=${this.#scope.platformId} and organization_id=${this.#scope.organizationId} and workspace_id=${this.#scope.workspaceId} and site_id=${this.#scope.siteId} and owner_key=${this.#scope.ownerKey} and owner_generation=${this.#scope.generation} and profile_id=${this.#scope.profileId} and resource_kind=${resourceKind} and resource_id=${resourceId} and mutation_id=${mutationId}`
    const row = rows[0]
    return row ? Object.freeze({ command: parsePublicationContract('stored mutation command', CollaborationReconcileCommandSchema, row.command_json), actorSessionId: row.actor_session_id, receipt: parsePublicationContract('stored mutation receipt', CollaborationAcceptedReceiptSchema, row.receipt_json), document: cloneJson(row.document_json) }) : null
  }
  async appendMutation(resourceKind: string, resourceId: string, record: CollaborationMutationRecord): Promise<boolean> {
    const { rowCount } = await this.#db`insert into fuma_publication_collaboration_mutations (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,resource_kind,resource_id,mutation_id,actor_session_id,accepted_sequence,command_json,receipt_json,document_json,created_at) values (${this.#scope.platformId},${this.#scope.organizationId},${this.#scope.workspaceId},${this.#scope.siteId},${this.#scope.ownerKey},${this.#scope.generation},${this.#scope.profileId},${resourceKind},${resourceId},${record.receipt.mutationId},${record.actorSessionId},${record.receipt.sequence},${JSON.stringify(record.command)},${JSON.stringify(record.receipt)},${JSON.stringify(record.document)},${record.receipt.operations[0]!.createdAt}) on conflict do nothing`
    return rowCount === 1
  }
  async updateHead(resourceKind: string, resourceId: string, expectedSequence: number, document: unknown): Promise<boolean> {
    const { rowCount } = await this.#db`update fuma_publication_collaboration_heads set sequence=sequence+1, document_json=${JSON.stringify(document)}, updated_at=current_timestamp where platform_id=${this.#scope.platformId} and organization_id=${this.#scope.organizationId} and workspace_id=${this.#scope.workspaceId} and site_id=${this.#scope.siteId} and owner_key=${this.#scope.ownerKey} and owner_generation=${this.#scope.generation} and profile_id=${this.#scope.profileId} and resource_kind=${resourceKind} and resource_id=${resourceId} and sequence=${expectedSequence}`
    return rowCount === 1
  }
  async getRevision(resourceKind: string, resourceId: string, revisionId: string): Promise<PublicationRevision | null> {
    const { rows } = await this.#db<RevisionRow>`select revision_id,resource_kind,resource_id,sequence,parent_revision_id,actor_id,reason,document_json,checksum_sha256,created_at from fuma_publication_revisions where platform_id=${this.#scope.platformId} and organization_id=${this.#scope.organizationId} and workspace_id=${this.#scope.workspaceId} and site_id=${this.#scope.siteId} and owner_key=${this.#scope.ownerKey} and owner_generation=${this.#scope.generation} and profile_id=${this.#scope.profileId} and resource_kind=${resourceKind} and resource_id=${resourceId} and revision_id=${revisionId}`
    const row = rows[0]
    return row ? parsePublicationContract('stored revision', PublicationRevisionSchema, { revisionId: row.revision_id, resourceKind: row.resource_kind, resourceId: row.resource_id, sequence: sequence(row.sequence), parentRevisionId: row.parent_revision_id, actorId: row.actor_id, reason: row.reason, document: row.document_json, checksumSha256: row.checksum_sha256, createdAt: new Date(row.created_at).toISOString() }) : null
  }
  async appendRevision(revision: PublicationRevision): Promise<boolean> {
    const { rowCount } = await this.#db`insert into fuma_publication_revisions (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,resource_kind,resource_id,revision_id,sequence,parent_revision_id,actor_id,reason,document_json,checksum_sha256,created_at) values (${this.#scope.platformId},${this.#scope.organizationId},${this.#scope.workspaceId},${this.#scope.siteId},${this.#scope.ownerKey},${this.#scope.generation},${this.#scope.profileId},${revision.resourceKind},${revision.resourceId},${revision.revisionId},${revision.sequence},${revision.parentRevisionId},${revision.actorId},${revision.reason},${JSON.stringify(revision.document)},${revision.checksumSha256},${revision.createdAt}) on conflict do nothing`
    return rowCount === 1
  }
}

export class PostgresPublicationCollaborationStore implements PublicationCollaborationStore {
  readonly #db: DbClient
  constructor(db: DbClient) { this.#db = db }
  transaction<T>(scope: PublicationRepositoryScope, work: (tx: PublicationCollaborationTransaction) => Promise<T>): Promise<T> {
    return this.#db.transaction(async (db) => {
      const authority = await db`select 1 from fuma_tenant_owner_keys where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and generation=${scope.generation} and state='active' and transfer_id is null and transfer_fence is null for share`
      if (authority.rowCount !== 1) throw new PublicationCollaborationError('not-found', 'Current owner authority denied.')
      return await work(new PostgresCollaborationTransaction(db, scope))
    })
  }
}
