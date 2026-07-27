import {
  assertTenantObjectCopyProgressReceipt,
  assertTenantObjectManifest,
  assertTenantObjectPolicySnapshot,
  assertTenantObjectRebindReceipt,
  type TenantObjectCopyProgressReceipt,
  type TenantObjectManifest,
  type TenantObjectPolicySnapshot,
  type TenantObjectRebindReceipt,
  type TenantObjectScope,
} from '../tenantObjects'
import type {
  TransferManifest,
  TransferOwnershipCoordinate,
  TransferReceipt,
} from './contracts'
import { assertTransferManifest } from './contracts'
import {
  sameTransferValue,
} from './baseOwnershipStep'
import {
  OBJECT_COPY_TRANSFER_STEP_ID,
} from './objectCopyStep'
import {
  type TransferSagaFence,
  type TransferStepCompensation,
  type TransferStepDefinition,
  type TransferStepExecutionInput,
  type TransferStepVerification,
} from './stepRegistry'

export const OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ID = 'transfer.object-ownership-policy'
/** The policy switch is final so compensation restores source authorization before copy cleanup. */
export const OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ORDER = Number.MAX_SAFE_INTEGER

export type ObjectOwnershipPolicyOperationInput = Readonly<{
  saga: TransferSagaFence
  manifest: TransferManifest
}>

export type ObjectOwnershipPolicyAtomicInput = ObjectOwnershipPolicyOperationInput & Readonly<{
  manifestChecksumSha256: string
  copyProgressReceiptChecksumSha256: string
  rebindReceipt: TenantObjectRebindReceipt | null
}>

export type ObjectOwnershipPolicyInspection = Readonly<{
  proposalMatches: boolean
  fenceMatches: boolean
  objectManifest: TenantObjectManifest | null
  copyProgressReceipt: TenantObjectCopyProgressReceipt | null
  sourcePolicy: TenantObjectPolicySnapshot
  destinationPolicy: TenantObjectPolicySnapshot
  rebindReceipt: TenantObjectRebindReceipt | null
}>

export type ObjectOwnershipPolicyAtomicResult = Readonly<{
  status:
    | 'applied'
    | 'compensated'
    | 'replayed'
    | 'stale-fence'
    | 'ancestry-conflict'
    | 'manifest-conflict'
    | 'policy-conflict'
  inspection: ObjectOwnershipPolicyInspection
}>

/**
 * One atomic adapter owns the exact source/destination policy pair and the
 * canonical rebind receipt. Switching must re-read the durable complete copy
 * receipt before sealing source and activating destination in one commit.
 */
export interface ObjectOwnershipPolicyAdapter {
  inspectObjectOwnershipPolicy(
    input: ObjectOwnershipPolicyOperationInput,
  ): Promise<ObjectOwnershipPolicyInspection>
  switchObjectOwnershipPolicy(
    input: ObjectOwnershipPolicyAtomicInput,
  ): Promise<ObjectOwnershipPolicyAtomicResult>
  restoreObjectOwnershipPolicy(
    input: ObjectOwnershipPolicyAtomicInput,
  ): Promise<ObjectOwnershipPolicyAtomicResult>
}

export type ObjectOwnershipPolicyTransferErrorCode =
  | 'invalid-execution'
  | 'transfer-ancestry-mismatch'
  | 'stale-fence'
  | 'missing-object-manifest'
  | 'incomplete-object-copy'
  | 'object-manifest-drift'
  | 'policy-drift'
  | 'receipt-mismatch'
  | 'atomic-policy-conflict'

export class ObjectOwnershipPolicyTransferError extends Error {
  readonly code: ObjectOwnershipPolicyTransferErrorCode
  readonly path: string

  constructor(
    code: ObjectOwnershipPolicyTransferErrorCode,
    message: string,
    path: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ObjectOwnershipPolicyTransferError'
    this.code = code
    this.path = path
  }
}

function policyError(
  code: ObjectOwnershipPolicyTransferErrorCode,
  message: string,
  path: string,
  cause?: unknown,
): never {
  throw new ObjectOwnershipPolicyTransferError(
    code,
    message,
    path,
    cause === undefined ? undefined : { cause },
  )
}

function tenantScope(coordinate: TransferOwnershipCoordinate): TenantObjectScope {
  return {
    organizationId: coordinate.organizationId,
    workspaceId: coordinate.workspaceId,
    siteId: coordinate.siteId,
  }
}

function sameScope(left: TenantObjectScope, right: TenantObjectScope): boolean {
  return left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
}

