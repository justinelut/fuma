import {
  PublicationRevisionComparisonSchema,
  PublicationRevisionCreateCommandSchema,
  PublicationRevisionListSchema,
  PublicationRevisionRecordSchema,
  PublicationRevisionRestoreCommandSchema,
  parsePublicationContract,
  type PublicationRevisionComparison,
  type PublicationRevisionCreateCommand,
  type PublicationRevisionList,
  type PublicationRevisionRecord,
} from '@core/fuma/publication'
import type { DbClient } from '../../db/client'
import { ObjectStorageError, type TenantObjectStorage } from '../objectStorage'
import { PublicationScopeError, type PublicationRepositoryScope } from './scope'

const SNAPSHOT_MIME = 'application/json'
const MAX_DIFF_ENTRIES = 1000

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type RevisionSnapshot = Readonly<{
  snapshotId: string
  objectKey: string
  checksumSha256: string
  sizeBytes: number
  createdAt: string
}>

type RevisionSnapshotClaim = RevisionSnapshot & Readonly<{ state: 'available' | 'deleting' }>

export interface PublicationRevisionRepository {
  currentHead(scope: PublicationRepositoryScope, resourceKind: string, resourceId: string): Promise<Readonly<{ sequence:number; document:unknown; headRevisionId:string|null }>>
  ensureSnapshot(scope: PublicationRepositoryScope, snapshot: RevisionSnapshot): Promise<void>
  capture(scope: PublicationRepositoryScope, revision: PublicationRevisionRecord, expectedHeadRevisionId: string | null): Promise<boolean>
  list(scope: PublicationRepositoryScope, resourceKind: string, resourceId: string): Promise<PublicationRevisionList>
  getAvailable(scope: PublicationRepositoryScope, resourceKind: string, resourceId: string, revisionId: string): Promise<PublicationRevisionRecord | null>
  restore(scope: PublicationRepositoryScope, source: PublicationRevisionRecord, restored: PublicationRevisionRecord, expectedHeadRevisionId: string, document: unknown): Promise<boolean>
  expireReferences(scope: PublicationRepositoryScope, before: string, actorId: string, eventIds: readonly string[], limit: number): Promise<number>
  claimUnreferencedSnapshots(scope: PublicationRepositoryScope, before: string, limit: number): Promise<readonly RevisionSnapshotClaim[]>
  completeSnapshotCollection(scope: PublicationRepositoryScope, snapshotId: string, actorId: string, eventId: string, createdAt: string): Promise<boolean>
  releaseSnapshotClaim(scope: PublicationRepositoryScope, snapshotId: string): Promise<void>
}

export interface PublicationRevisionIdAuthority {
  id(kind: string): string
  sha256(value: string): string
}

export class PublicationRevisionError extends Error {
  readonly code: 'invalid-document' | 'revision-conflict' | 'not-found' | 'snapshot-corrupt'
  constructor(code: PublicationRevisionError['code'], message: string) {
    super(message)
    this.name = 'PublicationRevisionError'
    this.code = code
  }
}

function jsonValue(value: unknown, seen = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object') throw new PublicationRevisionError('invalid-document', 'Revision document must be finite JSON data.')
  if (seen.has(value)) throw new PublicationRevisionError('invalid-document', 'Revision document must not contain cycles.')
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((entry) => jsonValue(entry, seen))
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new PublicationRevisionError('invalid-document', 'Revision document must contain plain JSON objects.')
    const output: Record<string, JsonValue> = Object.create(null)
    for (const key of Object.keys(value as object).sort()) output[key] = jsonValue((value as Record<string, unknown>)[key], seen)
    return output
  } finally {
    seen.delete(value)
  }
}

export function canonicalRevisionDocument(value: unknown): string {
  return JSON.stringify(jsonValue(value))
}

function snapshotObjectKey(scope: PublicationRepositoryScope, checksumSha256: string): string {
  return `publication-revisions/g${scope.generation}/${scope.profileId}/${checksumSha256}.json`
}

function objectScope(scope: PublicationRepositoryScope) {
  return Object.freeze({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, siteId: scope.siteId })
}

function clone<T>(value: T): T { return structuredClone(value) }
function addDays(timestamp: string, days: number): string { return new Date(Date.parse(timestamp) + days * 86_400_000).toISOString() }

function pathSegment(value: string): string { return value.replaceAll('~', '~0').replaceAll('/', '~1') }
function appendDiff(entries: Array<{path:string;kind:'added'|'removed'|'changed';before:unknown;after:unknown}>, before: JsonValue | undefined, after: JsonValue | undefined, path: string, truncated: { value: boolean }): void {
  if (entries.length >= MAX_DIFF_ENTRIES) { truncated.value = true; return }
  if (before === undefined) { entries.push({ path, kind: 'added', before: null, after: clone(after) }); return }
  if (after === undefined) { entries.push({ path, kind: 'removed', before: clone(before), after: null }); return }
  if (Object.is(before, after)) return
  if (Array.isArray(before) && Array.isArray(after)) {
    const size = Math.max(before.length, after.length)
    for (let index = 0; index < size; index += 1) appendDiff(entries, before[index], after[index], `${path}/${index}`, truncated)
    return
  }
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    for (const key of keys) appendDiff(entries, before[key], after[key], `${path}/${pathSegment(key)}`, truncated)
    return
  }
  entries.push({ path, kind: 'changed', before: clone(before), after: clone(after) })
}

