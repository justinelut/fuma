import { describe, expect, it } from 'bun:test'
import { fumaLaunchRegistry } from '@core/fuma'
import {
  FakeObjectStorageTransport,
  FumaObjectStorage,
  ObjectStorageError,
  sha256Hex,
  type BeginMultipartInput,
  type ObjectList,
  type ObjectMetadata,
  type ObjectStoragePolicy,
  type ObjectTenantScope,
  type ObjectUrlPurpose,
  type PutObjectInput,
  type RedeemedObjectUrl,
  type SignedObjectUrl,
  type TenantMultipartUpload,
  type TenantObjectStorage,
} from '../../../server/fuma/objectStorage'
import type {
  TenantObjectCompensationReceipt,
  TenantObjectCopyIntent,
  TenantObjectCopyProgressReceipt,
  TenantObjectCopyReceipt,
  TenantObjectDeleteReceipt,
  TenantObjectInventoryItem,
  TenantObjectManifest,
} from '../../../server/fuma/tenantObjects'
import {
  OBJECT_COPY_TRANSFER_STEP_ID,
  OBJECT_COPY_TRANSFER_STEP_ORDER,
  OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ORDER,
  ObjectCopyTransferError,
  TransferInterruptionError,
  createObjectCopyTransferStep,
  type ObjectCopyProgress,
  type ObjectCopyStateInspection,
  type ObjectCopyStatePort,
  type ObjectCopyTransferOperation,
  type TenantObjectInventoryPort,
  type TransferManifest,
  type TransferReceipt,
  type TransferStepExecutionInput,
} from '../../../server/fuma/transfers'

const SOURCE: ObjectTenantScope = {
  organizationId: 'organization-source',
  workspaceId: 'workspace-source',
  siteId: 'site-transfer',
}
const DESTINATION: ObjectTenantScope = {
  organizationId: 'organization-destination',
  workspaceId: 'workspace-destination',
  siteId: 'site-transfer',
}
const ATTACKER: ObjectTenantScope = {
  organizationId: 'organization-attacker',
  workspaceId: 'workspace-source',
  siteId: 'site-transfer',
}
const POLICY: ObjectStoragePolicy = {
  allowedMimeTypes: ['text/plain'],
  maxObjectBytes: 1_024,
  maxTenantBytes: 32_768,
}
const SECRET = 'fuma-object-copy-test-signing-secret-at-least-32-bytes'
const NOW = '2026-07-25T07:10:00.000Z'

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function inventory(): TenantObjectInventoryItem[] {
  const item = (
    objectClass: TenantObjectInventoryItem['objectClass'],
    logicalKey: string,
    value: string,
    metadata: TenantObjectInventoryItem['metadata'],
  ): TenantObjectInventoryItem => ({
    objectClass,
    logicalKey,
    sizeBytes: bytes(value).byteLength,
    mimeType: 'text/plain',
    contentChecksumSha256: sha256Hex(bytes(value)),
    metadata,
  })
  return [
    item('content-revision', 'content/revisions/revision-01.txt', 'revision', {
      contentId: 'content-01', revisionId: 'revision-01',
    }),
    item('form-attachment', 'forms/attachments/form-01/submission.txt', 'form', {
      formId: 'form-01',
    }),
    item('media', 'media/media-01/original.txt', 'media', { mediaId: 'media-01' }),
    item('publish-release', 'publish/releases/release-01/index.txt', 'release', {
      releaseId: 'release-01',
    }),
    item('plugin-artifact', 'plugins/artifacts/plugin-01/package.txt', 'plugin', {
      pluginId: 'plugin-01',
    }),
    item(
      'plugin-installation-artifact',
      'plugins/installations/installation-01/cache.txt',
      'installation',
      { pluginId: 'plugin-01', pluginInstallationId: 'installation-01' },
    ),
    item('import-artifact', 'imports/import-01/source.txt', 'import', { importId: 'import-01' }),
    item('export-artifact', 'exports/export-01/site.txt', 'export', { exportId: 'export-01' }),
    item('ai-artifact', 'ai/artifacts/ai-01/result.txt', 'ai', { aiArtifactId: 'ai-01' }),
    item('mcp-artifact', 'mcp/artifacts/mcp-01/result.txt', 'mcp', { mcpArtifactId: 'mcp-01' }),
  ]
}

