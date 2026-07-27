import { describe, expect, it } from 'bun:test'
import type {
  BeginMultipartInput,
  ObjectList,
  ObjectMetadata,
  ObjectTenantScope,
  PutObjectInput,
  RedeemedObjectUrl,
  SignedObjectUrl,
  TenantMultipartUpload,
  TenantObjectStorage,
} from '../../../server/fuma/objectStorage'
import {
  ObjectStorageError,
  sha256Hex,
} from '../../../server/fuma/objectStorage'
import {
  ReleaseRepositoryError,
  ReleaseService,
  ReleaseServiceError,
  type ActiveReleasePointer,
  type BoundReleaseRepository,
  type ReleaseManifest,
  type ReleaseRecord,
  type ReleaseRepository,
  type ReleaseRepositoryTransaction,
  type ReleaseRetentionRoot,
} from '../../../server/fuma/releases'
import type { FumaRepositoryScope } from '../../../server/fuma/tenancy'
import {
  RELEASE_FIXTURE_BYTES,
  RELEASE_FIXTURE_SCOPE_A,
  RELEASE_FIXTURE_SCOPE_B,
  RELEASE_FIXTURE_SOURCE_HASH,
  RELEASE_FIXTURE_TIME,
  createReleaseFixtureManifest,
} from '../helpers/fuma/releaseFixture'

const CLAIM = Object.freeze({ jobId: 'job-release-001', fence: '17' })

function scopeKey(scope: FumaRepositoryScope): string {
  return [scope.platformId, scope.ownerKey].join(':')
}

function releaseKey(scope: FumaRepositoryScope, releaseId: string): string {
  return `${scopeKey(scope)}:${releaseId}`
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

class InMemoryReleaseRepository implements ReleaseRepository {
  releases = new Map<string, ReleaseRecord>()
  pointers = new Map<string, ActiveReleasePointer>()
  roots = new Map<string, ReleaseRetentionRoot>()
  authorities = new Map<string, FumaRepositoryScope>()
  failNextRootInsert = false
  #tail = Promise.resolve()

  constructor(scopes: readonly FumaRepositoryScope[]) {
    for (const scope of scopes) this.authorities.set(scopeKey(scope), scope)
  }

  setAuthority(scope: FumaRepositoryScope): void {
    this.authorities.set(scopeKey(scope), scope)
  }

  forScope(scope: FumaRepositoryScope): BoundReleaseRepository {
    if (scope.state !== 'active' || scope.transferFence !== null) {
      throw new ReleaseRepositoryError('scope-transferring', 'scope transferring')
    }
    // The bound fixture methods intentionally share this repository's transaction lock.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const repository = this
    return Object.freeze({
      scope,
      read(releaseId: string) {
        return this.transaction(async (transaction) => await transaction.get(releaseId))
      },
      async transaction<T>(
        work: (transaction: ReleaseRepositoryTransaction) => Promise<T>,
      ): Promise<T> {
        const previous = repository.#tail
        let releaseLock = (): void => {}
        repository.#tail = previous.then(async () => await new Promise<void>((resolve) => {
          releaseLock = resolve
        }))
        await previous
        const authoritative = repository.authorities.get(scopeKey(scope))
        if (!authoritative
          || authoritative.organizationId !== scope.organizationId
          || authoritative.workspaceId !== scope.workspaceId
          || authoritative.siteId !== scope.siteId
          || authoritative.generation !== scope.generation
          || authoritative.state !== 'active'
          || authoritative.transferFence !== null) {
          releaseLock()
          throw new ReleaseRepositoryError('invalid-scope', 'Current release owner authority denied.')
        }
        const before = {
          releases: clone(repository.releases),
          pointers: clone(repository.pointers),
          roots: clone(repository.roots),
        }
        const owner = scopeKey(scope)
        const transaction: ReleaseRepositoryTransaction = {
          async get(releaseId) {
            return clone(repository.releases.get(releaseKey(scope, releaseId)) ?? null)
          },
          async insert(record) {
            const key = releaseKey(scope, record.releaseId)
            if (repository.releases.has(key)) return false
            repository.releases.set(key, clone(record))
            return true
          },
          async update(record, expectedVersion) {
            const key = releaseKey(scope, record.releaseId)
            const current = repository.releases.get(key)
            if (!current || current.version !== expectedVersion) return false
            repository.releases.set(key, clone(record))
            return true
          },
          async getActivePointer() {
            return clone(repository.pointers.get(owner) ?? null)
          },
          async putActivePointer(pointer, expectedVersion) {
            const current = repository.pointers.get(owner)
            if ((expectedVersion === null && current)
              || (expectedVersion !== null && current?.version !== expectedVersion)) return false
            repository.pointers.set(owner, clone(pointer))
            return true
          },
          async listRetentionRoots(releaseId) {
            return [...repository.roots.values()]
              .filter((root) => scopeKey(root as FumaRepositoryScope) === owner
                && root.releaseId === releaseId)
              .sort((left, right) => left.rootId.localeCompare(right.rootId))
              .map(clone)
          },
          async insertRetentionRoot(root) {
            if (repository.failNextRootInsert) {
              repository.failNextRootInsert = false
              return false
            }
            const key = `${owner}:${root.rootId}`
            if (repository.roots.has(key)) return false
            repository.roots.set(key, clone(root))
            return true
          },
          async deleteRetentionRoot(rootId, kind) {
            const key = `${owner}:${rootId}`
            const current = repository.roots.get(key)
            if (!current || current.kind !== kind) return false
            repository.roots.delete(key)
            return true
          },
          async deleteRelease(releaseId, expectedVersion) {
            const key = releaseKey(scope, releaseId)
            const current = repository.releases.get(key)
            if (!current || current.version !== expectedVersion || current.status === 'active') return false
            repository.releases.delete(key)
            return true
          },
        }
        try {
          return await work(transaction)
        } catch (error) {
          repository.releases = before.releases
          repository.pointers = before.pointers
          repository.roots = before.roots
          throw error
        } finally {
          releaseLock()
        }
      },
    })
  }
}

