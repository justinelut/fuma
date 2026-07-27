import {
  Type,
  Value,
  safeParseValue,
  type Static,
  type TSchema,
} from '@core/utils/typeboxHelpers'

const ID_OPTIONS = {
  minLength: 1,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
} as const
const SHA256_OPTIONS = { pattern: '^[a-f0-9]{64}$' } as const
const TIMESTAMP_OPTIONS = {
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$',
} as const
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER

export const TenantKeyIdSchema = Type.String(ID_OPTIONS)
export type TenantKeyId = Static<typeof TenantKeyIdSchema>

export const TenantOwnershipCoordinateSchema = Type.Object({
  platformId: TenantKeyIdSchema,
  organizationId: TenantKeyIdSchema,
  workspaceId: TenantKeyIdSchema,
  siteId: TenantKeyIdSchema,
}, { additionalProperties: false })
export type TenantOwnershipCoordinate = Static<typeof TenantOwnershipCoordinateSchema>

export const TenantOwnerKeyStateSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('transferring'),
])
export type TenantOwnerKeyState = Static<typeof TenantOwnerKeyStateSchema>

export const TenantOwnerKeyRecordSchema = Type.Object({
  ownerKey: TenantKeyIdSchema,
  coordinate: TenantOwnershipCoordinateSchema,
  state: TenantOwnerKeyStateSchema,
  generation: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  transferId: Type.Union([TenantKeyIdSchema, Type.Null()]),
  transferLockId: Type.Union([TenantKeyIdSchema, Type.Null()]),
  transferFence: Type.Union([
    Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
    Type.Null(),
  ]),
  createdAt: Type.String(TIMESTAMP_OPTIONS),
  updatedAt: Type.String(TIMESTAMP_OPTIONS),
}, { additionalProperties: false })
export type TenantOwnerKeyRecord = Static<typeof TenantOwnerKeyRecordSchema>

export const TenantLegacyIdentitySchema = Type.Record(
  Type.String({ minLength: 1, maxLength: 128 }),
  Type.Unknown(),
  { minProperties: 1, maxProperties: 32 },
)
export type TenantLegacyIdentity = Static<typeof TenantLegacyIdentitySchema>

const resourceOwnershipBase = {
  ownerKey: TenantKeyIdSchema,
  coordinate: TenantOwnershipCoordinateSchema,
  classId: TenantKeyIdSchema,
  sourceName: Type.String({ minLength: 1, maxLength: 255 }),
  legacyId: Type.String({ minLength: 1, maxLength: 2_048 }),
  legacyIdentity: TenantLegacyIdentitySchema,
  createdAt: Type.String(TIMESTAMP_OPTIONS),
  updatedAt: Type.String(TIMESTAMP_OPTIONS),
}

export const TenantTableRowOwnershipSchema = Type.Object({
  ...resourceOwnershipBase,
  resourceKind: Type.Literal('table-row'),
  objectKey: Type.Null(),
  contentHash: Type.Union([Type.String(SHA256_OPTIONS), Type.Null()]),
  sizeBytes: Type.Null(),
}, { additionalProperties: false })
export type TenantTableRowOwnership = Static<typeof TenantTableRowOwnershipSchema>