function validateExecution(input: TransferStepExecutionInput): void {
  try {
    assertTransferManifest(input.manifest)
  } catch (error) {
    policyError(
      'invalid-execution',
      'The object policy step received an invalid transfer manifest.',
      'input.manifest',
      error,
    )
  }
  if (input.saga.transferId !== input.manifest.transferId
    || typeof input.saga.lockId !== 'string'
    || input.saga.lockId.length === 0
    || !Number.isSafeInteger(input.saga.fence)
    || input.saga.fence < 1) {
    policyError(
      'invalid-execution',
      'The saga fence must identify this transfer, lock, and positive fence.',
      'input.saga',
    )
  }
}

function assertInspectionAuthority(inspection: ObjectOwnershipPolicyInspection): void {
  if (!inspection.proposalMatches) {
    policyError(
      'transfer-ancestry-mismatch',
      'The durable transfer does not match the exact source and destination ancestry.',
      'manifest',
    )
  }
  if (!inspection.fenceMatches) {
    policyError('stale-fence', 'The saga lock ID and fence are no longer active.', 'saga.fence')
  }
}

function assertPolicyRole(
  policy: TenantObjectPolicySnapshot,
  scope: TenantObjectScope,
  state: 'active' | 'sealed',
  path: string,
): void {
  try {
    assertTenantObjectPolicySnapshot(policy, path)
  } catch (error) {
    policyError('policy-drift', `${path} is not a canonical tenant-object policy.`, path, error)
  }
  if (!sameScope(policy.namespace, scope)
    || !sameScope(policy.owner, scope)
    || policy.state !== state) {
    policyError(
      'policy-drift',
      `${path} must name only the exact ${state} tenant ancestry.`,
      path,
    )
  }
}

function completeCopyEvidence(
  inspection: ObjectOwnershipPolicyInspection,
  operation: ObjectOwnershipPolicyOperationInput,
): Readonly<{
  manifest: TenantObjectManifest
  progress: TenantObjectCopyProgressReceipt
}> {
  const manifest = inspection.objectManifest
  const progress = inspection.copyProgressReceipt
  if (!manifest) {
    policyError('missing-object-manifest', 'Object policy requires the durable copy manifest.', 'objectManifest')
  }
  try {
    assertTenantObjectManifest(manifest)
  } catch (error) {
    policyError('object-manifest-drift', 'The durable object manifest is invalid.', 'objectManifest', error)
  }
  const source = tenantScope(operation.manifest.source)
  const destination = tenantScope(operation.manifest.destination)
  if (manifest.transferId !== operation.manifest.transferId
    || manifest.capturedAt !== operation.manifest.capturedAt
    || !sameScope(manifest.source, source)
    || !sameScope(manifest.destination, destination)) {
    policyError(
      'object-manifest-drift',
      'The object manifest differs from the immutable transfer ancestry.',
      'objectManifest',
    )
  }
  if (!progress) {
    policyError(
      'incomplete-object-copy',
      'Object policy requires canonical verified copy progress.',
      'copyProgressReceipt',
    )
  }
  try {
    assertTenantObjectCopyProgressReceipt(progress, manifest, operation.saga)
  } catch (error) {
    policyError(
      'incomplete-object-copy',
      'Object copy progress is invalid for this manifest and fence.',
      'copyProgressReceipt',
      error,
    )
  }
  if (progress.completedCount !== manifest.entryCount
    || progress.completedSizeBytes !== manifest.totalSizeBytes
    || progress.completed.some((receipt, index) => (
      receipt.logicalKey !== manifest.entries[index]?.logicalKey
    ))) {
    policyError(
      'incomplete-object-copy',
      'Destination policy cannot activate until every manifest entry has a verified copy receipt.',
      'copyProgressReceipt',
    )
  }
  return { manifest, progress }
}

function assertRebind(
  receipt: TenantObjectRebindReceipt,
  evidence: ReturnType<typeof completeCopyEvidence>,
  saga: TransferSagaFence,
): void {
  try {
    assertTenantObjectRebindReceipt(receipt, evidence.manifest, saga, evidence.progress)
  } catch (error) {
    policyError('policy-drift', 'The durable policy rebind receipt is invalid.', 'rebindReceipt', error)
  }
}

function createObjectOwnershipPolicyReceipt(
  evidence: ReturnType<typeof completeCopyEvidence>,
  rebindReceipt: TenantObjectRebindReceipt,
): TransferReceipt {
  return {
    code: 'tenant-object-ownership-policy-rebound',
    details: {
      transferId: rebindReceipt.transferId,
      lockId: rebindReceipt.lockId,
      fence: rebindReceipt.fence,
      manifestChecksumSha256: evidence.manifest.manifestChecksumSha256,
      copyProgressReceiptChecksumSha256: evidence.progress.receiptChecksumSha256,
      rebindReceiptChecksumSha256: rebindReceipt.receiptChecksumSha256,
      entryCount: evidence.manifest.entryCount,
      totalSizeBytes: evidence.manifest.totalSizeBytes,
      sourcePrefix: evidence.manifest.sourcePrefix,
      destinationPrefix: evidence.manifest.destinationPrefix,
    },
  }
}

