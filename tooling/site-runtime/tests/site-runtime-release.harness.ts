/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto'
import { AtomicPublishWorker, type PublishExecutionContext } from '../../../apps/studio/server/fuma/publishing/workerPublisher'
import { RuntimeTreeRendererAdapter, parseRuntimeSnapshotBytes } from '../../../apps/studio/server/fuma/publishing/runtimeTree/renderer'
import {
  SITE_002_AUTHORITY,
  SeededLegacySemanticRenderer,
  seededProjection,
  type SeededRuntimeRelease,
} from '../runtimeReleaseFixtures'
import { RUNTIME_SNAPSHOT_PATH, type RuntimeReleaseSnapshot } from '../../../apps/studio/server/fuma/publishing/runtimeTree/contracts'

const NOW = '2042-02-02T02:02:02.000Z'

type StoredObject = Readonly<{ bytes: Uint8Array, mimeType: string, checksumSha256: string }>
type FakeRelease = {
  releaseId: string
  sourceSnapshotHashSha256: string
  status: 'queued' | 'building' | 'ready' | 'active'
  buildClaim: { jobId: string, fence: string } | null
  manifest: any
}

export class Site002LifecycleHarness {
  readonly objects = new Map<string, StoredObject>()
  readonly releases = new Map<string, FakeRelease>()
  readonly durable = new Map<string, Map<string, unknown>>()
  readonly attempts = new Map<string, any>()
  readonly manualRetention = new Set<string>()
  readonly events: Array<{ releaseId: string, stage: string }> = []
  activeReleaseId: string | null = null
  pointerVersion = 0

  readonly adapter = new RuntimeTreeRendererAdapter({
    semanticRenderer: new SeededLegacySemanticRenderer(),
    project: seededProjection,
  })

  readonly worker = new AtomicPublishWorker({
    snapshots: {
      claimExact: async (_authority, snapshotId, expectedHash) => {
        const seed = this.currentSeed
        if (!seed || seed.sourceSnapshot.id !== snapshotId || seed.sourceSnapshot.hashSha256 !== expectedHash) throw new Error('snapshot drift')
        return seed.sourceSnapshot
      },
    },
    renderer: this.adapter,
    storage: {
      put: async (input: any) => {
        const existing = this.objects.get(input.key)
        if (existing) {
          if (existing.checksumSha256 !== input.checksumSha256) throw new Error('immutable object collision')
          return existing
        }
        this.objects.set(input.key, Object.freeze({ bytes: input.bytes.slice(), mimeType: input.mimeType, checksumSha256: input.checksumSha256 }))
        return { key: input.key, sizeBytes: input.bytes.byteLength, checksumSha256: input.checksumSha256, mimeType: input.mimeType }
      },
      head: async (_scope: unknown, key: string) => {
        const object = this.objects.get(key)
        if (!object) throw new Error('missing object')
        return { key, sizeBytes: object.bytes.byteLength, checksumSha256: object.checksumSha256, mimeType: object.mimeType }
      },
    } as never,
    releases: {
      queue: async (_scope: unknown, input: any) => {
        const existing = this.releases.get(input.releaseId)
        if (existing) {
          if (existing.sourceSnapshotHashSha256 !== input.sourceSnapshotHashSha256) throw new Error('release identity drift')
          return existing
        }
        const record: FakeRelease = {
          releaseId: input.releaseId,
          sourceSnapshotHashSha256: input.sourceSnapshotHashSha256,
          status: 'queued',
          buildClaim: null,
          manifest: null,
        }
        this.releases.set(input.releaseId, record)
        return record
      },
      startBuilding: async (_scope: unknown, input: any) => {
        const record = this.requiredRelease(input.releaseId)
        if (record.status === 'queued') {
          record.status = 'building'
          record.buildClaim = structuredClone(input.buildClaim)
        }
        return structuredClone(record)
      },
      finalize: async (_scope: unknown, input: any) => {
        const record = this.requiredRelease(input.releaseId)
        if (record.buildClaim && (record.buildClaim.jobId !== input.buildClaim.jobId || record.buildClaim.fence !== input.buildClaim.fence)) throw new Error('build claim mismatch')
        record.buildClaim = structuredClone(input.buildClaim)
        record.manifest = structuredClone(input.manifest)
        if (record.status !== 'active') record.status = 'ready'
        return structuredClone(record)
      },
      activate: async (_scope: unknown, input: any) => {
        const next = this.requiredRelease(input.releaseId)
        if (next.status !== 'ready' && next.status !== 'active') throw new Error('release not ready')
        if (this.activeReleaseId && this.activeReleaseId !== input.releaseId) this.requiredRelease(this.activeReleaseId).status = 'ready'
        next.status = 'active'
        this.activeReleaseId = input.releaseId
        this.pointerVersion += 1
        return { release: structuredClone(next), pointer: { version: this.pointerVersion } }
      },
    } as never,
    attempts: {
      exactAttemptId: (input: any) => createHash('sha256').update(JSON.stringify(input)).digest('hex'),
      claimExact: async (claim: any) => {
        const existing = this.attempts.get(claim.releaseId)
        if (existing) return existing
        this.attempts.set(claim.releaseId, structuredClone(claim))
        return claim
      },
      record: async (claim: any, event: any) => { this.events.push({ releaseId: claim.releaseId, stage: event.stage }) },
    } as never,
    now: () => new Date(NOW),
  })

