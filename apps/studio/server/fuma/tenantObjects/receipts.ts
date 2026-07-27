import { sha256Hex } from '../objectStorage'
import {
  TenantObjectCompensationReceiptSchema,
  TenantObjectContractError,
  TenantObjectCopyIntentSchema,
  TenantObjectCopyProgressReceiptSchema,
  TenantObjectCopyReceiptSchema,
  TenantObjectDeleteReceiptSchema,
  TenantObjectRebindReceiptSchema,
  assertTenantObjectSchema,
  type TenantObjectCompensationCheckpoint,
  type TenantObjectCompensationReceipt,
  type TenantObjectCopyDisposition,
  type TenantObjectCopyIntent,
  type TenantObjectCopyProgressReceipt,
  type TenantObjectCopyReceipt,
  type TenantObjectDeleteReceipt,
  type TenantObjectEntry,
  type TenantObjectManifest,
  type TenantObjectPolicySnapshot,
  type TenantObjectRebindReceipt,
  type TenantObjectSagaFence,
  type TenantObjectScope,
} from './contracts'
import {
  assertTenantObjectManifest,
  assertTenantObjectPolicySnapshot,
} from './manifest'

const textEncoder = new TextEncoder()

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function scopeEquals(left: TenantObjectScope, right: TenantObjectScope): boolean {
  return left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
}

function checksum(value: string): string {
  return sha256Hex(textEncoder.encode(value))
}

function assertTimestamp(value: string, path: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new TenantObjectContractError(
      'invalid-contract',
      `${path} must be a real timestamp.`,
      path,
    )
  }
}

