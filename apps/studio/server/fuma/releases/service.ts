import {
  Type,
  safeParseValue,
  type Static,
  type TSchema,
} from '@core/utils/typeboxHelpers'
import {
  ObjectStorageError,
  sha256Hex,
  type ObjectMetadata,
  type ObjectTenantScope,
  type TenantObjectStorage,
} from '../objectStorage'
import {
  FumaRepositoryScopeSchema,
  TenantKeyIdSchema,
  type FumaRepositoryScope,
} from '../tenancy'
import {
  ReleaseBuildClaimSchema,
  ReleaseFailureSchema,
  ReleaseHashSchema,
  type ActiveReleasePointer,
  type ReleaseBuildClaim,
  type ReleaseFailure,
  type ReleaseManifest,
  type ReleaseRecord,
  type ReleaseRetentionRoot,
  validateActiveReleasePointer,
  validateReleaseRecord,
  validateReleaseRetentionRoot,
} from './contracts'
import { assertReleaseManifest } from './manifest'
import { releaseObjectPrefix } from './keyPolicy'
import type {
  BoundReleaseRepository,
  ReleaseRepository,
  ReleaseRepositoryTransaction,
} from './repository'

const QueueReleaseSchema = Type.Object({
  releaseId: TenantKeyIdSchema,
  sourceSnapshotHashSha256: ReleaseHashSchema,
}, { additionalProperties: false })

const BuildReleaseSchema = Type.Object({
  releaseId: TenantKeyIdSchema,
  buildClaim: ReleaseBuildClaimSchema,
}, { additionalProperties: false })

const FinalizeReleaseSchema = Type.Object({
  releaseId: TenantKeyIdSchema,
  buildClaim: ReleaseBuildClaimSchema,
  manifest: Type.Unknown(),
}, { additionalProperties: false })

const FailReleaseSchema = Type.Object({
  releaseId: TenantKeyIdSchema,
  buildClaim: Type.Union([ReleaseBuildClaimSchema, Type.Null()]),
  failure: ReleaseFailureSchema,
}, { additionalProperties: false })

const ReleaseIdSchema = Type.Object({
  releaseId: TenantKeyIdSchema,
}, { additionalProperties: false })

const RetainReleaseSchema = Type.Object({
  releaseId: TenantKeyIdSchema,
  rootId: TenantKeyIdSchema,
}, { additionalProperties: false })

type QueueRelease = Static<typeof QueueReleaseSchema>
type BuildRelease = Static<typeof BuildReleaseSchema>
type FinalizeRelease = Static<typeof FinalizeReleaseSchema>
type FailRelease = Static<typeof FailReleaseSchema>
type ReleaseId = Static<typeof ReleaseIdSchema>
type RetainRelease = Static<typeof RetainReleaseSchema>

export type ReleaseServiceErrorCode =
  | 'invalid-input'
  | 'not-found'
  | 'already-exists'
  | 'invalid-transition'
  | 'claim-mismatch'
  | 'manifest-mismatch'
  | 'object-missing'
  | 'object-hash-mismatch'
  | 'object-inventory-mismatch'
  | 'concurrent-update'
  | 'active-release'
  | 'retained-release'
  | 'retention-conflict'

export class ReleaseServiceError extends Error {
  readonly code: ReleaseServiceErrorCode
  readonly path?: string

  constructor(code: ReleaseServiceErrorCode, message: string, path?: string) {
    super(message)
    this.name = 'ReleaseServiceError'
    this.code = code
    this.path = path
  }
}

function serviceError(
  code: ReleaseServiceErrorCode,
  message: string,
  path?: string,
): ReleaseServiceError {
  return new ReleaseServiceError(code, message, path)
}

function parse<T extends TSchema>(schema: T, value: unknown, path: string): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw serviceError('invalid-input', `${path} failed validation.`, path)
  return parsed.value
}

function validNow(now: () => Date): string {
  const value = now()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw serviceError('invalid-input', 'Release clock returned an invalid timestamp.', 'now')
  }
  return value.toISOString()
}

function sameClaim(left: ReleaseBuildClaim | null, right: ReleaseBuildClaim | null): boolean {
  return left?.jobId === right?.jobId && left?.fence === right?.fence
}