function assertMatchingReceipt(
  actual: TransferReceipt | null,
  expected: TransferReceipt,
  path: string,
): void {
  if (actual === null || !sameTransferValue(actual, expected)) {
    policyError(
      'receipt-mismatch',
      'Object policy operations require the exact manifest, copy, rebind, lock, and fence receipt.',
      path,
    )
  }
}

function handleAtomicResult(
  result: ObjectOwnershipPolicyAtomicResult,
): ObjectOwnershipPolicyInspection {
  if (result.status === 'stale-fence') {
    policyError('stale-fence', 'The atomic policy mutation rejected a stale fence.', 'saga.fence')
  }
  if (result.status === 'ancestry-conflict') {
    policyError(
      'transfer-ancestry-mismatch',
      'The atomic policy mutation rejected transfer ancestry.',
      'manifest',
    )
  }
  if (result.status === 'manifest-conflict') {
    policyError(
      'incomplete-object-copy',
      'The durable copy manifest or progress changed before the atomic policy mutation.',
      'copyProgressReceipt',
    )
  }
  if (result.status === 'policy-conflict') {
    policyError(
      'atomic-policy-conflict',
      'The atomic policy pair is owned by another authority or receipt.',
      'policy',
    )
  }
  return result.inspection
}

function compensatedReceipt(
  receipt: TransferReceipt,
  inspection: ObjectOwnershipPolicyInspection,
): TransferReceipt {
  return {
    code: 'tenant-object-ownership-policy-restored',
    details: {
      applyReceipt: receipt,
      sourcePolicyChecksumSha256: inspection.sourcePolicy.policyChecksumSha256,
      destinationPolicyChecksumSha256: inspection.destinationPolicy.policyChecksumSha256,
    },
  }
}

class ObjectOwnershipPolicyTransferHandlers {
  readonly #adapter: ObjectOwnershipPolicyAdapter

  constructor(adapter: ObjectOwnershipPolicyAdapter) {
    this.#adapter = adapter
  }

