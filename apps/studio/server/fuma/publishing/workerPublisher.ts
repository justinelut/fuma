import {
  Type,
  Value,
  safeParseValue,
  type Static,
} from '@core/utils/typeboxHelpers'
import type { FumaJobJsonValue } from '../jobs/contracts'
import type { FumaScopedJobHandler } from '../jobs/integration'
import {
  ObjectStorageError,
  sha256Hex,
  type TenantObjectStorage,
} from '../objectStorage'
import {
  ReleaseManifestSchema,
  assertReleaseManifest,
  createReleaseManifest,
  releaseObjectKey,
  type ReleaseManifest,
  type ReleaseRecord,
  type ReleaseService,
} from '../releases'
import type { FumaRepositoryScope } from '../tenancy'

const Id = Type.String({
  minLength: 1,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
})
const Hash = Type.String({ pattern: '^[a-f0-9]{64}$' })
const PositiveFence = Type.String({ pattern: '^[1-9][0-9]*$', maxLength: 128 })

export const PublishJobSchema = Type.Object({
  releaseId: Id,
  sourceSnapshotId: Id,
  sourceSnapshotHashSha256: Hash,
  auditCorrelationId: Id,
}, { additionalProperties: false })
export type PublishJob = Static<typeof PublishJobSchema>

export const RenderedArtifactSchema = Type.Object({
  logicalPath: Type.String({ minLength: 2, maxLength: 2_048, pattern: '^/' }),
  kind: Type.Union([
    Type.Literal('html'),
    Type.Literal('css'),
    Type.Literal('javascript'),
    Type.Literal('asset'),
  ]),
  mimeType: Type.String({ minLength: 3, maxLength: 255 }),
  bytes: Type.Uint8Array(),
  references: Type.Array(Type.String({ minLength: 2, maxLength: 2_048 }), {
    uniqueItems: true,
    maxItems: 10_000,
  }),
}, { additionalProperties: false })
export type RenderedArtifact = Static<typeof RenderedArtifactSchema>

export type ClaimedSnapshot = Readonly<{
  id: string
  hashSha256: string
  immutableRevision: string
  document: unknown
}>

export type PublishAuthority = Readonly<{
  scope: FumaRepositoryScope
  profileId: string
}>

export type PublishClaim = Readonly<{
  attemptId: string
  releaseId: string
  sourceSnapshotId: string
  sourceSnapshotHashSha256: string
  auditCorrelationId: string
  profileId: string
  scope: FumaRepositoryScope
  jobId: string
  fence: string
}>

export interface PublishSnapshotAuthority {
  claimExact(
    authority: PublishAuthority,
    snapshotId: string,
    expectedHashSha256: string,
  ): Promise<ClaimedSnapshot>
}

export type ReleaseRenderContext = Readonly<{
  releaseId: string
}>

export interface SemanticReleaseRenderer {
  render(
    authority: PublishAuthority,
    snapshot: ClaimedSnapshot,
    context?: ReleaseRenderContext,
  ): AsyncIterable<RenderedArtifact>
}

export type PublishProgressEvent = Readonly<{
  stage: 'claimed' | 'rendering' | 'uploaded' | 'finalized' | 'activated' | 'cancelled'
  completed: number
  total: number | null
}>

export interface PublishAttemptAuthority {
  exactAttemptId(input: Omit<PublishClaim, 'attemptId'>): string
  claimExact(claim: PublishClaim): Promise<PublishClaim>
  record(claim: PublishClaim, event: PublishProgressEvent): Promise<void>
}

export type PublishFaultBoundary =
  | 'after-claim'
  | 'after-render'
  | 'after-upload'
  | 'after-finalize'
  | 'before-activation'
  | 'after-activation-before-result'

export interface PublishExecutionContext {
  jobId: string
  fence: string
  cancellationRequested(): Promise<boolean>
  durableResult(key: string): Promise<unknown | null>
  commitDurableResult(key: string, value: unknown): Promise<unknown>
  fault?(boundary: PublishFaultBoundary): Promise<void>
}

const ManifestEffectSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  releaseId: Id,
  sourceSnapshotId: Id,
  sourceSnapshotHashSha256: Hash,
  ownerKey: Id,
  siteId: Id,
  ownerGeneration: Type.Integer({ minimum: 1 }),
  jobId: Id,
  fence: PositiveFence,
  manifest: ReleaseManifestSchema,
}, { additionalProperties: false })
type ManifestEffect = Static<typeof ManifestEffectSchema>

const ActivationEffectSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  releaseId: Id,
  sourceSnapshotHashSha256: Hash,
  ownerKey: Id,
  siteId: Id,
  ownerGeneration: Type.Integer({ minimum: 1 }),
  jobId: Id,
  fence: PositiveFence,
  manifestHashSha256: Hash,
  pointerVersion: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false })
type ActivationEffect = Static<typeof ActivationEffectSchema>

const MANIFEST_EFFECT_KEY = 'fuma.publish-release:manifest:v1'
const ACTIVATION_EFFECT_KEY = 'fuma.publish-release:activation:v1'

export class PublishWorkerError extends Error {
  readonly code:
    | 'invalid-job'
    | 'invalid-authority'
    | 'snapshot-drift'
    | 'claim-mismatch'
    | 'cancelled'
    | 'duplicate-path'
    | 'render-invalid'
    | 'untrusted-result'

  constructor(code: PublishWorkerError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'PublishWorkerError'
  }
}

function validateJob(input: unknown): PublishJob {
  const parsed = safeParseValue(PublishJobSchema, input)
  if (!parsed.ok) {
    throw new PublishWorkerError('invalid-job', 'Publish job failed its strict TypeBox contract.')
  }
  return Object.freeze(structuredClone(parsed.value))
}

function validateAuthority(input: PublishAuthority): PublishAuthority {
  if (typeof input.profileId !== 'string' || !Value.Check(Id, input.profileId)) {
    throw new PublishWorkerError('invalid-authority', 'Publish profile authority is invalid.')
  }
  const scope = input.scope
  if (scope.state !== 'active' || scope.transferFence !== null) {
    throw new PublishWorkerError('invalid-authority', 'Publish requires current active owner authority.')
  }
  return Object.freeze({ scope: Object.freeze(structuredClone(scope)), profileId: input.profileId })
}

function objectScope(scope: FumaRepositoryScope) {
  return {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
  }
}

function manifestMatchesClaim(effect: ManifestEffect, claim: PublishClaim): boolean {
  return effect.releaseId === claim.releaseId
    && effect.sourceSnapshotId === claim.sourceSnapshotId
    && effect.sourceSnapshotHashSha256 === claim.sourceSnapshotHashSha256
    && effect.ownerKey === claim.scope.ownerKey
    && effect.siteId === claim.scope.siteId
    && effect.ownerGeneration === claim.scope.generation
    && effect.jobId === claim.jobId
    && effect.fence === claim.fence
    && effect.manifest.releaseId === claim.releaseId
    && effect.manifest.ownerKey === claim.scope.ownerKey
    && effect.manifest.siteId === claim.scope.siteId
    && effect.manifest.sourceSnapshotHashSha256 === claim.sourceSnapshotHashSha256
}

function readManifestEffect(input: unknown, claim: PublishClaim): ManifestEffect {
  const parsed = safeParseValue(ManifestEffectSchema, input)
  if (!parsed.ok) {
    throw new PublishWorkerError('untrusted-result', 'Durable publish manifest result failed validation.')
  }
  try {
    assertReleaseManifest(parsed.value.manifest)
  } catch {
    throw new PublishWorkerError('untrusted-result', 'Durable publish manifest failed immutable revalidation.')
  }
  if (!manifestMatchesClaim(parsed.value, claim)) {
    throw new PublishWorkerError('claim-mismatch', 'Durable publish manifest does not match the exact claim.')
  }
  return Object.freeze(structuredClone(parsed.value))
}

function activationMatchesClaim(
  effect: ActivationEffect,
  claim: PublishClaim,
  manifest: ReleaseManifest,
): boolean {
  return effect.releaseId === claim.releaseId
    && effect.sourceSnapshotHashSha256 === claim.sourceSnapshotHashSha256
    && effect.ownerKey === claim.scope.ownerKey
    && effect.siteId === claim.scope.siteId
    && effect.ownerGeneration === claim.scope.generation
    && effect.jobId === claim.jobId
    && effect.fence === claim.fence
    && effect.manifestHashSha256 === manifest.manifestHashSha256
}

function readActivationEffect(
  input: unknown,
  claim: PublishClaim,
  manifest: ReleaseManifest,
): ActivationEffect {
  const parsed = safeParseValue(ActivationEffectSchema, input)
  if (!parsed.ok || !activationMatchesClaim(parsed.value, claim, manifest)) {
    throw new PublishWorkerError('untrusted-result', 'Durable activation result does not match the exact publish claim.')
  }
  return Object.freeze(structuredClone(parsed.value))
}