export const TenantObjectOwnershipSchema = Type.Object({
  ...resourceOwnershipBase,
  resourceKind: Type.Literal('object'),
  objectKey: Type.String({ minLength: 1, maxLength: 4_096 }),
  contentHash: Type.String(SHA256_OPTIONS),
  sizeBytes: Type.Integer({ minimum: 0, maximum: MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
export type TenantObjectOwnership = Static<typeof TenantObjectOwnershipSchema>

export const TenantResourceOwnershipSchema = Type.Union([
  TenantTableRowOwnershipSchema,
  TenantObjectOwnershipSchema,
])
export type TenantResourceOwnership = Static<typeof TenantResourceOwnershipSchema>

export const TenantBackfillStateSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('running'),
  Type.Literal('complete'),
  Type.Literal('failed'),
])
export type TenantBackfillState = Static<typeof TenantBackfillStateSchema>

export const TenantForeignKeyEvidenceSchema = Type.Object({
  sourceClassId: TenantKeyIdSchema,
  sourceColumns: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
    minItems: 1,
    maxItems: 16,
    uniqueItems: true,
  }),
  targetClassId: TenantKeyIdSchema,
  targetColumns: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
    minItems: 1,
    maxItems: 16,
    uniqueItems: true,
  }),
  checkedCount: Type.Integer({ minimum: 0, maximum: MAX_SAFE_INTEGER }),
  validCount: Type.Integer({ minimum: 0, maximum: MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
export type TenantForeignKeyEvidence = Static<typeof TenantForeignKeyEvidenceSchema>

const nullableJsonObject = Type.Union([
  Type.Record(Type.String(), Type.Unknown(), { maxProperties: 32 }),
  Type.Null(),
])
const nullableTimestamp = Type.Union([Type.String(TIMESTAMP_OPTIONS), Type.Null()])
const nullableHash = Type.Union([Type.String(SHA256_OPTIONS), Type.Null()])

export const TenantKeyBackfillRunSchema = Type.Object({
  id: TenantKeyIdSchema,
  ownerKey: TenantKeyIdSchema,
  coordinate: TenantOwnershipCoordinateSchema,
  sourceFingerprint: Type.String(SHA256_OPTIONS),
  inventoryVersion: TenantKeyIdSchema,
  state: TenantBackfillStateSchema,
  expectedClassCount: Type.Integer({ minimum: 0, maximum: MAX_SAFE_INTEGER }),
  completedClassCount: Type.Integer({ minimum: 0, maximum: MAX_SAFE_INTEGER }),
  expectedResourceCount: Type.Integer({ minimum: 0, maximum: MAX_SAFE_INTEGER }),
  mappedResourceCount: Type.Integer({ minimum: 0, maximum: MAX_SAFE_INTEGER }),
  failure: nullableJsonObject,
  startedAt: nullableTimestamp,
  updatedAt: Type.String(TIMESTAMP_OPTIONS),
  completedAt: nullableTimestamp,
}, { additionalProperties: false })
export type TenantKeyBackfillRun = Static<typeof TenantKeyBackfillRunSchema>

export const TenantKeyBackfillReceiptSchema = Type.Object({
  backfillId: TenantKeyIdSchema,
  classId: TenantKeyIdSchema,
  sourceName: Type.String({ minLength: 1, maxLength: 255 }),
  state: TenantBackfillStateSchema,
  resumeCursor: nullableJsonObject,
  sourceCount: Type.Integer({ minimum: 0, maximum: MAX_SAFE_INTEGER }),
  mappedCount: Type.Integer({ minimum: 0, maximum: MAX_SAFE_INTEGER }),
  sourceContentHash: nullableHash,
  mappedContentHash: nullableHash,
  sourceForeignKeyCount: Type.Integer({ minimum: 0, maximum: MAX_SAFE_INTEGER }),
  validForeignKeyCount: Type.Integer({ minimum: 0, maximum: MAX_SAFE_INTEGER }),
  foreignKeyEvidence: Type.Array(TenantForeignKeyEvidenceSchema, { maxItems: 256 }),
  failure: nullableJsonObject,
  updatedAt: Type.String(TIMESTAMP_OPTIONS),
  completedAt: nullableTimestamp,
}, { additionalProperties: false })
export type TenantKeyBackfillReceipt = Static<typeof TenantKeyBackfillReceiptSchema>

export type TenantKeyContractErrorCode =
  | 'invalid-contract'
  | 'invalid-owner-state'
  | 'invalid-progress'
  | 'count-mismatch'
  | 'hash-mismatch'
  | 'foreign-key-mismatch'
  | 'foreign-key-evidence-mismatch'

export class TenantKeyContractError extends Error {
  readonly code: TenantKeyContractErrorCode
  readonly path: string

  constructor(code: TenantKeyContractErrorCode, message: string, path: string) {
    super(message)
    this.name = 'TenantKeyContractError'
    this.code = code
    this.path = path
  }
}

function parseContract<T extends TSchema>(schema: T, value: unknown, path: string): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (parsed.ok) return parsed.value
  const detail = Value.Errors(schema, value).First()
  throw new TenantKeyContractError(
    'invalid-contract',
    `${path} does not match its TypeBox contract${detail ? `: ${detail.path || '/'} ${detail.message}` : ''}.`,
    path,
  )
}

function assertLifecycleShape(input: Readonly<{
  state: TenantBackfillState
  failure: Record<string, unknown> | null
  startedAt: string | null
  completedAt: string | null
}>, path: string): void {
  const valid = input.state === 'pending'
    ? input.failure === null && input.startedAt === null && input.completedAt === null
    : input.state === 'running'
      ? input.failure === null && input.startedAt !== null && input.completedAt === null
      : input.state === 'complete'
        ? input.failure === null && input.startedAt !== null && input.completedAt !== null
        : input.failure !== null && input.startedAt !== null && input.completedAt === null
  if (!valid) {
    throw new TenantKeyContractError(
      'invalid-progress',
      `${path} lifecycle timestamps and failure evidence do not match state ${input.state}.`,
      path,
    )
  }
}

function assertReceiptLifecycleShape(receipt: TenantKeyBackfillReceipt): void {
  const valid = receipt.state === 'pending'
    ? receipt.failure === null && receipt.completedAt === null
    : receipt.state === 'running'
      ? receipt.failure === null && receipt.completedAt === null
      : receipt.state === 'complete'
        ? receipt.failure === null && receipt.completedAt !== null
        : receipt.failure !== null && receipt.completedAt === null
  if (!valid) {
    throw new TenantKeyContractError(
      'invalid-progress',
      `backfillReceipt completion and failure evidence do not match state ${receipt.state}.`,
      'backfillReceipt',
    )
  }
}

function foreignKeyEvidenceKey(evidence: TenantForeignKeyEvidence): string {
  return [
    evidence.sourceClassId,
    evidence.sourceColumns.join(','),
    evidence.targetClassId,
    evidence.targetColumns.join(','),
  ].join('|')
}

export function validateTenantOwnerKeyRecord(value: unknown): TenantOwnerKeyRecord {
  const record = parseContract(TenantOwnerKeyRecordSchema, value, 'ownerKey')
  const activeShape = record.state === 'active'
    && record.transferId === null
    && record.transferLockId === null
    && record.transferFence === null
  const transferringShape = record.state === 'transferring'
    && record.transferId !== null
    && record.transferLockId !== null
    && record.transferFence !== null
  if (!activeShape && !transferringShape) {
    throw new TenantKeyContractError(
      'invalid-owner-state',
      'An active owner key has no transfer fence; a transferring key requires transfer, lock, and fence IDs.',
      'ownerKey.transferId',
    )
  }
  return record
}

export function validateTenantResourceOwnership(value: unknown): TenantResourceOwnership {
  return parseContract(TenantResourceOwnershipSchema, value, 'resourceOwnership')
}

export function validateTenantKeyBackfillRun(value: unknown): TenantKeyBackfillRun {
  const run = parseContract(TenantKeyBackfillRunSchema, value, 'backfillRun')
  if (run.completedClassCount > run.expectedClassCount
    || run.mappedResourceCount > run.expectedResourceCount) {
    throw new TenantKeyContractError(
      'invalid-progress',
      'Backfill progress cannot exceed its expected class or resource totals.',
      'backfillRun',
    )
  }
  assertLifecycleShape(run, 'backfillRun')
  if (run.state === 'complete'
    && (run.completedClassCount !== run.expectedClassCount
      || run.mappedResourceCount !== run.expectedResourceCount)) {
    throw new TenantKeyContractError(
      'count-mismatch',
      'A complete backfill run must map every expected class and resource.',
      'backfillRun',
    )
  }
  return run
}

export function validateTenantKeyBackfillReceipt(value: unknown): TenantKeyBackfillReceipt {
  const receipt = parseContract(TenantKeyBackfillReceiptSchema, value, 'backfillReceipt')
  if (receipt.mappedCount > receipt.sourceCount
    || receipt.validForeignKeyCount > receipt.sourceForeignKeyCount) {
    throw new TenantKeyContractError(
      'invalid-progress',
      'Backfill receipt progress cannot exceed source counts.',
      'backfillReceipt',
    )
  }
  assertReceiptLifecycleShape(receipt)
  if (receipt.state !== 'complete') return receipt
  if (receipt.sourceCount !== receipt.mappedCount) {
    throw new TenantKeyContractError(
      'count-mismatch',
      'A complete class receipt must preserve every source resource.',
      'backfillReceipt.mappedCount',
    )
  }
  if (receipt.sourceContentHash === null
    || receipt.sourceContentHash !== receipt.mappedContentHash) {
    throw new TenantKeyContractError(
      'hash-mismatch',
      'A complete class receipt requires equal non-null source and mapped hashes.',
      'backfillReceipt.mappedContentHash',
    )
  }
  if (receipt.sourceForeignKeyCount !== receipt.validForeignKeyCount) {
    throw new TenantKeyContractError(
      'foreign-key-mismatch',
      'A complete class receipt must validate every source foreign key.',
      'backfillReceipt.validForeignKeyCount',
    )
  }
  const checked = receipt.foreignKeyEvidence.reduce(
    (total, evidence) => total + evidence.checkedCount,
    0,
  )
  const valid = receipt.foreignKeyEvidence.reduce(
    (total, evidence) => total + evidence.validCount,
    0,
  )
  const evidenceKeys = receipt.foreignKeyEvidence.map(foreignKeyEvidenceKey)
  if (receipt.foreignKeyEvidence.some((evidence) => (
    evidence.validCount > evidence.checkedCount
    || evidence.sourceColumns.length !== evidence.targetColumns.length
  ))
    || new Set(evidenceKeys).size !== evidenceKeys.length
    || checked !== receipt.sourceForeignKeyCount
    || valid !== receipt.validForeignKeyCount) {
    throw new TenantKeyContractError(
      'foreign-key-evidence-mismatch',
      'Foreign-key evidence must be unique, column-aligned, and reconcile exactly with receipt totals.',
      'backfillReceipt.foreignKeyEvidence',
    )
  }
  return receipt
}
