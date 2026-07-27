import {
  Type,
  safeParseValue,
  type TSchema,
} from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import type {
  FumaRequestContext,
  FumaScopedRouteDeclaration,
  FumaScopedRouteHandlerInput,
} from '../context'
import type { FumaRepositoryScope } from '../tenancy'
import {
  EditorDraftAcceptedSchema,
  EditorDraftConflictSchema,
  EditorDraftMutationSchema,
  EditorDraftSnapshotSchema,
  EditorScopedRepositoryError,
  EditorSiteSessionIdentitySchema,
  type EditorSiteSessionIdentity,
} from './contracts'
import type { BoundEditorScopedRepository } from './repository'
import type { EditorSessionAuthorityPort } from './sessionAuthority'

const EditorRouteErrorEnvelopeSchema = Type.Object({
  error: Type.String({ minLength: 1 }),
}, { additionalProperties: false })

export interface EditorScopedRepositoryPort {
  forScope(identity: EditorSiteSessionIdentity): BoundEditorScopedRepository
}

export type EditorScopedRoutePorts = Readonly<{
  repository: EditorScopedRepositoryPort
  sessions: EditorSessionAuthorityPort
}>

function jsonResponse<T extends TSchema>(
  schema: T,
  candidate: unknown,
  status = 200,
): Response {
  const parsed = safeParseValue(schema, candidate)
  if (!parsed.ok) {
    throw new Error('Scoped editor route produced an invalid response envelope.')
  }
  return new Response(JSON.stringify(parsed.value), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  })
}

function errorResponse(error: string, status: number): Response {
  return jsonResponse(EditorRouteErrorEnvelopeSchema, { error }, status)
}

function sameTrustedScope(
  context: FumaRequestContext,
  repositoryScope: FumaRepositoryScope,
): boolean {
  return context.scope.platform.id === repositoryScope.platformId
    && context.scope.organization.id === repositoryScope.organizationId
    && context.scope.workspace.id === repositoryScope.workspaceId
    && context.scope.site.id === repositoryScope.siteId
    && context.scope.site.profileId === context.profile.id
}

async function bindRepository(
  ports: EditorScopedRoutePorts,
  handlerInput: FumaScopedRouteHandlerInput,
): Promise<BoundEditorScopedRepository> {
  const { context, repositoryScope } = handlerInput
  if (!sameTrustedScope(context, repositoryScope)) {
    throw new EditorScopedRepositoryError(
      'denied',
      'Editor repository scope authority denied.',
    )
  }

  const editorSessionId = await ports.sessions.resolveEditorSessionKey(Object.freeze({
    context,
    repositoryScope,
  }))
  const identity = safeParseValue(EditorSiteSessionIdentitySchema, {
    ...repositoryScope,
    profileId: context.profile.id,
    editorSessionId,
  })
  if (!identity.ok) {
    throw new EditorScopedRepositoryError(
      'invalid-session',
      'Editor session authority returned an invalid session key.',
    )
  }

  return ports.repository.forScope(Object.freeze(identity.value))
}

function routeFailure(error: unknown): Response {
  if (error instanceof EditorScopedRepositoryError) {
    if (error.code === 'denied') return errorResponse('Resource not found.', 404)
    if (error.code === 'invalid-input') return errorResponse(error.message, 400)
  }
  console.error('[fuma-editor] scoped route failed:', error)
  return errorResponse('Internal server error.', 500)
}

async function loadDocument(
  ports: EditorScopedRoutePorts,
  handlerInput: FumaScopedRouteHandlerInput,
): Promise<Response> {
  try {
    const repository = await bindRepository(ports, handlerInput)
    return jsonResponse(EditorDraftSnapshotSchema, await repository.loadDraft())
  } catch (error) {
    return routeFailure(error)
  }
}

async function saveDocument(
  ports: EditorScopedRoutePorts,
  handlerInput: FumaScopedRouteHandlerInput,
): Promise<Response> {
  try {
    const body = await readValidatedBody(
      handlerInput.request,
      EditorDraftMutationSchema,
    )
    if (body === null) return errorResponse('Request body is invalid.', 400)

    const repository = await bindRepository(ports, handlerInput)
    const result = await repository.mutateDraft(body)
    return result.outcome === 'accepted'
      ? jsonResponse(EditorDraftAcceptedSchema, result)
      : jsonResponse(EditorDraftConflictSchema, result, 409)
  } catch (error) {
    return routeFailure(error)
  }
}

/**
 * Hosted editor descendants for the FUMA scoped HTTP boundary. This factory
 * declares routes only; the central Studio router remains intentionally
 * untouched until the hosted composition root owns mounting.
 */
export function createEditorScopedRouteDeclarations(
  ports: EditorScopedRoutePorts,
): readonly FumaScopedRouteDeclaration[] {
  return Object.freeze([
    Object.freeze({
      method: 'GET' as const,
      path: '/editor/document' as const,
      permission: 'content.pages.read' as const,
      handler: (handlerInput: FumaScopedRouteHandlerInput) => (
        loadDocument(ports, handlerInput)
      ),
    }),
    Object.freeze({
      method: 'PUT' as const,
      path: '/editor/document' as const,
      permission: 'content.pages.write' as const,
      handler: (handlerInput: FumaScopedRouteHandlerInput) => (
        saveDocument(ports, handlerInput)
      ),
    }),
  ])
}