const CONTENT_BY_KEY = new Map(inventory().map((entry) => {
  const values: Readonly<Record<TenantObjectInventoryItem['objectClass'], string>> = {
    'content-revision': 'revision',
    'form-attachment': 'form',
    media: 'media',
    'publish-release': 'release',
    'plugin-artifact': 'plugin',
    'plugin-installation-artifact': 'installation',
    'import-artifact': 'import',
    'export-artifact': 'export',
    'ai-artifact': 'ai',
    'mcp-artifact': 'mcp',
  }
  return [entry.logicalKey, values[entry.objectClass]]
}))

function manifest(profileId = 'website'): TransferManifest {
  return {
    schemaVersion: 1,
    transferId: 'transfer-object-copy',
    source: { platformId: 'platform-fuma', ...SOURCE },
    destination: { platformId: 'platform-fuma', ...DESTINATION },
    siteProfileId: profileId,
    siteCapabilityOverrides: { grant: [], revoke: [] },
    siteCapabilityIds: ['site.settings'],
    snapshotChecksum: 'a'.repeat(64),
    resources: ['site-record'],
    collaborators: [],
    capturedAt: '2026-07-25T07:00:00.000Z',
  }
}

function execution(
  receipt: TransferReceipt | null = null,
  fence = 7,
  profileId = 'website',
): TransferStepExecutionInput {
  return {
    manifest: manifest(profileId),
    saga: { transferId: 'transfer-object-copy', lockId: 'lock-object-copy', fence },
    receipt,
  }
}

type FaultPhase = 'before' | 'after'

class FaultingStorage implements TenantObjectStorage {
  readonly delegate: TenantObjectStorage
  fault: string | null = null
  puts = new Map<string, number>()
  corruptSourceKey: string | null = null

  constructor(delegate: TenantObjectStorage) {
    this.delegate = delegate
  }

  async put(input: PutObjectInput): Promise<ObjectMetadata> {
    const point = `copy:${input.key}`
    this.#fault(point, 'before')
    const result = await this.delegate.put(input)
    if (sameScope(input.scope, DESTINATION)) {
      this.puts.set(input.key, (this.puts.get(input.key) ?? 0) + 1)
    }
    this.#fault(point, 'after')
    return result
  }

  beginMultipart(input: BeginMultipartInput): Promise<TenantMultipartUpload> {
    return this.delegate.beginMultipart(input)
  }

  async get(scope: ObjectTenantScope, key: string): Promise<Uint8Array> {
    const result = await this.delegate.get(scope, key)
    return sameScope(scope, SOURCE) && key === this.corruptSourceKey ? bytes('corrupt') : result
  }

  head(scope: ObjectTenantScope, key: string): Promise<ObjectMetadata> {
    return this.delegate.head(scope, key)
  }

  list(scope: ObjectTenantScope, prefix?: string): Promise<ObjectList> {
    return this.delegate.list(scope, prefix)
  }

  async delete(scope: ObjectTenantScope, key: string): Promise<void> {
    const point = `delete:${key}`
    this.#fault(point, 'before')
    await this.delegate.delete(scope, key)
    this.#fault(point, 'after')
  }

  createSignedUrl(input: Readonly<{
    scope: ObjectTenantScope
    key: string
    purpose: ObjectUrlPurpose
    ttlSeconds: number
  }>): Promise<SignedObjectUrl> {
    return this.delegate.createSignedUrl(input)
  }

  redeemSignedUrl(url: string, purpose: ObjectUrlPurpose): Promise<RedeemedObjectUrl> {
    return this.delegate.redeemSignedUrl(url, purpose)
  }

  #fault(point: string, phase: FaultPhase): void {
    if (this.fault !== `${point}:${phase}`) return
    this.fault = null
    throw new TransferInterruptionError(`death ${phase} ${point}`)
  }
}

