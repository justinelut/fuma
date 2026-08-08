/**
 * Canvas editing state.
 *
 * The layer between a pointer gesture and the module workspace. Deliberately
 * framework-agnostic: it is a plain state machine, so it can be tested without
 * rendering anything and the Zustand binding on top stays thin. That matters because
 * the interesting behaviour here — what undo restores, when a selection becomes
 * invalid, whether a save is safe — is exactly the part worth testing directly.
 *
 * Undo is a stack of module snapshots rather than inverse operations, because every
 * operation in `edit.ts` already returns a new module. Keeping the previous value is
 * both simpler and more reliable than computing an inverse: there is no operation whose
 * inverse could be wrong, because there are no inverses.
 *
 * The rule that shapes everything else: **the module in state is the truth for the
 * canvas, and the hash is the truth for the file.** They move together on save and
 * never independently, so a successful edit cannot leave the editor believing it is in
 * sync when it is not.
 */

import {
  deleteNode,
  duplicateNode,
  insertNodes,
  moveNode,
  reorderChild,
  replaceClassTokens,
  setClassTokens,
  setComponentProp,
  setNodeAnimation,
  verifyTree,
  type EditResult,
} from './edit'
import { commitEdit, loadModule } from './session'
import type { ModuleWorkspace } from './workspace'
import { childIdsOf, isHidden, type ReactIrModule, type ReactIrNode } from './nodes'
import type { MotionAnimation } from './motion'

/**
 * A problem shown to the author.
 *
 * Wider than `EditProblem` because two vocabularies reach this layer: edit refusals
 * ("that move would create a cycle") and reader diagnostics from source somebody typed
 * by hand ("spread attributes are not supported, line 12"). Flattening the second into
 * the first would discard the code and the line number, which is precisely what the
 * author needs to fix the file. The code stays a string for that reason.
 */
export type EditorProblem = Readonly<{
  code: string
  message: string
  line?: number
}>

/**
 * Carry problems from any source into the display vocabulary, keeping code and line.
 */
function asEditorProblems(
  problems: readonly Readonly<{ code: string, message: string, line?: number }>[],
): readonly EditorProblem[] {
  return Object.freeze(problems.map((problem) => Object.freeze({
    code: problem.code,
    message: problem.message,
    ...(problem.line === undefined ? {} : { line: problem.line }),
  })))
}

/** How many undo steps to keep. */
const HISTORY_LIMIT = 50

export type EditorState = Readonly<{
  path: string
  module: ReactIrModule
  /** Hash of the source on disk. Null once local edits diverge from it. */
  savedHash: string | null
  /** Node ids currently selected, in selection order. */
  selection: readonly string[]
  /** Snapshots to restore on undo, most recent last. */
  past: readonly ReactIrModule[]
  /** Snapshots to restore on redo, most recent last. */
  future: readonly ReactIrModule[]
  /** Problems from the last refused action, cleared by the next successful one. */
  problems: readonly EditorProblem[]
}>

export function initialState(
  path: string,
  module: ReactIrModule,
  savedHash: string,
): EditorState {
  return Object.freeze({
    path,
    module,
    savedHash,
    selection: Object.freeze([]),
    past: Object.freeze([]),
    future: Object.freeze([]),
    problems: Object.freeze([]),
  })
}

/** Whether local edits differ from what is on disk. */
export function isDirty(state: EditorState): boolean {
  return state.savedHash === null
}

export function canUndo(state: EditorState): boolean {
  return state.past.length > 0
}

export function canRedo(state: EditorState): boolean {
  return state.future.length > 0
}

/**
 * Apply an edit result to state.
 *
 * A refusal records its problems and changes nothing else — not the module, not the
 * history, not the selection. An action that failed must not consume an undo step, or
 * undo would appear to do nothing.
 */
function applyEdit(state: EditorState, result: EditResult): EditorState {
  if (!result.ok) {
    return Object.freeze({ ...state, problems: result.problems })
  }

  const damage = verifyTree(result.module)
  if (damage.length > 0) {
    // Refuse rather than store a broken tree the canvas cannot render.
    return Object.freeze({
      ...state,
      problems: Object.freeze(damage.map((problem) => Object.freeze({
        code: problem.code,
        message: `The edit left the tree inconsistent: ${problem.message}`,
      }))),
    })
  }

  return Object.freeze({
    ...state,
    module: result.module,
    // Marked dirty the moment the module changes, so a save is never skipped on the
    // belief that nothing happened.
    savedHash: null,
    past: Object.freeze([...state.past, state.module].slice(-HISTORY_LIMIT)),
    // A new edit invalidates the redo branch: keeping it would let redo jump to a
    // future that no longer follows from the present.
    future: Object.freeze([]),
    selection: pruneSelection(state.selection, result.module),
    problems: Object.freeze([]),
  })
}

/**
 * Drop selected ids that no longer exist.
 *
 * A deletion leaves the selection pointing at nothing, and a panel reading a missing
 * node shows an empty inspector that looks broken rather than empty.
 */