function sameFailure(left: ReleaseFailure | null, right: ReleaseFailure): boolean {
  return left?.code === right.code && left.retryable === right.retryable
}

function scopeIdentity(scope: FumaRepositoryScope): Readonly<{
  platformId: string
  organizationId: string
  workspaceId: string
  siteId: string
  ownerKey: string
}> {
  return {
    platformId: scope.platformId,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
    ownerKey: scope.ownerKey,
  }
}

function objectScope(scope: FumaRepositoryScope): ObjectTenantScope {
  return {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
  }
}

function nextRecord(
  current: ReleaseRecord,
  patch: Partial<ReleaseRecord>,
  updatedAt: string,
): ReleaseRecord {
  return validateReleaseRecord({
    ...current,
    ...patch,
    version: current.version + 1,
    updatedAt,
  })
}

function requiredRelease(
  release: ReleaseRecord | null,
  releaseId: string,
): ReleaseRecord {
  if (release === null) {
    throw serviceError('not-found', `Release ${releaseId} was not found.`, 'releaseId')
  }
  return release
}

function assertStatus(release: ReleaseRecord, expected: ReleaseRecord['status']): void {
  if (release.status !== expected) {
    throw serviceError(
      'invalid-transition',
      `Release ${release.releaseId} cannot transition from ${release.status}; expected ${expected}.`,
      'releaseId',
    )
  }
}

function exactManifest(release: ReleaseRecord, manifest: ReleaseManifest): void {
  if (manifest.releaseId !== release.releaseId
    || manifest.ownerKey !== release.ownerKey
    || manifest.siteId !== release.siteId
    || manifest.sourceSnapshotHashSha256 !== release.sourceSnapshotHashSha256) {
    throw serviceError(
      'manifest-mismatch',
      'Release manifest identity does not match the queued release.',
      'manifest',
    )
  }
}

function metadataMatches(
  metadata: ObjectMetadata,
  expected: ReleaseManifest['artifacts'][number],
): boolean {
  return metadata.key === expected.objectKey
    && metadata.sizeBytes === expected.sizeBytes
    && metadata.mimeType === expected.mimeType
    && metadata.checksumSha256 === expected.contentHashSha256
}

async function verifyManifestObjects(
  storage: TenantObjectStorage,
  scope: FumaRepositoryScope,
  manifest: ReleaseManifest,
): Promise<void> {
  const tenantScope = objectScope(scope)
  let listed
  try {
    listed = await storage.list(tenantScope, releaseObjectPrefix(manifest.releaseId))
  } catch (_error) {
    throw serviceError('object-missing', 'Release object inventory could not be read.', 'manifest.artifacts')
  }
  const expectedByKey = new Map(manifest.artifacts.map((artifact) => [artifact.objectKey, artifact]))
  const actualKeys = listed.objects.map(({ key }) => key).sort()
  const expectedKeys = [...expectedByKey.keys()].sort()
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw serviceError(
      'object-inventory-mismatch',
      'Release object inventory must exactly match the manifest.',
      'manifest.artifacts',
    )
  }

  for (const [objectKey, artifact] of expectedByKey) {
    let metadata: ObjectMetadata
    let bytes: Uint8Array
    try {
      [metadata, bytes] = await Promise.all([
        storage.head(tenantScope, objectKey),
        storage.get(tenantScope, objectKey),
      ])
    } catch (error) {
      if (error instanceof ObjectStorageError && [
        'corrupt_object',
        'checksum_mismatch',
        'mime_mismatch',
      ].includes(error.code)) {
        throw serviceError(
          'object-hash-mismatch',
          `Release object ${objectKey} failed immutable storage integrity.`,
          'objectKey',
        )
      }
      throw serviceError('object-missing', `Release object ${objectKey} is unavailable.`, 'objectKey')
    }
    if (!metadataMatches(metadata, artifact)
      || bytes.byteLength !== artifact.sizeBytes
      || sha256Hex(bytes) !== artifact.contentHashSha256) {
      throw serviceError(
        'object-hash-mismatch',
        `Release object ${objectKey} does not match its immutable identity.`,
        'objectKey',
      )
    }
  }
}