function sameScope(left: ObjectTenantScope, right: ObjectTenantScope): boolean {
  return left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
}

class MemoryObjectCopyState implements ObjectCopyStatePort {
  manifest: TenantObjectManifest | null = null
  progress: ObjectCopyProgress[] = []
  compensatedProgress: ObjectCopyProgress[] = []
  deleteReceipts: TenantObjectDeleteReceipt[] = []
  sourcePrefixFrozen = false
  sourceAuthorized = true
  copyProgressReceipt: TenantObjectCopyProgressReceipt | null = null
  copyReceipt: TransferReceipt | null = null
  compensationReceipt: TenantObjectCompensationReceipt | null = null
  policyAuthority: 'source' | 'destination' = 'source'
  fault: string | null = null
  completions = 0

  inspect(input: ObjectCopyTransferOperation): Promise<ObjectCopyStateInspection> {
    return Promise.resolve(this.#inspection(input))
  }

  async initialize(
    input: ObjectCopyTransferOperation,
    objectManifest: TenantObjectManifest,
  ): Promise<ObjectCopyStateInspection> {
    this.#fault('manifest', 'before')
    this.#assertFence(input)
    if (this.manifest === null) {
      this.manifest = structuredClone(objectManifest)
      this.sourcePrefixFrozen = true
    } else if (!same(this.manifest, objectManifest)) {
      throw new Error('manifest conflict')
    }
    this.#fault('manifest', 'after')
    return this.#inspection(input)
  }

  async beginObject(
    input: ObjectCopyTransferOperation,
    checksum: string,
    intent: TenantObjectCopyIntent,
  ): Promise<ObjectCopyStateInspection> {
    this.#fault(`intent:${intent.logicalKey}`, 'before')
    this.#assertMutation(input, checksum)
    const existing = this.progress.find(({ intent: candidate }) => (
      candidate.logicalKey === intent.logicalKey
    ))
    if (!existing) this.progress.push({ intent: structuredClone(intent), receipt: null })
    else if (!same(existing.intent, intent)) throw new Error('intent conflict')
    this.#fault(`intent:${intent.logicalKey}`, 'after')
    return this.#inspection(input)
  }

  async recordObjectCopied(
    input: ObjectCopyTransferOperation,
    checksum: string,
    receipt: TenantObjectCopyReceipt,
  ): Promise<ObjectCopyStateInspection> {
    this.#fault(`receipt:${receipt.logicalKey}`, 'before')
    this.#assertMutation(input, checksum)
    const progress = this.progress.find(({ intent }) => intent.logicalKey === receipt.logicalKey)
    if (!progress || progress.intent.disposition !== receipt.disposition) {
      throw new Error('copy receipt has no matching intent')
    }
    if (progress.receipt && !same(progress.receipt, receipt)) throw new Error('copy receipt conflict')
    progress.receipt = structuredClone(receipt)
    this.#fault(`receipt:${receipt.logicalKey}`, 'after')
    return this.#inspection(input)
  }

  async completeCopy(
    input: ObjectCopyTransferOperation,
    checksum: string,
    progressReceipt: TenantObjectCopyProgressReceipt,
    receipt: TransferReceipt,
  ): Promise<ObjectCopyStateInspection> {
    this.#fault('copy-receipt', 'before')
    this.#assertMutation(input, checksum)
    if (this.progress.some((progress) => progress.receipt === null)
      || this.progress.length !== this.manifest?.entries.length) {
      throw new Error('partial copy cannot complete')
    }
    if (this.copyReceipt && !same(this.copyReceipt, receipt)) throw new Error('completion conflict')
    if (!this.copyReceipt) this.completions += 1
    this.copyProgressReceipt = structuredClone(progressReceipt)
    this.copyReceipt = structuredClone(receipt)
    this.#fault('copy-receipt', 'after')
    return this.#inspection(input)
  }

  async recordObjectCompensated(
    input: ObjectCopyTransferOperation,
    checksum: string,
    logicalKey: string,
    deleteReceipt: TenantObjectDeleteReceipt | null,
  ): Promise<ObjectCopyStateInspection> {
    this.#fault(`compensation-receipt:${logicalKey}`, 'before')
    this.#assertMutation(input, checksum)
    const progressIndex = this.progress.findIndex(({ intent }) => intent.logicalKey === logicalKey)
    if (progressIndex === -1) {
      const completed = this.compensatedProgress.find(({ intent }) => intent.logicalKey === logicalKey)
      if (!completed) return this.#inspection(input)
      if (deleteReceipt) {
        const existing = this.deleteReceipts.find((candidate) => candidate.logicalKey === logicalKey)
        if (!existing || !same(existing, deleteReceipt)) throw new Error('delete receipt conflict')
      }
      return this.#inspection(input)
    }
    const progress = this.progress[progressIndex]
    if (progress.intent.disposition === 'copy' && !deleteReceipt) {
      throw new Error('copy compensation requires delete evidence')
    }
    if (progress.intent.disposition === 'rebind' && deleteReceipt) {
      throw new Error('rebound object cannot have delete evidence')
    }
    if (deleteReceipt) {
      const existing = this.deleteReceipts.find((candidate) => candidate.logicalKey === logicalKey)
      if (!existing) this.deleteReceipts.push(structuredClone(deleteReceipt))
      else if (!same(existing, deleteReceipt)) throw new Error('delete receipt conflict')
    }
    this.compensatedProgress.push(structuredClone(progress))
    this.progress.splice(progressIndex, 1)
    this.#fault(`compensation-receipt:${logicalKey}`, 'after')
    return this.#inspection(input)
  }

  async completeCompensation(
    input: ObjectCopyTransferOperation,
    checksum: string,
    receipt: TenantObjectCompensationReceipt,
  ): Promise<ObjectCopyStateInspection> {
    this.#fault('compensation-complete', 'before')
    this.#assertMutation(input, checksum)
    if (this.progress.length > 0 || !this.sourceAuthorized
      || receipt.checkpoints.length !== this.compensatedProgress.length
      || !same(
        this.deleteReceipts.toSorted(byLogicalKey),
        [...receipt.revertedCopies].toSorted(byLogicalKey),
      )) {
      throw new Error('compensation incomplete')
    }
    this.sourcePrefixFrozen = false
    this.copyReceipt = null
    this.compensatedProgress = []
    this.compensationReceipt = structuredClone(receipt)
    this.#fault('compensation-complete', 'after')
    return this.#inspection(input)
  }

  switchPolicyToDestination(): void {
    if (!this.copyReceipt) throw new Error('policy cannot expose a partial destination')
    this.policyAuthority = 'destination'
    this.sourceAuthorized = false
  }

  restoreSourcePolicy(): void {
    this.policyAuthority = 'source'
    this.sourceAuthorized = true
  }

  async authorizedRead(
    storage: TenantObjectStorage,
    scope: ObjectTenantScope,
    key: string,
  ): Promise<Uint8Array> {
    const allowedScope = this.policyAuthority === 'source' ? SOURCE : DESTINATION
    if (!sameScope(scope, allowedScope)) {
      throw new ObjectStorageError('not_found', 'Object is hidden by tenant policy.')
    }
    return storage.get(scope, key)
  }

  #inspection(input: ObjectCopyTransferOperation): ObjectCopyStateInspection {
    return structuredClone({
      proposalMatches: input.manifest.transferId === 'transfer-object-copy'
        && sameScope(input.sourceScope, SOURCE)
        && sameScope(input.destinationScope, DESTINATION),
      fenceMatches: input.saga.lockId === 'lock-object-copy' && input.saga.fence === 7,
      manifest: this.manifest,
      progress: this.progress,
      compensatedProgress: this.compensatedProgress,
      deleteReceipts: this.deleteReceipts.toSorted(byLogicalKey),
      sourcePrefixFrozen: this.sourcePrefixFrozen,
      sourceAuthorized: this.sourceAuthorized,
      copyProgressReceipt: this.copyProgressReceipt,
      copyReceipt: this.copyReceipt,
      compensationReceipt: this.compensationReceipt,
    })
  }