function assertSagaFence(
  saga: TenantObjectSagaFence,
  manifest: TenantObjectManifest,
  path: string,
): void {
  if (saga.transferId !== manifest.transferId || !saga.lockId
    || !Number.isSafeInteger(saga.fence) || saga.fence < 1) {
    throw new TenantObjectContractError(
      'receipt-drift',
      `${path} must bind the manifest transfer to one lock and positive fence.`,
      path,
    )
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function entryByLogicalKey(manifest: TenantObjectManifest, logicalKey: string): TenantObjectEntry {
  const entry = manifest.entries.find((candidate) => candidate.logicalKey === logicalKey)
  if (!entry) {
    throw new TenantObjectContractError(
      'receipt-drift',
      `Receipt references logical key "${logicalKey}" outside the manifest.`,
      'receipt.logicalKey',
    )
  }
  return entry
}

function copyEvidence(
  manifest: TenantObjectManifest,
  saga: TenantObjectSagaFence,
  logicalKey: string,
  disposition: TenantObjectCopyDisposition,
) {
  assertTenantObjectManifest(manifest)
  assertSagaFence(saga, manifest, 'saga')
  const entry = entryByLogicalKey(manifest, logicalKey)
  return {
    schemaVersion: 1 as const,
    transferId: manifest.transferId,
    lockId: saga.lockId,
    fence: saga.fence,
    manifestChecksumSha256: manifest.manifestChecksumSha256,
    entryDescriptorChecksumSha256: entry.descriptorChecksumSha256,
    logicalKey: entry.logicalKey,
    sourcePhysicalKey: entry.sourcePhysicalKey,
    destinationPhysicalKey: entry.destinationPhysicalKey,
    sizeBytes: entry.sizeBytes,
    mimeType: entry.mimeType,
    contentChecksumSha256: entry.contentChecksumSha256,
    disposition,
  }
}

export function tenantObjectCopyIntentHashInput(
  intent: Omit<TenantObjectCopyIntent, 'intentChecksumSha256'>,
): string {
  return JSON.stringify(intent)
}

export function createTenantObjectCopyIntent(input: Readonly<{
  manifest: TenantObjectManifest
  saga: TenantObjectSagaFence
  logicalKey: string
  disposition: TenantObjectCopyDisposition
  intendedAt: string
}>): TenantObjectCopyIntent {
  assertTimestamp(input.intendedAt, 'copyIntent.intendedAt')
  const base = {
    ...copyEvidence(input.manifest, input.saga, input.logicalKey, input.disposition),
    state: 'copying' as const,
    intendedAt: input.intendedAt,
  } satisfies Omit<TenantObjectCopyIntent, 'intentChecksumSha256'>
  const intent: TenantObjectCopyIntent = {
    ...base,
    intentChecksumSha256: checksum(tenantObjectCopyIntentHashInput(base)),
  }
  assertTenantObjectCopyIntent(intent, input.manifest, input.saga)
  return deepFreeze(intent)
}

export function assertTenantObjectCopyIntent(
  value: unknown,
  manifest: TenantObjectManifest,
  saga: TenantObjectSagaFence,
  path = 'copyIntent',
): asserts value is TenantObjectCopyIntent {
  assertTenantObjectSchema(TenantObjectCopyIntentSchema, value, path)
  assertTenantObjectManifest(manifest)
  assertSagaFence(saga, manifest, 'saga')
  assertTimestamp(value.intendedAt, `${path}.intendedAt`)
  const expected = copyEvidence(manifest, saga, value.logicalKey, value.disposition)
  if (Date.parse(value.intendedAt) < Date.parse(manifest.capturedAt)
    || Object.entries(expected).some(([key, expectedValue]) => (
      value[key as keyof TenantObjectCopyIntent] !== expectedValue
    ))) {
    throw new TenantObjectContractError(
      'receipt-drift',
      'Copy intent does not match its object entry, immutable manifest, lock, or fence.',
      path,
    )
  }
  const { intentChecksumSha256: _intentChecksumSha256, ...base } = value
  if (value.intentChecksumSha256 !== checksum(tenantObjectCopyIntentHashInput(base))) {
    throw new TenantObjectContractError(
      'receipt-drift',
      'Copy intent drifted from its checksum.',
      `${path}.intentChecksumSha256`,
    )
  }
}

export function tenantObjectCopyReceiptHashInput(
  receipt: Omit<TenantObjectCopyReceipt, 'receiptChecksumSha256'>,
): string {
  return JSON.stringify(receipt)
}

export function createTenantObjectCopyReceipt(input: Readonly<{
  manifest: TenantObjectManifest
  saga: TenantObjectSagaFence
  logicalKey: string
  disposition: TenantObjectCopyDisposition
  copiedAt: string
}>): TenantObjectCopyReceipt {
  assertTimestamp(input.copiedAt, 'receipt.copiedAt')
  const base = {
    ...copyEvidence(input.manifest, input.saga, input.logicalKey, input.disposition),
    copiedAt: input.copiedAt,
  } satisfies Omit<TenantObjectCopyReceipt, 'receiptChecksumSha256'>
  const receipt: TenantObjectCopyReceipt = {
    ...base,
    receiptChecksumSha256: checksum(tenantObjectCopyReceiptHashInput(base)),
  }
  assertTenantObjectCopyReceipt(receipt, input.manifest, input.saga)
  return deepFreeze(receipt)
}

export function assertTenantObjectCopyReceipt(
  value: unknown,
  manifest: TenantObjectManifest,
  saga: TenantObjectSagaFence,
  path = 'receipt',
): asserts value is TenantObjectCopyReceipt {
  assertTenantObjectSchema(TenantObjectCopyReceiptSchema, value, path)
  assertTenantObjectManifest(manifest)
  assertSagaFence(saga, manifest, 'saga')
  assertTimestamp(value.copiedAt, `${path}.copiedAt`)
  const expected = copyEvidence(manifest, saga, value.logicalKey, value.disposition)
  if (Date.parse(value.copiedAt) < Date.parse(manifest.capturedAt)
    || Object.entries(expected).some(([key, expectedValue]) => (
      value[key as keyof TenantObjectCopyReceipt] !== expectedValue
    ))) {
    throw new TenantObjectContractError(
      'receipt-drift',
      'Copy receipt does not match its object entry, immutable manifest, lock, or fence.',
      path,
    )
  }
  const { receiptChecksumSha256: _receiptChecksumSha256, ...base } = value
  if (value.receiptChecksumSha256 !== checksum(tenantObjectCopyReceiptHashInput(base))) {
    throw new TenantObjectContractError(
      'receipt-drift',
      'Copy receipt drifted from its checksum.',
      `${path}.receiptChecksumSha256`,
    )
  }
}

export function tenantObjectCopyProgressHashInput(
  receipt: Omit<TenantObjectCopyProgressReceipt, 'receiptChecksumSha256'>,
): string {
  return JSON.stringify({
    ...receipt,
    completed: receipt.completed.map((entry) => ({
      logicalKey: entry.logicalKey,
      receiptChecksumSha256: entry.receiptChecksumSha256,
    })),
  })
}

export function createTenantObjectCopyProgressReceipt(
  manifest: TenantObjectManifest,
  saga: TenantObjectSagaFence,
  completed: readonly TenantObjectCopyReceipt[],
  updatedAt: string,
): TenantObjectCopyProgressReceipt {
  assertTenantObjectManifest(manifest)
  assertSagaFence(saga, manifest, 'saga')
  assertTimestamp(updatedAt, 'copyProgress.updatedAt')
  const ordered = [...completed].sort((left, right) => compareText(left.logicalKey, right.logicalKey))
  const base = {
    schemaVersion: 1,
    transferId: manifest.transferId,
    lockId: saga.lockId,
    fence: saga.fence,
    manifestChecksumSha256: manifest.manifestChecksumSha256,
    completed: ordered.map((receipt) => ({ ...receipt })),
    completedCount: ordered.length,
    completedSizeBytes: ordered.reduce((total, receipt) => total + receipt.sizeBytes, 0),
    updatedAt,
  } satisfies Omit<TenantObjectCopyProgressReceipt, 'receiptChecksumSha256'>
  const receipt: TenantObjectCopyProgressReceipt = {
    ...base,
    receiptChecksumSha256: checksum(tenantObjectCopyProgressHashInput(base)),
  }
  assertTenantObjectCopyProgressReceipt(receipt, manifest, saga)
  return deepFreeze(receipt)
}

export function assertTenantObjectCopyProgressReceipt(
  value: unknown,
  manifest: TenantObjectManifest,
  saga: TenantObjectSagaFence,
): asserts value is TenantObjectCopyProgressReceipt {
  assertTenantObjectSchema(TenantObjectCopyProgressReceiptSchema, value, 'copyProgress')
  assertTenantObjectManifest(manifest)
  assertSagaFence(saga, manifest, 'saga')
  assertTimestamp(value.updatedAt, 'copyProgress.updatedAt')
  let completedSizeBytes = 0
  for (const [index, receipt] of value.completed.entries()) {
    assertTenantObjectCopyReceipt(receipt, manifest, saga, `copyProgress.completed[${index}]`)
    if (index > 0 && compareText(value.completed[index - 1].logicalKey, receipt.logicalKey) >= 0) {
      throw new TenantObjectContractError(
        value.completed[index - 1].logicalKey === receipt.logicalKey ? 'duplicate-key' : 'ordering-drift',
        'Completed copy receipts must be unique and canonically ordered.',
        `copyProgress.completed[${index}].logicalKey`,
      )
    }
    if (Date.parse(receipt.copiedAt) > Date.parse(value.updatedAt)) {
      throw new TenantObjectContractError(
        'receipt-drift',
        'Copy progress cannot precede a completed object copy.',
        'copyProgress.updatedAt',
      )
    }
    completedSizeBytes += receipt.sizeBytes
  }
  if (!Number.isSafeInteger(completedSizeBytes)
    || value.transferId !== manifest.transferId
    || value.lockId !== saga.lockId
    || value.fence !== saga.fence
    || value.manifestChecksumSha256 !== manifest.manifestChecksumSha256
    || value.completedCount !== value.completed.length
    || value.completedSizeBytes !== completedSizeBytes) {
    throw new TenantObjectContractError(
      'receipt-drift',
      'Copy progress totals, manifest identity, lock, or fence do not match completed receipts.',
      'copyProgress',
    )
  }
  const { receiptChecksumSha256: _receiptChecksumSha256, ...base } = value
  if (value.receiptChecksumSha256 !== checksum(tenantObjectCopyProgressHashInput(base))) {
    throw new TenantObjectContractError(
      'receipt-drift',
      'Copy progress drifted from its checksum.',
      'copyProgress.receiptChecksumSha256',
    )
  }
}

function assertPolicyRole(
  snapshot: TenantObjectPolicySnapshot,
  namespace: TenantObjectScope,
  owner: TenantObjectScope,
  state: 'active' | 'sealed',
  path: string,
): void {
  assertTenantObjectPolicySnapshot(snapshot, path)
  if (!scopeEquals(snapshot.namespace, namespace)
    || !scopeEquals(snapshot.owner, owner)
    || snapshot.state !== state) {
    throw new TenantObjectContractError(
      'policy-drift',
      `${path} does not match the required namespace, owner, and state.`,
      path,
    )
  }
}

export function tenantObjectRebindReceiptHashInput(
  receipt: Omit<TenantObjectRebindReceipt, 'receiptChecksumSha256'>,
): string {
  return JSON.stringify({
    ...receipt,
    sourceBefore: receipt.sourceBefore.policyChecksumSha256,
    destinationBefore: receipt.destinationBefore.policyChecksumSha256,
    sourceAfter: receipt.sourceAfter.policyChecksumSha256,
    destinationAfter: receipt.destinationAfter.policyChecksumSha256,
  })
}

export function createTenantObjectRebindReceipt(input: Readonly<{
  manifest: TenantObjectManifest
  saga: TenantObjectSagaFence
  copyProgress: TenantObjectCopyProgressReceipt
  sourceBefore: TenantObjectPolicySnapshot
  destinationBefore: TenantObjectPolicySnapshot
  sourceAfter: TenantObjectPolicySnapshot
  destinationAfter: TenantObjectPolicySnapshot
  reboundAt: string
}>): TenantObjectRebindReceipt {
  assertSagaFence(input.saga, input.manifest, 'saga')
  assertTenantObjectCopyProgressReceipt(input.copyProgress, input.manifest, input.saga)
  assertTimestamp(input.reboundAt, 'rebindReceipt.reboundAt')
  const base = {
    schemaVersion: 1,
    transferId: input.manifest.transferId,
    lockId: input.saga.lockId,
    fence: input.saga.fence,
    manifestChecksumSha256: input.manifest.manifestChecksumSha256,
    copyProgressReceiptChecksumSha256: input.copyProgress.receiptChecksumSha256,
    sourceBefore: input.sourceBefore,
    destinationBefore: input.destinationBefore,
    sourceAfter: input.sourceAfter,
    destinationAfter: input.destinationAfter,
    reboundAt: input.reboundAt,
  } satisfies Omit<TenantObjectRebindReceipt, 'receiptChecksumSha256'>
  const receipt: TenantObjectRebindReceipt = {
    ...base,
    receiptChecksumSha256: checksum(tenantObjectRebindReceiptHashInput(base)),
  }
  assertTenantObjectRebindReceipt(receipt, input.manifest, input.saga, input.copyProgress)
  return deepFreeze(receipt)
}

export function assertTenantObjectRebindReceipt(
  value: unknown,
  manifest: TenantObjectManifest,
  saga: TenantObjectSagaFence,
  copyProgress: TenantObjectCopyProgressReceipt,
): asserts value is TenantObjectRebindReceipt {
  assertTenantObjectSchema(TenantObjectRebindReceiptSchema, value, 'rebindReceipt')
  assertTenantObjectManifest(manifest)
  assertSagaFence(saga, manifest, 'saga')
  assertTenantObjectCopyProgressReceipt(copyProgress, manifest, saga)
  assertTimestamp(value.reboundAt, 'rebindReceipt.reboundAt')
  if (value.transferId !== manifest.transferId
    || value.lockId !== saga.lockId
    || value.fence !== saga.fence
    || value.manifestChecksumSha256 !== manifest.manifestChecksumSha256
    || value.copyProgressReceiptChecksumSha256 !== copyProgress.receiptChecksumSha256) {
    throw new TenantObjectContractError(
      'receipt-drift',
      'Policy rebind receipt belongs to a different transfer, manifest, copy receipt, lock, or fence.',
      'rebindReceipt',
    )
  }
  if (copyProgress.completedCount !== manifest.entryCount
    || copyProgress.completedSizeBytes !== manifest.totalSizeBytes
    || copyProgress.completed.some((receipt, index) => receipt.logicalKey !== manifest.entries[index]?.logicalKey)) {
    throw new TenantObjectContractError(
      'receipt-drift',
      'Policy rebind requires a complete receipt for every manifest entry.',
      'rebindReceipt.copyProgressReceiptChecksumSha256',
    )
  }
  assertPolicyRole(value.sourceBefore, manifest.source, manifest.source, 'active', 'rebindReceipt.sourceBefore')
  assertPolicyRole(value.destinationBefore, manifest.destination, manifest.destination, 'sealed', 'rebindReceipt.destinationBefore')
  assertPolicyRole(value.sourceAfter, manifest.source, manifest.source, 'sealed', 'rebindReceipt.sourceAfter')
  assertPolicyRole(value.destinationAfter, manifest.destination, manifest.destination, 'active', 'rebindReceipt.destinationAfter')
  const capturedAt = Date.parse(manifest.capturedAt)
  const reboundAt = Date.parse(value.reboundAt)
  const beforeTimes = [value.sourceBefore.capturedAt, value.destinationBefore.capturedAt]
    .map((timestamp) => Date.parse(timestamp))
  const afterTimes = [value.sourceAfter.capturedAt, value.destinationAfter.capturedAt]
    .map((timestamp) => Date.parse(timestamp))
  const beforeLatest = Math.max(...beforeTimes)
  if (reboundAt < capturedAt
    || reboundAt < Date.parse(copyProgress.updatedAt)
    || beforeTimes.some((timestamp) => timestamp > reboundAt)
    || afterTimes.some((timestamp) => timestamp < beforeLatest || timestamp > reboundAt)) {
    throw new TenantObjectContractError(
      'policy-drift',
      'Policy snapshots must form a monotonic manifest-copy-rebind timeline.',
      'rebindReceipt.reboundAt',
    )
  }
  if (value.sourceAfter.version !== value.sourceBefore.version + 1
    || value.destinationAfter.version !== value.destinationBefore.version + 1) {
    throw new TenantObjectContractError(
      'policy-drift',
      'Policy rebind must advance both namespace policy versions exactly once.',
      'rebindReceipt',
    )
  }
  const { receiptChecksumSha256: _receiptChecksumSha256, ...base } = value
  if (value.receiptChecksumSha256 !== checksum(tenantObjectRebindReceiptHashInput(base))) {
    throw new TenantObjectContractError(
      'receipt-drift',
      'Policy rebind receipt drifted from its checksum.',
      'rebindReceipt.receiptChecksumSha256',
    )
  }
}

export function tenantObjectDeleteReceiptHashInput(
  receipt: Omit<TenantObjectDeleteReceipt, 'receiptChecksumSha256'>,
): string {
  return JSON.stringify(receipt)
}

export function createTenantObjectDeleteReceipt(
  manifest: TenantObjectManifest,
  saga: TenantObjectSagaFence,
  logicalKey: string,
  outcome: 'deleted' | 'already-absent',
  deletedAt: string,
): TenantObjectDeleteReceipt {
  assertTenantObjectManifest(manifest)
  assertSagaFence(saga, manifest, 'saga')
  assertTimestamp(deletedAt, 'deleteReceipt.deletedAt')
  const entry = entryByLogicalKey(manifest, logicalKey)
  const base = {
    schemaVersion: 1,
    transferId: manifest.transferId,
    lockId: saga.lockId,
    fence: saga.fence,
    manifestChecksumSha256: manifest.manifestChecksumSha256,
    entryDescriptorChecksumSha256: entry.descriptorChecksumSha256,
    logicalKey: entry.logicalKey,
    destinationPhysicalKey: entry.destinationPhysicalKey,
    outcome,
    deletedAt,
  } satisfies Omit<TenantObjectDeleteReceipt, 'receiptChecksumSha256'>
  const receipt: TenantObjectDeleteReceipt = {
    ...base,
    receiptChecksumSha256: checksum(tenantObjectDeleteReceiptHashInput(base)),
  }
  assertTenantObjectDeleteReceipt(receipt, manifest, saga)
  return deepFreeze(receipt)
}

export function assertTenantObjectDeleteReceipt(
  value: unknown,
  manifest: TenantObjectManifest,
  saga: TenantObjectSagaFence,
  path = 'deleteReceipt',
): asserts value is TenantObjectDeleteReceipt {
  assertTenantObjectSchema(TenantObjectDeleteReceiptSchema, value, path)
  assertTenantObjectManifest(manifest)
  assertSagaFence(saga, manifest, 'saga')
  assertTimestamp(value.deletedAt, `${path}.deletedAt`)
  if (Date.parse(value.deletedAt) < Date.parse(manifest.capturedAt)) {
    throw new TenantObjectContractError(
      'receipt-drift',
      'Delete receipt cannot predate its immutable object manifest.',
      `${path}.deletedAt`,
    )
  }
  const entry = entryByLogicalKey(manifest, value.logicalKey)
  if (value.transferId !== manifest.transferId
    || value.lockId !== saga.lockId
    || value.fence !== saga.fence
    || value.manifestChecksumSha256 !== manifest.manifestChecksumSha256
    || value.entryDescriptorChecksumSha256 !== entry.descriptorChecksumSha256
    || value.destinationPhysicalKey !== entry.destinationPhysicalKey) {
    throw new TenantObjectContractError(
      'receipt-drift',
      'Delete receipt does not match its destination entry, manifest, lock, or fence.',
      path,
    )
  }
  const { receiptChecksumSha256: _receiptChecksumSha256, ...base } = value
  if (value.receiptChecksumSha256 !== checksum(tenantObjectDeleteReceiptHashInput(base))) {
    throw new TenantObjectContractError(
      'receipt-drift',
      'Delete receipt drifted from its checksum.',
      `${path}.receiptChecksumSha256`,
    )
  }
}

export function tenantObjectCompensationReceiptHashInput(
  receipt: Omit<TenantObjectCompensationReceipt, 'receiptChecksumSha256'>,
): string {
  return JSON.stringify({
    ...receipt,
    checkpoints: receipt.checkpoints.map(({ intent, receipt: copyReceipt }) => ({
      logicalKey: intent.logicalKey,
      disposition: intent.disposition,
      intentChecksumSha256: intent.intentChecksumSha256,
      copyReceiptChecksumSha256: copyReceipt?.receiptChecksumSha256 ?? null,
    })),
    revertedCopies: receipt.revertedCopies.map((entry) => ({
      logicalKey: entry.logicalKey,
      receiptChecksumSha256: entry.receiptChecksumSha256,
    })),
  })
}

function canonicalCompensationCheckpoints(
  checkpoints: readonly TenantObjectCompensationCheckpoint[],
): TenantObjectCompensationCheckpoint[] {
  return checkpoints.map(({ intent, receipt }) => ({
    intent: { ...intent },
    receipt: receipt === null ? null : { ...receipt },
  })).sort((left, right) => compareText(left.intent.logicalKey, right.intent.logicalKey))
}

export function createTenantObjectCompensationReceipt(input: Readonly<{
  manifest: TenantObjectManifest
  saga: TenantObjectSagaFence
  copyProgress: TenantObjectCopyProgressReceipt | null
  checkpoints: readonly TenantObjectCompensationCheckpoint[]
  revertedCopies: readonly TenantObjectDeleteReceipt[]
  compensatedAt: string
}>): TenantObjectCompensationReceipt {
  assertTenantObjectManifest(input.manifest)
  assertSagaFence(input.saga, input.manifest, 'saga')
  if (input.copyProgress !== null) {
    assertTenantObjectCopyProgressReceipt(input.copyProgress, input.manifest, input.saga)
  }
  assertTimestamp(input.compensatedAt, 'compensationReceipt.compensatedAt')
  const checkpoints = canonicalCompensationCheckpoints(input.checkpoints)
  const revertedCopies = [...input.revertedCopies]
    .map((receipt) => ({ ...receipt }))
    .sort((left, right) => compareText(left.logicalKey, right.logicalKey))
  const base = {
    schemaVersion: 1,
    transferId: input.manifest.transferId,
    lockId: input.saga.lockId,
    fence: input.saga.fence,
    manifestChecksumSha256: input.manifest.manifestChecksumSha256,
    copyProgressReceiptChecksumSha256: input.copyProgress?.receiptChecksumSha256 ?? null,
    checkpoints,
    revertedCopies,
    compensatedAt: input.compensatedAt,
  } satisfies Omit<TenantObjectCompensationReceipt, 'receiptChecksumSha256'>
  const receipt: TenantObjectCompensationReceipt = {
    ...base,
    receiptChecksumSha256: checksum(tenantObjectCompensationReceiptHashInput(base)),
  }
  assertTenantObjectCompensationReceipt(
    receipt,
    input.manifest,
    input.saga,
    input.copyProgress,
  )
  return deepFreeze(receipt)
}

export function assertTenantObjectCompensationReceipt(
  value: unknown,
  manifest: TenantObjectManifest,
  saga: TenantObjectSagaFence,
  copyProgress: TenantObjectCopyProgressReceipt | null,
): asserts value is TenantObjectCompensationReceipt {
  assertTenantObjectSchema(TenantObjectCompensationReceiptSchema, value, 'compensationReceipt')
  assertTenantObjectManifest(manifest)
  assertSagaFence(saga, manifest, 'saga')
  if (copyProgress !== null) {
    assertTenantObjectCopyProgressReceipt(copyProgress, manifest, saga)
  }
  assertTimestamp(value.compensatedAt, 'compensationReceipt.compensatedAt')
  if (value.transferId !== manifest.transferId
    || value.lockId !== saga.lockId
    || value.fence !== saga.fence
    || value.manifestChecksumSha256 !== manifest.manifestChecksumSha256
    || value.copyProgressReceiptChecksumSha256
      !== (copyProgress?.receiptChecksumSha256 ?? null)) {
    throw new TenantObjectContractError(
      'receipt-drift',
      'Compensation receipt belongs to a different manifest, copy progress, lock, or fence.',
      'compensationReceipt',
    )
  }

  const compensatedAt = Date.parse(value.compensatedAt)
  const checkpointKeys = new Set<string>()
  const copyKeys: string[] = []
  for (const [index, checkpoint] of value.checkpoints.entries()) {
    const path = `compensationReceipt.checkpoints[${index}]`
    assertTenantObjectCopyIntent(checkpoint.intent, manifest, saga, `${path}.intent`)
    if (checkpoint.receipt !== null) {
      assertTenantObjectCopyReceipt(checkpoint.receipt, manifest, saga, `${path}.receipt`)
      if (checkpoint.receipt.logicalKey !== checkpoint.intent.logicalKey
        || checkpoint.receipt.disposition !== checkpoint.intent.disposition) {
        throw new TenantObjectContractError(
          'receipt-drift',
          'Compensation copy receipt does not match its durable intent.',
          `${path}.receipt`,
        )
      }
      if (Date.parse(checkpoint.receipt.copiedAt) > compensatedAt) {
        throw new TenantObjectContractError(
          'receipt-drift',
          'Compensation cannot predate a copied object receipt.',
          'compensationReceipt.compensatedAt',
        )
      }
    }
    if (Date.parse(checkpoint.intent.intendedAt) > compensatedAt) {
      throw new TenantObjectContractError(
        'receipt-drift',
        'Compensation cannot predate a durable object intent.',
        'compensationReceipt.compensatedAt',
      )
    }
    const logicalKey = checkpoint.intent.logicalKey
    if (checkpointKeys.has(logicalKey)
      || (index > 0 && compareText(value.checkpoints[index - 1].intent.logicalKey, logicalKey) >= 0)) {
      throw new TenantObjectContractError(
        checkpointKeys.has(logicalKey) ? 'duplicate-key' : 'ordering-drift',
        'Compensation checkpoints must be unique and canonically ordered.',
        `${path}.intent.logicalKey`,
      )
    }
    checkpointKeys.add(logicalKey)
    if (checkpoint.intent.disposition === 'copy') copyKeys.push(logicalKey)
  }

  const deleteKeys: string[] = []
  for (const [index, receipt] of value.revertedCopies.entries()) {
    assertTenantObjectDeleteReceipt(
      receipt,
      manifest,
      saga,
      `compensationReceipt.revertedCopies[${index}]`,
    )
    if (Date.parse(receipt.deletedAt) > compensatedAt) {
      throw new TenantObjectContractError(
        'receipt-drift',
        'Compensation cannot predate an object rollback receipt.',
        'compensationReceipt.compensatedAt',
      )
    }
    deleteKeys.push(receipt.logicalKey)
    if (index > 0 && compareText(value.revertedCopies[index - 1].logicalKey, receipt.logicalKey) >= 0) {
      throw new TenantObjectContractError(
        value.revertedCopies[index - 1].logicalKey === receipt.logicalKey
          ? 'duplicate-key'
          : 'ordering-drift',
        'Object rollback receipts must be unique and canonically ordered.',
        `compensationReceipt.revertedCopies[${index}].logicalKey`,
      )
    }
  }
  if (JSON.stringify(copyKeys) !== JSON.stringify(deleteKeys)) {
    throw new TenantObjectContractError(
      'receipt-drift',
      'Compensation deletes every and only transfer-created copies; rebound objects remain.',
      'compensationReceipt.revertedCopies',
    )
  }

  if (copyProgress !== null) {
    const completed = new Map(copyProgress.completed.map((receipt) => [receipt.logicalKey, receipt]))
    if (value.checkpoints.length !== copyProgress.completed.length
      || value.checkpoints.some(({ intent, receipt }) => (
        receipt === null || !sameReceiptEvidence(receipt, completed.get(intent.logicalKey))
      ))) {
      throw new TenantObjectContractError(
        'receipt-drift',
        'Completed-copy compensation must bind every exact copy-progress receipt.',
        'compensationReceipt.checkpoints',
      )
    }
  }

  const { receiptChecksumSha256: _receiptChecksumSha256, ...base } = value
  if (value.receiptChecksumSha256 !== checksum(tenantObjectCompensationReceiptHashInput(base))) {
    throw new TenantObjectContractError(
      'receipt-drift',
      'Compensation receipt drifted from its checksum.',
      'compensationReceipt.receiptChecksumSha256',
    )
  }
}

function sameReceiptEvidence(
  left: TenantObjectCopyReceipt,
  right: TenantObjectCopyReceipt | undefined,
): boolean {
  return right !== undefined && left.receiptChecksumSha256 === right.receiptChecksumSha256
}