function pruneSelection(
  selection: readonly string[],
  module: ReactIrModule,
): readonly string[] {
  return Object.freeze(selection.filter((id) => module.nodes[id] !== undefined))
}

export function selectNode(state: EditorState, nodeId: string): EditorState {
  if (state.module.nodes[nodeId] === undefined) return state
  return Object.freeze({ ...state, selection: Object.freeze([nodeId]) })
}

/** Add to or remove from the selection, for shift-clicking. */
export function toggleSelection(state: EditorState, nodeId: string): EditorState {
  if (state.module.nodes[nodeId] === undefined) return state
  const selected = state.selection.includes(nodeId)
  return Object.freeze({
    ...state,
    selection: Object.freeze(selected
      ? state.selection.filter((id) => id !== nodeId)
      : [...state.selection, nodeId]),
  })
}

export function clearSelection(state: EditorState): EditorState {
  return Object.freeze({ ...state, selection: Object.freeze([]) })
}

/**
 * Undo.
 *
 * Restores the previous module and marks the document dirty, because undoing to a state
 * that matches disk is still a change *from* what was saved most recently — the file
 * and the editor have diverged either way, and only a save can reconcile them.
 */
export function undo(state: EditorState): EditorState {
  const previous = state.past[state.past.length - 1]
  if (previous === undefined) return state

  return Object.freeze({
    ...state,
    module: previous,
    savedHash: null,
    past: Object.freeze(state.past.slice(0, -1)),
    future: Object.freeze([...state.future, state.module]),
    selection: pruneSelection(state.selection, previous),
    problems: Object.freeze([]),
  })
}

export function redo(state: EditorState): EditorState {
  const next = state.future[state.future.length - 1]
  if (next === undefined) return state

  return Object.freeze({
    ...state,
    module: next,
    savedHash: null,
    past: Object.freeze([...state.past, state.module].slice(-HISTORY_LIMIT)),
    future: Object.freeze(state.future.slice(0, -1)),
    selection: pruneSelection(state.selection, next),
    problems: Object.freeze([]),
  })
}

/** Insert a subtree under the selected node, or under the root when nothing is selected. */
export function insert(
  state: EditorState,
  subtree: Readonly<Record<string, ReactIrNode>>,
  subtreeRootId: string,
  index?: number,
): EditorState {
  const parentId = state.selection[0] ?? state.module.rootNodeId
  const result = insertNodes(state.module, parentId, subtree, subtreeRootId, index)
  const next = applyEdit(state, result)
  // Select what was just inserted: the author almost always wants to act on it.
  return result.ok
    ? Object.freeze({ ...next, selection: Object.freeze([subtreeRootId]) })
    : next
}

export function remove(state: EditorState, nodeId: string): EditorState {
  return applyEdit(state, deleteNode(state.module, nodeId))
}

export function move(
  state: EditorState,
  nodeId: string,
  newParentId: string,
  index?: number,
): EditorState {
  return applyEdit(state, moveNode(state.module, nodeId, newParentId, index))
}

export function reorder(
  state: EditorState,
  parentId: string,
  nodeId: string,
  toIndex: number,
): EditorState {
  return applyEdit(state, reorderChild(state.module, parentId, nodeId, toIndex))
}

export function duplicate(
  state: EditorState,
  nodeId: string,
  nextId: (original: string) => string,
): EditorState {
  const result = duplicateNode(state.module, nodeId, nextId)
  const next = applyEdit(state, result)
  // Select the copy, not the original, so a repeated duplicate does not stack copies of
  // the same node.
  const created = result.ok ? result.createdIds?.[0] : undefined
  return created !== undefined
    ? Object.freeze({ ...next, selection: Object.freeze([created]) })
    : next
}

/** Apply class tokens to every selected node that can carry them. */
/**
 * Sets one prop on the single selected component, which is what a properties panel does.
 *
 * SINGLE SELECTION ONLY, unlike restyle. Classes are additive so styling a mixed selection sensibly
 * styles what it can; a PROP is not — writing `variant` across a mixed selection would silently skip
 * every node that is not a component while the panel reported success, and the author would believe
 * they had changed all of them. So a selection that is not exactly one component is reported.
 */
export function setProp(
  state: EditorState,
  name: string,
  value: string | number | boolean | null,
): EditorState {
  if (state.selection.length !== 1) {
    return Object.freeze({
      ...state,
      problems: Object.freeze([Object.freeze({
        code: 'unknown-node' as const,
        message: state.selection.length === 0
          ? 'Select the component whose property you want to change.'
          : 'Select a single component — a property applies to one component, not a mixed selection.',
      })]),
    })
  }
  const result = setComponentProp(state.module, state.selection[0]!, name, value)
  if (!result.ok) {
    return Object.freeze({ ...state, problems: Object.freeze([...result.problems]) })
  }
  // Recorded exactly as a restyle records one, so a property change is reversible and marks the
  // document dirty (savedHash null IS the dirty flag).
  return Object.freeze({
    ...state,
    module: result.module,
    savedHash: null,
    past: Object.freeze([...state.past, state.module].slice(-HISTORY_LIMIT)),
    future: Object.freeze([]),
    problems: Object.freeze([]),
  })
}