  #assertFence(input: ObjectCopyTransferOperation): void {
    const inspection = this.#inspection(input)
    if (!inspection.proposalMatches || !inspection.fenceMatches) throw new Error('stale fake fence')
  }

  #assertMutation(input: ObjectCopyTransferOperation, checksum: string): void {
    this.#assertFence(input)
    if (this.manifest?.manifestChecksumSha256 !== checksum) {
      throw new Error('manifest checksum conflict')
    }
  }

  #fault(point: string, phase: FaultPhase): void {
    if (this.fault !== `${point}:${phase}`) return
    this.fault = null
    throw new TransferInterruptionError(`death ${phase} ${point}`)
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function byLogicalKey(
  left: TenantObjectDeleteReceipt,
  right: TenantObjectDeleteReceipt,
): number {
  return left.logicalKey.localeCompare(right.logicalKey)
}

class InventoryFixture implements TenantObjectInventoryPort {
  items = inventory()

  captureTenantObjectInventory(): Promise<unknown> {
    return Promise.resolve(structuredClone(this.items))
  }
}

function fixture() {
  const transport = new FakeObjectStorageTransport(() => Date.parse(NOW))
  const baseStorage = new FumaObjectStorage({
    transport,
    policy: POLICY,
    signingSecret: SECRET,
    accessUrlBase: 'https://fuma.test/_fuma/object-access',
  })
  const storage = new FaultingStorage(baseStorage)
  const state = new MemoryObjectCopyState()
  const catalog = new InventoryFixture()
  const step = createObjectCopyTransferStep({
    storage,
    state,
    inventory: catalog,
    now: () => NOW,
  })
  return { baseStorage, catalog, state, step, storage }
}