function effectForManifest(claim: PublishClaim, manifest: ReleaseManifest): ManifestEffect {
  return {
    schemaVersion: 1,
    releaseId: claim.releaseId,
    sourceSnapshotId: claim.sourceSnapshotId,
    sourceSnapshotHashSha256: claim.sourceSnapshotHashSha256,
    ownerKey: claim.scope.ownerKey,
    siteId: claim.scope.siteId,
    ownerGeneration: claim.scope.generation,
    jobId: claim.jobId,
    fence: claim.fence,
    manifest: structuredClone(manifest) as Static<typeof ReleaseManifestSchema>,
  }
}

function finalizedManifest(record: ReleaseRecord, claim: PublishClaim): ReleaseManifest | null {
  if (record.status !== 'ready' && record.status !== 'active') return null
  if (record.buildClaim?.jobId !== claim.jobId || record.buildClaim.fence !== claim.fence) {
    throw new PublishWorkerError('claim-mismatch', 'Finalized release belongs to another build claim.')
  }
  if (record.manifest === null) {
    throw new PublishWorkerError('untrusted-result', 'Finalized release is missing its immutable manifest.')
  }
  const effect = effectForManifest(claim, record.manifest)
  if (!manifestMatchesClaim(effect, claim)) {
    throw new PublishWorkerError('claim-mismatch', 'Finalized release does not match the exact publish claim.')
  }
  assertReleaseManifest(record.manifest)
  return record.manifest
}

function validatePersistedClaim(
  requested: PublishClaim,
  persisted: PublishClaim,
  attempts: PublishAttemptAuthority,
): PublishClaim {
  const sameCoordinates = persisted.releaseId === requested.releaseId
    && persisted.sourceSnapshotId === requested.sourceSnapshotId
    && persisted.sourceSnapshotHashSha256 === requested.sourceSnapshotHashSha256
    && persisted.auditCorrelationId === requested.auditCorrelationId
    && persisted.profileId === requested.profileId
    && persisted.jobId === requested.jobId
    && persisted.scope.platformId === requested.scope.platformId
    && persisted.scope.organizationId === requested.scope.organizationId
    && persisted.scope.workspaceId === requested.scope.workspaceId
    && persisted.scope.siteId === requested.scope.siteId
    && persisted.scope.ownerKey === requested.scope.ownerKey
    && persisted.scope.generation === requested.scope.generation
  const canonicalId = attempts.exactAttemptId({
    releaseId: persisted.releaseId,
    sourceSnapshotId: persisted.sourceSnapshotId,
    sourceSnapshotHashSha256: persisted.sourceSnapshotHashSha256,
    auditCorrelationId: persisted.auditCorrelationId,
    profileId: persisted.profileId,
    scope: persisted.scope,
    jobId: persisted.jobId,
    fence: persisted.fence,
  })
  let monotonicFence: boolean
  try {
    monotonicFence = BigInt(persisted.fence) <= BigInt(requested.fence)
  } catch {
    monotonicFence = false
  }
  if (!sameCoordinates || persisted.attemptId !== canonicalId || !monotonicFence) {
    throw new PublishWorkerError('claim-mismatch', 'Persisted publish claim does not match current durable authority.')
  }
  return Object.freeze(structuredClone(persisted))
}

/** FUMA-049 worker authority. Only this service renders and writes hosted releases. */
export class AtomicPublishWorker {
  private readonly dependencies: Readonly<{
    snapshots: PublishSnapshotAuthority
    renderer: SemanticReleaseRenderer

    storage: TenantObjectStorage
    releases: ReleaseService
    attempts: PublishAttemptAuthority
    now?: () => Date
  }>

  constructor(dependencies: Readonly<{
    snapshots: PublishSnapshotAuthority
    renderer: SemanticReleaseRenderer
    storage: TenantObjectStorage
    releases: ReleaseService
    attempts: PublishAttemptAuthority
    now?: () => Date
  }>) {
    this.dependencies = dependencies
  }

