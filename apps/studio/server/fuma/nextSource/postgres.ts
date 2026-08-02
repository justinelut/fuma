import { strToU8, strFromU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { FileMap } from '@core/siteImport/types'
import {
  NextSourceDraftRevisionSchema,
  NextSourceFixReceiptSchema,
  NextSourceIngestReceiptSchema,
  NextSourcePatchSchema,
  NextSourceRollbackReceiptSchema,
  type NextSourceDraftRepository,
  type NextSourceDraftRevision,
  type NextSourceFixReceipt,
  type NextSourceIngestReceipt,
  type NextSourcePatch,
  type NextSourceRollbackReceipt,
} from '@core/siteImport'
import type { DbClient } from '../../db/client'
import { ObjectStorageError, sha256Hex, type ObjectTenantScope, type TenantObjectStorage } from '../objectStorage'

export type NextSourceScope = Readonly<{
  platformId: string
  organizationId: string
  workspaceId: string
  siteId: string
  ownerKey: string
  ownerGeneration: number
  profileId: string
}>

type RevisionRow = Readonly<{
  revision_json: unknown
  object_key: string
  object_hash_sha256: string
  object_size_bytes: string | number | bigint
}>
type FixRow = Readonly<{
  receipt_json: unknown
  patch_object_key: string
  patch_object_hash_sha256: string
  patch_object_size_bytes: string | number | bigint
}>
type ReceiptRow = Readonly<{ receipt_json: unknown }>

const canonical = (value: unknown): string => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`

function parse<T>(schema: Parameters<typeof safeParseValue>[0], value: unknown, label: string): T {
  const parsed = safeParseValue(schema, typeof value === 'string' ? JSON.parse(value) : value)
  if (!parsed.ok) throw new Error(`${label} failed strict TypeBox validation.`)
  return parsed.value as T
}

function archive(fileMap: FileMap): Uint8Array {
  const entries: Zippable = {}
  for (const [path, file] of Object.entries(fileMap.files).sort(([a], [b]) => a.localeCompare(b))) {
    entries[path] = [file.bytes, { level: 0, mtime: new Date('1980-01-01T00:00:00.000Z') }]
  }
  return zipSync(entries)
}

function fileMap(bytes: Uint8Array): FileMap {
  const files = unzipSync(bytes)
  return {
    files: Object.fromEntries(
      Object.entries(files)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, value]) => [path, { bytes: value }]),
    ),
  }
}

function patchArchive(patches: readonly NextSourcePatch[]): Uint8Array {
  return zipSync({
    'patches.json': [strToU8(JSON.stringify(patches)), { level: 0, mtime: new Date('1980-01-01T00:00:00.000Z') }],
  })
}

function patchesFromArchive(bytes: Uint8Array): readonly NextSourcePatch[] {
  const entries = unzipSync(bytes)
  if (Object.keys(entries).length !== 1 || !entries['patches.json']) throw new Error('Stored Next source patch archive is invalid.')
  const raw = JSON.parse(strFromU8(entries['patches.json'])) as unknown
  if (!Array.isArray(raw)) throw new Error('Stored Next source patch set is invalid.')
  return Object.freeze(raw.map((item) => parse<NextSourcePatch>(NextSourcePatchSchema, item, 'Stored Next source patch')))
}

function objectScope(scope: NextSourceScope): ObjectTenantScope {
  return { organizationId: scope.organizationId, workspaceId: scope.workspaceId, siteId: scope.siteId }
}

function scopeArgs(scope: NextSourceScope): readonly unknown[] {
  return [scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.ownerGeneration, scope.profileId]
}

function sameDestination(revision: Pick<NextSourceDraftRevision, 'destination'>, scope: NextSourceScope): boolean {
  return revision.destination.organizationId === scope.organizationId
    && revision.destination.workspaceId === scope.workspaceId
    && revision.destination.siteId === scope.siteId
}

function fileEvidence(files: FileMap): readonly Readonly<{ path: string; sizeBytes: number; sha256: string }>[] {
  return Object.entries(files.files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, entry]) => Object.freeze({ path, sizeBytes: entry.bytes.byteLength, sha256: sha256Hex(entry.bytes) }))
}

function sourceHash(files: FileMap): string {
  return sha256Hex(strToU8(JSON.stringify(fileEvidence(files).map((item) => [item.path, item.sizeBytes, item.sha256]))))
}

function assertRevisionFiles(revision: NextSourceDraftRevision, files: FileMap): void {
  const evidence = fileEvidence(files)
  const hash = sourceHash(files)
  if (
    hash !== revision.sourceHashSha256
    || revision.analysis.sourceHashSha256 !== hash
    || canonical(revision.analysis.files) !== canonical(evidence)
    || canonical(revision.analysis.destination) !== canonical(revision.destination)
    || canonical(revision.analysis.provenance) !== canonical(revision.provenance)
  ) throw new Error('Next source revision files do not match immutable analysis evidence.')
}

async function putImmutableObject(
  storage: TenantObjectStorage,
  scope: ObjectTenantScope,
  key: string,
  bytes: Uint8Array,
  checksumSha256: string,
): Promise<void> {
  try {
    await storage.put({ scope, key, bytes, mimeType: 'application/zip', checksumSha256 })
  } catch (error) {
    if (!(error instanceof ObjectStorageError) || error.code !== 'already_exists') throw error
    const prior = await storage.head(scope, key)
    if (prior.checksumSha256 !== checksumSha256 || prior.sizeBytes !== bytes.byteLength || prior.mimeType !== 'application/zip') {
      throw new Error('Next source object identity collision.', { cause: error })
    }
  }
}

async function readImmutableObject(
  storage: TenantObjectStorage,
  scope: ObjectTenantScope,
  key: string,
  checksumSha256: string,
  sizeBytes: string | number | bigint,
): Promise<Uint8Array> {
  const metadata = await storage.head(scope, key)
  const bytes = await storage.get(scope, key)
  if (
    metadata.key !== key
    || metadata.mimeType !== 'application/zip'
    || metadata.checksumSha256 !== checksumSha256
    || metadata.sizeBytes !== Number(sizeBytes)
    || bytes.byteLength !== Number(sizeBytes)
    || sha256Hex(bytes) !== checksumSha256
  ) throw new Error('Stored Next source object failed immutable integrity.')
  return bytes
}

export class PostgresNextSourceDraftRepository implements NextSourceDraftRepository {
  readonly #db: DbClient
  readonly #storage: TenantObjectStorage
  readonly #scope: NextSourceScope

  constructor(input: Readonly<{ db: DbClient; storage: TenantObjectStorage; scope: NextSourceScope }>) {
    if (input.db.dialect !== 'postgres') throw new TypeError('Hosted Next source persistence requires PostgreSQL.')
    this.#db = input.db
    this.#storage = input.storage
    this.#scope = Object.freeze(structuredClone(input.scope))
  }

  async getRevision(revisionId: string): Promise<Readonly<{ revision: NextSourceDraftRevision; files: FileMap }> | null> {
    const result = await this.#db.unsafe<RevisionRow>(`select revision_json,object_key,object_hash_sha256,object_size_bytes from fuma_next_source_revisions_v1 where platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4 and owner_key=$5 and owner_generation=$6 and profile_id=$7 and revision_id=$8`, [...scopeArgs(this.#scope), revisionId])
    const row = result.rows[0]
    if (!row) return null
    const revision = parse<NextSourceDraftRevision>(NextSourceDraftRevisionSchema, row.revision_json, 'Stored Next source revision')
    if (!sameDestination(revision, this.#scope)) throw new Error('Stored Next source revision escaped its destination.')
    const bytes = await readImmutableObject(this.#storage, objectScope(this.#scope), row.object_key, row.object_hash_sha256, row.object_size_bytes)
    const files = fileMap(bytes)
    assertRevisionFiles(revision, files)
    return Object.freeze({ revision, files })
  }

  async putRevision(value: Readonly<{ revision: NextSourceDraftRevision; files: FileMap }>): Promise<void> {
    const revision = parse<NextSourceDraftRevision>(NextSourceDraftRevisionSchema, value.revision, 'Next source revision')
    if (!sameDestination(revision, this.#scope)) throw new Error('Next source revision destination does not match current owner scope.')
    assertRevisionFiles(revision, value.files)
    const bytes = archive(value.files)
    const objectHash = sha256Hex(bytes)
    const objectKey = `imports/next-source/revisions/${objectHash}.zip`
    await putImmutableObject(this.#storage, objectScope(this.#scope), objectKey, bytes, objectHash)
    const inserted = await this.#db.unsafe(`insert into fuma_next_source_revisions_v1(revision_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,source_hash_sha256,object_key,object_hash_sha256,object_size_bytes,revision_json,state,parent_revision_id,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text::jsonb,$14,$15,$16) on conflict(revision_id) do nothing`, [revision.revisionId, ...scopeArgs(this.#scope), revision.sourceHashSha256, objectKey, objectHash, bytes.byteLength, JSON.stringify(revision), revision.state, revision.parentRevisionId, revision.createdAt])
    if (inserted.rowCount === 1) return
    const prior = await this.getRevision(revision.revisionId)
    if (!prior || canonical(prior.revision) !== canonical(revision) || sha256Hex(archive(prior.files)) !== objectHash) throw new Error('Next source revision replay evidence changed.')
  }

  async getFix(receiptId: string): Promise<Readonly<{ receipt: NextSourceFixReceipt; patches: readonly NextSourcePatch[] }> | null> {
    const result = await this.#db.unsafe<FixRow>(`select receipt_json,patch_object_key,patch_object_hash_sha256,patch_object_size_bytes from fuma_next_source_fixes_v1 where platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4 and owner_key=$5 and owner_generation=$6 and profile_id=$7 and receipt_id=$8`, [...scopeArgs(this.#scope), receiptId])
    const row = result.rows[0]
    if (!row) return null
    const receipt = parse<NextSourceFixReceipt>(NextSourceFixReceiptSchema, row.receipt_json, 'Stored Next source fix')
    const bytes = await readImmutableObject(this.#storage, objectScope(this.#scope), row.patch_object_key, row.patch_object_hash_sha256, row.patch_object_size_bytes)
    const patches = patchesFromArchive(bytes)
    if (sha256Hex(strToU8(canonical(patches))) !== receipt.patchHashSha256) throw new Error('Stored Next source patches escaped their receipt hash.')
    return Object.freeze({ receipt, patches })
  }

  async putFix(value: Readonly<{ receipt: NextSourceFixReceipt; patches: readonly NextSourcePatch[] }>): Promise<void> {
    const receipt = parse<NextSourceFixReceipt>(NextSourceFixReceiptSchema, value.receipt, 'Next source fix')
    if (!sameDestination({ destination: receipt.authority.destination } as Pick<NextSourceDraftRevision, 'destination'>, this.#scope) || receipt.authority.ownerGeneration !== this.#scope.ownerGeneration) {
      throw new Error('Next source fix destination does not match current owner scope.')
    }
    const patches = value.patches.map((item) => parse<NextSourcePatch>(NextSourcePatchSchema, item, 'Next source patch'))
    if (sha256Hex(strToU8(canonical(patches))) !== receipt.patchHashSha256) throw new Error('Next source patches do not match their receipt hash.')
    const bytes = patchArchive(patches)
    const objectHash = sha256Hex(bytes)
    const objectKey = `imports/next-source/fixes/${objectHash}.zip`
    await putImmutableObject(this.#storage, objectScope(this.#scope), objectKey, bytes, objectHash)
    const inserted = await this.#db.unsafe(`insert into fuma_next_source_fixes_v1(receipt_id,source_revision_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,operation_id,receipt_json,patch_object_key,patch_object_hash_sha256,patch_object_size_bytes,state,created_at,confirmed_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text::jsonb,$12,$13,$14,$15,$16,$17) on conflict(receipt_id) do nothing`, [receipt.receiptId, receipt.authority.sourceRevisionId, ...scopeArgs(this.#scope), receipt.authority.operationId, JSON.stringify(receipt), objectKey, objectHash, bytes.byteLength, receipt.state, receipt.createdAt, receipt.confirmedAt])
    if (inserted.rowCount === 1) return
    const prior = await this.getFix(receipt.receiptId)
    if (!prior || canonical(prior) !== canonical({ receipt, patches })) throw new Error('Next source fix replay evidence changed.')
  }

  async updateFix(receiptValue: NextSourceFixReceipt): Promise<void> {
    const receipt = parse<NextSourceFixReceipt>(NextSourceFixReceiptSchema, receiptValue, 'Next source fix update')
    const result = await this.#db.unsafe(`update fuma_next_source_fixes_v1 set receipt_json=$1::text::jsonb,state=$2,confirmed_at=$3,version=version+1 where platform_id=$4 and organization_id=$5 and workspace_id=$6 and site_id=$7 and owner_key=$8 and owner_generation=$9 and profile_id=$10 and receipt_id=$11 and (($2='owner-confirmed' and state='proposed') or ($2='applied' and state='owner-confirmed') or ($2='applied' and $12=false and state='proposed') or ($2='revoked' and state in ('proposed','owner-confirmed')))`, [JSON.stringify(receipt), receipt.state, receipt.confirmedAt, ...scopeArgs(this.#scope), receipt.receiptId, receipt.executableChange])
    if (result.rowCount !== 1) {
      const prior = await this.getFix(receipt.receiptId)
      if (!prior || canonical(prior.receipt) !== canonical(receipt)) throw new Error('Next source fix changed concurrently.')
    }
  }

  async putRollback(value: NextSourceRollbackReceipt): Promise<void> {
    const receipt = parse<NextSourceRollbackReceipt>(NextSourceRollbackReceiptSchema, value, 'Next source rollback')
    if (!sameDestination({ destination: receipt.destination } as Pick<NextSourceDraftRevision, 'destination'>, this.#scope)) throw new Error('Rollback destination does not match current owner scope.')
    const inserted = await this.#db.unsafe(`insert into fuma_next_source_rollbacks_v1(receipt_id,from_revision_id,restored_revision_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,receipt_json,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text::jsonb,$12) on conflict(receipt_id) do nothing`, [receipt.receiptId, receipt.fromRevisionId, receipt.restoredRevisionId, ...scopeArgs(this.#scope), JSON.stringify(receipt), receipt.createdAt])
    if (inserted.rowCount !== 1) {
      const prior = await this.#db.unsafe<ReceiptRow>(`select receipt_json from fuma_next_source_rollbacks_v1 where platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4 and owner_key=$5 and owner_generation=$6 and profile_id=$7 and receipt_id=$8`, [...scopeArgs(this.#scope), receipt.receiptId])
      if (!prior.rows[0] || canonical(parse<NextSourceRollbackReceipt>(NextSourceRollbackReceiptSchema, prior.rows[0].receipt_json, 'Stored rollback')) !== canonical(receipt)) throw new Error('Rollback replay evidence changed.')
    }
  }

  async putIngestReceipt(revisionId: string, value: NextSourceIngestReceipt): Promise<void> {
    const receipt = parse<NextSourceIngestReceipt>(NextSourceIngestReceiptSchema, value, 'Next source ingest receipt')
    if (!sameDestination({ destination: receipt.destination } as Pick<NextSourceDraftRevision, 'destination'>, this.#scope)) throw new Error('Ingest receipt destination does not match current owner scope.')
    const inserted = await this.#db.unsafe(`insert into fuma_next_source_ingest_receipts_v1(receipt_id,revision_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,receipt_json,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text::jsonb,$11) on conflict(platform_id,owner_key,owner_generation,profile_id,revision_id,receipt_id) do nothing`, [receipt.receiptId, revisionId, ...scopeArgs(this.#scope), JSON.stringify(receipt), receipt.createdAt])
    if (inserted.rowCount !== 1) {
      const prior = await this.#db.unsafe<ReceiptRow>(`select receipt_json from fuma_next_source_ingest_receipts_v1 where platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4 and owner_key=$5 and owner_generation=$6 and profile_id=$7 and revision_id=$8 and receipt_id=$9`, [...scopeArgs(this.#scope), revisionId, receipt.receiptId])
      if (!prior.rows[0] || canonical(parse<NextSourceIngestReceipt>(NextSourceIngestReceiptSchema, prior.rows[0].receipt_json, 'Stored ingest receipt')) !== canonical(receipt)) throw new Error('Ingest receipt replay evidence changed.')
    }
  }
}
