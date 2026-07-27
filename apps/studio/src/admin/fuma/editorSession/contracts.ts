import { Type, Value, type Static } from '@core/utils/typeboxHelpers'

const TARGET_ID_OPTIONS = { minLength: 1, maxLength: 255 } as const
const TargetIdSchema = Type.String(TARGET_ID_OPTIONS)

/** Complete hosted authority for one editor session. Lower-scope IDs are not globally unique. */
export const EditorSessionTargetSchema = Type.Readonly(Type.Object({
  organizationId: TargetIdSchema,
  workspaceId: TargetIdSchema,
  siteId: TargetIdSchema,
  profileId: TargetIdSchema,
}, { additionalProperties: false }))
export type EditorSessionTarget = Static<typeof EditorSessionTargetSchema>

export type EditorSessionLoadState = 'idle' | 'loading' | 'ready' | 'error'
export type EditorSessionSaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error'
export type EditorSessionImportState = 'idle' | 'running' | 'succeeded' | 'error'

export type EditorSessionConflict<TDocument> = Readonly<{
  code: 'draft-sequence-conflict' | 'mutation-id-reused'
  mutationId: string
  expectedSequence: number
  authoritativeSequence: number
  authoritativeDocument: TDocument | null
}>

export type EditorSessionSnapshot<TDocument> = Readonly<{
  kind: 'active'
  target: EditorSessionTarget
  document: TDocument | null
  loadState: EditorSessionLoadState
  saveState: EditorSessionSaveState
  importState: EditorSessionImportState
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  undoDepth: number
  redoDepth: number
  revision: number
  sequence: number
  conflict?: EditorSessionConflict<TDocument>
  errorMessage?: string
}>

export type EmptyEditorSessionSnapshot = Readonly<{
  kind: 'empty'
}>

export type EditorSessionCoordinatorSnapshot<TDocument> =
  | EmptyEditorSessionSnapshot
  | EditorSessionSnapshot<TDocument>

export type EditorSessionVersionedDocument<TDocument> = Readonly<{
  document: TDocument | null
  sequence: number
}>

export type EditorSessionSaveCommand<TDocument> = Readonly<{
  document: TDocument
  expectedSequence: number
  mutationId: string
}>

export type EditorSessionSaveAccepted<TDocument> = Readonly<{
  outcome: 'accepted'
  mutationId: string
  expectedSequence: number
  sequence: number
  replayed: boolean
  document: TDocument
}>

export class EditorSessionConflictError<TDocument> extends Error {
  readonly conflict: EditorSessionConflict<TDocument>

  constructor(conflict: EditorSessionConflict<TDocument>) {
    super(`Editor draft conflict at sequence ${conflict.authoritativeSequence}.`)
    this.name = 'EditorSessionConflictError'
    this.conflict = conflict
  }
}

/** Persistence is bound to one complete target and carries no replaceable authority. */
export interface BoundEditorSessionAdapter<TDocument> {
  load(): Promise<EditorSessionVersionedDocument<TDocument>>
  save(command: EditorSessionSaveCommand<TDocument>): Promise<EditorSessionSaveAccepted<TDocument>>
}

export type EditorSessionAdapterBinder<TDocument> = (
  target: EditorSessionTarget,
) => BoundEditorSessionAdapter<TDocument>

export type EditorSessionImport<TDocument> = (
  document: TDocument,
  target: EditorSessionTarget,
) => Promise<TDocument>

export type EditorSessionSubscriber<TDocument> = (
  snapshot: EditorSessionCoordinatorSnapshot<TDocument>,
) => void

export type EditorSessionCoordinatorOptions<TDocument> = Readonly<{
  bindAdapter: EditorSessionAdapterBinder<TDocument>
  cloneDocument?: (document: TDocument) => TDocument
  generateMutationId?: () => string
}>

export const EditorSessionCoordinatorErrorCodeSchema = Type.Union([
  Type.Literal('invalid-target'),
  Type.Literal('invalid-adapter'),
  Type.Literal('no-active-target'),
  Type.Literal('document-unavailable'),
])
export type EditorSessionCoordinatorErrorCode = Static<
  typeof EditorSessionCoordinatorErrorCodeSchema
>

export class EditorSessionCoordinatorError extends Error {
  readonly code: EditorSessionCoordinatorErrorCode

  constructor(code: EditorSessionCoordinatorErrorCode, message: string) {
    super(message)
    this.name = 'EditorSessionCoordinatorError'
    this.code = code
  }
}

function freezeTarget(target: EditorSessionTarget): EditorSessionTarget {
  return Object.freeze(target)
}

/** Validates, copies, and freezes authority before it reaches an adapter. */
export function createEditorSessionTarget(value: unknown): EditorSessionTarget {
  if (!Value.Check(EditorSessionTargetSchema, value)) {
    throw new EditorSessionCoordinatorError(
      'invalid-target',
      'editor session target must contain a complete organization/workspace/site chain',
    )
  }

  return freezeTarget({
    organizationId: value.organizationId,
    workspaceId: value.workspaceId,
    siteId: value.siteId,
    profileId: value.profileId,
  })
}
