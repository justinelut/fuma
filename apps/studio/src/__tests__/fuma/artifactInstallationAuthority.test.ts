import { describe, expect, test } from 'bun:test'
import { FakeObjectStorageTransport, FumaObjectStorage, sha256Hex } from '../../../server/fuma/objectStorage'
import {
  ArtifactInstallationAuthority,
  ArtifactAuthorityError,
  TenantSharedArtifactObjectStore,
  type ArtifactAuthorityRepository,
  type ArtifactCrash,
  type ArtifactInstallation,
  type ArtifactRelease,
  type ArtifactSchedule,
  type ArtifactStorageUsage,
  type ArtifactTransferReceipt,
  type SharedArtifactObjectStore,
} from '../../../server/fuma/artifacts'

const now = '2026-07-29T12:00:00.000Z'
const bytes = new TextEncoder().encode('immutable-plugin-package')
const componentBytes = new TextEncoder().encode('{"components":[]}')
const hash = sha256Hex(bytes)
const componentHash = sha256Hex(componentBytes)

class MemoryObjects implements SharedArtifactObjectStore {
  readonly values = new Map<string, Uint8Array>()
  async putIfAbsent(artifact: ArtifactRelease, value: Uint8Array) { if (this.values.has(artifact.objectKey)) return 'exists' as const; this.values.set(artifact.objectKey, value.slice()); return 'inserted' as const }
  async get(artifact: ArtifactRelease) { const value = this.values.get(artifact.objectKey); if (!value) throw new Error('missing'); return value.slice() }
}

class MemoryRepository implements ArtifactAuthorityRepository {
  readonly artifacts = new Map<string, ArtifactRelease>()
  readonly installations = new Map<string, ArtifactInstallation>()
  readonly schedules: ArtifactSchedule[] = []
  readonly crashes: ArtifactCrash[] = []
  readonly usage = new Map<string, ArtifactStorageUsage>()
  readonly transfers: ArtifactTransferReceipt[] = []
  readonly calls = new Map<string, number>()
  key(value: Pick<ArtifactInstallation, 'platformId'|'ownerKey'|'installationId'>) { return `${value.platformId}:${value.ownerKey}:${value.installationId}` }
  async readArtifact(id: string) { return structuredClone(this.artifacts.get(id) ?? null) }
  async insertArtifact(value: ArtifactRelease) { if (this.artifacts.has(value.artifactId)) return false; this.artifacts.set(value.artifactId, structuredClone(value)); return true }
  async readInstallation(scope: Pick<ArtifactInstallation, 'platformId'|'ownerKey'|'installationId'>) { return structuredClone(this.installations.get(this.key(scope)) ?? null) }
  async insertInstallation(value: ArtifactInstallation) { const key = this.key(value); if (this.installations.has(key)) return false; this.installations.set(key, structuredClone(value)); return true }
  async replaceInstallation(current: ArtifactInstallation, next: ArtifactInstallation) { const key = this.key(current); if (JSON.stringify(this.installations.get(key)) !== JSON.stringify(current)) return false; this.installations.set(key, structuredClone(next)); return true }
  async transferInstallation(current: ArtifactInstallation, next: ArtifactInstallation, receipt: ArtifactTransferReceipt) { const key = this.key(current); if (JSON.stringify(this.installations.get(key)) !== JSON.stringify(current)) return false; this.installations.delete(key); this.installations.set(this.key(next), structuredClone(next)); this.transfers.push(structuredClone(receipt)); return true }
  async countSchedules(installation: ArtifactInstallation) { return this.schedules.filter((value) => this.key(value as ArtifactInstallation) === this.key(installation)).length }
  async putScheduleIfAbsent(value: ArtifactSchedule) { if (this.schedules.some((row) => row.scheduleId === value.scheduleId && this.key(row as ArtifactInstallation) === this.key(value as ArtifactInstallation))) return false; this.schedules.push(structuredClone(value)); return true }
  async putStorageUsage(installation: ArtifactInstallation, value: ArtifactStorageUsage) { if (value.bytesUsed > installation.quota.storageBytes) return false; const key = this.key(value as ArtifactInstallation); const current = this.usage.get(key); if (current && value.version !== current.version + 1) return false; this.usage.set(key, structuredClone(value)); return true }
  async recordCrashAndContain(installation: ArtifactInstallation, crash: ArtifactCrash, next: ArtifactInstallation) { if (JSON.stringify(this.installations.get(this.key(installation))) !== JSON.stringify(installation)) return false; this.crashes.push(structuredClone(crash)); this.installations.set(this.key(next), structuredClone(next)); return true }
  async consumeCalls(installation: ArtifactInstallation, window: string, units: number) { const key = `${this.key(installation)}:${window}`; const next = (this.calls.get(key) ?? 0) + units; if (next > installation.quota.callsPerMinute) return false; this.calls.set(key, next); return true }
}