export class PublicationRevisionSnapshotStore {
  readonly #storage: TenantObjectStorage
  constructor(storage: TenantObjectStorage) { this.#storage = storage }

  async put(scope: PublicationRepositoryScope, canonical: string, checksumSha256: string, createdAt: string): Promise<RevisionSnapshot> {
    const bytes = new TextEncoder().encode(canonical)
    const objectKey = snapshotObjectKey(scope, checksumSha256)
    try {
      await this.#storage.put({ scope: objectScope(scope), key: objectKey, bytes, mimeType: SNAPSHOT_MIME, checksumSha256 })
    } catch (error) {
      if (!(error instanceof ObjectStorageError) || error.code !== 'already_exists') throw error
      const existing = await this.#storage.head(objectScope(scope), objectKey)
      if (existing.checksumSha256 !== checksumSha256 || existing.sizeBytes !== bytes.byteLength || existing.mimeType !== SNAPSHOT_MIME) {
        throw new PublicationRevisionError('snapshot-corrupt', 'Existing immutable revision snapshot does not match its content address.')
      }
    }
    return Object.freeze({ snapshotId: checksumSha256, objectKey, checksumSha256, sizeBytes: bytes.byteLength, createdAt })
  }

  async get(scope: PublicationRepositoryScope, snapshot: Pick<RevisionSnapshot, 'objectKey'|'checksumSha256'|'sizeBytes'>): Promise<unknown> {
    const bytes = await this.#storage.get(objectScope(scope), snapshot.objectKey)
    if (bytes.byteLength !== snapshot.sizeBytes) throw new PublicationRevisionError('snapshot-corrupt', 'Revision snapshot size changed.')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const actualChecksum=new Bun.CryptoHasher('sha256').update(text).digest('hex')
    if(actualChecksum!==snapshot.checksumSha256)throw new PublicationRevisionError('snapshot-corrupt','Revision snapshot checksum changed.')
    try {
      const value: unknown = JSON.parse(text)
      if (canonicalRevisionDocument(value) !== text) throw new PublicationRevisionError('snapshot-corrupt', 'Revision snapshot is not canonical JSON.')
      return value
    } catch (error) {
      if (error instanceof PublicationRevisionError) throw error
      throw new PublicationRevisionError('snapshot-corrupt', 'Revision snapshot JSON is invalid.')
    }
  }

  delete(scope: PublicationRepositoryScope, objectKey: string): Promise<void> {
    return this.#storage.delete(objectScope(scope), objectKey)
  }
}

export class PublicationRevisionService {
  readonly #repository: PublicationRevisionRepository
  readonly #snapshots: PublicationRevisionSnapshotStore
  readonly #ids: PublicationRevisionIdAuthority
  readonly #now: () => Date
  constructor(input: Readonly<{ repository: PublicationRevisionRepository; snapshots: PublicationRevisionSnapshotStore; ids: PublicationRevisionIdAuthority; now?: () => Date }>) {
    this.#repository = input.repository; this.#snapshots = input.snapshots; this.#ids = input.ids; this.#now = input.now ?? (() => new Date())
  }