async function seed(storage: TenantObjectStorage): Promise<void> {
  for (const item of inventory()) {
    await storage.put({
      scope: SOURCE,
      key: item.logicalKey,
      bytes: bytes(CONTENT_BY_KEY.get(item.logicalKey)!),
      mimeType: item.mimeType,
      checksumSha256: item.contentChecksumSha256,
    })
  }
}

async function expectAuthorized(
  state: MemoryObjectCopyState,
  storage: TenantObjectStorage,
  scope: ObjectTenantScope,
): Promise<void> {
  const key = inventory()[2].logicalKey
  expect(new TextDecoder().decode(await state.authorizedRead(storage, scope, key))).toBe('media')
  const denied = sameScope(scope, SOURCE) ? DESTINATION : SOURCE
  await expect(state.authorizedRead(storage, denied, key)).rejects.toMatchObject({ code: 'not_found' })
  await expect(state.authorizedRead(storage, ATTACKER, key)).rejects.toMatchObject({ code: 'not_found' })
}

describe('FUMA-024 tenant-object copy transfer step', () => {
  it('is mandatory for every profile and ordered after base before final policy', () => {
    const { step } = fixture()
    expect(step).toMatchObject({
      id: OBJECT_COPY_TRANSFER_STEP_ID,
      order: OBJECT_COPY_TRANSFER_STEP_ORDER,
      dependsOn: ['transfer.base-ownership'],
      mandatory: true,
    })
    expect(OBJECT_COPY_TRANSFER_STEP_ORDER).toBeLessThan(
      OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ORDER,
    )
    for (const profileId of ['website', 'publication'] as const) {
      expect(fumaLaunchRegistry.compose(profileId).transfer.map(({ id }) => id))
        .not.toContain('transfer.media')
    }
  })

  it('captures every canonical object class and rejects an unclassified source orphan', async () => {
    const h = fixture()
    await seed(h.storage)
    const receipt = await h.step.apply(execution())

    expect(receipt).toMatchObject({
      code: 'tenant-objects-copied',
      details: {
        entryCount: 10,
        objectClasses: inventory().map(({ objectClass }) => objectClass).toSorted(),
        manifestChecksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
    expect(h.state.manifest?.entries.map(({ objectClass }) => objectClass).toSorted())
      .toEqual(inventory().map(({ objectClass }) => objectClass).toSorted())
    expect(h.state.progress.every(({ receipt: copy }) => copy !== null)).toBe(true)
    expect(h.state.copyProgressReceipt?.completedCount).toBe(10)
    await expectAuthorized(h.state, h.storage, SOURCE)

    const orphan = fixture()
    await seed(orphan.storage)
    const orphanBytes = bytes('orphan')
    await orphan.storage.put({
      scope: SOURCE,
      key: 'media/uninventoried/orphan.txt',
      bytes: orphanBytes,
      mimeType: 'text/plain',
      checksumSha256: sha256Hex(orphanBytes),
    })
    await expect(orphan.step.apply(execution())).rejects.toMatchObject({ code: 'inventory-drift' })
    expect(orphan.state.manifest).toBeNull()
  })

  it('survives death across every object class and every intent/copy/receipt boundary without exposure', async () => {
    const boundaries = ['intent', 'copy', 'receipt'] as const
    const cases = inventory().map(({ logicalKey }, index) => ({
      logicalKey,
      point: boundaries[index % boundaries.length],
      phase: (index % 2 === 0 ? 'before' : 'after') as FaultPhase,
    }))
    const representative = inventory()[2].logicalKey
    for (const point of boundaries) {
      for (const phase of ['before', 'after'] as const) {
        cases.push({ logicalKey: representative, point, phase })
      }
    }

    for (const { logicalKey, point, phase } of cases) {
      const h = fixture()
      await seed(h.storage)
      const owner = point === 'copy' ? h.storage : h.state
      owner.fault = `${point}:${logicalKey}:${phase}`

      await expect(h.step.apply(execution())).rejects.toBeInstanceOf(TransferInterruptionError)
      await expectAuthorized(h.state, h.storage, SOURCE)
      await expect(h.step.verify(execution())).resolves.toEqual({
        status: 'not-applied',
        receipt: null,
      })

      await h.step.apply(execution())
      expect(h.storage.puts.get(logicalKey)).toBe(1)
      expect(h.state.progress).toHaveLength(inventory().length)
    }
  }, 15_000)

  it('replays copied-but-unreceipted bytes and final completion exactly once', async () => {
    const key = inventory()[0].logicalKey
    const h = fixture()
    await seed(h.storage)
    h.state.fault = `receipt:${key}:before`
    await expect(h.step.apply(execution())).rejects.toBeInstanceOf(TransferInterruptionError)
    expect(h.state.progress.find(({ intent }) => intent.logicalKey === key)).toMatchObject({
      intent: { logicalKey: key, state: 'copying' },
      receipt: null,
    })

    const receipt = await h.step.apply(execution())
    expect(await h.step.apply(execution(receipt))).toEqual(receipt)
    expect(await h.step.verify(execution(receipt))).toEqual({ status: 'verified', receipt })
    expect(h.storage.puts.get(key)).toBe(1)
    expect(h.state.completions).toBe(1)
  })

  it('rejects stale fences, inventory metadata drift, source bytes drift, and destination collisions', async () => {
    const stale = fixture()
    await seed(stale.storage)
    await expect(stale.step.apply(execution(null, 6))).rejects.toMatchObject({ code: 'stale-fence' })

    const catalogDrift = fixture()
    await seed(catalogDrift.storage)
    catalogDrift.catalog.items[0] = { ...catalogDrift.catalog.items[0], sizeBytes: 999 }
    await expect(catalogDrift.step.apply(execution())).rejects.toMatchObject({ code: 'inventory-drift' })

    const sourceDrift = fixture()
    await seed(sourceDrift.storage)
    sourceDrift.storage.corruptSourceKey = inventory()[0].logicalKey
    await expect(sourceDrift.step.apply(execution())).rejects.toMatchObject({ code: 'source-object-drift' })

    const destinationDrift = fixture()
    await seed(destinationDrift.storage)

    const wrong = bytes('wrong')
    await destinationDrift.storage.put({
      scope: DESTINATION,
      key: inventory()[0].logicalKey,
      bytes: wrong,
      mimeType: 'text/plain',
      checksumSha256: sha256Hex(wrong),
    })
    await expect(destinationDrift.step.apply(execution())).rejects.toMatchObject({
      code: 'destination-object-drift',
    })
  })

  it('compensates a partial interrupted copy without a complete progress or policy receipt', async () => {
    const h = fixture()
    await seed(h.storage)
    const key = inventory()
      .map(({ logicalKey }) => logicalKey)
      .toSorted()[0]!
    h.state.fault = `receipt:${key}:before`
    await expect(h.step.apply(execution())).rejects.toBeInstanceOf(TransferInterruptionError)
    expect(h.state.copyProgressReceipt).toBeNull()
    expect(h.state.progress).toHaveLength(1)

    const compensated = await h.step.compensate(execution())
    expect(compensated).toMatchObject({
      status: 'compensated',
      receipt: {
        code: 'tenant-objects-copy-compensated',
        details: {
          copyProgressReceiptChecksumSha256: null,
          checkpointCount: 1,
          revertedCopies: [{ logicalKey: key }],
        },
      },
    })
    await expect(h.step.compensate(execution())).resolves.toEqual(compensated)
    expect(h.state.progress).toEqual([])
    expect(h.state.compensatedProgress).toEqual([])
    await expect(h.baseStorage.head(DESTINATION, key))
      .rejects.toMatchObject({ code: 'not_found' })
  })

  it('preserves identical rebound objects and deletes every transfer-created copy', async () => {
    const h = fixture()
    await seed(h.storage)
    const rebound = inventory()[0]
    await h.storage.put({
      scope: DESTINATION,
      key: rebound.logicalKey,
      bytes: bytes(CONTENT_BY_KEY.get(rebound.logicalKey)!),
      mimeType: rebound.mimeType,
      checksumSha256: rebound.contentChecksumSha256,
    })
    const receipt = await h.step.apply(execution())
    expect(h.state.progress.find(({ intent }) => intent.logicalKey === rebound.logicalKey))
      .toMatchObject({ intent: { disposition: 'rebind' } })

    await expect(h.step.compensate(execution(receipt))).resolves.toMatchObject({
      status: 'compensated',
    })
    expect(await h.baseStorage.head(DESTINATION, rebound.logicalKey)).toBeDefined()
    for (const entry of inventory().slice(1)) {
      await expect(h.baseStorage.head(DESTINATION, entry.logicalKey))
        .rejects.toMatchObject({ code: 'not_found' })
    }
    expect(h.state.deleteReceipts).toHaveLength(inventory().length - 1)
  })

  it('requires final policy restoration before cleanup and replays reverse faults', async () => {
    const h = fixture()
    await seed(h.storage)
    const receipt = await h.step.apply(execution())
    h.state.switchPolicyToDestination()
    await expect(h.step.compensate(execution(receipt))).rejects.toMatchObject({
      code: 'source-policy-not-restored',
    })
    await expectAuthorized(h.state, h.storage, DESTINATION)

    h.state.restoreSourcePolicy()
    const key = inventory().at(-1)!.logicalKey
    h.storage.fault = `delete:${key}:after`
    await expect(h.step.compensate(execution(receipt)))
      .rejects.toBeInstanceOf(TransferInterruptionError)
    const replay = await h.step.compensate(execution(receipt))
    expect(replay.status).toBe('compensated')
    expect(h.state.progress).toEqual([])
    await expectAuthorized(h.state, h.storage, SOURCE)
  })

  it('rejects receipt substitution and never authorizes attacker ancestry', async () => {
    const h = fixture()
    await seed(h.storage)
    const receipt = await h.step.apply(execution(null, 7, 'publication'))
    await expect(h.step.apply(execution({
      code: receipt.code,
      details: { ...receipt.details, fence: 999 },
    }, 7, 'publication'))).rejects.toBeInstanceOf(ObjectCopyTransferError)
    await expect(h.state.authorizedRead(h.storage, ATTACKER, inventory()[0].logicalKey))
      .rejects.toMatchObject({ code: 'not_found' })
  })
})
