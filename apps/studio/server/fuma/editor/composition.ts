import {
  createFumaScopedRouteBoundary,
  type FumaScopedRouteBoundary,
  type FumaScopedRouteBoundaryDependencies,
} from '../context'
import { EditorScopedRepository } from './repository'
import {
  createEditorScopedRouteDeclarations,
} from './routes'
import type { EditorSessionAuthorityPort } from './sessionAuthority'
import type { EditorScopedStorage } from './storage'

export type FumaEditorScopedApiCompositionInput = Readonly<{
  boundary: FumaScopedRouteBoundaryDependencies
  storage: EditorScopedStorage
  sessions: EditorSessionAuthorityPort
}>

/**
 * Production composition for hosted editor routes. All request, permission,
 * owner-key, storage, and editor-session authority is supplied by the caller;
 * this helper only wires those authorities to the scoped editor declarations.
 */
export function createFumaEditorScopedApiBoundary(
  input: FumaEditorScopedApiCompositionInput,
): FumaScopedRouteBoundary {
  const repository = new EditorScopedRepository(input.storage)
  return createFumaScopedRouteBoundary({
    ...input.boundary,
    routes: createEditorScopedRouteDeclarations({
      repository,
      sessions: input.sessions,
    }),
  })
}