  async apply(input: TransferStepExecutionInput): Promise<TransferReceipt> {
    validateExecution(input)
    const operation = { saga: input.saga, manifest: input.manifest }
    const before = await this.#adapter.inspectObjectOwnershipPolicy(operation)
    assertInspectionAuthority(before)
    const evidence = completeCopyEvidence(before, operation)

    if (before.rebindReceipt) {
      assertRebind(before.rebindReceipt, evidence, input.saga)
      assertPolicyRole(before.sourcePolicy, evidence.manifest.source, 'sealed', 'sourcePolicy')
      assertPolicyRole(
        before.destinationPolicy,
        evidence.manifest.destination,
        'active',
        'destinationPolicy',
      )
      const receipt = createObjectOwnershipPolicyReceipt(evidence, before.rebindReceipt)
      if (input.receipt !== null) assertMatchingReceipt(input.receipt, receipt, 'input.receipt')
      return receipt
    }

    assertPolicyRole(before.sourcePolicy, evidence.manifest.source, 'active', 'sourcePolicy')
    assertPolicyRole(
      before.destinationPolicy,
      evidence.manifest.destination,
      'sealed',
      'destinationPolicy',
    )
    const after = handleAtomicResult(await this.#adapter.switchObjectOwnershipPolicy({
      ...operation,
      manifestChecksumSha256: evidence.manifest.manifestChecksumSha256,
      copyProgressReceiptChecksumSha256: evidence.progress.receiptChecksumSha256,
      rebindReceipt: null,
    }))
    assertInspectionAuthority(after)
    const afterEvidence = completeCopyEvidence(after, operation)
    const rebind = after.rebindReceipt
    if (!rebind) {
      policyError('atomic-policy-conflict', 'Atomic policy switch did not persist a rebind receipt.', 'rebindReceipt')
    }
    assertRebind(rebind, afterEvidence, input.saga)
    assertPolicyRole(after.sourcePolicy, afterEvidence.manifest.source, 'sealed', 'sourcePolicy')
    assertPolicyRole(
      after.destinationPolicy,
      afterEvidence.manifest.destination,
      'active',
      'destinationPolicy',
    )
    const receipt = createObjectOwnershipPolicyReceipt(afterEvidence, rebind)
    if (input.receipt !== null) assertMatchingReceipt(input.receipt, receipt, 'input.receipt')
    return receipt
  }

  async verify(input: TransferStepExecutionInput): Promise<TransferStepVerification> {
    validateExecution(input)
    const operation = { saga: input.saga, manifest: input.manifest }
    const inspection = await this.#adapter.inspectObjectOwnershipPolicy(operation)
    assertInspectionAuthority(inspection)
    const evidence = completeCopyEvidence(inspection, operation)
    if (!inspection.rebindReceipt) {
      assertPolicyRole(inspection.sourcePolicy, evidence.manifest.source, 'active', 'sourcePolicy')
      assertPolicyRole(
        inspection.destinationPolicy,
        evidence.manifest.destination,
        'sealed',
        'destinationPolicy',
      )
      return Object.freeze({ status: 'not-applied', receipt: null })
    }
    assertRebind(inspection.rebindReceipt, evidence, input.saga)
    assertPolicyRole(inspection.sourcePolicy, evidence.manifest.source, 'sealed', 'sourcePolicy')
    assertPolicyRole(
      inspection.destinationPolicy,
      evidence.manifest.destination,
      'active',
      'destinationPolicy',
    )
    const receipt = createObjectOwnershipPolicyReceipt(evidence, inspection.rebindReceipt)
    if (input.receipt !== null) assertMatchingReceipt(input.receipt, receipt, 'input.receipt')
    return Object.freeze({ status: 'verified', receipt })
  }

  async compensate(input: TransferStepExecutionInput): Promise<TransferStepCompensation> {
    validateExecution(input)
    const operation = { saga: input.saga, manifest: input.manifest }
    const before = await this.#adapter.inspectObjectOwnershipPolicy(operation)
    assertInspectionAuthority(before)
    const evidence = completeCopyEvidence(before, operation)
    if (!before.rebindReceipt) {
      assertPolicyRole(before.sourcePolicy, evidence.manifest.source, 'active', 'sourcePolicy')
      assertPolicyRole(
        before.destinationPolicy,
        evidence.manifest.destination,
        'sealed',
        'destinationPolicy',
      )
      if (input.receipt !== null) {
        policyError('receipt-mismatch', 'No policy rebind exists for the supplied receipt.', 'input.receipt')
      }
      return Object.freeze({ status: 'not-applied', receipt: null })
    }
    assertRebind(before.rebindReceipt, evidence, input.saga)
    const receipt = createObjectOwnershipPolicyReceipt(evidence, before.rebindReceipt)
    assertMatchingReceipt(input.receipt, receipt, 'input.receipt')

    const alreadyRestored = before.sourcePolicy.state === 'active'
      && before.destinationPolicy.state === 'sealed'
    if (alreadyRestored) {
      assertPolicyRole(before.sourcePolicy, evidence.manifest.source, 'active', 'sourcePolicy')
      assertPolicyRole(
        before.destinationPolicy,
        evidence.manifest.destination,
        'sealed',
        'destinationPolicy',
      )
      return Object.freeze({
        status: 'compensated',
        receipt: compensatedReceipt(receipt, before),
      })
    }
    assertPolicyRole(before.sourcePolicy, evidence.manifest.source, 'sealed', 'sourcePolicy')
    assertPolicyRole(
      before.destinationPolicy,
      evidence.manifest.destination,
      'active',
      'destinationPolicy',
    )
    const after = handleAtomicResult(await this.#adapter.restoreObjectOwnershipPolicy({
      ...operation,
      manifestChecksumSha256: evidence.manifest.manifestChecksumSha256,
      copyProgressReceiptChecksumSha256: evidence.progress.receiptChecksumSha256,
      rebindReceipt: before.rebindReceipt,
    }))
    assertInspectionAuthority(after)
    const afterEvidence = completeCopyEvidence(after, operation)
    if (!after.rebindReceipt) {
      policyError('atomic-policy-conflict', 'Policy restoration lost its rebind receipt.', 'rebindReceipt')
    }
    assertRebind(after.rebindReceipt, afterEvidence, input.saga)
    assertPolicyRole(after.sourcePolicy, afterEvidence.manifest.source, 'active', 'sourcePolicy')
    assertPolicyRole(
      after.destinationPolicy,
      afterEvidence.manifest.destination,
      'sealed',
      'destinationPolicy',
    )
    return Object.freeze({
      status: 'compensated',
      receipt: compensatedReceipt(receipt, after),
    })
  }
}

export function createObjectOwnershipPolicyTransferStep(
  adapter: ObjectOwnershipPolicyAdapter,
): TransferStepDefinition {
  const handlers = new ObjectOwnershipPolicyTransferHandlers(adapter)
  return Object.freeze({
    id: OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ID,
    order: OBJECT_OWNERSHIP_POLICY_TRANSFER_STEP_ORDER,
    dependsOn: Object.freeze([OBJECT_COPY_TRANSFER_STEP_ID]),
    mandatory: true,
    apply: (input) => handlers.apply(input),
    verify: (input) => handlers.verify(input),
    compensate: (input) => handlers.compensate(input),
  })
}
