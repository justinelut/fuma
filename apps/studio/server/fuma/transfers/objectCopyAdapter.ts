import type {
  ObjectMetadata,
  ObjectTenantScope,
  TenantObjectStorage,
} from '../objectStorage'
import {
  ObjectStorageError,
  sha256Hex,
} from '../objectStorage'
import {
  createTenantObjectCopyIntent,
  createTenantObjectCopyReceipt,
  createTenantObjectDeleteReceipt,
  createTenantObjectInventory,
  createTenantObjectManifest,
  type TenantObjectCompensationReceipt,
  type TenantObjectCopyDisposition,
  type TenantObjectCopyProgressReceipt,
  type TenantObjectDeleteReceipt,
  type TenantObjectEntry,
  type TenantObjectInventory,
  type TenantObjectManifest,
} from '../tenantObjects'
import type { TransferReceipt } from './contracts'
import { sameTransferValue } from './baseOwnershipStep'
import {
  assertExactSourceInventory,
  assertInspection,
  copyError,
  progressFor,
  type ObjectCopyProgress,
  type ObjectCopyStateInspection,
  type ObjectCopyStatePort,
  type ObjectCopyTransferOperation,
  type TenantObjectInventoryPort,
} from './objectCopyContracts'

async function objectMetadata(
  storage: TenantObjectStorage,
  scope: ObjectTenantScope,
  key: string,
): Promise<ObjectMetadata | null> {
  try {
    return await storage.head(scope, key)
  } catch (error) {
    if (error instanceof ObjectStorageError && error.code === 'not_found') return null
    throw error
  }
}

async function matchesObject(
  storage: TenantObjectStorage,
  scope: ObjectTenantScope,
  entry: TenantObjectEntry,
): Promise<boolean> {
  const metadata = await objectMetadata(storage, scope, entry.logicalKey)
  if (!metadata
    || metadata.sizeBytes !== entry.sizeBytes
    || metadata.mimeType !== entry.mimeType
    || metadata.checksumSha256 !== entry.contentChecksumSha256) return false
  const bytes = await storage.get(scope, entry.logicalKey)
  return bytes.byteLength === entry.sizeBytes && sha256Hex(bytes) === entry.contentChecksumSha256
}

export type TenantObjectCopyTransferAdapterOptions = Readonly<{
  storage: TenantObjectStorage
  state: ObjectCopyStatePort
  inventory: TenantObjectInventoryPort
  now?: () => string
}>

export class TenantObjectCopyTransferAdapter {
  readonly #storage: TenantObjectStorage
  readonly #state: ObjectCopyStatePort
  readonly #inventory: TenantObjectInventoryPort
  readonly #now: () => string

  constructor(options: TenantObjectCopyTransferAdapterOptions) {
    this.#storage = options.storage
    this.#state = options.state
    this.#inventory = options.inventory
    this.#now = options.now ?? (() => new Date().toISOString())
  }

  inspect(operation: ObjectCopyTransferOperation): Promise<ObjectCopyStateInspection> {
    return this.#state.inspect(operation)
  }

  async prepare(operation: ObjectCopyTransferOperation): Promise<ObjectCopyStateInspection> {
    const current = await this.#state.inspect(operation)
    assertInspection(current, operation)
    if (current.compensationReceipt !== null) return current
    if (current.manifest) return current
    if (current.sourcePrefixFrozen || current.copyReceipt !== null
      || current.progress.length > 0 || current.compensatedProgress.length > 0) {
      copyError('checkpoint-drift', 'Object manifest capture found partial prior state.', 'state')
    }

    let inventory: TenantObjectInventory
    try {
      inventory = createTenantObjectInventory(
        await this.#inventory.captureTenantObjectInventory(operation),
      )
    } catch (error) {
      copyError('inventory-drift', 'The server-owned tenant-object inventory is invalid.', 'inventory', error)
    }
    const listed = await this.#storage.list(operation.sourceScope)
    assertExactSourceInventory(inventory, listed.objects)
    const manifest = createTenantObjectManifest({
      transferId: operation.manifest.transferId,
      source: operation.sourceScope,
      destination: operation.destinationScope,
      inventory,
      capturedAt: operation.manifest.capturedAt,
    })
    const initialized = await this.#state.initialize(operation, manifest)
    assertInspection(initialized, operation)
    if (!initialized.manifest || !sameTransferValue(initialized.manifest, manifest)) {
      copyError('manifest-drift', 'Object manifest initialization was not exact.', 'state.manifest')
    }
    return initialized
  }