  async execute(
    rawAuthority: PublishAuthority,
    rawJob: unknown,
    execution: PublishExecutionContext,
  ): Promise<ReleaseManifest> {
    const authority = validateAuthority(rawAuthority)
    const job = validateJob(rawJob)
    if (!Value.Check(Id, execution.jobId) || !Value.Check(PositiveFence, execution.fence)) {
      throw new PublishWorkerError('invalid-authority', 'Durable publish job claim is invalid.')
    }

    const claimInput = {
      releaseId: job.releaseId,
      sourceSnapshotId: job.sourceSnapshotId,
      sourceSnapshotHashSha256: job.sourceSnapshotHashSha256,
      auditCorrelationId: job.auditCorrelationId,
      profileId: authority.profileId,
      scope: authority.scope,
      jobId: execution.jobId,
      fence: execution.fence,
    }
    const requestedClaim: PublishClaim = Object.freeze({
      ...claimInput,
      attemptId: this.dependencies.attempts.exactAttemptId(claimInput),
    })

    await this.dependencies.releases.queue(authority.scope, {
      releaseId: job.releaseId,
      sourceSnapshotHashSha256: job.sourceSnapshotHashSha256,
    })
    const claim = validatePersistedClaim(
      requestedClaim,
      await this.dependencies.attempts.claimExact(requestedClaim),
      this.dependencies.attempts,
    )

    const cancel = async (): Promise<void> => {
      if (!await execution.cancellationRequested()) return
      await this.dependencies.attempts.record(claim, {
        stage: 'cancelled', completed: 0, total: null,
      })
      throw new PublishWorkerError('cancelled', 'Publish was cancelled before activation.')
    }

    await cancel()
    const snapshot = await this.dependencies.snapshots.claimExact(
      authority,
      job.sourceSnapshotId,
      job.sourceSnapshotHashSha256,
    )
    if (snapshot.id !== job.sourceSnapshotId
      || snapshot.hashSha256 !== job.sourceSnapshotHashSha256) {
      throw new PublishWorkerError('snapshot-drift', 'Claimed snapshot identity changed.')
    }
    await this.dependencies.attempts.record(claim, {
      stage: 'claimed', completed: 0, total: null,
    })
    await execution.fault?.('after-claim')

    let manifestEffect: ManifestEffect | null = null
    const cachedManifest = await execution.durableResult(MANIFEST_EFFECT_KEY)
    if (cachedManifest !== null) manifestEffect = readManifestEffect(cachedManifest, claim)

    let manifest: ReleaseManifest
    if (manifestEffect !== null) {
      manifest = manifestEffect.manifest
      await this.dependencies.releases.finalize(authority.scope, {
        releaseId: job.releaseId,
        buildClaim: { jobId: claim.jobId, fence: claim.fence },
        manifest,
      })
    } else {
      const building = await this.dependencies.releases.startBuilding(authority.scope, {
        releaseId: job.releaseId,
        buildClaim: { jobId: claim.jobId, fence: claim.fence },
      })
      const recovered = finalizedManifest(building, claim)
      if (recovered !== null) {
        manifest = recovered
        await this.dependencies.releases.finalize(authority.scope, {
          releaseId: job.releaseId,
          buildClaim: { jobId: claim.jobId, fence: claim.fence },
          manifest,
        })
      } else {
        manifest = await this.#renderAndFinalize(authority, snapshot, claim, cancel, execution)
      }

      await execution.fault?.('after-finalize')
      const committed = await execution.commitDurableResult(
        MANIFEST_EFFECT_KEY,
        effectForManifest(claim, manifest),
      )
      manifestEffect = readManifestEffect(committed, claim)
      manifest = manifestEffect.manifest
    }

    await this.dependencies.attempts.record(claim, {
      stage: 'finalized',
      completed: manifest.artifactCount,
      total: manifest.artifactCount,
    })

    const cachedActivation = await execution.durableResult(ACTIVATION_EFFECT_KEY)
    if (cachedActivation !== null) readActivationEffect(cachedActivation, claim, manifest)

    await cancel()
    await execution.fault?.('before-activation')
    const activation = await this.dependencies.releases.activate(authority.scope, {
      releaseId: job.releaseId,
    })

    if (cachedActivation === null) {
      await execution.fault?.('after-activation-before-result')
      const activationEffect: ActivationEffect = {
        schemaVersion: 1,
        releaseId: claim.releaseId,
        sourceSnapshotHashSha256: claim.sourceSnapshotHashSha256,
        ownerKey: claim.scope.ownerKey,
        siteId: claim.scope.siteId,
        ownerGeneration: claim.scope.generation,
        jobId: claim.jobId,
        fence: claim.fence,
        manifestHashSha256: manifest.manifestHashSha256,
        pointerVersion: activation.pointer.version,
      }
      const committed = await execution.commitDurableResult(
        ACTIVATION_EFFECT_KEY,
        activationEffect,
      )
      readActivationEffect(committed, claim, manifest)
    }

    await this.dependencies.attempts.record(claim, {
      stage: 'activated',
      completed: manifest.artifactCount,
      total: manifest.artifactCount,
    })
    return Object.freeze(structuredClone(manifest))
  }

