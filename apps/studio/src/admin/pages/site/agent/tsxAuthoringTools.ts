/**
 * Executor handlers for the TSX authoring tools.
 *
 * The bridge between a tool call and the module workspace. It exists as its own file
 * rather than inside `executor.ts` because that file still implements the HTML tools
 * against the old module+props document, and the two models should not be tangled
 * while both exist.
 *
 * The workspace arrives as a parameter rather than being reached for globally, so the
 * same handlers serve the hosted editor, a build sandbox and the tests without any of
 * them needing a different code path — and so no handler can accidentally write to
 * the wrong site's workspace.
 */

import { aiToolError, aiToolOk, type AiToolOutput } from '@core/ai'
import {
  runAuthorModule,
  runEditModule,
  runListModules,
  runReadModule,
} from '@core/ai/authoringTools'
import type {
  AuthorModuleToolInput,
  EditModuleToolInput,
  ReadModuleToolInput,
} from '@core/ai/toolSchemas'
import type { ModuleWorkspace } from '@core/react-ir/workspace'
import type { AuthoringToolOutput } from '@core/ai/authoringTools'

/**
 * The workspace the authoring tools write to.
 *
 * Registered once by whatever composes the editor, following the same pattern as the
 * store reference: the executor cannot import the workspace's construction directly
 * without a cycle, and a global getter that throws when unset fails loudly at
 * startup rather than writing to the wrong place.
 */
let registered: ModuleWorkspace | null = null

export function setAgentModuleWorkspace(workspace: ModuleWorkspace | null): void {
  registered = workspace
}

export function getAgentModuleWorkspace(): ModuleWorkspace {
  if (!registered) {
    throw new Error(
      '[agent] No module workspace is registered, so TSX authoring cannot write. '
      + 'Call setAgentModuleWorkspace() with a workspace bound to the active site scope '
      + 'before invoking the agent.',
    )
  }
  return registered
}

/** Tool names the TSX authoring surface answers to. */
export const TSX_AUTHORING_TOOLS = new Set([
  'site_author_module',
  'site_edit_module',
  'site_read_module',
  'site_list_modules',
])

/**
 * Convert an authoring result into a tool result.
 *
 * A refusal becomes an error carrying the diagnostics, because a model that is told
 * only "failed" will retry the same thing, while one told which line and which rule
 * can correct itself.
 */
function toToolOutput(result: AuthoringToolOutput): AiToolOutput {
  if (!result.ok) return aiToolError(result.summary)
  return aiToolOk({
    summary: result.summary,
    ...(result.path === undefined ? {} : { path: result.path }),
    ...(result.hash === undefined ? {} : { hash: result.hash }),
    ...(result.nodeIds === undefined ? {} : { nodeIds: result.nodeIds }),
    ...(result.source === undefined ? {} : { source: result.source }),
    ...(result.offTheme === undefined ? {} : { offTheme: result.offTheme }),
    // Task 74's composition advice. Without this line the review runs, records its note, and
    // nothing ever reaches the model - which is indistinguishable from not having the review.
    ...(result.notes === undefined ? {} : { notes: result.notes }),
  })
}

export async function executeAuthorModule(
  workspace: ModuleWorkspace,
  input: AuthorModuleToolInput,
): Promise<AiToolOutput> {
  return toToolOutput(await runAuthorModule(workspace, input))
}

export async function executeEditModule(
  workspace: ModuleWorkspace,
  input: EditModuleToolInput,
): Promise<AiToolOutput> {
  return toToolOutput(await runEditModule(workspace, input))
}

export async function executeReadModule(
  workspace: ModuleWorkspace,
  input: ReadModuleToolInput,
): Promise<AiToolOutput> {
  return toToolOutput(await runReadModule(workspace, input))
}

export async function executeListModules(
  workspace: ModuleWorkspace,
): Promise<AiToolOutput> {
  return toToolOutput(await runListModules(workspace))
}
