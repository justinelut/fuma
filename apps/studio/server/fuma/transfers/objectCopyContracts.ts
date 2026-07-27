import type { ObjectMetadata, ObjectTenantScope } from '../objectStorage'
import {
  assertTenantObjectCompensationReceipt,
  assertTenantObjectCopyIntent,
  assertTenantObjectCopyProgressReceipt,
  assertTenantObjectCopyReceipt,
  assertTenantObjectDeleteReceipt,
  assertTenantObjectManifest,
  type TenantObjectCompensationReceipt,
  type TenantObjectCopyIntent,
  type TenantObjectCopyProgressReceipt,
  type TenantObjectCopyReceipt,
  type TenantObjectDeleteReceipt,
  type TenantObjectEntry,
  type TenantObjectInventory,
  type TenantObjectManifest,
} from '../tenantObjects'
import type { TransferManifest, TransferReceipt } from './contracts'
import { assertTransferManifest } from './contracts'
import { sameTransferValue } from './baseOwnershipStep'
import type {
  TransferSagaFence,
  TransferStepExecutionInput,
} from './stepRegistry'

export const OBJECT_COPY_TRANSFER_STEP_ID = 'transfer.tenant-objects-copy'
export const OBJECT_COPY_TRANSFER_STEP_ORDER = 60

/** Server-owned catalog for every persisted object under one site namespace. */
export interface TenantObjectInventoryPort {
  captureTenantObjectInventory(input: ObjectCopyTransferOperation): Promise<unknown>
}

export type ObjectCopyProgress = Readonly<{
  intent: TenantObjectCopyIntent
  receipt: TenantObjectCopyReceipt | null
}>

export type ObjectCopyTransferOperation = Readonly<{
  saga: TransferSagaFence
  manifest: TransferManifest
  sourceScope: ObjectTenantScope
  destinationScope: ObjectTenantScope
}>

export type ObjectCopyStateInspection = Readonly<{
  proposalMatches: boolean
  fenceMatches: boolean
  manifest: TenantObjectManifest | null
  progress: readonly ObjectCopyProgress[]
  compensatedProgress: readonly ObjectCopyProgress[]
  deleteReceipts: readonly TenantObjectDeleteReceipt[]
  sourcePrefixFrozen: boolean
  sourceAuthorized: boolean
  copyProgressReceipt: TenantObjectCopyProgressReceipt | null
  copyReceipt: TransferReceipt | null
  compensationReceipt: TenantObjectCompensationReceipt | null
}>

/**
 * Durable fenced state. Implementations reserve an intent before object writes,
 * persist per-object evidence after verification, and remove progress only with
 * matching compensation evidence. Source authorization is controlled solely by
 * the mandatory final ownership-policy step.
 */
export interface ObjectCopyStatePort {
  inspect(input: ObjectCopyTransferOperation): Promise<ObjectCopyStateInspection>
  initialize(
    input: ObjectCopyTransferOperation,
    manifest: TenantObjectManifest,
  ): Promise<ObjectCopyStateInspection>
  beginObject(
    input: ObjectCopyTransferOperation,
    manifestChecksumSha256: string,
    intent: TenantObjectCopyIntent,
  ): Promise<ObjectCopyStateInspection>
  recordObjectCopied(
    input: ObjectCopyTransferOperation,
    manifestChecksumSha256: string,
    receipt: TenantObjectCopyReceipt,
  ): Promise<ObjectCopyStateInspection>
  completeCopy(
    input: ObjectCopyTransferOperation,
    manifestChecksumSha256: string,
    progressReceipt: TenantObjectCopyProgressReceipt,
    receipt: TransferReceipt,
  ): Promise<ObjectCopyStateInspection>
  recordObjectCompensated(
    input: ObjectCopyTransferOperation,
    manifestChecksumSha256: string,
    logicalKey: string,
    deleteReceipt: TenantObjectDeleteReceipt | null,
  ): Promise<ObjectCopyStateInspection>
  completeCompensation(
    input: ObjectCopyTransferOperation,
    manifestChecksumSha256: string,
    receipt: TenantObjectCompensationReceipt,
  ): Promise<ObjectCopyStateInspection>
}