/** Replace the complete class list on one selected element or component. */
export function replaceStyle(state: EditorState, tokens: readonly string[]): EditorState {
  if (state.selection.length !== 1) {
    return Object.freeze({
      ...state,
      problems: Object.freeze([Object.freeze({
        code: 'unknown-node' as const,
        message: state.selection.length === 0
          ? 'Select the element whose Tailwind classes you want to edit.'
          : 'Select a single element — an exact class list cannot be applied to a mixed selection.',
      })]),
    })
  }
  return applyEdit(state, replaceClassTokens(state.module, state.selection[0]!, tokens))
}

/** Set or remove Motion data on one selected renderable node. */
export function setAnimation(
  state: EditorState,
  animation: MotionAnimation | null,
): EditorState {
  if (state.selection.length !== 1) {
    return Object.freeze({
      ...state,
      problems: Object.freeze([Object.freeze({
        code: 'unknown-node' as const,
        message: state.selection.length === 0
          ? 'Select the element you want to animate.'
          : 'Select a single element — Motion settings apply to one element at a time.',
      })]),
    })
  }
  return applyEdit(state, setNodeAnimation(state.module, state.selection[0]!, animation))
}

export function restyle(state: EditorState, tokens: readonly string[]): EditorState {
  if (state.selection.length === 0) return state

  let working = state
  for (const nodeId of state.selection) {
    const result = setClassTokens(working.module, nodeId, tokens)
    // A node that cannot carry classes is skipped rather than failing the whole
    // gesture: restyling a mixed selection should style what it can.
    if (!result.ok) continue
    working = Object.freeze({ ...working, module: result.module })
  }

  if (working.module === state.module) {
    // Nothing was styleable, so report that rather than recording an empty undo step.
    return Object.freeze({
      ...state,
      problems: Object.freeze([Object.freeze({
        code: 'children-not-allowed' as const,
        message: 'None of the selected nodes can carry classes.',
      })]),
    })
  }

  return Object.freeze({
    ...state,
    module: working.module,
    savedHash: null,
    past: Object.freeze([...state.past, state.module].slice(-HISTORY_LIMIT)),
    future: Object.freeze([]),
    problems: Object.freeze([]),
  })
}

export type SaveOutcome =
  | Readonly<{ saved: true, state: EditorState }>
  | Readonly<{ saved: false, state: EditorState, problems: readonly EditorProblem[] }>

/**
 * Persist to the workspace.
 *
 * Goes through `commitEdit`, so generation, tree verification and concurrent-change
 * detection are the same ones the AI executor uses. A save with nothing to save is a
 * no-op rather than a write, because rewriting an unchanged file would bump its hash
 * and make every other editor's base stale for no reason.
 */
export async function save(
  workspace: ModuleWorkspace,
  state: EditorState,
): Promise<SaveOutcome> {
  if (!isDirty(state)) {
    return Object.freeze({ saved: true, state })
  }

  // The base is the hash this session last agreed with. After local edits it is null,
  // so it has to be re-read — which is also how a concurrent change is detected.
  const stored = await loadModule(workspace, state.path)
  if ('problems' in stored) {
    const problems = asEditorProblems(stored.problems)
    return Object.freeze({
      saved: false,
      // Recorded on state too, so a surface showing problems does not need the outcome
      // object to display them.
      state: Object.freeze({ ...state, problems }),
      problems,
    })
  }

  const result = await commitEdit(
    workspace, state.path, stored.hash, () => Object.freeze({
      ok: true,
      problems: Object.freeze([]),
      module: state.module,
    }),
  )

  if (!result.ok) {
    const problems = asEditorProblems(result.problems)
    return Object.freeze({
      saved: false,
      // The dirty flag deliberately survives: clearing it would let the editor believe
      // it is in sync with a file it failed to write.
      state: Object.freeze({ ...state, problems }),
      problems,
    })
  }

  return Object.freeze({
    saved: true,
    state: Object.freeze({
      ...state,
      savedHash: result.hash ?? null,
      problems: Object.freeze([]),
    }),
  })
}

/**
 * Node ids in canvas order, for the layer list and keyboard navigation.
 *
 * Hidden nodes are excluded so the layer list agrees with what is on screen. Implemented
 * here rather than imported from the canvas, because core must not depend on the admin
 * layer — the same order is needed by anything driving the IR, not only the UI.
 */
export function layerOrder(state: EditorState): readonly string[] {
  const order: string[] = []
  const seen = new Set<string>()
  const visit = (nodeId: string): void => {
    const node = state.module.nodes[nodeId]
    // Guarded against a cycle so a corrupt tree cannot hang the layer list.
    if (!node || isHidden(node) || seen.has(nodeId)) return
    seen.add(nodeId)
    order.push(nodeId)
    for (const childId of childIdsOf(node)) visit(childId)
  }
  visit(state.module.rootNodeId)
  return Object.freeze(order)
}
