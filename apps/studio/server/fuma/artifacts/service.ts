import { sha256Hex } from '../objectStorage'
import {
  ArtifactCrashSchema,
  ArtifactInstallationSchema,
  ArtifactScheduleSchema,
  ArtifactStorageUsageSchema,
  ArtifactTransferReceiptSchema,
  ArtifactAuthorityError,
  assertArtifactPolicy,
  assertInstallationPolicy,
  parseArtifactContract,
  type ArtifactCrash,
  type ArtifactInstallation,
  type ArtifactSchedule,
  type ArtifactSecret,
  type ArtifactStorageUsage,
  type ArtifactTransferReceipt,
  type ArtifactRelease,
} from './contracts'
import { ArtifactReleaseSchema } from './contracts'

export interface SharedArtifactObjectStore {
  putIfAbsent(artifact: ArtifactRelease, bytes: Uint8Array): Promise<'inserted' | 'exists'>
  get(artifact: ArtifactRelease): Promise<Uint8Array>
}

export interface ArtifactAuthorityRepository {
  readArtifact(artifactId: string): Promise<ArtifactRelease | null>
  insertArtifact(artifact: ArtifactRelease): Promise<boolean>
  readInstallation(scope: Pick<ArtifactInstallation, 'platformId' | 'ownerKey' | 'installationId'>): Promise<ArtifactInstallation | null>
  insertInstallation(installation: ArtifactInstallation): Promise<boolean>
  replaceInstallation(current: ArtifactInstallation, next: ArtifactInstallation): Promise<boolean>
  transferInstallation(current: ArtifactInstallation, next: ArtifactInstallation, receipt: ArtifactTransferReceipt): Promise<boolean>
  countSchedules(installation: ArtifactInstallation): Promise<number>
  putScheduleIfAbsent(schedule: ArtifactSchedule): Promise<boolean>
  putStorageUsage(installation: ArtifactInstallation, usage: ArtifactStorageUsage): Promise<boolean>
  recordCrashAndContain(installation: ArtifactInstallation, crash: ArtifactCrash, next: ArtifactInstallation): Promise<boolean>
  consumeCalls(installation: ArtifactInstallation, windowStartedAt: string, units: number): Promise<boolean>
}