  async #renderAndFinalize(
    authority: PublishAuthority,
    snapshot: ClaimedSnapshot,
    claim: PublishClaim,
    cancel: () => Promise<void>,
    execution: PublishExecutionContext,
  ): Promise<ReleaseManifest> {
    const rendered: RenderedArtifact[] = []
    const paths = new Set<string>()
    for await (const rawArtifact of this.dependencies.renderer.render(
      authority,
      snapshot,
      { releaseId: claim.releaseId },
    )) {
      await cancel()
      const parsed = safeParseValue(RenderedArtifactSchema, rawArtifact)
      if (!parsed.ok) {
        throw new PublishWorkerError('render-invalid', 'Renderer emitted an invalid artifact.')
      }
      const artifact = parsed.value
      if (paths.has(artifact.logicalPath)) {
        throw new PublishWorkerError('duplicate-path', 'Renderer emitted a duplicate logical path.')
      }
      paths.add(artifact.logicalPath)
      rendered.push(structuredClone(artifact))
      await this.dependencies.attempts.record(claim, {
        stage: 'rendering', completed: rendered.length, total: null,
      })
    }
    if (rendered.length === 0) {
      throw new PublishWorkerError('render-invalid', 'Renderer emitted no release artifacts.')
    }
    await execution.fault?.('after-render')

    const descriptors = []
    for (const [index, artifact] of rendered.entries()) {
      await cancel()
      const hash = sha256Hex(artifact.bytes)
      const objectKey = releaseObjectKey(claim.releaseId, hash)
      try {
        await this.dependencies.storage.put({
          scope: objectScope(authority.scope),
          key: objectKey,
          bytes: artifact.bytes,
          mimeType: artifact.mimeType,
          checksumSha256: hash,
        })
      } catch (error) {
        if (!(error instanceof ObjectStorageError) || error.code !== 'already_exists') throw error
        const existing = await this.dependencies.storage.head(objectScope(authority.scope), objectKey)
        if (existing.checksumSha256 !== hash
          || existing.sizeBytes !== artifact.bytes.byteLength
          || existing.mimeType !== artifact.mimeType) {
          throw new PublishWorkerError(
            'render-invalid',
            'Existing immutable artifact does not match retry output.',
          )
        }
      }
      descriptors.push({
        logicalPath: artifact.logicalPath,
        kind: artifact.kind,
        contentHashSha256: hash,
        sizeBytes: artifact.bytes.byteLength,
        mimeType: artifact.mimeType,
        references: artifact.references,
      })
      await this.dependencies.attempts.record(claim, {
        stage: 'uploaded', completed: index + 1, total: rendered.length,
      })
    }
    await execution.fault?.('after-upload')

    const manifest = createReleaseManifest({
      releaseId: claim.releaseId,
      ownerKey: authority.scope.ownerKey,
      siteId: authority.scope.siteId,
      sourceSnapshotHashSha256: claim.sourceSnapshotHashSha256,
      artifacts: descriptors,
      createdAt: (this.dependencies.now ?? (() => new Date()))().toISOString(),
    })
    await this.dependencies.releases.finalize(authority.scope, {
      releaseId: claim.releaseId,
      buildClaim: { jobId: claim.jobId, fence: claim.fence },
      manifest,
    })
    return manifest
  }
}

export const PUBLISH_RELEASE_JOB_KIND = 'fuma.publish-release' as const


/** Central FUMA-009 registration: scope/profile/job/fence come only from the claimed record. */
export function publishWorkerRegistration(
  worker: AtomicPublishWorker,
): Readonly<Record<typeof PUBLISH_RELEASE_JOB_KIND, FumaScopedJobHandler>> {
  const handler: FumaScopedJobHandler = async (context) => {
    if (context.jobContext.kind !== 'site' || context.repositoryScope === null) {
      throw new PublishWorkerError('invalid-authority', 'Publish release jobs require trusted site authority.')
    }
    const manifest = await worker.execute({
      scope: context.repositoryScope,
      profileId: context.jobContext.profile.id,
    }, context.job.payload, {
      jobId: context.job.id,
      fence: context.fence,
      cancellationRequested: context.cancellationRequested,
      durableResult: async (key) => (await context.readDurableResult(key))?.result ?? null,
      commitDurableResult: async (key, value) => (
        await context.commitDurableResult(key, value as FumaJobJsonValue)
      ).result,
    })
    return structuredClone(manifest) as unknown as FumaJobJsonValue
  }
  return Object.freeze({ [PUBLISH_RELEASE_JOB_KIND]: handler })
}