  async create(scope: PublicationRepositoryScope, actorId: string, input: unknown): Promise<PublicationRevisionRecord> {
    const command = parsePublicationContract('revision create command', PublicationRevisionCreateCommandSchema, input)
    if ((command.reason === 'manual-checkpoint') !== (command.checkpointName !== null)) throw new PublicationRevisionError('invalid-document', 'Only named checkpoints may carry a checkpoint name.')
    const createdAt = this.#now().toISOString()
    const current=await this.#repository.currentHead(scope,command.resourceKind,command.resourceId)
    if(current.sequence!==command.expectedSequence||current.headRevisionId!==command.expectedHeadRevisionId)throw new PublicationRevisionError('revision-conflict','Revision head or collaborative sequence changed concurrently.')
    const canonical = canonicalRevisionDocument(current.document)
    if(canonical!==canonicalRevisionDocument(command.document))throw new PublicationRevisionError('revision-conflict','Revision document is not the current collaborative head.')
    const checksumSha256 = this.#ids.sha256(canonical)
    const snapshot = await this.#snapshots.put(scope, canonical, checksumSha256, createdAt)
    await this.#repository.ensureSnapshot(scope, snapshot)
    const revision = parsePublicationContract('revision record', PublicationRevisionRecordSchema, {
      revisionId: command.revisionId, resourceKind: command.resourceKind, resourceId: command.resourceId,
      sequence: command.expectedSequence, parentRevisionId: command.expectedHeadRevisionId, actorId,
      reason: command.reason, checkpointName: command.checkpointName, snapshotId: snapshot.snapshotId,
      checksumSha256, sizeBytes: snapshot.sizeBytes,
      retainedUntil: command.reason === 'periodic' ? addDays(createdAt, command.retentionDays) : null,
      snapshotAvailable: true, createdAt,
    })
    if (!await this.#repository.capture(scope, revision, command.expectedHeadRevisionId)) throw new PublicationRevisionError('revision-conflict', 'Revision head or collaborative sequence changed concurrently.')
    return revision
  }

  async capturePeriodicCurrent(scope: PublicationRepositoryScope, actorId: string, input: Readonly<{ revisionId:string;resourceKind:PublicationRevisionCreateCommand['resourceKind'];resourceId:string;retentionDays:number }>): Promise<PublicationRevisionRecord> {
    const head = await this.#repository.currentHead(scope, input.resourceKind, input.resourceId)
    return this.create(scope, actorId, { ...input, expectedSequence:head.sequence,expectedHeadRevisionId:head.headRevisionId,document:head.document,reason:'periodic',checkpointName:null })
  }

  async capturePeriodicHead(scope: PublicationRepositoryScope, actorId: string, input: Readonly<{ revisionId:string;resourceKind:PublicationRevisionCreateCommand['resourceKind'];resourceId:string;expectedSequence:number;expectedHeadRevisionId:string|null;document:unknown;retentionDays:number }>): Promise<PublicationRevisionRecord> {
    return this.create(scope, actorId, { ...input, reason: 'periodic', checkpointName: null })
  }

  list(scope: PublicationRepositoryScope, resourceKind: string, resourceId: string): Promise<PublicationRevisionList> {
    return this.#repository.list(scope, resourceKind, resourceId)
  }

  async compare(scope: PublicationRepositoryScope, resourceKind: string, resourceId: string, fromRevisionId: string, toRevisionId: string): Promise<PublicationRevisionComparison> {
    const [from, to] = await Promise.all([
      this.#repository.getAvailable(scope, resourceKind, resourceId, fromRevisionId),
      this.#repository.getAvailable(scope, resourceKind, resourceId, toRevisionId),
    ])
    if (!from || !to) throw new PublicationRevisionError('not-found', 'A requested revision or retained snapshot was not found.')
    const [before, after] = await Promise.all([this.#load(scope, from), this.#load(scope, to)])
    const entries: Array<{path:string;kind:'added'|'removed'|'changed';before:unknown;after:unknown}> = []
    const truncated = { value: false }
    appendDiff(entries, jsonValue(before), jsonValue(after), '', truncated)
    return parsePublicationContract('revision comparison', PublicationRevisionComparisonSchema, {
      fromRevisionId, toRevisionId, fromChecksumSha256: from.checksumSha256, toChecksumSha256: to.checksumSha256,
      truncated: truncated.value, entries,
    })
  }

  async restore(scope: PublicationRepositoryScope, resourceKind: string, resourceId: string, actorId: string, input: unknown): Promise<PublicationRevisionRecord> {
    const command = parsePublicationContract('revision restore command', PublicationRevisionRestoreCommandSchema, input)
    const source = await this.#repository.getAvailable(scope, resourceKind, resourceId, command.sourceRevisionId)
    if (!source) throw new PublicationRevisionError('not-found', 'Revision snapshot is unavailable or outside this exact scope.')
    const history = await this.#repository.list(scope, resourceKind, resourceId)
    const currentHead = history.revisions.find((revision) => revision.revisionId === history.headRevisionId)
    if (!currentHead || currentHead.revisionId !== command.expectedHeadRevisionId) throw new PublicationRevisionError('revision-conflict', 'Restore conflicted with a newer revision head.')
    const document = await this.#load(scope, source)
    const createdAt = this.#now().toISOString()
    const restored = parsePublicationContract('restored revision record', PublicationRevisionRecordSchema, {
      ...source, revisionId: command.restoreRevisionId, sequence: currentHead.sequence + 1,
      parentRevisionId: command.expectedHeadRevisionId, actorId, reason: 'restore', checkpointName: null,
      retainedUntil: null, snapshotAvailable: true, createdAt,
    })
    if (!await this.#repository.restore(scope, source, restored, command.expectedHeadRevisionId, document)) throw new PublicationRevisionError('revision-conflict', 'Restore conflicted with a newer collaborative or revision head.')
    return restored
  }

  async expireRetention(scope: PublicationRepositoryScope, actorId: string, limit = 100): Promise<number> {
    const bounded = Math.max(1, Math.min(500, Math.trunc(limit)))
    return this.#repository.expireReferences(scope, this.#now().toISOString(), actorId, Array.from({ length: bounded }, () => this.#ids.id('revision-audit')), bounded)
  }

  async collectGarbage(scope: PublicationRepositoryScope, actorId: string, graceMs = 3_600_000, limit = 100): Promise<number> {
    const before = new Date(this.#now().getTime() - Math.max(60_000, graceMs)).toISOString()
    const claims = await this.#repository.claimUnreferencedSnapshots(scope, before, Math.max(1, Math.min(500, Math.trunc(limit))))
    let collected = 0
    for (const snapshot of claims) {
      try {
        await this.#snapshots.delete(scope, snapshot.objectKey)
        if (await this.#repository.completeSnapshotCollection(scope, snapshot.snapshotId, actorId, this.#ids.id('revision-audit'), this.#now().toISOString())) collected += 1
      } catch (error) {
        await this.#repository.releaseSnapshotClaim(scope, snapshot.snapshotId)
        throw error
      }
    }
    return collected
  }

  async #load(scope: PublicationRepositoryScope, revision: PublicationRevisionRecord): Promise<unknown> {
    return this.#snapshots.get(scope, { objectKey: snapshotObjectKey(scope, revision.snapshotId), checksumSha256: revision.checksumSha256, sizeBytes: revision.sizeBytes })
  }
}

interface RevisionRow {
  revision_id:string;resource_kind:string;resource_id:string;sequence:string|number|bigint;parent_revision_id:string|null;actor_id:string;reason:PublicationRevisionRecord['reason'];checkpoint_name:string|null;snapshot_id:string;checksum_sha256:string;size_bytes:string|number|bigint;retained_until:string|Date|null;created_at:string|Date;snapshot_available:boolean
}
interface SnapshotRow { snapshot_id:string;object_key:string;checksum_sha256:string;size_bytes:string|number|bigint;state:'available'|'deleting';created_at:string|Date }

function integer(value:string|number|bigint, name:string):number { const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<0)throw new PublicationRevisionError('snapshot-corrupt',`${name} is invalid.`);return parsed }
function timestamp(value:string|Date|null):string|null{return value===null?null:new Date(value).toISOString()}
function mapRevision(row:RevisionRow):PublicationRevisionRecord{return parsePublicationContract('stored revision record',PublicationRevisionRecordSchema,{revisionId:row.revision_id,resourceKind:row.resource_kind,resourceId:row.resource_id,sequence:integer(row.sequence,'Revision sequence'),parentRevisionId:row.parent_revision_id,actorId:row.actor_id,reason:row.reason,checkpointName:row.checkpoint_name,snapshotId:row.snapshot_id,checksumSha256:row.checksum_sha256,sizeBytes:integer(row.size_bytes,'Revision size'),retainedUntil:timestamp(row.retained_until),snapshotAvailable:row.snapshot_available,createdAt:timestamp(row.created_at)})}

export class PostgresPublicationRevisionRepository implements PublicationRevisionRepository {
  readonly #db:DbClient
  constructor(db:DbClient){this.#db=db}
  async currentHead(s:PublicationRepositoryScope,k:string,id:string):Promise<Readonly<{sequence:number;document:unknown;headRevisionId:string|null}>>{return this.#authorized(s,async(db)=>{const head=await db<{sequence:string|number|bigint;document_json:unknown}>`select sequence,document_json from fuma_publication_collaboration_heads where platform_id=${s.platformId} and organization_id=${s.organizationId} and workspace_id=${s.workspaceId} and site_id=${s.siteId} and owner_key=${s.ownerKey} and owner_generation=${s.generation} and profile_id=${s.profileId} and resource_kind=${k} and resource_id=${id} for update`;if(!head.rows[0])throw new PublicationRevisionError('not-found','Collaborative resource was not found.');const pointer=await db<{revision_id:string}>`select revision_id from fuma_publication_revision_heads where platform_id=${s.platformId} and organization_id=${s.organizationId} and workspace_id=${s.workspaceId} and site_id=${s.siteId} and owner_key=${s.ownerKey} and owner_generation=${s.generation} and profile_id=${s.profileId} and resource_kind=${k} and resource_id=${id} for update`;return Object.freeze({sequence:integer(head.rows[0].sequence,'Head sequence'),document:clone(head.rows[0].document_json),headRevisionId:pointer.rows[0]?.revision_id??null})})}
  async #authorized<T>(scope:PublicationRepositoryScope,work:(db:DbClient)=>Promise<T>):Promise<T>{return this.#db.transaction(async(db)=>{const authority=await db`select 1 from fuma_tenant_owner_keys owner join fuma_sites site on site.organization_id=owner.organization_id and site.workspace_id=owner.workspace_id and site.id=owner.site_id where owner.platform_id=${scope.platformId} and owner.owner_key=${scope.ownerKey} and owner.organization_id=${scope.organizationId} and owner.workspace_id=${scope.workspaceId} and owner.site_id=${scope.siteId} and owner.generation=${scope.generation} and site.profile_id=${scope.profileId} and owner.state='active' and owner.transfer_id is null and owner.transfer_lock_id is null and owner.transfer_fence is null for share`;if(authority.rowCount!==1)throw new PublicationScopeError();return work(db)})}
  async ensureSnapshot(s:PublicationRepositoryScope,x:RevisionSnapshot):Promise<void>{await this.#authorized(s,async(db)=>{await db`insert into fuma_publication_revision_snapshots (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,snapshot_id,object_key,checksum_sha256,size_bytes,state,created_at) values (${s.platformId},${s.organizationId},${s.workspaceId},${s.siteId},${s.ownerKey},${s.generation},${s.profileId},${x.snapshotId},${x.objectKey},${x.checksumSha256},${x.sizeBytes},'available',${x.createdAt}) on conflict do nothing`;const found=await db<SnapshotRow>`select snapshot_id,object_key,checksum_sha256,size_bytes,state,created_at from fuma_publication_revision_snapshots where platform_id=${s.platformId} and organization_id=${s.organizationId} and workspace_id=${s.workspaceId} and site_id=${s.siteId} and owner_key=${s.ownerKey} and owner_generation=${s.generation} and profile_id=${s.profileId} and snapshot_id=${x.snapshotId} for update`;const row=found.rows[0];if(!row||row.state!=='available'||row.object_key!==x.objectKey||row.checksum_sha256!==x.checksumSha256||integer(row.size_bytes,'Snapshot size')!==x.sizeBytes)throw new PublicationRevisionError('snapshot-corrupt','Snapshot inventory conflicts with immutable object metadata.')})}
  async capture(s:PublicationRepositoryScope,r:PublicationRevisionRecord,expected:string|null):Promise<boolean>{return this.#authorized(s,async(db)=>{const h=await db<{sequence:string|number|bigint}>`select sequence from fuma_publication_collaboration_heads where platform_id=${s.platformId} and organization_id=${s.organizationId} and workspace_id=${s.workspaceId} and site_id=${s.siteId} and owner_key=${s.ownerKey} and owner_generation=${s.generation} and profile_id=${s.profileId} and resource_kind=${r.resourceKind} and resource_id=${r.resourceId} for update`;if(!h.rows[0]||integer(h.rows[0].sequence,'Head sequence')!==r.sequence)return false;const p=await db<{revision_id:string}>`select revision_id from fuma_publication_revision_heads where platform_id=${s.platformId} and organization_id=${s.organizationId} and workspace_id=${s.workspaceId} and site_id=${s.siteId} and owner_key=${s.ownerKey} and owner_generation=${s.generation} and profile_id=${s.profileId} and resource_kind=${r.resourceKind} and resource_id=${r.resourceId} for update`;if((p.rows[0]?.revision_id??null)!==expected)return false;const snapshot=await db`select 1 from fuma_publication_revision_snapshots where platform_id=${s.platformId} and organization_id=${s.organizationId} and workspace_id=${s.workspaceId} and site_id=${s.siteId} and owner_key=${s.ownerKey} and owner_generation=${s.generation} and profile_id=${s.profileId} and snapshot_id=${r.snapshotId} and state='available' for update`;if(snapshot.rowCount!==1)return false;const inserted=await this.#insertRevision(db,s,r);if(!inserted)return false;await db`insert into fuma_publication_revision_heads (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,resource_kind,resource_id,revision_id,updated_at) values (${s.platformId},${s.organizationId},${s.workspaceId},${s.siteId},${s.ownerKey},${s.generation},${s.profileId},${r.resourceKind},${r.resourceId},${r.revisionId},${r.createdAt}) on conflict (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,resource_kind,resource_id) do update set revision_id=excluded.revision_id,updated_at=excluded.updated_at`;await this.#audit(db,s,{eventId:`created-${r.resourceKind}-${r.resourceId}-${r.revisionId}`,action:'revision-created',revision:r,actorId:r.actorId,createdAt:r.createdAt});return true})}
  async #insertRevision(db:DbClient,s:PublicationRepositoryScope,r:PublicationRevisionRecord):Promise<boolean>{const inserted=await db`insert into fuma_publication_revision_entries (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,resource_kind,resource_id,revision_id,sequence,parent_revision_id,actor_id,reason,checkpoint_name,snapshot_id,checksum_sha256,size_bytes,retained_until,created_at) values (${s.platformId},${s.organizationId},${s.workspaceId},${s.siteId},${s.ownerKey},${s.generation},${s.profileId},${r.resourceKind},${r.resourceId},${r.revisionId},${r.sequence},${r.parentRevisionId},${r.actorId},${r.reason},${r.checkpointName},${r.snapshotId},${r.checksumSha256},${r.sizeBytes},${r.retainedUntil},${r.createdAt}) on conflict do nothing`;if(inserted.rowCount!==1)return false;await db`insert into fuma_publication_revision_snapshot_refs (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,resource_kind,resource_id,revision_id,snapshot_id,protected,retained_until,created_at) values (${s.platformId},${s.organizationId},${s.workspaceId},${s.siteId},${s.ownerKey},${s.generation},${s.profileId},${r.resourceKind},${r.resourceId},${r.revisionId},${r.snapshotId},${r.retainedUntil===null},${r.retainedUntil},${r.createdAt})`;return true}
  async list(s:PublicationRepositoryScope,k:string,id:string):Promise<PublicationRevisionList>{return this.#authorized(s,async(db)=>{const rows=await db<RevisionRow>`select entry.revision_id,entry.resource_kind,entry.resource_id,entry.sequence,entry.parent_revision_id,entry.actor_id,entry.reason,entry.checkpoint_name,entry.snapshot_id,entry.checksum_sha256,entry.size_bytes,entry.retained_until,entry.created_at,(ref.revision_id is not null and snapshot.state='available') as snapshot_available from fuma_publication_revision_entries entry left join fuma_publication_revision_snapshot_refs ref on ref.platform_id=entry.platform_id and ref.organization_id=entry.organization_id and ref.workspace_id=entry.workspace_id and ref.site_id=entry.site_id and ref.owner_key=entry.owner_key and ref.owner_generation=entry.owner_generation and ref.profile_id=entry.profile_id and ref.resource_kind=entry.resource_kind and ref.resource_id=entry.resource_id and ref.revision_id=entry.revision_id left join fuma_publication_revision_snapshots snapshot on snapshot.platform_id=entry.platform_id and snapshot.organization_id=entry.organization_id and snapshot.workspace_id=entry.workspace_id and snapshot.site_id=entry.site_id and snapshot.owner_key=entry.owner_key and snapshot.owner_generation=entry.owner_generation and snapshot.profile_id=entry.profile_id and snapshot.snapshot_id=entry.snapshot_id where entry.platform_id=${s.platformId} and entry.organization_id=${s.organizationId} and entry.workspace_id=${s.workspaceId} and entry.site_id=${s.siteId} and entry.owner_key=${s.ownerKey} and entry.owner_generation=${s.generation} and entry.profile_id=${s.profileId} and entry.resource_kind=${k} and entry.resource_id=${id} order by entry.created_at desc,entry.revision_id desc limit 500`;const head=await db<{revision_id:string}>`select revision_id from fuma_publication_revision_heads where platform_id=${s.platformId} and organization_id=${s.organizationId} and workspace_id=${s.workspaceId} and site_id=${s.siteId} and owner_key=${s.ownerKey} and owner_generation=${s.generation} and profile_id=${s.profileId} and resource_kind=${k} and resource_id=${id}`;const collaboration=await db<{sequence:string|number|bigint}>`select sequence from fuma_publication_collaboration_heads where platform_id=${s.platformId} and organization_id=${s.organizationId} and workspace_id=${s.workspaceId} and site_id=${s.siteId} and owner_key=${s.ownerKey} and owner_generation=${s.generation} and profile_id=${s.profileId} and resource_kind=${k} and resource_id=${id}`;if(!collaboration.rows[0])throw new PublicationRevisionError('not-found','Collaborative resource was not found.');return parsePublicationContract('revision list',PublicationRevisionListSchema,{revisions:rows.rows.map(mapRevision),headRevisionId:head.rows[0]?.revision_id??null,currentSequence:integer(collaboration.rows[0].sequence,'Head sequence')})})}
  async getAvailable(s:PublicationRepositoryScope,k:string,id:string,revisionId:string):Promise<PublicationRevisionRecord|null>{return this.#authorized(s,async(db)=>{const result=await db<RevisionRow>`select entry.revision_id,entry.resource_kind,entry.resource_id,entry.sequence,entry.parent_revision_id,entry.actor_id,entry.reason,entry.checkpoint_name,entry.snapshot_id,entry.checksum_sha256,entry.size_bytes,entry.retained_until,entry.created_at,true as snapshot_available from fuma_publication_revision_entries entry join fuma_publication_revision_snapshot_refs ref on ref.platform_id=entry.platform_id and ref.organization_id=entry.organization_id and ref.workspace_id=entry.workspace_id and ref.site_id=entry.site_id and ref.owner_key=entry.owner_key and ref.owner_generation=entry.owner_generation and ref.profile_id=entry.profile_id and ref.resource_kind=entry.resource_kind and ref.resource_id=entry.resource_id and ref.revision_id=entry.revision_id join fuma_publication_revision_snapshots snapshot on snapshot.platform_id=ref.platform_id and snapshot.organization_id=ref.organization_id and snapshot.workspace_id=ref.workspace_id and snapshot.site_id=ref.site_id and snapshot.owner_key=ref.owner_key and snapshot.owner_generation=ref.owner_generation and snapshot.profile_id=ref.profile_id and snapshot.snapshot_id=ref.snapshot_id and snapshot.state='available' where entry.platform_id=${s.platformId} and entry.organization_id=${s.organizationId} and entry.workspace_id=${s.workspaceId} and entry.site_id=${s.siteId} and entry.owner_key=${s.ownerKey} and entry.owner_generation=${s.generation} and entry.profile_id=${s.profileId} and entry.resource_kind=${k} and entry.resource_id=${id} and entry.revision_id=${revisionId}`;return result.rows[0]?mapRevision(result.rows[0]):null})}
  async restore(s:PublicationRepositoryScope,source:PublicationRevisionRecord,r:PublicationRevisionRecord,expected:string,document:unknown):Promise<boolean>{return this.#authorized(s,async(db)=>{const pointer=await db<{revision_id:string}>`select revision_id from fuma_publication_revision_heads where platform_id=${s.platformId} and organization_id=${s.organizationId} and workspace_id=${s.workspaceId} and site_id=${s.siteId} and owner_key=${s.ownerKey} and owner_generation=${s.generation} and profile_id=${s.profileId} and resource_kind=${r.resourceKind} and resource_id=${r.resourceId} for update`;if(pointer.rows[0]?.revision_id!==expected)return false;const head=await db<{sequence:string|number|bigint}>`select sequence from fuma_publication_collaboration_heads where platform_id=${s.platformId} and organization_id=${s.organizationId} and workspace_id=${s.workspaceId} and site_id=${s.siteId} and owner_key=${s.ownerKey} and owner_generation=${s.generation} and profile_id=${s.profileId} and resource_kind=${r.resourceKind} and resource_id=${r.resourceId} for update`;const current=head.rows[0]?integer(head.rows[0].sequence,'Head sequence'):-1;if(current<0||r.sequence!==current+1)return false;const retained=await db`select 1 from fuma_publication_revision_snapshot_refs ref join fuma_publication_revision_snapshots snapshot on snapshot.platform_id=ref.platform_id and snapshot.organization_id=ref.organization_id and snapshot.workspace_id=ref.workspace_id and snapshot.site_id=ref.site_id and snapshot.owner_key=ref.owner_key and snapshot.owner_generation=ref.owner_generation and snapshot.profile_id=ref.profile_id and snapshot.snapshot_id=ref.snapshot_id where ref.platform_id=${s.platformId} and ref.organization_id=${s.organizationId} and ref.workspace_id=${s.workspaceId} and ref.site_id=${s.siteId} and ref.owner_key=${s.ownerKey} and ref.owner_generation=${s.generation} and ref.profile_id=${s.profileId} and ref.resource_kind=${source.resourceKind} and ref.resource_id=${source.resourceId} and ref.revision_id=${source.revisionId} and snapshot.state='available' for update`;if(retained.rowCount!==1)return false;const updated=await db`update fuma_publication_collaboration_heads set sequence=sequence+1,document_json=${JSON.stringify(document)}::text::jsonb,updated_at=${r.createdAt} where platform_id=${s.platformId} and organization_id=${s.organizationId} and workspace_id=${s.workspaceId} and site_id=${s.siteId} and owner_key=${s.ownerKey} and owner_generation=${s.generation} and profile_id=${s.profileId} and resource_kind=${r.resourceKind} and resource_id=${r.resourceId} and sequence=${current}`;if(updated.rowCount!==1)return false;if(!await this.#insertRevision(db,s,r))return false;await db`update fuma_publication_revision_heads set revision_id=${r.revisionId},updated_at=${r.createdAt} where platform_id=${s.platformId} and organization_id=${s.organizationId} and workspace_id=${s.workspaceId} and site_id=${s.siteId} and owner_key=${s.ownerKey} and owner_generation=${s.generation} and profile_id=${s.profileId} and resource_kind=${r.resourceKind} and resource_id=${r.resourceId} and revision_id=${expected}`;await this.#audit(db,s,{eventId:`restored-${r.resourceKind}-${r.resourceId}-${r.revisionId}`,action:'revision-restored',revision:r,actorId:r.actorId,createdAt:r.createdAt});return true})}
  async expireReferences(s:PublicationRepositoryScope,before:string,actorId:string,eventIds:readonly string[],limit:number):Promise<number>{return this.#authorized(s,async(db)=>{const expired=await db<{resource_kind:string;resource_id:string;revision_id:string;snapshot_id:string}>`select ref.resource_kind,ref.resource_id,ref.revision_id,ref.snapshot_id from fuma_publication_revision_snapshot_refs ref left join fuma_publication_revision_heads head on head.platform_id=ref.platform_id and head.organization_id=ref.organization_id and head.workspace_id=ref.workspace_id and head.site_id=ref.site_id and head.owner_key=ref.owner_key and head.owner_generation=ref.owner_generation and head.profile_id=ref.profile_id and head.resource_kind=ref.resource_kind and head.resource_id=ref.resource_id and head.revision_id=ref.revision_id where ref.platform_id=${s.platformId} and ref.organization_id=${s.organizationId} and ref.workspace_id=${s.workspaceId} and ref.site_id=${s.siteId} and ref.owner_key=${s.ownerKey} and ref.owner_generation=${s.generation} and ref.profile_id=${s.profileId} and ref.protected=false and ref.retained_until<${before} and head.revision_id is null order by ref.retained_until,ref.revision_id for update skip locked limit ${limit}`;for(const [index,row] of expired.rows.entries()){await db`delete from fuma_publication_revision_snapshot_refs where platform_id=${s.platformId} and organization_id=${s.organizationId} and workspace_id=${s.workspaceId} and site_id=${s.siteId} and owner_key=${s.ownerKey} and owner_generation=${s.generation} and profile_id=${s.profileId} and resource_kind=${row.resource_kind} and resource_id=${row.resource_id} and revision_id=${row.revision_id} and protected=false`;await this.#audit(db,s,{eventId:eventIds[index]!,action:'snapshot-reference-expired',revision:{resourceKind:row.resource_kind,resourceId:row.resource_id,revisionId:row.revision_id,snapshotId:row.snapshot_id},actorId,createdAt:before})}return expired.rows.length})}
  async claimUnreferencedSnapshots(s:PublicationRepositoryScope,before:string,limit:number):Promise<readonly RevisionSnapshotClaim[]>{return this.#authorized(s,async(db)=>{const candidates=await db<SnapshotRow>`select snapshot.snapshot_id,snapshot.object_key,snapshot.checksum_sha256,snapshot.size_bytes,snapshot.state,snapshot.created_at from fuma_publication_revision_snapshots snapshot where snapshot.platform_id=${s.platformId} and snapshot.organization_id=${s.organizationId} and snapshot.workspace_id=${s.workspaceId} and snapshot.site_id=${s.siteId} and snapshot.owner_key=${s.ownerKey} and snapshot.owner_generation=${s.generation} and snapshot.profile_id=${s.profileId} and snapshot.state='available' and snapshot.created_at<${before} and not exists (select 1 from fuma_publication_revision_snapshot_refs ref where ref.platform_id=snapshot.platform_id and ref.organization_id=snapshot.organization_id and ref.workspace_id=snapshot.workspace_id and ref.site_id=snapshot.site_id and ref.owner_key=snapshot.owner_key and ref.owner_generation=snapshot.owner_generation and ref.profile_id=snapshot.profile_id and ref.snapshot_id=snapshot.snapshot_id) order by snapshot.created_at,snapshot.snapshot_id for update skip locked limit ${limit}`;const output:RevisionSnapshotClaim[]=[];for(const row of candidates.rows){const claimed=await db`update fuma_publication_revision_snapshots set state='deleting' where platform_id=${s.platformId} and organization_id=${s.organizationId} and workspace_id=${s.workspaceId} and site_id=${s.siteId} and owner_key=${s.ownerKey} and owner_generation=${s.generation} and profile_id=${s.profileId} and snapshot_id=${row.snapshot_id} and state='available' and not exists (select 1 from fuma_publication_revision_snapshot_refs ref where ref.platform_id=${s.platformId} and ref.organization_id=${s.organizationId} and ref.workspace_id=${s.workspaceId} and ref.site_id=${s.siteId} and ref.owner_key=${s.ownerKey} and ref.owner_generation=${s.generation} and ref.profile_id=${s.profileId} and ref.snapshot_id=${row.snapshot_id})`;if(claimed.rowCount===1)output.push({snapshotId:row.snapshot_id,objectKey:row.object_key,checksumSha256:row.checksum_sha256,sizeBytes:integer(row.size_bytes,'Snapshot size'),state:'deleting',createdAt:timestamp(row.created_at)!})}return Object.freeze(output)})}
  async completeSnapshotCollection(s:PublicationRepositoryScope,snapshotId:string,actorId:string,eventId:string,createdAt:string):Promise<boolean>{return this.#authorized(s,async(db)=>{const removed=await db`delete from fuma_publication_revision_snapshots snapshot where snapshot.platform_id=${s.platformId} and snapshot.organization_id=${s.organizationId} and snapshot.workspace_id=${s.workspaceId} and snapshot.site_id=${s.siteId} and snapshot.owner_key=${s.ownerKey} and snapshot.owner_generation=${s.generation} and snapshot.profile_id=${s.profileId} and snapshot.snapshot_id=${snapshotId} and snapshot.state='deleting' and not exists (select 1 from fuma_publication_revision_snapshot_refs ref where ref.platform_id=snapshot.platform_id and ref.organization_id=snapshot.organization_id and ref.workspace_id=snapshot.workspace_id and ref.site_id=snapshot.site_id and ref.owner_key=snapshot.owner_key and ref.owner_generation=snapshot.owner_generation and ref.profile_id=snapshot.profile_id and ref.snapshot_id=snapshot.snapshot_id)`;if(removed.rowCount===1)await this.#audit(db,s,{eventId,action:'snapshot-collected',revision:{snapshotId},actorId,createdAt});return removed.rowCount===1})}
  async releaseSnapshotClaim(s:PublicationRepositoryScope,snapshotId:string):Promise<void>{await this.#authorized(s,async(db)=>{await db`update fuma_publication_revision_snapshots set state='available' where platform_id=${s.platformId} and organization_id=${s.organizationId} and workspace_id=${s.workspaceId} and site_id=${s.siteId} and owner_key=${s.ownerKey} and owner_generation=${s.generation} and profile_id=${s.profileId} and snapshot_id=${snapshotId} and state='deleting'`})}
  async #audit(db:DbClient,s:PublicationRepositoryScope,input:{eventId:string;action:string;revision:{resourceKind?:string;resourceId?:string;revisionId?:string;snapshotId?:string};actorId:string;createdAt:string}):Promise<void>{await db`insert into fuma_publication_revision_audit (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,event_id,action,resource_kind,resource_id,revision_id,snapshot_id,actor_id,details_json,created_at) values (${s.platformId},${s.organizationId},${s.workspaceId},${s.siteId},${s.ownerKey},${s.generation},${s.profileId},${input.eventId},${input.action},${input.revision.resourceKind??null},${input.revision.resourceId??null},${input.revision.revisionId??null},${input.revision.snapshotId??null},${input.actorId},${JSON.stringify({action:input.action})}::text::jsonb,${input.createdAt})`}
}