  private currentSeed: SeededRuntimeRelease | null = null

  private requiredRelease(releaseId: string): FakeRelease {
    const release = this.releases.get(releaseId)
    if (!release) throw new Error(`missing release ${releaseId}`)
    return release
  }

  retain(releaseId: string): void {
    const release = this.requiredRelease(releaseId)
    if (release.status !== 'ready' && release.status !== 'active') throw new Error('only readable releases can be retained')
    this.manualRetention.add(releaseId)
  }

  rollback(releaseId: string): void {
    if (!this.manualRetention.has(releaseId)) throw new Error('rollback release is not retained')
    const next = this.requiredRelease(releaseId)
    if (this.activeReleaseId && this.activeReleaseId !== releaseId) this.requiredRelease(this.activeReleaseId).status = 'ready'
    next.status = 'active'
    this.activeReleaseId = releaseId
    this.pointerVersion += 1
  }

  async publish(seed: SeededRuntimeRelease, options: Readonly<{
    cancelled?: boolean
    fault?: PublishExecutionContext['fault']
  }> = {}): Promise<any> {
    this.currentSeed = seed
    const effects = this.durable.get(seed.releaseId) ?? new Map<string, unknown>()
    this.durable.set(seed.releaseId, effects)
    return await this.worker.execute(SITE_002_AUTHORITY as never, {
      releaseId: seed.releaseId,
      sourceSnapshotId: seed.sourceSnapshot.id,
      sourceSnapshotHashSha256: seed.sourceSnapshot.hashSha256,
      auditCorrelationId: `audit_${seed.releaseId}`,
    }, {
      jobId: `job_${seed.releaseId}`,
      fence: '1',
      async cancellationRequested() { return options.cancelled ?? false },
      async durableResult(key) { return effects.get(key) ?? null },
      async commitDurableResult(key, value) {
        const prior = effects.get(key)
        if (prior !== undefined) return prior
        effects.set(key, structuredClone(value))
        return value
      },
      fault: options.fault,
    })
  }

  artifactBytes(releaseId: string, logicalPath: string): Uint8Array {
    const release = this.requiredRelease(releaseId)
    const descriptor = release.manifest?.artifacts.find((artifact: any) => artifact.logicalPath === logicalPath)
    if (!descriptor) throw new Error(`missing artifact ${logicalPath}`)
    const object = this.objects.get(descriptor.objectKey)
    if (!object) throw new Error(`missing object ${descriptor.objectKey}`)
    return object.bytes.slice()
  }

  runtimeSnapshot(releaseId: string): Readonly<RuntimeReleaseSnapshot> {
    return parseRuntimeSnapshotBytes(this.artifactBytes(releaseId, RUNTIME_SNAPSHOT_PATH))
  }
}