export type ObjectCopyTransferErrorCode =
  | 'invalid-execution'
  | 'inventory-drift'
  | 'stale-fence'
  | 'transfer-ancestry-mismatch'
  | 'manifest-drift'
  | 'source-object-drift'
  | 'destination-object-drift'
  | 'checkpoint-drift'
  | 'source-policy-not-restored'
  | 'receipt-mismatch'

export class ObjectCopyTransferError extends Error {
  readonly code: ObjectCopyTransferErrorCode
  readonly path: string

  constructor(
    code: ObjectCopyTransferErrorCode,
    message: string,
    path: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ObjectCopyTransferError'
    this.code = code
    this.path = path
  }
}

export function copyError(
  code: ObjectCopyTransferErrorCode,
  message: string,
  path: string,
  cause?: unknown,
): never {
  throw new ObjectCopyTransferError(
    code,
    message,
    path,
    cause === undefined ? undefined : { cause },
  )
}

export function operationFrom(input: TransferStepExecutionInput): ObjectCopyTransferOperation {
  try {
    assertTransferManifest(input.manifest)
  } catch (error) {
    copyError(
      'invalid-execution',
      'The tenant-object copy step received an invalid transfer manifest.',
      'input.manifest',
      error,
    )
  }
  if (input.saga.transferId !== input.manifest.transferId
    || !input.saga.lockId
    || !Number.isSafeInteger(input.saga.fence)
    || input.saga.fence < 1) {
    copyError(
      'invalid-execution',
      'The tenant-object copy step requires this transfer active lock and positive fence.',
      'input.saga',
    )
  }
  return {
    saga: input.saga,
    manifest: input.manifest,
    sourceScope: {
      organizationId: input.manifest.source.organizationId,
      workspaceId: input.manifest.source.workspaceId,
      siteId: input.manifest.source.siteId,
    },
    destinationScope: {
      organizationId: input.manifest.destination.organizationId,
      workspaceId: input.manifest.destination.workspaceId,
      siteId: input.manifest.destination.siteId,
    },
  }
}

function sameScope(left: ObjectTenantScope, right: ObjectTenantScope): boolean {
  return left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
}

function assertOperationManifest(
  manifest: TenantObjectManifest,
  operation: ObjectCopyTransferOperation,
): void {
  try {
    assertTenantObjectManifest(manifest)
  } catch (error) {
    copyError('manifest-drift', 'The durable tenant-object manifest is invalid.', 'state.manifest', error)
  }
  if (manifest.transferId !== operation.manifest.transferId
    || !sameScope(manifest.source, operation.sourceScope)
    || !sameScope(manifest.destination, operation.destinationScope)
    || manifest.capturedAt !== operation.manifest.capturedAt) {
    copyError(
      'manifest-drift',
      'The durable tenant-object manifest differs from the immutable transfer ancestry.',
      'state.manifest',
    )
  }
}

export function assertExactSourceInventory(
  inventory: TenantObjectInventory,
  listed: readonly ObjectMetadata[],
): void {
  const storageEntries = [...listed].sort((left, right) => left.key.localeCompare(right.key))
  if (storageEntries.length !== inventory.length) {
    copyError(
      'inventory-drift',
      'The canonical tenant-object inventory must account for every object under the source site prefix.',
      'inventory',
    )
  }
  for (const [index, item] of inventory.entries()) {
    const stored = storageEntries[index]
    if (!stored || stored.key !== item.logicalKey
      || stored.sizeBytes !== item.sizeBytes
      || stored.mimeType !== item.mimeType
      || stored.checksumSha256 !== item.contentChecksumSha256) {
      copyError(
        'inventory-drift',
        'Tenant-object inventory metadata differs from immutable source storage.',
        `inventory[${index}]`,
      )
    }
  }
}