function storageScopeKey(scope: ObjectTenantScope, key: string): string {
  return `${scope.organizationId}/${scope.workspaceId}/${scope.siteId}/${key}`
}

class InMemoryReleaseStorage implements TenantObjectStorage {
  readonly objects = new Map<string, Readonly<{ metadata: ObjectMetadata; bytes: Uint8Array }>>()
  #readGate: Promise<void> | null = null
  #releaseReadGate: (() => void) | null = null
  #blockedReads = 0
  #blockedWaiters: Array<Readonly<{ count: number; resolve: () => void }>> = []

  blockReads(): void {
    this.#readGate = new Promise((resolve) => { this.#releaseReadGate = resolve })
  }

  waitForBlockedReads(count: number): Promise<void> {
    if (this.#blockedReads >= count) return Promise.resolve()
    return new Promise((resolve) => this.#blockedWaiters.push({ count, resolve }))
  }

  releaseReads(): void {
    this.#releaseReadGate?.()
    this.#releaseReadGate = null
    this.#readGate = null
  }

  async put(input: PutObjectInput): Promise<ObjectMetadata> {
    const id = storageScopeKey(input.scope, input.key)
    if (this.objects.has(id)) throw new ObjectStorageError('already_exists', 'immutable')
    if (sha256Hex(input.bytes) !== input.checksumSha256) {
      throw new ObjectStorageError('checksum_mismatch', 'checksum')
    }
    const metadata = {
      key: input.key,
      sizeBytes: input.bytes.byteLength,
      mimeType: input.mimeType,
      checksumSha256: input.checksumSha256,
      createdAt: RELEASE_FIXTURE_TIME,
    }
    this.objects.set(id, { metadata, bytes: input.bytes.slice() })
    return clone(metadata)
  }

  beginMultipart(_input: BeginMultipartInput): Promise<TenantMultipartUpload> {
    throw new Error('not used')
  }

  async get(scope: ObjectTenantScope, key: string): Promise<Uint8Array> {
    const value = this.objects.get(storageScopeKey(scope, key))
    if (!value) throw new ObjectStorageError('not_found', 'missing')
    if (this.#readGate) {
      this.#blockedReads += 1
      for (const waiter of this.#blockedWaiters.splice(0)) {
        if (this.#blockedReads >= waiter.count) waiter.resolve()
        else this.#blockedWaiters.push(waiter)
      }
      await this.#readGate
    }
    return value.bytes.slice()
  }

  async head(scope: ObjectTenantScope, key: string): Promise<ObjectMetadata> {
    const value = this.objects.get(storageScopeKey(scope, key))
    if (!value) throw new ObjectStorageError('not_found', 'missing')
    return clone(value.metadata)
  }

  async list(scope: ObjectTenantScope, prefix = ''): Promise<ObjectList> {
    const namespace = `${scope.organizationId}/${scope.workspaceId}/${scope.siteId}/`
    const objects = [...this.objects.entries()]
      .filter(([key]) => key.startsWith(namespace))
      .map(([, value]) => value.metadata)
      .filter(({ key }) => key.startsWith(prefix))
      .sort((left, right) => left.key.localeCompare(right.key))
      .map(clone)
    return { objects, totalBytes: objects.reduce((total, item) => total + item.sizeBytes, 0) }
  }

  async delete(scope: ObjectTenantScope, key: string): Promise<void> {
    this.objects.delete(storageScopeKey(scope, key))
  }

  createSignedUrl(): Promise<SignedObjectUrl> {
    throw new Error('not used')
  }

  redeemSignedUrl(): Promise<RedeemedObjectUrl> {
    throw new Error('not used')
  }

  corrupt(scope: FumaRepositoryScope, key: string, bytes: Uint8Array): void {
    const id = storageScopeKey(scope, key)
    const current = this.objects.get(id)
    if (!current) throw new Error('missing object')
    this.objects.set(id, { metadata: current.metadata, bytes: bytes.slice() })
  }
}

function makeHarness() {
  const repository = new InMemoryReleaseRepository([
    RELEASE_FIXTURE_SCOPE_A,
    RELEASE_FIXTURE_SCOPE_B,
  ])
  const storage = new InMemoryReleaseStorage()
  const service = new ReleaseService({
    repository,
    objectStorage: storage,
    now: () => new Date(RELEASE_FIXTURE_TIME),
  })
  return { repository, storage, service }
}

async function seedManifest(
  storage: InMemoryReleaseStorage,
  scope: FumaRepositoryScope,
  manifest: ReleaseManifest,
): Promise<void> {
  for (const artifact of manifest.artifacts) {
    const bytes = artifact.logicalPath === '/index.html'
      ? RELEASE_FIXTURE_BYTES.html
      : RELEASE_FIXTURE_BYTES.css
    await storage.put({
      scope,
      key: artifact.objectKey,
      bytes,
      mimeType: artifact.mimeType,
      checksumSha256: artifact.contentHashSha256,
    })
  }
}

async function makeReady(
  harness: ReturnType<typeof makeHarness>,
  releaseId = 'release-001',
  scope = RELEASE_FIXTURE_SCOPE_A,
): Promise<ReleaseRecord> {
  const manifest = createReleaseFixtureManifest(scope, releaseId)
  await seedManifest(harness.storage, scope, manifest)
  await harness.service.queue(scope, {
    releaseId,
    sourceSnapshotHashSha256: RELEASE_FIXTURE_SOURCE_HASH,
  })
  await harness.service.startBuilding(scope, { releaseId, buildClaim: CLAIM })
  return await harness.service.finalize(scope, { releaseId, buildClaim: CLAIM, manifest })
}

function expectCode(error: unknown, code: ReleaseServiceError['code']): boolean {
  return error instanceof ReleaseServiceError && error.code === code
}

describe('FUMA-048 immutable release lifecycle', () => {
  it('moves queued -> building -> ready -> active and protects active retention', async () => {
    const harness = makeHarness()
    const ready = await makeReady(harness)
    expect(ready.status).toBe('ready')
    expect(ready.manifest?.artifactCount).toBe(2)

    const activated = await harness.service.activate(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: ready.releaseId,
    })
    expect(activated.release.status).toBe('active')
    expect(activated.pointer).toMatchObject({
      releaseId: ready.releaseId,
      version: 1,
      ownerKey: RELEASE_FIXTURE_SCOPE_A.ownerKey,
      siteId: RELEASE_FIXTURE_SCOPE_A.siteId,
    })
    expect(harness.repository.roots.get('platform-fuma:owner-a:active')).toMatchObject({
      releaseId: ready.releaseId,
      kind: 'active',
    })
    await expect(harness.service.delete(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: ready.releaseId,
    })).rejects.toMatchObject({ code: 'active-release' })
  })

  it('replays exact publish transitions after durable worker interruption without replacing immutable identity', async () => {
    const harness = makeHarness()
    const manifest = createReleaseFixtureManifest()
    await seedManifest(harness.storage, RELEASE_FIXTURE_SCOPE_A, manifest)
    const queued = await harness.service.queue(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      sourceSnapshotHashSha256: RELEASE_FIXTURE_SOURCE_HASH,
    })
    expect(await harness.service.queue(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      sourceSnapshotHashSha256: RELEASE_FIXTURE_SOURCE_HASH,
    })).toEqual(queued)
    const building = await harness.service.startBuilding(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      buildClaim: CLAIM,
    })
    expect(await harness.service.startBuilding(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      buildClaim: CLAIM,
    })).toEqual(building)
    const ready = await harness.service.finalize(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      buildClaim: CLAIM,
      manifest,
    })
    expect(await harness.service.finalize(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      buildClaim: CLAIM,
      manifest,
    })).toEqual(ready)
    await expect(harness.service.startBuilding(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      buildClaim: { ...CLAIM, fence: '18' },
    })).rejects.toMatchObject({ code: 'invalid-transition' })
  })

  it('rejects overwrite, invalid transitions, stale claims, and terminal failure reuse', async () => {
    const harness = makeHarness()
    const queued = await harness.service.queue(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: 'release-failure',
      sourceSnapshotHashSha256: RELEASE_FIXTURE_SOURCE_HASH,
    })
    expect(queued.status).toBe('queued')
    await expect(harness.service.queue(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: queued.releaseId,
      sourceSnapshotHashSha256: 'd'.repeat(64),
    })).rejects.toMatchObject({ code: 'already-exists' })
    await expect(harness.service.activate(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: queued.releaseId,
    })).rejects.toMatchObject({ code: 'invalid-transition' })

    const building = await harness.service.startBuilding(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: queued.releaseId,
      buildClaim: CLAIM,
    })
    expect(building.status).toBe('building')
    await expect(harness.service.fail(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: queued.releaseId,
      buildClaim: { ...CLAIM, fence: '18' },
      failure: { code: 'renderer-failed', retryable: true },
    })).rejects.toMatchObject({ code: 'claim-mismatch' })
    const failed = await harness.service.fail(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: queued.releaseId,
      buildClaim: CLAIM,
      failure: { code: 'renderer-failed', retryable: true },
    })
    expect(failed).toMatchObject({ status: 'failed', failure: { code: 'renderer-failed' } })
    expect(await harness.service.fail(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: queued.releaseId,
      buildClaim: CLAIM,
      failure: { code: 'renderer-failed', retryable: true },
    })).toEqual(failed)
    await expect(harness.service.fail(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: queued.releaseId,
      buildClaim: CLAIM,
      failure: { code: 'renderer-failed', retryable: false },
    })).rejects.toMatchObject({ code: 'invalid-transition' })
    await expect(harness.service.startBuilding(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: queued.releaseId,
      buildClaim: CLAIM,
    })).rejects.toMatchObject({ code: 'invalid-transition' })
  })

  it('requires a complete exact object inventory and verifies bytes, metadata, and references', async () => {
    const missing = makeHarness()
    const manifest = createReleaseFixtureManifest()
    await missing.service.queue(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      sourceSnapshotHashSha256: RELEASE_FIXTURE_SOURCE_HASH,
    })
    await missing.service.startBuilding(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      buildClaim: CLAIM,
    })
    await missing.storage.put({
      scope: RELEASE_FIXTURE_SCOPE_A,
      key: manifest.artifacts[0].objectKey,
      bytes: RELEASE_FIXTURE_BYTES.css,
      mimeType: manifest.artifacts[0].mimeType,
      checksumSha256: sha256Hex(RELEASE_FIXTURE_BYTES.css),
    })
    await expect(missing.service.finalize(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      buildClaim: CLAIM,
      manifest,
    })).rejects.toMatchObject({ code: 'object-inventory-mismatch' })

    const extra = makeHarness()
    await seedManifest(extra.storage, RELEASE_FIXTURE_SCOPE_A, manifest)
    await extra.storage.put({
      scope: RELEASE_FIXTURE_SCOPE_A,
      key: `publish/releases/${manifest.releaseId}/objects/${'e'.repeat(64)}`,
      bytes: new Uint8Array(),
      mimeType: 'application/octet-stream',
      checksumSha256: sha256Hex(new Uint8Array()),
    })
    await extra.service.queue(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      sourceSnapshotHashSha256: RELEASE_FIXTURE_SOURCE_HASH,
    })
    await extra.service.startBuilding(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      buildClaim: CLAIM,
    })
    await expect(extra.service.finalize(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      buildClaim: CLAIM,
      manifest,
    })).rejects.toMatchObject({ code: 'object-inventory-mismatch' })
  })

  it('rejects post-validation object mutation and foreign activation/deletion', async () => {
    const harness = makeHarness()
    const ready = await makeReady(harness)
    const artifact = ready.manifest!.artifacts[0]
    harness.storage.corrupt(RELEASE_FIXTURE_SCOPE_A, artifact.objectKey, new TextEncoder().encode('tampered'))
    await expect(harness.service.verify(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: ready.releaseId,
    })).rejects.toMatchObject({ code: 'object-hash-mismatch' })
    await expect(harness.service.activate(RELEASE_FIXTURE_SCOPE_B, {
      releaseId: ready.releaseId,
    })).rejects.toMatchObject({ code: 'not-found' })
    await expect(harness.service.delete(RELEASE_FIXTURE_SCOPE_B, {
      releaseId: ready.releaseId,
    })).rejects.toMatchObject({ code: 'not-found' })
  })

  it('denies stale generation and transfer-fenced authority', async () => {
    const harness = makeHarness()
    await harness.service.queue(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: 'release-authority',
      sourceSnapshotHashSha256: RELEASE_FIXTURE_SOURCE_HASH,
    })
    harness.repository.setAuthority(Object.freeze({
      ...RELEASE_FIXTURE_SCOPE_A,
      generation: RELEASE_FIXTURE_SCOPE_A.generation + 1,
    }))
    await expect(harness.service.startBuilding(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: 'release-authority',
      buildClaim: CLAIM,
    })).rejects.toBeInstanceOf(ReleaseRepositoryError)

    const transferring = Object.freeze({
      ...RELEASE_FIXTURE_SCOPE_A,
      state: 'transferring' as const,
      transferFence: 19,
    })
    await expect(harness.service.queue(transferring, {
      releaseId: 'release-transfer',
      sourceSnapshotHashSha256: RELEASE_FIXTURE_SOURCE_HASH,
    })).rejects.toMatchObject({ code: 'invalid-input' })
  })

  it('serializes concurrent finalize and rolls activation failures back atomically', async () => {
    const harness = makeHarness()
    const manifest = createReleaseFixtureManifest()
    await seedManifest(harness.storage, RELEASE_FIXTURE_SCOPE_A, manifest)
    await harness.service.queue(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      sourceSnapshotHashSha256: RELEASE_FIXTURE_SOURCE_HASH,
    })
    await harness.service.startBuilding(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      buildClaim: CLAIM,
    })
    harness.storage.blockReads()
    const first = harness.service.finalize(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      buildClaim: CLAIM,
      manifest,
    })
    const second = harness.service.finalize(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
      buildClaim: CLAIM,
      manifest,
    })
    await harness.storage.waitForBlockedReads(2)
    harness.storage.releaseReads()
    const settled = await Promise.allSettled([first, second])
    expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter(({ status }) => status === 'rejected')).toSatisfy((items) => (
      items.length === 1
      && items[0].status === 'rejected'
      && expectCode(items[0].reason, 'concurrent-update')
    ))

    const active = await harness.service.activate(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: manifest.releaseId,
    })
    const next = await makeReady(harness, 'release-002')
    harness.repository.failNextRootInsert = true
    await expect(harness.service.activate(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: next.releaseId,
    })).rejects.toMatchObject({ code: 'retention-conflict' })
    expect(harness.repository.pointers.get('platform-fuma:owner-a')).toEqual(active.pointer)
    expect(harness.repository.releases.get(releaseKey(RELEASE_FIXTURE_SCOPE_A, active.release.releaseId))?.status)
      .toBe('active')
    expect(harness.repository.releases.get(releaseKey(RELEASE_FIXTURE_SCOPE_A, next.releaseId))?.status)
      .toBe('ready')
  })

  it('preserves manual retention roots and switches one exact-site pointer', async () => {
    const harness = makeHarness()
    const first = await makeReady(harness)
    await harness.service.activate(RELEASE_FIXTURE_SCOPE_A, { releaseId: first.releaseId })
    const retained = await harness.service.retain(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: first.releaseId,
      rootId: 'rollback-window',
    })
    expect(retained.kind).toBe('manual')

    const second = await makeReady(harness, 'release-002')
    const switched = await harness.service.activate(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: second.releaseId,
    })
    expect(switched).toMatchObject({ previousReleaseId: first.releaseId })
    expect(switched.pointer).toMatchObject({ releaseId: second.releaseId, version: 2 })
    await expect(harness.service.delete(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: first.releaseId,
    })).rejects.toMatchObject({ code: 'retained-release' })
    await harness.service.releaseRetention(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: first.releaseId,
      rootId: retained.rootId,
    })
    await expect(harness.service.delete(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: first.releaseId,
    })).resolves.toBeUndefined()
  })

  it('runs the branded demo: validate once, reject mutation and foreign activation', async () => {
    const harness = makeHarness()
    const ready = await makeReady(harness)
    expect((await harness.service.verify(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: ready.releaseId,
    })).manifest?.manifestHashSha256).toBe(ready.manifest?.manifestHashSha256)
    const object = ready.manifest!.artifacts[0]
    harness.storage.corrupt(RELEASE_FIXTURE_SCOPE_A, object.objectKey, new Uint8Array([0]))
    await expect(harness.service.verify(RELEASE_FIXTURE_SCOPE_A, {
      releaseId: ready.releaseId,
    })).rejects.toMatchObject({ code: 'object-hash-mismatch' })
    await expect(harness.service.activate(RELEASE_FIXTURE_SCOPE_B, {
      releaseId: ready.releaseId,
    })).rejects.toMatchObject({ code: 'not-found' })
    process.stdout.write('[FUMA-048 demo] release verified; mutation and foreign activation denied\n')
  })
})