function artifact(id = 'artifact-plugin-v1', version = '1.0.0'): ArtifactRelease {
  return { schemaVersion: 1, artifactId: id, kind: 'plugin', packageId: 'plugin-payments', exactVersion: version, executionPolicy: 'plugin-sandbox-worker', objectKey: `artifacts/plugin/plugin-payments/${version}.zip`, mimeType: 'application/zip', contentHashSha256: hash, sizeBytes: bytes.byteLength, permissions: ['storage.write'], provenance: { sourceHashSha256: 'a'.repeat(64), lockHashSha256: 'b'.repeat(64), builderId: 'builder-a' }, createdAt: now }
}
function componentArtifact(): ArtifactRelease {
  return { schemaVersion: 1, artifactId: 'artifact-component-v1', kind: 'component-pack', packageId: 'restaurant-pack', exactVersion: '1.0.0', executionPolicy: 'component-declarative', objectKey: 'artifacts/component-pack/restaurant-pack/1.0.0.json', mimeType: 'application/json', contentHashSha256: componentHash, sizeBytes: componentBytes.byteLength, permissions: ['content.public.read'], provenance: { sourceHashSha256: 'c'.repeat(64), lockHashSha256: 'd'.repeat(64), builderId: 'builder-b' }, createdAt: now }
}
function installation(owner: 'alpha'|'beta', artifactValue: ArtifactRelease = artifact()): ArtifactInstallation {
  return { platformId: 'fuma', organizationId: `org-${owner}`, workspaceId: `workspace-${owner}`, siteId: `site-${owner}`, ownerKey: `owner-${owner}`, ownerGeneration: 1, installationId: 'installation-shared', artifactId: artifactValue.artifactId, artifactKind: artifactValue.kind, packageId: artifactValue.packageId, exactVersion: artifactValue.exactVersion, contentHashSha256: artifactValue.contentHashSha256, executionPolicy: artifactValue.executionPolicy, settingsObjectKey: `artifact-installations/${owner}/settings.json`, secret: artifactValue.kind === 'plugin' ? { keyId: 'key-a', ciphertextObjectKey: `secrets/artifact-installations/${owner}/secret`, fingerprintSha256: owner === 'alpha' ? '1'.repeat(64) : '2'.repeat(64) } : null, state: 'active', workerGeneration: artifactValue.kind === 'plugin' ? 1 : null, quota: { storageBytes: 1000, scheduledJobs: artifactValue.kind === 'plugin' ? 1 : 0, callsPerMinute: 2 }, previousArtifactId: null, version: 1, installedAt: now, updatedAt: now }
}
function authority(repository = new MemoryRepository(), objects = new MemoryObjects()) {
  const dispatches: string[] = []
  return { repository, objects, dispatches, service: new ArtifactInstallationAuthority({ repository, objects, workers: { async dispatch({ installation }) { dispatches.push(installation.ownerKey); return { ok: true } } }, now: () => new Date(now) }) }
}

