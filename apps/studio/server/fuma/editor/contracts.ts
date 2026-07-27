import { FumaActiveProfileSchema, FumaContextIdSchema } from '../context'
import { FumaRepositoryScopeSchema } from '../tenancy'
import { SavedLayoutSchema } from '@core/layouts'
import { PageSchema, SiteShellSchema } from '@core/page-tree'
import { Type, type Static } from '@core/utils/typeboxHelpers'
import { VisualComponentSchema } from '@core/visualComponents'

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

type Contract<T> = DeepReadonly<T>

const activeScopeProperties = FumaRepositoryScopeSchema.anyOf[0].properties
const LOGICAL_ID_OPTIONS = { minLength: 1, maxLength: 255 } as const

export const EditorLogicalIdSchema = Type.String(LOGICAL_ID_OPTIONS)
export type EditorLogicalId = Static<typeof EditorLogicalIdSchema>

/**
 * Complete identity of one loaded hosted editor session. It is intentionally
 * broader than a site ID: profile and browser editor session stay attached to
 * the exact owner-key generation selected by server authority.
 */
export const EditorSiteSessionIdentitySchema = Type.Object({
  platformId: activeScopeProperties.platformId,
  organizationId: activeScopeProperties.organizationId,
  workspaceId: activeScopeProperties.workspaceId,
  siteId: activeScopeProperties.siteId,
  ownerKey: activeScopeProperties.ownerKey,
  generation: activeScopeProperties.generation,
  state: Type.Literal('active'),
  transferFence: Type.Null(),
  profileId: FumaActiveProfileSchema.properties.id,
  editorSessionId: FumaContextIdSchema,
}, { additionalProperties: false })
export type EditorSiteSessionIdentity = Contract<
  Static<typeof EditorSiteSessionIdentitySchema>
>

export const EditorResourceKindSchema = Type.Union([
  Type.Literal('site-shell'),
  Type.Literal('page'),
  Type.Literal('component'),
  Type.Literal('layout'),
])
export type EditorResourceKind = Static<typeof EditorResourceKindSchema>

/**
 * A durable address. Resource kind is part of identity so a page, component,
 * and layout may deliberately preserve the same logical ID.
 */
export const EditorScopedStorageKeySchema = Type.Object({
  platformId: activeScopeProperties.platformId,
  ownerKey: activeScopeProperties.ownerKey,
  generation: activeScopeProperties.generation,
  resourceKind: EditorResourceKindSchema,
  logicalId: EditorLogicalIdSchema,
}, { additionalProperties: false })
export type EditorScopedStorageKey = Contract<
  Static<typeof EditorScopedStorageKeySchema>
>

export const EditorScopedStoragePrefixSchema = Type.Object({
  platformId: activeScopeProperties.platformId,
  ownerKey: activeScopeProperties.ownerKey,
  generation: activeScopeProperties.generation,
  resourceKind: EditorResourceKindSchema,
}, { additionalProperties: false })
export type EditorScopedStoragePrefix = Contract<
  Static<typeof EditorScopedStoragePrefixSchema>
>

export const EditorScopedStorageEntrySchema = Type.Object({
  key: EditorScopedStorageKeySchema,
  value: Type.Unknown(),
}, { additionalProperties: false })
export type EditorScopedStorageEntry = Contract<
  Static<typeof EditorScopedStorageEntrySchema>
>

export const EditorSiteDocumentSchema = Type.Object({
  site: SiteShellSchema,
  pages: Type.Array(PageSchema),
  visualComponents: Type.Array(VisualComponentSchema),
  layouts: Type.Array(SavedLayoutSchema),
}, { additionalProperties: false })
export type EditorSiteDocument = Contract<Static<typeof EditorSiteDocumentSchema>>

export const EditorIncrementalSaveSchema = Type.Object({
  site: SiteShellSchema,
  changedPages: Type.Array(PageSchema),
  deletedPageIds: Type.Array(EditorLogicalIdSchema, { uniqueItems: true }),
  changedComponents: Type.Array(VisualComponentSchema),
  deletedComponentIds: Type.Array(EditorLogicalIdSchema, { uniqueItems: true }),
  changedLayouts: Type.Array(SavedLayoutSchema),
  deletedLayoutIds: Type.Array(EditorLogicalIdSchema, { uniqueItems: true }),
}, { additionalProperties: false })
export type EditorIncrementalSave = Contract<
  Static<typeof EditorIncrementalSaveSchema>
>

const EDITOR_SEQUENCE_OPTIONS = {
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
} as const
const EDITOR_MUTATION_ID_OPTIONS = {
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
} as const

