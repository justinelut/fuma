import {
  ApiError,
  responseErrorMessage,
  type FetchLike,
} from '@core/http'
import { SavedLayoutSchema } from '@core/layouts'
import { PageSchema, SiteShellSchema } from '@core/page-tree'
import { parseJsonResponse } from '@core/utils/jsonValidate'
import { Type, type Static } from '@core/utils/typeboxHelpers'
import { VisualComponentSchema } from '@core/visualComponents'
import {
  EditorSessionConflictError,
  createEditorSessionTarget,
  type BoundEditorSessionAdapter,
  type EditorSessionSaveCommand,
  type EditorSessionTarget,
} from './contracts'

const SequenceSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const MutationIdSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
})

const HostedEditorDocumentSchema = Type.Object({
  site: SiteShellSchema,
  pages: Type.Array(PageSchema),
  visualComponents: Type.Array(VisualComponentSchema),
  layouts: Type.Array(SavedLayoutSchema),
}, { additionalProperties: false })

type HostedEditorDocument = Static<typeof HostedEditorDocumentSchema>

const HostedEditorDraftSnapshotSchema = Type.Object({
  document: Type.Union([HostedEditorDocumentSchema, Type.Null()]),
  sequence: SequenceSchema,
}, { additionalProperties: false })

const HostedEditorDraftAcceptedSchema = Type.Object({
  outcome: Type.Literal('accepted'),
  mutationId: MutationIdSchema,
  expectedSequence: SequenceSchema,
  sequence: SequenceSchema,
  replayed: Type.Boolean(),
  document: HostedEditorDocumentSchema,
}, { additionalProperties: false })

const HostedEditorDraftConflictSchema = Type.Object({
  outcome: Type.Literal('conflict'),
  code: Type.Union([
    Type.Literal('draft-sequence-conflict'),
    Type.Literal('mutation-id-reused'),
  ]),
  mutationId: MutationIdSchema,
  expectedSequence: SequenceSchema,
  authoritativeSequence: SequenceSchema,
  document: Type.Union([HostedEditorDocumentSchema, Type.Null()]),
}, { additionalProperties: false })

function documentPath(target: EditorSessionTarget): string {
  const organization = encodeURIComponent(target.organizationId)
  const workspace = encodeURIComponent(target.workspaceId)
  const site = encodeURIComponent(target.siteId)
  return `/api/fuma/organizations/${organization}/workspaces/${workspace}/sites/${site}/editor/document`
}

function incrementalOperation(document: HostedEditorDocument) {
  return {
    kind: 'incremental-save' as const,
    save: {
      site: document.site,
      changedPages: document.pages,
      deletedPageIds: [],
      changedComponents: document.visualComponents,
      deletedComponentIds: [],
      changedLayouts: document.layouts,
      deletedLayoutIds: [],
    },
  }
}

/** Bind hosted editor persistence to one validated, immutable ancestry/profile tuple. */
export function createFumaEditorScopedHttpAdapter(
  target: EditorSessionTarget,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): BoundEditorSessionAdapter<HostedEditorDocument> {
  const boundTarget = createEditorSessionTarget(target)
  const path = documentPath(boundTarget)

  return Object.freeze({
    async load() {
      const response = await fetchImpl(path, {
        method: 'GET',
        credentials: 'include',
      })
      if (!response.ok) {
        throw new ApiError(
          await responseErrorMessage(response, 'Hosted editor document load failed'),
          response.status,
        )
      }
      return await parseJsonResponse(response, HostedEditorDraftSnapshotSchema)
    },
    async save(command: EditorSessionSaveCommand<HostedEditorDocument>) {
      const response = await fetchImpl(path, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mutationId: command.mutationId,
          expectedSequence: command.expectedSequence,
          operations: [incrementalOperation(command.document)],
        }),
      })
      if (response.status === 409) {
        const conflict = await parseJsonResponse(response, HostedEditorDraftConflictSchema)
        throw new EditorSessionConflictError({
          code: conflict.code,
          mutationId: conflict.mutationId,
          expectedSequence: conflict.expectedSequence,
          authoritativeSequence: conflict.authoritativeSequence,
          authoritativeDocument: conflict.document,
        })
      }
      if (!response.ok) {
        throw new ApiError(
          await responseErrorMessage(response, 'Hosted editor document save failed'),
          response.status,
        )
      }
      return await parseJsonResponse(response, HostedEditorDraftAcceptedSchema)
    },
  })
}
