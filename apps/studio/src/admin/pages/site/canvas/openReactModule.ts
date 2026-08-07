/**
 * Opens a React IR module on the canvas.
 *
 * THE ONE PLACE that joins the three things which must agree: the HTTP-backed workspace the editor
 * store reads through, the editor store's open module, and the canvas document the shell renders.
 * Doing it at each call site would let them drift — and the drift is invisible, because a canvas
 * showing module B while the document says A looks completely normal while every edit lands in a file
 * the author did not open.
 */
import { ModuleWorkspace } from '@core/react-ir/workspace'
import { savedBlockSource } from '@core/react-ir/savedBlockModule'
import type { BlockDefinition } from '@core/react-ir/blockLibrary'
import { useReactEditorStore } from '@site/canvas/reactEditorStore'
import { createHttpModuleStore } from '@site/canvas/httpModuleStore'
import type { ActiveDocument } from '@site/store/slices/uiSlice'

/**
 * Built ONCE per session rather than per open.
 *
 * The HTTP store remembers the hash it last read for each path, and that memory is what lets the
 * server refuse a conflicting write. A fresh store per open would forget it, so every save would
 * carry a null base and the second session to save would silently overwrite the first.
 */
let sessionWorkspace: ModuleWorkspace | null = null

export function moduleWorkspaceForSession(): ModuleWorkspace {
  sessionWorkspace ??= new ModuleWorkspace(createHttpModuleStore())
  return sessionWorkspace
}

/** Test seam: replaces the session workspace so a suite can drive it without a network. */
export function setModuleWorkspaceForSession(workspace: ModuleWorkspace | null): void {
  sessionWorkspace = workspace
}

export type OpenModuleOutcome =
  | { ok: true }
  /** The reason is carried so a caller can SHOW it; a swallowed failure reads as a dead control. */
  | { ok: false; reason: string }

/**
 * Attaches the workspace, opens the module, and only THEN switches the canvas document.
 *
 * The order is the design. Switching the document first would render the React canvas against
 * whatever module the store still held — the previous one, or none — so a failed open would leave the
 * author looking at the wrong file with no indication anything went wrong. Switching last means a
 * failure leaves them exactly where they were.
 */
export async function openReactModule(
  path: string,
  setActiveDocument: (doc: ActiveDocument | null) => void,
): Promise<OpenModuleOutcome> {
  const store = useReactEditorStore.getState()
  store.attachWorkspace(moduleWorkspaceForSession())
  try {
    await store.open(path)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : `Could not open ${path}.` }
  }
  // The store reports a module it could not read as problems with no open editor, so an empty editor
  // is a REFUSAL rather than a success with nothing in it.
  const opened = useReactEditorStore.getState().editor
  if (opened === null) {
    const problems = useReactEditorStore.getState().problems
    return {
      ok: false,
      reason: problems.length > 0
        ? `${path} could not be opened: ${problems.map((problem) => problem.message).join('; ')}`
        : `${path} could not be opened.`,
    }
  }
  setActiveDocument({ kind: 'reactModule', path })
  return { ok: true }
}

/**
 * Persists a saved block as a real component module.
 *
 * Uses the SAME session workspace the canvas reads through, so the write goes through the same
 * validation a hand edit does — a saved block cannot enter the tenant's source by a weaker path than
 * the one an author's own typing takes.
 */
export async function persistSavedBlock(
  block: BlockDefinition,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const generated = savedBlockSource(block)
  if (!generated.ok) return { ok: false, reason: generated.reason }

  const workspace = moduleWorkspaceForSession()
  try {
    // MEASURED CONSTRAINT: WriteOptions.baseHash is `string | undefined` and an OMITTED base means no
    // conflict check at all - so writing straight away would silently overwrite a block saved earlier
    // under the same name. There is no "must not exist" mode, so existence is checked explicitly.
    const existing = await workspace.read(generated.file.path)
    if (existing !== null) {
      return {
        ok: false,
        reason: `${generated.file.path} already exists. Choose a different name so an earlier block is not replaced.`,
      }
    }
    const result = await workspace.write(generated.file.path, generated.file.source)
    if (!result.written) {
      return {
        ok: false,
        reason: result.problems.length > 0
          ? result.problems.map((problem) => problem.message).join(' ')
          : `Could not save ${generated.file.path}.`,
      }
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : `Could not save ${generated.file.path}.`,
    }
  }
  return { ok: true, path: generated.file.path }
}
