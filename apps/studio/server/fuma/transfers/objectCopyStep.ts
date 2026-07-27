import {
  createTenantObjectCompensationReceipt,
  createTenantObjectCopyProgressReceipt,
  type TenantObjectManifest,
} from '../tenantObjects'
import type { TransferReceipt } from './contracts'
import { sameTransferValue } from './baseOwnershipStep'
import {
  OBJECT_COPY_TRANSFER_STEP_ID,
  OBJECT_COPY_TRANSFER_STEP_ORDER,
  applyReceipt,
  assertInspection,
  assertReceipt,
  compensationTransferReceipt,
  copyError,
  operationFrom,
  progressFor,
  type ObjectCopyStateInspection,
  type ObjectCopyTransferOperation,
} from './objectCopyContracts'
import {
  TenantObjectCopyTransferAdapter,
  type TenantObjectCopyTransferAdapterOptions,
} from './objectCopyAdapter'
import {
  BASE_OWNERSHIP_TRANSFER_STEP_ID,
  type TransferStepCompensation,
  type TransferStepDefinition,
  type TransferStepExecutionInput,
  type TransferStepVerification,
} from './stepRegistry'

export * from './objectCopyContracts'
export * from './objectCopyAdapter'

class ObjectCopyTransferHandlers {
  readonly #adapter: TenantObjectCopyTransferAdapter
  readonly #now: () => string

  constructor(adapter: TenantObjectCopyTransferAdapter, now: () => string) {
    this.#adapter = adapter
    this.#now = now
  }

  async apply(input: TransferStepExecutionInput): Promise<TransferReceipt> {
    const operation = operationFrom(input)
    let inspection = await this.#adapter.prepare(operation)
    assertInspection(inspection, operation)
    if (inspection.compensationReceipt !== null) {
      copyError('checkpoint-drift', 'A compensated object copy cannot be applied.', 'state')
    }
    if (inspection.compensatedProgress.length > 0) {
      copyError('checkpoint-drift', 'Object-copy compensation is already in progress.', 'state')
    }
    const manifest = inspection.manifest
    if (!manifest) copyError('manifest-drift', 'Object-copy manifest is absent.', 'state.manifest')
    if (inspection.copyReceipt !== null) {
      if (!inspection.copyProgressReceipt) {
        copyError('checkpoint-drift', 'Copy completion receipt has no canonical progress.', 'state')
      }
      const receipt = applyReceipt(manifest, inspection.copyProgressReceipt, input.saga)
      if (input.receipt !== null) assertReceipt(input.receipt, receipt, 'input.receipt')
      assertReceipt(inspection.copyReceipt, receipt, 'state.copyReceipt')
      await this.#verifyDestination(operation, manifest, inspection)
      return receipt
    }
    if (!inspection.sourcePrefixFrozen) {
      copyError(
        'checkpoint-drift',
        'The source prefix must remain frozen while immutable objects are copied.',
        'state.sourcePrefixFrozen',
      )
    }
    for (const entry of manifest.entries) {
      inspection = await this.#adapter.copyOrRebind(operation, manifest, entry)
    }
    await this.#verifyDestination(operation, manifest, inspection)
    const completed = inspection.progress.map(({ receipt }) => {
      if (!receipt) copyError('checkpoint-drift', 'Copy completion found an unreceipted object.', 'state.progress')
      return receipt
    })
    const progressReceipt = createTenantObjectCopyProgressReceipt(
      manifest,
      operation.saga,
      completed,
      this.#now(),
    )
    const receipt = applyReceipt(manifest, progressReceipt, input.saga)
    if (input.receipt !== null) assertReceipt(input.receipt, receipt, 'input.receipt')
    inspection = await this.#adapter.completeCopy(operation, manifest, progressReceipt, receipt)
    assertInspection(inspection, operation)
    assertReceipt(inspection.copyReceipt, receipt, 'state.copyReceipt')
    if (!sameTransferValue(inspection.copyProgressReceipt, progressReceipt)) {
      copyError('checkpoint-drift', 'Canonical copy progress was not persisted exactly.', 'state.copyProgressReceipt')
    }
    return receipt
  }

  async verify(input: TransferStepExecutionInput): Promise<TransferStepVerification> {
    const operation = operationFrom(input)
    const inspection = await this.#adapter.inspect(operation)
    assertInspection(inspection, operation)
    if (inspection.compensationReceipt !== null || inspection.copyReceipt === null) {
      return Object.freeze({ status: 'not-applied', receipt: null })
    }
    const manifest = inspection.manifest
    const progress = inspection.copyProgressReceipt
    if (!manifest || !progress) {
      copyError('checkpoint-drift', 'Copy receipt is missing canonical manifest progress.', 'state')
    }
    const receipt = applyReceipt(manifest, progress, input.saga)
    assertReceipt(inspection.copyReceipt, receipt, 'state.copyReceipt')
    if (input.receipt !== null) assertReceipt(input.receipt, receipt, 'input.receipt')
    await this.#verifyDestination(operation, manifest, inspection)
    return Object.freeze({ status: 'verified', receipt })
  }