  async verifyDestinationObject(
    operation: ObjectCopyTransferOperation,
    entry: TenantObjectEntry,
  ): Promise<boolean> {
    return matchesObject(this.#storage, operation.destinationScope, entry)
  }

  async copyOrRebind(
    operation: ObjectCopyTransferOperation,
    manifest: TenantObjectManifest,
    entry: TenantObjectEntry,
  ): Promise<ObjectCopyStateInspection> {
    let inspection = await this.#state.inspect(operation)
    assertInspection(inspection, operation)
    const existing = progressFor(inspection, entry)
    if (existing?.receipt) {
      if (!await this.verifyDestinationObject(operation, entry)) {
        copyError(
          'destination-object-drift',
          'A receipted destination object no longer matches its checksum.',
          `objects.${entry.logicalKey}`,
        )
      }
      return inspection
    }
    if (!await matchesObject(this.#storage, operation.sourceScope, entry)) {
      copyError(
        'source-object-drift',
        'A source object differs from the frozen tenant-object manifest.',
        `objects.${entry.logicalKey}`,
      )
    }

    let intent = existing?.intent
    if (!intent) {
      const destinationMetadata = await objectMetadata(
        this.#storage,
        operation.destinationScope,
        entry.logicalKey,
      )
      const destinationMatches = destinationMetadata !== null
        && await this.verifyDestinationObject(operation, entry)
      if (destinationMetadata && !destinationMatches) {
        copyError(
          'destination-object-drift',
          'A destination collision differs from the immutable source object.',
          `objects.${entry.logicalKey}`,
        )
      }
      const disposition: TenantObjectCopyDisposition = destinationMatches ? 'rebind' : 'copy'
      intent = createTenantObjectCopyIntent({
        manifest,
        saga: operation.saga,
        logicalKey: entry.logicalKey,
        disposition,
        intendedAt: this.#now(),
      })
      inspection = await this.#state.beginObject(
        operation,
        manifest.manifestChecksumSha256,
        intent,
      )
      assertInspection(inspection, operation)
      const recorded = progressFor(inspection, entry)?.intent
      if (!recorded || !sameTransferValue(recorded, intent)) {
        copyError('checkpoint-drift', 'Object copy intent was not durably recorded.', 'state.progress')
      }
    }

    if (intent.disposition === 'copy') {
      const destinationMetadata = await objectMetadata(
        this.#storage,
        operation.destinationScope,
        entry.logicalKey,
      )
      if (destinationMetadata === null) {
        const bytes = await this.#storage.get(operation.sourceScope, entry.logicalKey)
        if (bytes.byteLength !== entry.sizeBytes
          || sha256Hex(bytes) !== entry.contentChecksumSha256) {
          copyError(
            'source-object-drift',
            'Source bytes changed after manifest verification.',
            `objects.${entry.logicalKey}`,
          )
        }
        try {
          await this.#storage.put({
            scope: operation.destinationScope,
            key: entry.logicalKey,
            bytes,
            mimeType: entry.mimeType,
            checksumSha256: entry.contentChecksumSha256,
          })
        } catch (error) {
          if (!(error instanceof ObjectStorageError) || error.code !== 'already_exists') throw error
        }
      }
    }
    if (!await this.verifyDestinationObject(operation, entry)) {
      copyError(
        'destination-object-drift',
        'Copied or rebound destination bytes do not match the tenant-object manifest.',
        `objects.${entry.logicalKey}`,
      )
    }
    const receipt = createTenantObjectCopyReceipt({
      manifest,
      saga: operation.saga,
      logicalKey: entry.logicalKey,
      disposition: intent.disposition,
      copiedAt: this.#now(),
    })
    const recorded = await this.#state.recordObjectCopied(
      operation,
      manifest.manifestChecksumSha256,
      receipt,
    )
    assertInspection(recorded, operation)
    if (!sameTransferValue(progressFor(recorded, entry)?.receipt, receipt)) {
      copyError('checkpoint-drift', 'Object copy receipt was not durably recorded.', 'state.progress')
    }
    return recorded
  }

  completeCopy(
    operation: ObjectCopyTransferOperation,
    manifest: TenantObjectManifest,
    progress: TenantObjectCopyProgressReceipt,
    receipt: TransferReceipt,
  ): Promise<ObjectCopyStateInspection> {
    return this.#state.completeCopy(
      operation,
      manifest.manifestChecksumSha256,
      progress,
      receipt,
    )
  }

  async compensateObject(
    operation: ObjectCopyTransferOperation,
    manifest: TenantObjectManifest,
    progress: ObjectCopyProgress,
  ): Promise<ObjectCopyStateInspection> {
    let deleteReceipt: TenantObjectDeleteReceipt | null = null
    const entry = manifest.entries.find(({ logicalKey }) => logicalKey === progress.intent.logicalKey)
    if (!entry) {
      copyError('manifest-drift', 'Object progress is outside the immutable manifest.', 'state.progress')
    }
    if (progress.intent.disposition === 'copy') {
      const metadata = await objectMetadata(
        this.#storage,
        operation.destinationScope,
        entry.logicalKey,
      )
      let outcome: 'deleted' | 'already-absent' = 'already-absent'
      if (metadata) {
        if (!await this.verifyDestinationObject(operation, entry)) {
          copyError(
            'destination-object-drift',
            'A transfer-created destination object changed before compensation.',
            `objects.${entry.logicalKey}`,
          )
        }
        await this.#storage.delete(operation.destinationScope, entry.logicalKey)
        outcome = 'deleted'
      }
      deleteReceipt = createTenantObjectDeleteReceipt(
        manifest,
        operation.saga,
        entry.logicalKey,
        outcome,
        this.#now(),
      )
    } else if (!await this.verifyDestinationObject(operation, entry)) {
      copyError(
        'destination-object-drift',
        'A rebound destination object changed before compensation.',
        `objects.${entry.logicalKey}`,
      )
    }
    return this.#state.recordObjectCompensated(
      operation,
      manifest.manifestChecksumSha256,
      entry.logicalKey,
      deleteReceipt,
    )
  }

  completeCompensation(
    operation: ObjectCopyTransferOperation,
    manifest: TenantObjectManifest,
    receipt: TenantObjectCompensationReceipt,
  ): Promise<ObjectCopyStateInspection> {
    return this.#state.completeCompensation(
      operation,
      manifest.manifestChecksumSha256,
      receipt,
    )
  }
}
