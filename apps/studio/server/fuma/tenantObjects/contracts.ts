import {
  Type,
  Value,
  type Static,
  type TSchema,
} from '@core/utils/typeboxHelpers'

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

type Contract<T> = DeepReadonly<T>

export const TENANT_OBJECT_MANIFEST_MAX_ENTRIES = 100_000
export const TENANT_OBJECT_POLICY_MAX_BINDINGS = 64
export const TENANT_OBJECT_METADATA_MAX_STRING_LENGTH = 512

const ID_OPTIONS = {
  minLength: 1,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
} as const
const SCOPE_SEGMENT_OPTIONS = {
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$',
} as const
const TIMESTAMP_OPTIONS = {
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$',
} as const
const CHECKSUM_OPTIONS = {
  pattern: '^[a-f0-9]{64}$',
} as const
const LOGICAL_KEY_OPTIONS = {
  minLength: 1,
  maxLength: 1_024,
} as const
const PHYSICAL_PREFIX_OPTIONS = {
  minLength: 1,
  maxLength: 1_024,
  pattern: '^organizations/[^/]+/workspaces/[^/]+/sites/[^/]+/objects/$',
} as const
const PHYSICAL_KEY_OPTIONS = {
  minLength: 1,
  maxLength: 2_048,
  pattern: '^organizations/[^/]+/workspaces/[^/]+/sites/[^/]+/objects/.+$',
} as const
const MIME_TYPE_OPTIONS = {
  minLength: 3,
  maxLength: 255,
  pattern: '^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$',
} as const

function literalUnion<const Values extends readonly [string, ...string[]]>(values: Values) {
  return Type.Union(values.map((value) => Type.Literal(value)))
}

export const TENANT_OBJECT_CLASSES = Object.freeze([
  'content-revision',
  'form-attachment',
  'media',
  'publish-release',
  'plugin-artifact',
  'plugin-installation-artifact',
  'import-artifact',
  'export-artifact',
  'ai-artifact',
  'mcp-artifact',
] as const)

export const TenantObjectClassSchema = literalUnion(TENANT_OBJECT_CLASSES)
export type TenantObjectClass = Contract<Static<typeof TenantObjectClassSchema>>

export const TenantObjectIdSchema = Type.String(ID_OPTIONS)
export type TenantObjectId = Contract<Static<typeof TenantObjectIdSchema>>

export const TenantObjectTimestampSchema = Type.String(TIMESTAMP_OPTIONS)
export type TenantObjectTimestamp = Contract<Static<typeof TenantObjectTimestampSchema>>

export const TenantObjectChecksumSchema = Type.String(CHECKSUM_OPTIONS)
export type TenantObjectChecksum = Contract<Static<typeof TenantObjectChecksumSchema>>

/** The FUMA-008 storage boundary always requires complete tenant ancestry. */
export const TenantObjectScopeSchema = Type.Object({
  organizationId: Type.String(SCOPE_SEGMENT_OPTIONS),
  workspaceId: Type.String(SCOPE_SEGMENT_OPTIONS),
  siteId: Type.String(SCOPE_SEGMENT_OPTIONS),
}, { additionalProperties: false })
export type TenantObjectScope = Contract<Static<typeof TenantObjectScopeSchema>>

export const TenantObjectMetadataSchema = Type.Object({
  contentId: Type.Optional(Type.String(ID_OPTIONS)),
  revisionId: Type.Optional(Type.String(ID_OPTIONS)),
  formId: Type.Optional(Type.String(ID_OPTIONS)),
  mediaId: Type.Optional(Type.String(ID_OPTIONS)),
  releaseId: Type.Optional(Type.String(ID_OPTIONS)),
  pluginId: Type.Optional(Type.String(ID_OPTIONS)),
  pluginInstallationId: Type.Optional(Type.String(ID_OPTIONS)),
  importId: Type.Optional(Type.String(ID_OPTIONS)),
  exportId: Type.Optional(Type.String(ID_OPTIONS)),
  aiArtifactId: Type.Optional(Type.String(ID_OPTIONS)),
  mcpArtifactId: Type.Optional(Type.String(ID_OPTIONS)),
  fileName: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  variant: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  purpose: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  provenance: Type.Optional(Type.String({ minLength: 1, maxLength: TENANT_OBJECT_METADATA_MAX_STRING_LENGTH })),
}, { additionalProperties: false })
export type TenantObjectMetadata = Contract<Static<typeof TenantObjectMetadataSchema>>