  async compensate(input: TransferStepExecutionInput): Promise<TransferStepCompensation> {
    const operation = operationFrom(input)
    let inspection = await this.#adapter.inspect(operation)
    assertInspection(inspection, operation)
    if (inspection.compensationReceipt !== null) {
      return Object.freeze({
        status: 'compensated',
        receipt: compensationTransferReceipt(inspection.compensationReceipt),
      })
    }
    const manifest = inspection.manifest
    if (!manifest) {
      if (input.receipt !== null) {
        copyError('receipt-mismatch', 'A receipt exists without object-copy state.', 'input.receipt')
      }
      return Object.freeze({ status: 'not-applied', receipt: null })
    }
    if (inspection.copyReceipt !== null) {
      if (!inspection.copyProgressReceipt) {
        copyError('checkpoint-drift', 'Applied copy has no canonical progress receipt.', 'state')
      }
      const expectedApplyReceipt = applyReceipt(
        manifest,
        inspection.copyProgressReceipt,
        operation.saga,
      )
      assertReceipt(inspection.copyReceipt, expectedApplyReceipt, 'state.copyReceipt')
      assertReceipt(input.receipt, expectedApplyReceipt, 'input.receipt')
    } else if (input.receipt !== null) {
      copyError('receipt-mismatch', 'A partial object copy cannot accept a completed receipt.', 'input.receipt')
    }
    if (!inspection.sourceAuthorized) {
      copyError(
        'source-policy-not-restored',
        'Object-copy compensation requires source authorization to be restored first.',
        'state.sourceAuthorized',
      )
    }

    const checkpoints = [...inspection.compensatedProgress, ...inspection.progress]
    for (const progress of [...inspection.progress].reverse()) {
      inspection = await this.#adapter.compensateObject(operation, manifest, progress)
      assertInspection(inspection, operation)
    }
    const deletes = [...inspection.deleteReceipts]
      .sort((left, right) => left.logicalKey.localeCompare(right.logicalKey))
    const canonicalReceipt = createTenantObjectCompensationReceipt({
      manifest,
      saga: operation.saga,
      copyProgress: inspection.copyProgressReceipt,
      checkpoints,
      revertedCopies: deletes,
      compensatedAt: this.#now(),
    })
    inspection = await this.#adapter.completeCompensation(
      operation,
      manifest,
      canonicalReceipt,
    )
    assertInspection(inspection, operation)
    if (!sameTransferValue(inspection.compensationReceipt, canonicalReceipt)) {
      copyError(
        'receipt-mismatch',
        'Object compensation did not persist its exact canonical receipt.',
        'state.compensationReceipt',
      )
    }
    return Object.freeze({
      status: 'compensated',
      receipt: compensationTransferReceipt(canonicalReceipt),
    })
  }

  async #verifyDestination(
    operation: ObjectCopyTransferOperation,
    manifest: TenantObjectManifest,
    inspection: ObjectCopyStateInspection,
  ): Promise<void> {
    if (inspection.progress.length !== manifest.entries.length) {
      copyError(
        'checkpoint-drift',
        'Copy completion requires one durable receipt per manifest object.',
        'state.progress',
      )
    }
    for (const entry of manifest.entries) {
      if (!progressFor(inspection, entry)?.receipt) {
        copyError(
          'checkpoint-drift',
          'Copy completion requires every object receipt.',
          `objects.${entry.logicalKey}`,
        )
      }
      if (!await this.#adapter.verifyDestinationObject(operation, entry)) {
        copyError(
          'destination-object-drift',
          'Destination verification found missing or mismatched immutable bytes.',
          `objects.${entry.logicalKey}`,
        )
      }
    }
  }
}

export function createObjectCopyTransferStep(
  options: TenantObjectCopyTransferAdapterOptions,
): TransferStepDefinition {
  const now = options.now ?? (() => new Date().toISOString())
  const adapter = new TenantObjectCopyTransferAdapter({ ...options, now })
  const handlers = new ObjectCopyTransferHandlers(adapter, now)
  return Object.freeze({
    id: OBJECT_COPY_TRANSFER_STEP_ID,
    order: OBJECT_COPY_TRANSFER_STEP_ORDER,
    dependsOn: Object.freeze([BASE_OWNERSHIP_TRANSFER_STEP_ID]),
    mandatory: true,
    apply: (input) => handlers.apply(input),
    compensate: (input) => handlers.compensate(input),
    verify: (input) => handlers.verify(input),
  })
}