export interface PluginWorkerDispatchPort {
  dispatch(input: Readonly<{ installation: ArtifactInstallation; target: string; payload: unknown }>): Promise<unknown>
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`
}
function same(value: unknown, other: unknown): boolean { return canonical(value) === canonical(other) }
function sameScope(left: ArtifactInstallation, right: Pick<ArtifactInstallation, 'platformId' | 'organizationId' | 'workspaceId' | 'siteId' | 'ownerKey' | 'ownerGeneration'>): boolean {
  return left.platformId === right.platformId && left.organizationId === right.organizationId && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId && left.ownerKey === right.ownerKey && left.ownerGeneration === right.ownerGeneration
}
function validNow(now: () => Date): string {
  const value = now().toISOString()
  if (new Date(value).toISOString() !== value) throw new ArtifactAuthorityError('invalid-contract', 'Clock must return a valid canonical instant.')
  return value
}

export class ArtifactInstallationAuthority {
  readonly #repository: ArtifactAuthorityRepository
  readonly #objects: SharedArtifactObjectStore
  readonly #workers: PluginWorkerDispatchPort
  readonly #now: () => Date

  constructor(input: Readonly<{ repository: ArtifactAuthorityRepository; objects: SharedArtifactObjectStore; workers: PluginWorkerDispatchPort; now?: () => Date }>) {
    this.#repository = input.repository
    this.#objects = input.objects
    this.#workers = input.workers
    this.#now = input.now ?? (() => new Date())
  }

  async readInstallation(
    scope: Pick<ArtifactInstallation, 'platformId' | 'ownerKey' | 'installationId'>,
  ): Promise<ArtifactInstallation | null> {
    const installation = await this.#repository.readInstallation(scope)
    return installation ? Object.freeze(structuredClone(installation)) : null
  }

  async readVerifiedArtifact(artifactId: string): Promise<Readonly<{ artifact: ArtifactRelease; bytes: Uint8Array }>> {
    const artifact = await this.#repository.readArtifact(artifactId)
    if (!artifact) throw new ArtifactAuthorityError('not-found', 'Immutable artifact release is unavailable.')
    const bytes = await this.#objects.get(artifact)
    if (bytes.byteLength !== artifact.sizeBytes || sha256Hex(bytes) !== artifact.contentHashSha256) {
      throw new ArtifactAuthorityError('immutable-artifact', 'Stored artifact bytes failed integrity verification.')
    }
    return Object.freeze({ artifact, bytes })
  }

  async register(rawArtifact: unknown, bytes: Uint8Array): Promise<ArtifactRelease> {
    const artifact = parseArtifactContract(ArtifactReleaseSchema, rawArtifact, 'artifact release') as ArtifactRelease
    assertArtifactPolicy(artifact)
    if (bytes.byteLength !== artifact.sizeBytes || sha256Hex(bytes) !== artifact.contentHashSha256) throw new ArtifactAuthorityError('immutable-artifact', 'Artifact bytes do not match immutable identity.')
    const existing = await this.#repository.readArtifact(artifact.artifactId)
    if (existing) {
      if (!same(existing, artifact)) throw new ArtifactAuthorityError('immutable-artifact', 'Artifact identity was reused with different immutable metadata.')
      const stored = await this.#objects.get(existing)
      if (stored.byteLength !== bytes.byteLength || sha256Hex(stored) !== artifact.contentHashSha256) throw new ArtifactAuthorityError('immutable-artifact', 'Stored artifact bytes failed integrity verification.')
      return existing
    }
    await this.#objects.putIfAbsent(artifact, bytes)
    if (!await this.#repository.insertArtifact(artifact)) {
      const winner = await this.#repository.readArtifact(artifact.artifactId)
      if (!winner) throw new ArtifactAuthorityError('immutable-artifact', 'Artifact immutable coordinates are already owned by another identity.')
      return this.register(artifact, bytes)
    }
    return artifact
  }

  async install(raw: unknown): Promise<ArtifactInstallation> {
    const installation = parseArtifactContract(ArtifactInstallationSchema, raw, 'artifact installation') as ArtifactInstallation
    assertInstallationPolicy(installation)
    const artifact = await this.#repository.readArtifact(installation.artifactId)
    if (!artifact || artifact.kind !== installation.artifactKind || artifact.packageId !== installation.packageId
      || artifact.exactVersion !== installation.exactVersion || artifact.contentHashSha256 !== installation.contentHashSha256
      || artifact.executionPolicy !== installation.executionPolicy) throw new ArtifactAuthorityError('not-found', 'Exact immutable artifact release is unavailable.')
    const existing = await this.#repository.readInstallation(installation)
    if (existing) {
      if (!same(existing, installation)) throw new ArtifactAuthorityError('conflict', 'Installation idempotency identity changed.')
      return existing
    }
    if (!await this.#repository.insertInstallation(installation)) {
      const winner = await this.#repository.readInstallation(installation)
      if (!winner) throw new ArtifactAuthorityError('conflict', 'Installation insertion fence changed or owner authority is unavailable.')
      if (!same(winner, installation)) throw new ArtifactAuthorityError('conflict', 'Installation idempotency identity changed.')
      return winner
    }
    return installation
  }

  async schedule(raw: unknown): Promise<ArtifactSchedule> {
    const schedule = parseArtifactContract(ArtifactScheduleSchema, raw, 'artifact schedule') as ArtifactSchedule
    const installation = await this.#required(schedule)
    if (installation.artifactKind !== 'plugin' || installation.executionPolicy !== 'plugin-sandbox-worker' || installation.state !== 'active') {
      throw new ArtifactAuthorityError('policy-denied', 'Only active sandboxed plugins may own schedules.')
    }
    if (await this.#repository.countSchedules(installation) >= installation.quota.scheduledJobs) throw new ArtifactAuthorityError('quota-exceeded', 'Plugin schedule quota is exhausted.')
    if (!await this.#repository.putScheduleIfAbsent(schedule)) return schedule
    return schedule
  }

  async recordStorage(raw: unknown): Promise<ArtifactStorageUsage> {
    const usage = parseArtifactContract(ArtifactStorageUsageSchema, raw, 'artifact storage usage') as ArtifactStorageUsage
    const installation = await this.#required(usage)
    if (usage.bytesUsed > installation.quota.storageBytes) throw new ArtifactAuthorityError('quota-exceeded', 'Artifact installation storage quota is exhausted.')
    if (!await this.#repository.putStorageUsage(installation, usage)) throw new ArtifactAuthorityError('conflict', 'Artifact storage usage version changed.')
    return usage
  }

  async crash(raw: unknown): Promise<ArtifactInstallation> {
    const crash = parseArtifactContract(ArtifactCrashSchema, raw, 'artifact crash') as ArtifactCrash
    const installation = await this.#required(crash)
    if (installation.artifactKind !== 'plugin' || installation.workerGeneration !== crash.workerGeneration || installation.state !== 'active') {
      throw new ArtifactAuthorityError('policy-denied', 'Crash evidence does not own the active plugin worker generation.')
    }
    const next = parseArtifactContract(ArtifactInstallationSchema, { ...installation, state: 'crashed', version: installation.version + 1, updatedAt: crash.occurredAt }, 'crashed installation') as ArtifactInstallation
    if (!await this.#repository.recordCrashAndContain(installation, crash, next)) throw new ArtifactAuthorityError('conflict', 'Plugin crash containment fence changed.')
    return next
  }

  async rollback(input: Readonly<{ installation: unknown; targetArtifactId: string }>): Promise<ArtifactInstallation> {
    const current = parseArtifactContract(ArtifactInstallationSchema, input.installation, 'rollback installation') as ArtifactInstallation
    const persisted = await this.#required(current)
    if (!same(current, persisted)) throw new ArtifactAuthorityError('conflict', 'Rollback installation is stale.')
    const target = await this.#repository.readArtifact(input.targetArtifactId)
    if (!target || target.kind !== current.artifactKind || target.packageId !== current.packageId) throw new ArtifactAuthorityError('not-found', 'Rollback artifact is not an exact release of the installed package.')
    const next = parseArtifactContract(ArtifactInstallationSchema, {
      ...current,
      artifactId: target.artifactId,
      exactVersion: target.exactVersion,
      contentHashSha256: target.contentHashSha256,
      executionPolicy: target.executionPolicy,
      previousArtifactId: current.artifactId,
      state: 'active',
      workerGeneration: current.artifactKind === 'plugin' ? (current.workerGeneration ?? 0) + 1 : null,
      version: current.version + 1,
      updatedAt: validNow(this.#now),
    }, 'rollback installation result') as ArtifactInstallation
    assertInstallationPolicy(next)
    if (!await this.#repository.replaceInstallation(current, next)) throw new ArtifactAuthorityError('conflict', 'Rollback installation fence changed.')
    return next
  }

  async transfer(input: Readonly<{
    transferId: string
    installation: unknown
    destination: Pick<ArtifactInstallation, 'organizationId' | 'workspaceId' | 'siteId' | 'ownerKey' | 'ownerGeneration'>
    rekeyedSecret: ArtifactSecret | null
  }>): Promise<ArtifactInstallation> {
    const current = parseArtifactContract(ArtifactInstallationSchema, input.installation, 'transfer installation') as ArtifactInstallation
    const persisted = await this.#required(current)
    if (!same(current, persisted) || input.destination.ownerGeneration <= current.ownerGeneration || input.destination.ownerKey === current.ownerKey) throw new ArtifactAuthorityError('scope-denied', 'Installation transfer authority is stale or unchanged.')
    if (current.artifactKind === 'component-pack' && input.rekeyedSecret !== null) throw new ArtifactAuthorityError('policy-denied', 'Component packs cannot gain secrets during transfer.')
    if (current.secret && (!input.rekeyedSecret || input.rekeyedSecret.fingerprintSha256 === current.secret.fingerprintSha256 || input.rekeyedSecret.ciphertextObjectKey === current.secret.ciphertextObjectKey)) {
      throw new ArtifactAuthorityError('scope-denied', 'Plugin secret must be re-encrypted for the destination owner.')
    }
    const now = validNow(this.#now)
    const next = parseArtifactContract(ArtifactInstallationSchema, {
      ...current,
      ...input.destination,
      secret: input.rekeyedSecret,
      state: 'active',
      workerGeneration: current.artifactKind === 'plugin' ? (current.workerGeneration ?? 0) + 1 : null,
      version: current.version + 1,
      updatedAt: now,
    }, 'transfer installation result') as ArtifactInstallation
    const receipt = parseArtifactContract(ArtifactTransferReceiptSchema, {
      transferId: input.transferId,
      installationId: current.installationId,
      artifactId: current.artifactId,
      sourceOwnerKey: current.ownerKey,
      sourceOwnerGeneration: current.ownerGeneration,
      destinationOwnerKey: next.ownerKey,
      destinationOwnerGeneration: next.ownerGeneration,
      sourceSecretFingerprintSha256: current.secret?.fingerprintSha256 ?? null,
      destinationSecretFingerprintSha256: next.secret?.fingerprintSha256 ?? null,
      transferredAt: now,
    }, 'artifact transfer receipt') as ArtifactTransferReceipt
    if (!await this.#repository.transferInstallation(current, next, receipt)) throw new ArtifactAuthorityError('conflict', 'Installation transfer fence changed.')
    return next
  }

  async dispatch(input: Readonly<{ scope: Pick<ArtifactInstallation, 'platformId' | 'ownerKey' | 'installationId'>; target: string; payload: unknown; units: number; windowStartedAt: string }>): Promise<unknown> {
    const installation = await this.#repository.readInstallation(input.scope)
    if (!installation || installation.artifactKind !== 'plugin' || installation.executionPolicy !== 'plugin-sandbox-worker' || installation.state !== 'active') {
      throw new ArtifactAuthorityError('policy-denied', 'Only an exact active plugin installation may dispatch a worker call.')
    }
    if (!Number.isSafeInteger(input.units) || input.units <= 0 || !await this.#repository.consumeCalls(installation, input.windowStartedAt, input.units)) {
      throw new ArtifactAuthorityError('quota-exceeded', 'Plugin call quota is exhausted.')
    }
    return await this.#workers.dispatch({ installation, target: input.target, payload: input.payload })
  }

  async #required(scope: Pick<ArtifactInstallation, 'platformId' | 'ownerKey' | 'installationId'> & Partial<ArtifactInstallation>): Promise<ArtifactInstallation> {
    const installation = await this.#repository.readInstallation(scope)
    if (!installation) throw new ArtifactAuthorityError('not-found', 'Artifact installation is unavailable.')
    if ('organizationId' in scope && !sameScope(installation, scope as ArtifactInstallation)) throw new ArtifactAuthorityError('scope-denied', 'Artifact installation belongs to another exact owner generation.')
    return installation
  }
}