/** Server-owned monotonic sequence for one profile-qualified site document stream. */
export const EditorDraftSequenceSchema = Type.Integer(EDITOR_SEQUENCE_OPTIONS)
export type EditorDraftSequence = Static<typeof EditorDraftSequenceSchema>

export const EditorMutationIdSchema = Type.String(EDITOR_MUTATION_ID_OPTIONS)
export type EditorMutationId = Static<typeof EditorMutationIdSchema>

export const EditorDraftStreamKeySchema = Type.Object({
  platformId: activeScopeProperties.platformId,
  ownerKey: activeScopeProperties.ownerKey,
  generation: activeScopeProperties.generation,
  profileId: FumaActiveProfileSchema.properties.id,
  resourceKind: Type.Literal('site-document'),
  logicalId: EditorLogicalIdSchema,
}, { additionalProperties: false })
export type EditorDraftStreamKey = Contract<Static<typeof EditorDraftStreamKeySchema>>

export const EditorDraftOperationSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('incremental-save'),
    save: EditorIncrementalSaveSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('replace-document'),
    document: EditorSiteDocumentSchema,
  }, { additionalProperties: false }),
])
export type EditorDraftOperation = Contract<Static<typeof EditorDraftOperationSchema>>

/** One compare-and-swap command. Every operation commits or all roll back. */
export const EditorDraftMutationSchema = Type.Object({
  mutationId: EditorMutationIdSchema,
  expectedSequence: EditorDraftSequenceSchema,
  operations: Type.Array(EditorDraftOperationSchema, { minItems: 1, maxItems: 64 }),
}, { additionalProperties: false })
export type EditorDraftMutation = Contract<Static<typeof EditorDraftMutationSchema>>

export const EditorDraftSnapshotSchema = Type.Object({
  document: Type.Union([EditorSiteDocumentSchema, Type.Null()]),
  sequence: EditorDraftSequenceSchema,
}, { additionalProperties: false })
export type EditorDraftSnapshot = Contract<Static<typeof EditorDraftSnapshotSchema>>

export const EditorDraftAcceptedSchema = Type.Object({
  outcome: Type.Literal('accepted'),
  mutationId: EditorMutationIdSchema,
  expectedSequence: EditorDraftSequenceSchema,
  sequence: EditorDraftSequenceSchema,
  replayed: Type.Boolean(),
  document: EditorSiteDocumentSchema,
}, { additionalProperties: false })
export type EditorDraftAccepted = Contract<Static<typeof EditorDraftAcceptedSchema>>

export const EditorDraftConflictCodeSchema = Type.Union([
  Type.Literal('draft-sequence-conflict'),
  Type.Literal('mutation-id-reused'),
])
export type EditorDraftConflictCode = Static<typeof EditorDraftConflictCodeSchema>

export const EditorDraftConflictSchema = Type.Object({
  outcome: Type.Literal('conflict'),
  code: EditorDraftConflictCodeSchema,
  mutationId: EditorMutationIdSchema,
  expectedSequence: EditorDraftSequenceSchema,
  authoritativeSequence: EditorDraftSequenceSchema,
  document: Type.Union([EditorSiteDocumentSchema, Type.Null()]),
}, { additionalProperties: false })
export type EditorDraftConflict = Contract<Static<typeof EditorDraftConflictSchema>>

export const EditorDraftMutationResultSchema = Type.Union([
  EditorDraftAcceptedSchema,
  EditorDraftConflictSchema,
])
export type EditorDraftMutationResult = Contract<Static<typeof EditorDraftMutationResultSchema>>

export const EditorDraftMutationReceiptSchema = Type.Object({
  requestHash: Type.String({ minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' }),
  expectedSequence: EditorDraftSequenceSchema,
  acceptedSequence: EditorDraftSequenceSchema,
  document: EditorSiteDocumentSchema,
}, { additionalProperties: false })
export type EditorDraftMutationReceipt = Contract<
  Static<typeof EditorDraftMutationReceiptSchema>
>

export const EditorScopedRepositoryErrorCodeSchema = Type.Union([
  Type.Literal('denied'),
  Type.Literal('invalid-session'),
  Type.Literal('invalid-input'),
  Type.Literal('invalid-storage'),
  Type.Literal('sequence-exhausted'),
])
export type EditorScopedRepositoryErrorCode = Static<
  typeof EditorScopedRepositoryErrorCodeSchema
>

export class EditorScopedRepositoryError extends Error {
  readonly code: EditorScopedRepositoryErrorCode

  constructor(code: EditorScopedRepositoryErrorCode, message: string) {
    super(message)
    this.name = 'EditorScopedRepositoryError'
    this.code = code
  }
}