export function progressFor(
  inspection: ObjectCopyStateInspection,
  entry: TenantObjectEntry,
): ObjectCopyProgress | undefined {
  const matches = inspection.progress.filter(({ intent }) => intent.logicalKey === entry.logicalKey)
  if (matches.length > 1) {
    copyError('checkpoint-drift', 'An object has duplicate durable checkpoints.', 'state.progress')
  }
  return matches[0]
}

function assertProgress(
  progress: ObjectCopyProgress,
  manifest: TenantObjectManifest,
  saga: TransferSagaFence,
  path: string,
): void {
  try {
    assertTenantObjectCopyIntent(progress.intent, manifest, saga, `${path}.intent`)
    if (progress.receipt) {
      assertTenantObjectCopyReceipt(progress.receipt, manifest, saga, `${path}.receipt`)
    }
  } catch (error) {
    copyError('checkpoint-drift', 'Durable object-copy evidence drifted.', path, error)
  }
  if (progress.receipt && (
    progress.receipt.logicalKey !== progress.intent.logicalKey
    || progress.receipt.disposition !== progress.intent.disposition
  )) {
    copyError('checkpoint-drift', 'Copy receipt does not match its durable intent.', path)
  }
}

export function assertInspection(
  inspection: ObjectCopyStateInspection,
  operation: ObjectCopyTransferOperation,
): void {
  if (!inspection.proposalMatches) {
    copyError(
      'transfer-ancestry-mismatch',
      'Object-copy state does not match the immutable transfer ancestry.',
      'state.proposalMatches',
    )
  }
  if (!inspection.fenceMatches) {
    copyError('stale-fence', 'The object-copy lock ID and fence are stale.', 'input.saga.fence')
  }
  if (inspection.manifest) {
    assertOperationManifest(inspection.manifest, operation)
    const allProgress = [...inspection.progress, ...inspection.compensatedProgress]
    const progressKeys = new Set<string>()
    for (const [index, progress] of allProgress.entries()) {
      assertProgress(progress, inspection.manifest, operation.saga, `state.progress[${index}]`)
      if (progressKeys.has(progress.intent.logicalKey)) {
        copyError('checkpoint-drift', 'An object has duplicate durable checkpoints.', 'state.progress')
      }
      progressKeys.add(progress.intent.logicalKey)
    }
    const deleteKeys = new Set<string>()
    for (const [index, receipt] of inspection.deleteReceipts.entries()) {
      try {
        assertTenantObjectDeleteReceipt(
          receipt,
          inspection.manifest,
          operation.saga,
          `state.deleteReceipts[${index}]`,
        )
      } catch (error) {
        copyError('checkpoint-drift', 'Durable object-delete evidence drifted.', 'state.deleteReceipts', error)
      }
      if (deleteKeys.has(receipt.logicalKey)) {
        copyError('checkpoint-drift', 'An object has duplicate delete receipts.', 'state.deleteReceipts')
      }
      deleteKeys.add(receipt.logicalKey)
    }
    const compensatedCopies = inspection.compensatedProgress
      .filter(({ intent }) => intent.disposition === 'copy')
      .map(({ intent }) => intent.logicalKey)
      .sort()
    if (inspection.compensationReceipt === null) {
      if (!sameTransferValue(compensatedCopies, [...deleteKeys].sort())) {
        copyError(
          'checkpoint-drift',
          'Compensated copy checkpoints must have exact durable delete evidence.',
          'state.compensatedProgress',
        )
      }
    } else {
      const completedDeletes = [...inspection.compensationReceipt.revertedCopies]
        .sort((left, right) => left.logicalKey.localeCompare(right.logicalKey))
      const durableDeletes = [...inspection.deleteReceipts]
        .sort((left, right) => left.logicalKey.localeCompare(right.logicalKey))
      if (!sameTransferValue(completedDeletes, durableDeletes)) {
        copyError(
          'checkpoint-drift',
          'Completed compensation must retain its exact durable delete evidence.',
          'state.deleteReceipts',
        )
      }
    }
    if (inspection.copyProgressReceipt) {
      try {
        assertTenantObjectCopyProgressReceipt(
          inspection.copyProgressReceipt,
          inspection.manifest,
          operation.saga,
        )
      } catch (error) {
        copyError('checkpoint-drift', 'Durable copy-progress evidence drifted.', 'state.copyProgressReceipt', error)
      }
    }
    if (inspection.compensationReceipt) {
      try {
        assertTenantObjectCompensationReceipt(
          inspection.compensationReceipt,
          inspection.manifest,
          operation.saga,
          inspection.copyProgressReceipt,
        )
      } catch (error) {
        copyError('checkpoint-drift', 'Durable compensation evidence drifted.', 'state.compensationReceipt', error)
      }
    }
  } else if (inspection.progress.length > 0
    || inspection.compensatedProgress.length > 0
    || inspection.deleteReceipts.length > 0
    || inspection.copyProgressReceipt !== null
    || inspection.copyReceipt !== null
    || inspection.compensationReceipt !== null) {
    copyError('checkpoint-drift', 'Object-copy evidence exists without its immutable manifest.', 'state')
  }
  if (inspection.compensationReceipt !== null
    && (inspection.sourcePrefixFrozen
      || !inspection.sourceAuthorized
      || inspection.progress.length > 0
      || inspection.compensatedProgress.length > 0
      || inspection.copyReceipt !== null)) {
    copyError(
      'checkpoint-drift',
      'Compensated object-copy state has missing evidence or active checkpoints.',
      'state.compensationReceipt',
    )
  }
}

