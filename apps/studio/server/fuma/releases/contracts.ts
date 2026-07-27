import {
  Type,
  Value,
  safeParseValue,
  type Static,
  type TSchema,
} from '@core/utils/typeboxHelpers'
import { TenantKeyIdSchema } from '../tenancy'

const SHA256_OPTIONS = { pattern: '^[a-f0-9]{64}$' } as const
const TIMESTAMP_OPTIONS = {
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$',
} as const
const LOGICAL_PATH_OPTIONS = {
  minLength: 2,
  maxLength: 2_048,
  pattern: '^/[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$',
} as const
const OBJECT_KEY_OPTIONS = {
  minLength: 1,
  maxLength: 4_096,
  pattern: '^publish/releases/[A-Za-z0-9][A-Za-z0-9._:-]*/objects/[a-f0-9]{64}$',
} as const
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

export const ReleaseHashSchema = Type.String(SHA256_OPTIONS)
export type ReleaseHash = Static<typeof ReleaseHashSchema>

export const ReleaseTimestampSchema = Type.String(TIMESTAMP_OPTIONS)
export type ReleaseTimestamp = Static<typeof ReleaseTimestampSchema>

export const ReleaseStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('building'),
  Type.Literal('ready'),
  Type.Literal('active'),
  Type.Literal('failed'),
])
export type ReleaseStatus = Static<typeof ReleaseStatusSchema>

export const ReleaseArtifactKindSchema = Type.Union([
  Type.Literal('html'),
  Type.Literal('css'),
  Type.Literal('javascript'),
  Type.Literal('asset'),
])
export type ReleaseArtifactKind = Static<typeof ReleaseArtifactKindSchema>

export const ReleaseArtifactSchema = Type.Object({
  logicalPath: Type.String(LOGICAL_PATH_OPTIONS),
  kind: ReleaseArtifactKindSchema,
  objectKey: Type.String(OBJECT_KEY_OPTIONS),
  contentHashSha256: ReleaseHashSchema,
  sizeBytes: Type.Integer({ minimum: 0, maximum: MAX_SAFE_INTEGER }),
  mimeType: Type.String({
    minLength: 3,
    maxLength: 255,
    pattern: '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$',
  }),
  references: Type.Array(Type.String(LOGICAL_PATH_OPTIONS), {
    maxItems: 10_000,
    uniqueItems: true,
  }),
}, { additionalProperties: false })
export type ReleaseArtifact = DeepReadonly<Static<typeof ReleaseArtifactSchema>>

export const ReleaseManifestSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  releaseId: TenantKeyIdSchema,
  ownerKey: TenantKeyIdSchema,
  siteId: TenantKeyIdSchema,
  sourceSnapshotHashSha256: ReleaseHashSchema,
  artifacts: Type.Array(ReleaseArtifactSchema, {
    minItems: 1,
    maxItems: 100_000,
  }),
  artifactCount: Type.Integer({ minimum: 1, maximum: 100_000 }),
  totalSizeBytes: Type.Integer({ minimum: 0, maximum: MAX_SAFE_INTEGER }),
  artifactsHashSha256: ReleaseHashSchema,
  createdAt: ReleaseTimestampSchema,
  manifestHashSha256: ReleaseHashSchema,
}, { additionalProperties: false })
export type ReleaseManifest = DeepReadonly<Static<typeof ReleaseManifestSchema>>

export const ReleaseBuildClaimSchema = Type.Object({
  jobId: TenantKeyIdSchema,
  fence: Type.String({ pattern: '^[1-9][0-9]*$', maxLength: 128 }),
}, { additionalProperties: false })
export type ReleaseBuildClaim = DeepReadonly<Static<typeof ReleaseBuildClaimSchema>>

export const ReleaseFailureSchema = Type.Object({
  code: Type.String({
    minLength: 1,
    maxLength: 128,
    pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
  }),
  retryable: Type.Boolean(),
}, { additionalProperties: false })
export type ReleaseFailure = DeepReadonly<Static<typeof ReleaseFailureSchema>>

const nullableTimestamp = Type.Union([ReleaseTimestampSchema, Type.Null()])

export const ReleaseRecordSchema = Type.Object({
  platformId: TenantKeyIdSchema,
  organizationId: TenantKeyIdSchema,
  workspaceId: TenantKeyIdSchema,
  siteId: TenantKeyIdSchema,
  ownerKey: TenantKeyIdSchema,
  releaseId: TenantKeyIdSchema,
  sourceSnapshotHashSha256: ReleaseHashSchema,
  status: ReleaseStatusSchema,
  buildClaim: Type.Union([ReleaseBuildClaimSchema, Type.Null()]),
  manifest: Type.Union([ReleaseManifestSchema, Type.Null()]),
  failure: Type.Union([ReleaseFailureSchema, Type.Null()]),
  version: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  queuedAt: ReleaseTimestampSchema,
  buildingAt: nullableTimestamp,
  readyAt: nullableTimestamp,
  activatedAt: nullableTimestamp,
  failedAt: nullableTimestamp,
  updatedAt: ReleaseTimestampSchema,
}, { additionalProperties: false })
export type ReleaseRecord = DeepReadonly<Static<typeof ReleaseRecordSchema>>

export const ActiveReleasePointerSchema = Type.Object({
  platformId: TenantKeyIdSchema,
  organizationId: TenantKeyIdSchema,
  workspaceId: TenantKeyIdSchema,
  siteId: TenantKeyIdSchema,
  ownerKey: TenantKeyIdSchema,
  releaseId: TenantKeyIdSchema,
  version: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  activatedAt: ReleaseTimestampSchema,
}, { additionalProperties: false })
export type ActiveReleasePointer = DeepReadonly<Static<typeof ActiveReleasePointerSchema>>

export const ReleaseRetentionRootKindSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('manual'),
])
export type ReleaseRetentionRootKind = Static<typeof ReleaseRetentionRootKindSchema>

export const ReleaseRetentionRootSchema = Type.Object({
  platformId: TenantKeyIdSchema,
  organizationId: TenantKeyIdSchema,
  workspaceId: TenantKeyIdSchema,
  siteId: TenantKeyIdSchema,
  ownerKey: TenantKeyIdSchema,
  rootId: TenantKeyIdSchema,
  releaseId: TenantKeyIdSchema,
  kind: ReleaseRetentionRootKindSchema,
  createdAt: ReleaseTimestampSchema,
}, { additionalProperties: false })
export type ReleaseRetentionRoot = DeepReadonly<Static<typeof ReleaseRetentionRootSchema>>

export type ReleaseContractErrorCode =
  | 'invalid-contract'
  | 'invalid-path'
  | 'duplicate-artifact'
  | 'invalid-object-identity'
  | 'missing-reference'
  | 'aggregate-mismatch'
  | 'hash-mismatch'
  | 'invalid-lifecycle'

export class ReleaseContractError extends Error {
  readonly code: ReleaseContractErrorCode
  readonly path: string

  constructor(code: ReleaseContractErrorCode, message: string, path: string) {
    super(message)
    this.name = 'ReleaseContractError'
    this.code = code
    this.path = path
  }
}

function parseContract<T extends TSchema>(
  schema: T,
  value: unknown,
  path: string,
): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (parsed.ok) return parsed.value
  const detail = Value.Errors(schema, value).First()
  throw new ReleaseContractError(
    'invalid-contract',
    `${path} does not match its TypeBox contract${detail ? `: ${detail.path || '/'} ${detail.message}` : ''}.`,
    path,
  )
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}

function assertTimestamp(value: string, path: string): void {
  const time = Date.parse(value)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new ReleaseContractError(
      'invalid-contract',
      `${path} must be a canonical UTC ISO timestamp.`,
      path,
    )
  }
}

export function assertReleaseLogicalPath(value: string, path = 'logicalPath'): void {
  if (!Value.Check(Type.String(LOGICAL_PATH_OPTIONS), value)
    || value.includes('//')
    || value.includes('/./')
    || value.includes('/../')) {
    throw new ReleaseContractError(
      'invalid-path',
      `${path} must be a canonical absolute release path.`,
      path,
    )
  }
}

export function assertReleaseRecord(value: unknown): asserts value is ReleaseRecord {
  const record = parseContract(ReleaseRecordSchema, value, 'release')
  for (const field of ['queuedAt', 'updatedAt'] as const) assertTimestamp(record[field], `release.${field}`)
  for (const field of ['buildingAt', 'readyAt', 'activatedAt', 'failedAt'] as const) {
    if (record[field] !== null) assertTimestamp(record[field], `release.${field}`)
  }

  const queued = record.status === 'queued'
    && record.buildClaim === null
    && record.manifest === null
    && record.failure === null
    && record.buildingAt === null
    && record.readyAt === null
    && record.activatedAt === null
    && record.failedAt === null
  const building = record.status === 'building'
    && record.buildClaim !== null
    && record.manifest === null
    && record.failure === null
    && record.buildingAt !== null
    && record.readyAt === null
    && record.activatedAt === null
    && record.failedAt === null
  const publishable = (record.status === 'ready' || record.status === 'active')
    && record.buildClaim !== null
    && record.manifest !== null
    && record.failure === null
    && record.buildingAt !== null
    && record.readyAt !== null
    && record.failedAt === null
    && (record.status === 'ready' || record.activatedAt !== null)
  const failed = record.status === 'failed'
    && record.manifest === null
    && record.failure !== null
    && record.readyAt === null
    && record.activatedAt === null
    && record.failedAt !== null
  if (!queued && !building && !publishable && !failed) {
    throw new ReleaseContractError(
      'invalid-lifecycle',
      `Release lifecycle fields do not match state ${record.status}.`,
      'release.status',
    )
  }
  if (record.manifest !== null) {
    if (record.manifest.releaseId !== record.releaseId
      || record.manifest.ownerKey !== record.ownerKey
      || record.manifest.siteId !== record.siteId
      || record.manifest.sourceSnapshotHashSha256 !== record.sourceSnapshotHashSha256) {
      throw new ReleaseContractError(
        'invalid-lifecycle',
        'Release manifest identity does not match its release record.',
        'release.manifest',
      )
    }
  }
}

export function validateReleaseRecord(value: unknown): ReleaseRecord {
  assertReleaseRecord(value)
  return deepFreeze(structuredClone(value))
}

export function validateActiveReleasePointer(value: unknown): ActiveReleasePointer {
  const pointer = parseContract(ActiveReleasePointerSchema, value, 'activePointer')
  assertTimestamp(pointer.activatedAt, 'activePointer.activatedAt')
  return deepFreeze(structuredClone(pointer))
}

export function validateReleaseRetentionRoot(value: unknown): ReleaseRetentionRoot {
  const root = parseContract(ReleaseRetentionRootSchema, value, 'retentionRoot')
  assertTimestamp(root.createdAt, 'retentionRoot.createdAt')
  return deepFreeze(structuredClone(root))
}

export function assertManifestShape(value: unknown): ReleaseManifest {
  const manifest = parseContract(ReleaseManifestSchema, value, 'manifest')
  assertTimestamp(manifest.createdAt, 'manifest.createdAt')
  return manifest
}