export type ReleaseServiceOptions = Readonly<{
  repository: ReleaseRepository
  objectStorage: TenantObjectStorage
  now?: () => Date
}>

/**
 * FUMA-048 lifecycle authority. Rendering, object writes, and durable worker
 * registration remain FUMA-049 responsibilities.
 */
export class ReleaseService {
  readonly #repository: ReleaseRepository
  readonly #objectStorage: TenantObjectStorage
  readonly #now: () => Date

  constructor(options: ReleaseServiceOptions) {
    this.#repository = options.repository
    this.#objectStorage = options.objectStorage
    this.#now = options.now ?? (() => new Date())
  }

  #bound(scope: FumaRepositoryScope): BoundReleaseRepository {
    const parsed = safeParseValue(FumaRepositoryScopeSchema, scope)
    if (!parsed.ok || parsed.value.state !== 'active' || parsed.value.transferFence !== null) {
      throw serviceError('invalid-input', 'An active exact release scope is required.', 'scope')
    }
    return this.#repository.forScope(scope)
  }

  async queue(scope: FumaRepositoryScope, input: unknown): Promise<ReleaseRecord> {
    const command: QueueRelease = parse(QueueReleaseSchema, input, 'queueRelease')
    const time = validNow(this.#now)
    const record = validateReleaseRecord({
      ...scopeIdentity(scope),
      releaseId: command.releaseId,
      sourceSnapshotHashSha256: command.sourceSnapshotHashSha256,
      status: 'queued',
      buildClaim: null,
      manifest: null,
      failure: null,
      version: 1,
      queuedAt: time,
      buildingAt: null,
      readyAt: null,
      activatedAt: null,
      failedAt: null,
      updatedAt: time,
    })
    return await this.#bound(scope).transaction(async (transaction) => {
      if (await transaction.insert(record)) return record
      const existing = requiredRelease(await transaction.get(command.releaseId), command.releaseId)
      if (existing.sourceSnapshotHashSha256 !== command.sourceSnapshotHashSha256) {
        throw serviceError('already-exists', 'Release identity already exists with another immutable snapshot.', 'releaseId')
      }
      return existing
    })
  }

  async startBuilding(scope: FumaRepositoryScope, input: unknown): Promise<ReleaseRecord> {
    const command: BuildRelease = parse(BuildReleaseSchema, input, 'buildRelease')
    const time = validNow(this.#now)
    return await this.#bound(scope).transaction(async (transaction) => {
      const current = requiredRelease(await transaction.get(command.releaseId), command.releaseId)
      if ((current.status === 'building' || current.status === 'ready' || current.status === 'active')
        && sameClaim(current.buildClaim, command.buildClaim)) return current
      assertStatus(current, 'queued')
      const next = nextRecord(current, {
        status: 'building',
        buildClaim: command.buildClaim,
        buildingAt: time,
      }, time)
      if (!await transaction.update(next, current.version)) {
        throw serviceError('concurrent-update', 'Release build claim lost a concurrent update.')
      }
      return next
    })
  }

  async fail(scope: FumaRepositoryScope, input: unknown): Promise<ReleaseRecord> {
    const command: FailRelease = parse(FailReleaseSchema, input, 'failRelease')
    const time = validNow(this.#now)
    return await this.#bound(scope).transaction(async (transaction) => {
      const current = requiredRelease(await transaction.get(command.releaseId), command.releaseId)
      if (current.status === 'failed'
        && sameClaim(current.buildClaim, command.buildClaim)
        && sameFailure(current.failure, command.failure)) return current
      if (current.status !== 'queued' && current.status !== 'building') {
        throw serviceError('invalid-transition', `Release ${current.releaseId} cannot fail from ${current.status}.`)
      }
      if (!sameClaim(current.buildClaim, command.buildClaim)) {
        throw serviceError('claim-mismatch', 'Release failure claim does not own the build.', 'buildClaim')
      }
      const next = nextRecord(current, {
        status: 'failed',
        failure: command.failure as ReleaseFailure,
        failedAt: time,
      }, time)
      if (!await transaction.update(next, current.version)) {
        throw serviceError('concurrent-update', 'Release failure lost a concurrent update.')
      }
      return next
    })
  }

  async finalize(scope: FumaRepositoryScope, input: unknown): Promise<ReleaseRecord> {
    const command: FinalizeRelease = parse(FinalizeReleaseSchema, input, 'finalizeRelease')
    assertReleaseManifest(command.manifest)
    const manifest = command.manifest
    const bound = this.#bound(scope)
    const candidate = await bound.transaction(async (transaction) => {
      const current = requiredRelease(await transaction.get(command.releaseId), command.releaseId)
      if ((current.status === 'ready' || current.status === 'active')
        && sameClaim(current.buildClaim, command.buildClaim)
        && current.manifest?.manifestHashSha256 === manifest.manifestHashSha256) {
        exactManifest(current, manifest)
        return { release: current, alreadyFinalized: true as const }
      }
      assertStatus(current, 'building')
      if (!sameClaim(current.buildClaim, command.buildClaim)) {
        throw serviceError('claim-mismatch', 'Release finalize claim does not own the build.', 'buildClaim')
      }
      exactManifest(current, manifest)
      return { release: current, alreadyFinalized: false as const }
    })

    await verifyManifestObjects(this.#objectStorage, scope, manifest)
    if (candidate.alreadyFinalized) return candidate.release
    const time = validNow(this.#now)
    return await bound.transaction(async (transaction) => {
      const current = requiredRelease(await transaction.get(command.releaseId), command.releaseId)
      if (current.version !== candidate.release.version) {
        throw serviceError('concurrent-update', 'Release changed while manifest objects were verified.')
      }
      assertStatus(current, 'building')
      if (!sameClaim(current.buildClaim, command.buildClaim)) {
        throw serviceError('claim-mismatch', 'Release finalize claim no longer owns the build.', 'buildClaim')
      }
      const next = nextRecord(current, {
        status: 'ready',
        manifest,
        readyAt: time,
      }, time)
      if (!await transaction.update(next, current.version)) {
        throw serviceError('concurrent-update', 'Release finalize lost a concurrent update.')
      }
      return next
    })
  }

  async verify(scope: FumaRepositoryScope, input: unknown): Promise<ReleaseRecord> {
    const command: ReleaseId = parse(ReleaseIdSchema, input, 'verifyRelease')
    const release = requiredRelease(await this.#bound(scope).read(command.releaseId), command.releaseId)
    if ((release.status !== 'ready' && release.status !== 'active') || release.manifest === null) {
      throw serviceError('invalid-transition', 'Only ready or active releases can be verified.')
    }
    await verifyManifestObjects(this.#objectStorage, scope, release.manifest)
    return release
  }

  async activate(scope: FumaRepositoryScope, input: unknown): Promise<Readonly<{
    release: ReleaseRecord
    previousReleaseId: string | null
    pointer: ActiveReleasePointer
  }>> {
    const command: ReleaseId = parse(ReleaseIdSchema, input, 'activateRelease')
    const bound = this.#bound(scope)
    const verified = await this.verify(scope, command)
    const time = validNow(this.#now)
    return await bound.transaction(async (transaction) => {
      let target = requiredRelease(await transaction.get(command.releaseId), command.releaseId)
      if (target.version !== verified.version) {
        throw serviceError('concurrent-update', 'Release changed while activation integrity was verified.')
      }
      const previousPointer = await transaction.getActivePointer()
      if (previousPointer?.releaseId === target.releaseId && target.status === 'active') {
        return { release: target, previousReleaseId: target.releaseId, pointer: previousPointer }
      }
      assertStatus(target, 'ready')

      let previousReleaseId: string | null = null
      if (previousPointer !== null) {
        previousReleaseId = previousPointer.releaseId
        const previous = requiredRelease(
          await transaction.get(previousPointer.releaseId),
          previousPointer.releaseId,
        )
        assertStatus(previous, 'active')
        const demoted = nextRecord(previous, { status: 'ready' }, time)
        if (!await transaction.update(demoted, previous.version)) {
          throw serviceError('concurrent-update', 'Previous active release changed during activation.')
        }
        if (!await transaction.deleteRetentionRoot('active', 'active')) {
          throw serviceError('retention-conflict', 'Previous active retention root is missing.')
        }
      }

      target = nextRecord(target, { status: 'active', activatedAt: time }, time)
      if (!await transaction.update(target, verified.version)) {
        throw serviceError('concurrent-update', 'Target release changed during activation.')
      }
      const pointer = validateActiveReleasePointer({
        ...scopeIdentity(scope),
        releaseId: target.releaseId,
        version: (previousPointer?.version ?? 0) + 1,
        activatedAt: time,
      })
      if (!await transaction.putActivePointer(pointer, previousPointer?.version ?? null)) {
        throw serviceError('concurrent-update', 'Active release pointer changed concurrently.')
      }
      const activeRoot = validateReleaseRetentionRoot({
        ...scopeIdentity(scope),
        rootId: 'active',
        releaseId: target.releaseId,
        kind: 'active',
        createdAt: time,
      })
      if (!await transaction.insertRetentionRoot(activeRoot)) {
        throw serviceError('retention-conflict', 'Active release retention root already exists.')
      }
      return { release: target, previousReleaseId, pointer }
    })
  }

  async retain(scope: FumaRepositoryScope, input: unknown): Promise<ReleaseRetentionRoot> {
    const command: RetainRelease = parse(RetainReleaseSchema, input, 'retainRelease')
    if (command.rootId === 'active') {
      throw serviceError('invalid-input', 'The active retention root ID is reserved.', 'rootId')
    }
    const time = validNow(this.#now)
    return await this.#bound(scope).transaction(async (transaction) => {
      const release = requiredRelease(await transaction.get(command.releaseId), command.releaseId)
      if (release.status !== 'ready' && release.status !== 'active') {
        throw serviceError('invalid-transition', 'Only ready or active releases can be retained.')
      }
      const root = validateReleaseRetentionRoot({
        ...scopeIdentity(scope),
        rootId: command.rootId,
        releaseId: release.releaseId,
        kind: 'manual',
        createdAt: time,
      })
      const roots = await transaction.listRetentionRoots(release.releaseId)
      const existing = roots.find(({ rootId }) => rootId === root.rootId)
      if (existing) {
        if (existing.releaseId !== root.releaseId || existing.kind !== root.kind) {
          throw serviceError('retention-conflict', 'Retention root identity is already bound elsewhere.')
        }
        return existing
      }
      if (!await transaction.insertRetentionRoot(root)) {
        throw serviceError('retention-conflict', 'Retention root was created concurrently.')
      }
      return root
    })
  }

  async releaseRetention(scope: FumaRepositoryScope, input: unknown): Promise<void> {
    const command: RetainRelease = parse(RetainReleaseSchema, input, 'releaseRetention')
    if (command.rootId === 'active') {
      throw serviceError('active-release', 'The active retention root cannot be removed directly.')
    }
    await this.#bound(scope).transaction(async (transaction) => {
      requiredRelease(await transaction.get(command.releaseId), command.releaseId)
      const roots = await transaction.listRetentionRoots(command.releaseId)
      const root = roots.find(({ rootId, kind }) => (
        rootId === command.rootId && kind === 'manual'
      ))
      if (!root || !await transaction.deleteRetentionRoot(root.rootId, 'manual')) {
        throw serviceError('not-found', 'Manual retention root was not found.', 'rootId')
      }
    })
  }

  async delete(scope: FumaRepositoryScope, input: unknown): Promise<void> {
    const command: ReleaseId = parse(ReleaseIdSchema, input, 'deleteRelease')
    await this.#bound(scope).transaction(async (transaction) => {
      const release = requiredRelease(await transaction.get(command.releaseId), command.releaseId)
      if (release.status === 'active') {
        throw serviceError('active-release', 'The active release cannot be deleted.')
      }
      if (release.status === 'building' || release.status === 'queued') {
        throw serviceError('invalid-transition', `A ${release.status} release cannot be deleted.`)
      }
      const roots = await transaction.listRetentionRoots(release.releaseId)
      if (roots.length > 0) {
        throw serviceError('retained-release', 'A retained release cannot be deleted.')
      }
      if (!await transaction.deleteRelease(release.releaseId, release.version)) {
        throw serviceError('concurrent-update', 'Release deletion lost a concurrent update.')
      }
    })
  }
}

export type { ReleaseRepositoryTransaction }