export const TenantObjectInventoryItemSchema = Type.Object({
  objectClass: TenantObjectClassSchema,
  logicalKey: Type.String(LOGICAL_KEY_OPTIONS),
  sizeBytes: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  mimeType: Type.String(MIME_TYPE_OPTIONS),
  contentChecksumSha256: TenantObjectChecksumSchema,
  metadata: TenantObjectMetadataSchema,
}, { additionalProperties: false })
export type TenantObjectInventoryItem = Contract<Static<typeof TenantObjectInventoryItemSchema>>

export const TenantObjectEntrySchema = Type.Object({
  objectClass: TenantObjectClassSchema,
  logicalKey: Type.String(LOGICAL_KEY_OPTIONS),
  sourcePhysicalKey: Type.String(PHYSICAL_KEY_OPTIONS),
  destinationPhysicalKey: Type.String(PHYSICAL_KEY_OPTIONS),
  sizeBytes: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  mimeType: Type.String(MIME_TYPE_OPTIONS),
  contentChecksumSha256: TenantObjectChecksumSchema,
  metadata: TenantObjectMetadataSchema,
  descriptorChecksumSha256: TenantObjectChecksumSchema,
}, { additionalProperties: false })
export type TenantObjectEntry = Contract<Static<typeof TenantObjectEntrySchema>>

export const TenantObjectInventorySchema = Type.Array(TenantObjectInventoryItemSchema, {
  maxItems: TENANT_OBJECT_MANIFEST_MAX_ENTRIES,
})
export type TenantObjectInventory = Contract<Static<typeof TenantObjectInventorySchema>>

export const TenantObjectManifestSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  transferId: TenantObjectIdSchema,
  source: TenantObjectScopeSchema,
  destination: TenantObjectScopeSchema,
  sourcePrefix: Type.String(PHYSICAL_PREFIX_OPTIONS),
  destinationPrefix: Type.String(PHYSICAL_PREFIX_OPTIONS),
  entries: Type.Array(TenantObjectEntrySchema, {
    maxItems: TENANT_OBJECT_MANIFEST_MAX_ENTRIES,
  }),
  entryCount: Type.Integer({ minimum: 0, maximum: TENANT_OBJECT_MANIFEST_MAX_ENTRIES }),
  totalSizeBytes: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  entriesChecksumSha256: TenantObjectChecksumSchema,
  capturedAt: TenantObjectTimestampSchema,
  manifestChecksumSha256: TenantObjectChecksumSchema,
}, { additionalProperties: false })
export type TenantObjectManifest = Contract<Static<typeof TenantObjectManifestSchema>>

export const TENANT_OBJECT_POLICY_ACTIONS = Object.freeze([
  'read',
  'write',
  'list',
  'delete',
] as const)
export const TenantObjectPolicyActionSchema = literalUnion(TENANT_OBJECT_POLICY_ACTIONS)
export type TenantObjectPolicyAction = Contract<Static<typeof TenantObjectPolicyActionSchema>>

export const TenantObjectPolicyBindingSchema = Type.Object({
  principalKind: Type.Union([
    Type.Literal('organization'),
    Type.Literal('workspace'),
    Type.Literal('site'),
    Type.Literal('platform-service'),
  ]),
  principalId: TenantObjectIdSchema,
  actions: Type.Array(TenantObjectPolicyActionSchema, {
    minItems: 1,
    maxItems: TENANT_OBJECT_POLICY_ACTIONS.length,
    uniqueItems: true,
  }),
}, { additionalProperties: false })
export type TenantObjectPolicyBinding = Contract<Static<typeof TenantObjectPolicyBindingSchema>>

export const TenantObjectPolicySnapshotSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  namespace: TenantObjectScopeSchema,
  owner: TenantObjectScopeSchema,
  prefix: Type.String(PHYSICAL_PREFIX_OPTIONS),
  state: Type.Union([Type.Literal('active'), Type.Literal('sealed')]),
  version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  bindings: Type.Array(TenantObjectPolicyBindingSchema, {
    maxItems: TENANT_OBJECT_POLICY_MAX_BINDINGS,
  }),
  capturedAt: TenantObjectTimestampSchema,
  policyChecksumSha256: TenantObjectChecksumSchema,
}, { additionalProperties: false })
export type TenantObjectPolicySnapshot = Contract<Static<typeof TenantObjectPolicySnapshotSchema>>

export const TenantObjectSagaFenceSchema = Type.Object({
  transferId: TenantObjectIdSchema,
  lockId: TenantObjectIdSchema,
  fence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
export type TenantObjectSagaFence = Contract<Static<typeof TenantObjectSagaFenceSchema>>

export const TenantObjectCopyDispositionSchema = Type.Union([
  Type.Literal('copy'),
  Type.Literal('rebind'),
])
export type TenantObjectCopyDisposition = Contract<Static<typeof TenantObjectCopyDispositionSchema>>

const COPY_EVIDENCE_PROPERTIES = {
  transferId: TenantObjectIdSchema,
  lockId: TenantObjectIdSchema,
  fence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  manifestChecksumSha256: TenantObjectChecksumSchema,
  entryDescriptorChecksumSha256: TenantObjectChecksumSchema,
  logicalKey: Type.String(LOGICAL_KEY_OPTIONS),
  sourcePhysicalKey: Type.String(PHYSICAL_KEY_OPTIONS),
  destinationPhysicalKey: Type.String(PHYSICAL_KEY_OPTIONS),
  sizeBytes: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  mimeType: Type.String(MIME_TYPE_OPTIONS),
  contentChecksumSha256: TenantObjectChecksumSchema,
  disposition: TenantObjectCopyDispositionSchema,
} as const

/** Durable before any destination write, so interrupted copies remain attributable. */
export const TenantObjectCopyIntentSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  ...COPY_EVIDENCE_PROPERTIES,
  state: Type.Literal('copying'),
  intendedAt: TenantObjectTimestampSchema,
  intentChecksumSha256: TenantObjectChecksumSchema,
}, { additionalProperties: false })
export type TenantObjectCopyIntent = Contract<Static<typeof TenantObjectCopyIntentSchema>>

export const TenantObjectCopyReceiptSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  ...COPY_EVIDENCE_PROPERTIES,
  copiedAt: TenantObjectTimestampSchema,
  receiptChecksumSha256: TenantObjectChecksumSchema,
}, { additionalProperties: false })
export type TenantObjectCopyReceipt = Contract<Static<typeof TenantObjectCopyReceiptSchema>>

export const TenantObjectCopyProgressReceiptSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  transferId: TenantObjectIdSchema,
  lockId: TenantObjectIdSchema,
  fence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  manifestChecksumSha256: TenantObjectChecksumSchema,
  completed: Type.Array(TenantObjectCopyReceiptSchema, {
    maxItems: TENANT_OBJECT_MANIFEST_MAX_ENTRIES,
  }),
  completedCount: Type.Integer({ minimum: 0, maximum: TENANT_OBJECT_MANIFEST_MAX_ENTRIES }),
  completedSizeBytes: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  updatedAt: TenantObjectTimestampSchema,
  receiptChecksumSha256: TenantObjectChecksumSchema,
}, { additionalProperties: false })
export type TenantObjectCopyProgressReceipt = Contract<Static<typeof TenantObjectCopyProgressReceiptSchema>>

export const TenantObjectRebindReceiptSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  transferId: TenantObjectIdSchema,
  lockId: TenantObjectIdSchema,
  fence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  manifestChecksumSha256: TenantObjectChecksumSchema,
  copyProgressReceiptChecksumSha256: TenantObjectChecksumSchema,
  sourceBefore: TenantObjectPolicySnapshotSchema,
  destinationBefore: TenantObjectPolicySnapshotSchema,
  sourceAfter: TenantObjectPolicySnapshotSchema,
  destinationAfter: TenantObjectPolicySnapshotSchema,
  reboundAt: TenantObjectTimestampSchema,
  receiptChecksumSha256: TenantObjectChecksumSchema,
}, { additionalProperties: false })
export type TenantObjectRebindReceipt = Contract<Static<typeof TenantObjectRebindReceiptSchema>>

export const TenantObjectDeleteReceiptSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  transferId: TenantObjectIdSchema,
  lockId: TenantObjectIdSchema,
  fence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  manifestChecksumSha256: TenantObjectChecksumSchema,
  entryDescriptorChecksumSha256: TenantObjectChecksumSchema,
  logicalKey: Type.String(LOGICAL_KEY_OPTIONS),
  destinationPhysicalKey: Type.String(PHYSICAL_KEY_OPTIONS),
  outcome: Type.Union([Type.Literal('deleted'), Type.Literal('already-absent')]),
  deletedAt: TenantObjectTimestampSchema,
  receiptChecksumSha256: TenantObjectChecksumSchema,
}, { additionalProperties: false })
export type TenantObjectDeleteReceipt = Contract<Static<typeof TenantObjectDeleteReceiptSchema>>

export const TenantObjectCompensationCheckpointSchema = Type.Object({
  intent: TenantObjectCopyIntentSchema,
  receipt: Type.Union([TenantObjectCopyReceiptSchema, Type.Null()]),
}, { additionalProperties: false })
export type TenantObjectCompensationCheckpoint = Contract<
  Static<typeof TenantObjectCompensationCheckpointSchema>
>

/**
 * Self-contained rollback evidence. A failed copy can be compensated before a
 * complete progress receipt or policy rebind exists, so both the complete-copy
 * checksum and each per-object receipt are intentionally nullable.
 */
export const TenantObjectCompensationReceiptSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  transferId: TenantObjectIdSchema,
  lockId: TenantObjectIdSchema,
  fence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  manifestChecksumSha256: TenantObjectChecksumSchema,
  copyProgressReceiptChecksumSha256: Type.Union([
    TenantObjectChecksumSchema,
    Type.Null(),
  ]),
  checkpoints: Type.Array(TenantObjectCompensationCheckpointSchema, {
    maxItems: TENANT_OBJECT_MANIFEST_MAX_ENTRIES,
  }),
  revertedCopies: Type.Array(TenantObjectDeleteReceiptSchema, {
    maxItems: TENANT_OBJECT_MANIFEST_MAX_ENTRIES,
  }),
  compensatedAt: TenantObjectTimestampSchema,
  receiptChecksumSha256: TenantObjectChecksumSchema,
}, { additionalProperties: false })
export type TenantObjectCompensationReceipt = Contract<Static<typeof TenantObjectCompensationReceiptSchema>>

export const TenantObjectContractErrorCodeSchema = Type.Union([
  Type.Literal('invalid-contract'),
  Type.Literal('invalid-scope'),
  Type.Literal('same-owner'),
  Type.Literal('site-identity-mismatch'),
  Type.Literal('unknown-object-class'),
  Type.Literal('class-key-mismatch'),
  Type.Literal('duplicate-key'),
  Type.Literal('prefix-substitution'),
  Type.Literal('ordering-drift'),
  Type.Literal('object-drift'),
  Type.Literal('aggregate-drift'),
  Type.Literal('secret-metadata'),
  Type.Literal('cross-tenant-collision'),
  Type.Literal('receipt-drift'),
  Type.Literal('policy-drift'),
])
export type TenantObjectContractErrorCode = Contract<Static<typeof TenantObjectContractErrorCodeSchema>>

export class TenantObjectContractError extends Error {
  readonly code: TenantObjectContractErrorCode
  readonly path: string

  constructor(code: TenantObjectContractErrorCode, message: string, path: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'TenantObjectContractError'
    this.code = code
    this.path = path
  }
}

export function assertTenantObjectSchema<T extends TSchema>(
  schema: T,
  value: unknown,
  path: string,
): asserts value is Static<T> {
  if (Value.Check(schema, value)) return
  const error = Value.Errors(schema, value).First()
  throw new TenantObjectContractError(
    'invalid-contract',
    `${path} does not match its TypeBox contract${error ? `: ${error.path || '/'} ${error.message}` : ''}.`,
    path,
  )
}