describe('FUMA-067 scoped artifact installations', () => {
function exactScope(value: ArtifactInstallation) {
  return { platformId: value.platformId, organizationId: value.organizationId, workspaceId: value.workspaceId, siteId: value.siteId, ownerKey: value.ownerKey, ownerGeneration: value.ownerGeneration, installationId: value.installationId }
}
  test('shares immutable package bytes while keeping two site installations and state isolated', async () => {
    const harness = authority()
    const release = await harness.service.register(artifact(), bytes)
    await harness.service.install(installation('alpha', release))
    await harness.service.install(installation('beta', release))
    expect(harness.objects.values.size).toBe(1)
    expect(harness.repository.installations.size).toBe(2)
    const alpha = installation('alpha', release)
    const beta = installation('beta', release)
    await harness.service.recordStorage({ ...exactScope(alpha), objectCount: 1, bytesUsed: 800, version: 1 })
    await expect(harness.service.recordStorage({ ...exactScope(beta), objectCount: 1, bytesUsed: 1001, version: 1 })).rejects.toThrow('quota')
    expect(harness.repository.usage.size).toBe(1)
  })

  test('contains one plugin crash, preserves its sibling, and enforces schedule/call quotas', async () => {
    const harness = authority()
    const release = await harness.service.register(artifact(), bytes)
    const alpha = await harness.service.install(installation('alpha', release))
    const beta = await harness.service.install(installation('beta', release))
    await harness.service.schedule({ ...exactScope(alpha), scheduleId: 'daily', cronExpression: '0 0 * * *', handlerName: 'daily', enabled: true, nextRunAt: now })
    await expect(harness.service.schedule({ ...exactScope(alpha), scheduleId: 'second', cronExpression: '0 1 * * *', handlerName: 'second', enabled: true, nextRunAt: now })).rejects.toThrow('quota')
    await harness.service.dispatch({ scope: alpha, target: 'route', payload: {}, units: 2, windowStartedAt: now })
    await expect(harness.service.dispatch({ scope: alpha, target: 'route', payload: {}, units: 1, windowStartedAt: now })).rejects.toThrow('quota')
    const crashed = await harness.service.crash({ ...exactScope(alpha), crashId: 'crash-a', workerGeneration: 1, errorCode: 'worker-failed', evidenceHashSha256: 'e'.repeat(64), occurredAt: now })
    expect(crashed.state).toBe('crashed')
    expect((await harness.repository.readInstallation(beta))?.state).toBe('active')
  })

  test('rolls back exact versions and transfers the other installation with secret rekey and generation fence', async () => {
    const harness = authority()
    const v1 = await harness.service.register(artifact(), bytes)
    const v2Bytes = new TextEncoder().encode('immutable-plugin-package-v2')
    const v2 = { ...artifact('artifact-plugin-v2', '2.0.0'), contentHashSha256: sha256Hex(v2Bytes), sizeBytes: v2Bytes.byteLength, objectKey: 'artifacts/plugin/plugin-payments/2.0.0.zip' }
    await harness.service.register(v2, v2Bytes)
    const alphaV1 = await harness.service.install(installation('alpha', v1))
    const upgraded = await harness.service.rollback({ installation: alphaV1, targetArtifactId: v2.artifactId })
    expect(upgraded).toMatchObject({ artifactId: v2.artifactId, previousArtifactId: v1.artifactId, workerGeneration: 2, version: 2 })
    const rolledBack = await harness.service.rollback({ installation: upgraded, targetArtifactId: v1.artifactId })
    expect(rolledBack).toMatchObject({ artifactId: v1.artifactId, previousArtifactId: v2.artifactId, workerGeneration: 3, version: 3 })

    const beta = await harness.service.install(installation('beta', v1))
    await expect(harness.service.transfer({ transferId: 'transfer-a', installation: beta, destination: { organizationId: 'org-gamma', workspaceId: 'workspace-gamma', siteId: 'site-gamma', ownerKey: 'owner-gamma', ownerGeneration: 2 }, rekeyedSecret: beta.secret })).rejects.toThrow('re-encrypted')
    const transferred = await harness.service.transfer({ transferId: 'transfer-a', installation: beta, destination: { organizationId: 'org-gamma', workspaceId: 'workspace-gamma', siteId: 'site-gamma', ownerKey: 'owner-gamma', ownerGeneration: 2 }, rekeyedSecret: { keyId: 'key-b', ciphertextObjectKey: 'secrets/artifact-installations/gamma/secret', fingerprintSha256: '3'.repeat(64) } })
    expect(transferred).toMatchObject({ ownerKey: 'owner-gamma', ownerGeneration: 2, workerGeneration: 2 })
    expect(harness.repository.transfers).toHaveLength(1)
  })

  test('installs declarative component packs but never dispatches workers, schedules, secrets, or crash state', async () => {
    const harness = authority()
    const release = await harness.service.register(componentArtifact(), componentBytes)
    const pack = await harness.service.install({ ...installation('alpha', release), settingsObjectKey: 'artifact-installations/alpha/component.json' })
    expect(pack).toMatchObject({ artifactKind: 'component-pack', workerGeneration: null, secret: null })
    await expect(harness.service.schedule({ ...exactScope(pack), scheduleId: 'bad', cronExpression: '0 0 * * *', handlerName: 'bad', enabled: true, nextRunAt: now })).rejects.toThrow('plugins')
    await expect(harness.service.dispatch({ scope: pack, target: 'schedule', payload: {}, units: 1, windowStartedAt: now })).rejects.toThrow('plugin')
    await expect(harness.service.crash({ ...exactScope(pack), crashId: 'bad', workerGeneration: 1, errorCode: 'bad', evidenceHashSha256: 'f'.repeat(64), occurredAt: now })).rejects.toThrow()
  })

  test('rejects mutable artifact identities and privileged declarative component packs', async () => {
    const harness = authority()
    await harness.service.register(artifact(), bytes)
    await expect(harness.service.register({ ...artifact(), sizeBytes: bytes.byteLength + 1 }, bytes)).rejects.toThrow('immutable identity')
    await expect(harness.service.register({ ...componentArtifact(), permissions: ['network.fetch'] }, componentBytes)).rejects.toThrow('privileged')
    expect(new ArtifactAuthorityError('scope-denied', 'x').code).toBe('scope-denied')
  })

  test('stores verified ZIP bytes once through the production tenant object authority', async () => {
    const zipBytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00])
    const zipArtifact: ArtifactRelease = {
      ...artifact('artifact-real-zip', '3.0.0'),
      objectKey: 'artifacts/plugin/plugin-payments/3.0.0.zip',
      contentHashSha256: sha256Hex(zipBytes),
      sizeBytes: zipBytes.byteLength,
    }
    const transport = new FakeObjectStorageTransport(() => Date.parse(now))
    const storage = new FumaObjectStorage({
      transport,
      policy: { allowedMimeTypes: ['application/zip', 'application/json'], maxObjectBytes: 1024, maxTenantBytes: 4096 },
      signingSecret: 's'.repeat(32),
      accessUrlBase: 'https://app.fuma.co.ke/_fuma/objects',
      nowMs: () => Date.parse(now),
    })
    const objects = new TenantSharedArtifactObjectStore(storage, { organizationId: 'platform-artifacts', workspaceId: 'platform-artifacts', siteId: 'platform-artifacts' })
    expect(await objects.putIfAbsent(zipArtifact, zipBytes)).toBe('inserted')
    expect(await objects.putIfAbsent(zipArtifact, zipBytes)).toBe('exists')
    expect(await objects.get(zipArtifact)).toEqual(zipBytes)
    expect(transport.physicalKeys()).toHaveLength(2)
    await expect(objects.putIfAbsent({ ...zipArtifact, contentHashSha256: '9'.repeat(64) }, zipBytes)).rejects.toThrow('different immutable metadata')
  })
})