export function applyReceipt(
  manifest: TenantObjectManifest,
  progress: TenantObjectCopyProgressReceipt,
  saga: TransferSagaFence,
): TransferReceipt {
  const objectClasses = [...new Set(manifest.entries.map(({ objectClass }) => objectClass))].sort()
  return {
    code: 'tenant-objects-copied',
    details: {
      transferId: manifest.transferId,
      lockId: saga.lockId,
      fence: saga.fence,
      manifestChecksumSha256: manifest.manifestChecksumSha256,
      progressReceiptChecksumSha256: progress.receiptChecksumSha256,
      entryCount: manifest.entryCount,
      totalSizeBytes: manifest.totalSizeBytes,
      objectClasses,
    },
  }
}

export function compensationTransferReceipt(
  receipt: TenantObjectCompensationReceipt,
): TransferReceipt {
  return {
    code: 'tenant-objects-copy-compensated',
    details: {
      transferId: receipt.transferId,
      lockId: receipt.lockId,
      fence: receipt.fence,
      manifestChecksumSha256: receipt.manifestChecksumSha256,
      copyProgressReceiptChecksumSha256: receipt.copyProgressReceiptChecksumSha256,
      compensationReceiptChecksumSha256: receipt.receiptChecksumSha256,
      checkpointCount: receipt.checkpoints.length,
      preservedRebinds: receipt.checkpoints
        .filter(({ intent }) => intent.disposition === 'rebind')
        .map(({ intent }) => intent.logicalKey),
      revertedCopies: receipt.revertedCopies.map(({ logicalKey, receiptChecksumSha256 }) => ({
        logicalKey,
        receiptChecksumSha256,
      })),
    },
  }
}

export function assertReceipt(actual: TransferReceipt | null, expected: TransferReceipt, path: string): void {
  if (actual === null || !sameTransferValue(actual, expected)) {
    copyError('receipt-mismatch', 'Object movement requires its exact fenced receipt.', path)
  }
}
