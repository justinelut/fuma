/**
 * React binding for the React-IR editing state.
 *
 * Thin on purpose. Every decision about what an edit means lives in
 * `core/react-ir/editorState.ts`, which is plain data and testable without rendering;
 * this file only holds it in a Zustand store and exposes selectors. Keeping the logic
 * out of the component layer is what lets the canvas, the AI executor and a migration
 * script all produce identical results.
 *
 * Distinct from `pages/site/store/store.ts`, which drives the old module+props builder.
 * The two coexist while the canvas is converted; this one is the target model.
 */

import { create } from 'zustand'
import {
  canRedo as canRedoOf,
  canUndo as canUndoOf,
  clearSelection,
  duplicate,
  initialState,
  insert,
  isDirty as isDirtyOf,
  layerOrder,
  move,
  redo,
  remove,
  reorder,
  restyle,
  setProp,
  save,
  selectNode,
  toggleSelection,
  undo,
  type EditorProblem,
  type EditorState,
} from '@core/react-ir/editorState'
import type { ModuleWorkspace } from '@core/react-ir/workspace'
import { loadModule } from '@core/react-ir/session'
import type { ReactIrModule, ReactIrNode } from '@core/react-ir/nodes'

type Store = {
  /** Null until a module is opened, so the canvas can render an empty state. */
  editor: EditorState | null
  workspace: ModuleWorkspace | null
  /** True while a save is in flight, so the UI can disable a second one. */
  saving: boolean
  /** Problems from the last refused action, surfaced to the author. */
  problems: readonly EditorProblem[]

  attachWorkspace: (workspace: ModuleWorkspace) => void
  open: (path: string) => Promise<void>
  close: () => void

  select: (nodeId: string) => void
  toggle: (nodeId: string) => void
  deselect: () => void

  insertSubtree: (
    subtree: Readonly<Record<string, ReactIrNode>>,
    subtreeRootId: string,
    index?: number,
  ) => void
  deleteNode: (nodeId: string) => void
  moveNode: (nodeId: string, newParentId: string, index?: number) => void
  reorderNode: (parentId: string, nodeId: string, toIndex: number) => void
  duplicateNode: (nodeId: string) => void
  applyClasses: (tokens: readonly string[]) => void
  setProp: (name: string, value: string | number | boolean | null) => void

  undoEdit: () => void
  redoEdit: () => void
  saveModule: () => Promise<boolean>
}

/** Suffix counter for duplicate ids, kept outside state so it never lands in history. */
let duplicateCounter = 0

export const useReactEditorStore = create<Store>((set, get) => ({
  editor: null,
  workspace: null,
  saving: false,
  problems: [],

  attachWorkspace: (workspace) => set({ workspace }),

  open: async (path) => {
    const { workspace } = get()
    if (!workspace) {
      // Loud rather than silent: opening with no workspace attached would otherwise
      // read as an empty file.
      throw new Error(
        'No module workspace is attached. Call attachWorkspace before opening a module, '
        + 'or the editor cannot tell an empty site from an unconfigured one.',
      )
    }

    const loaded = await loadModule(workspace, path)
    if ('problems' in loaded) {
      set({ editor: null, problems: loaded.problems })
      return
    }
    set({ editor: initialState(path, loaded.module, loaded.hash), problems: [] })
  },

  close: () => set({ editor: null, problems: [] }),

  select: (nodeId) => mutate(set, get, (state) => selectNode(state, nodeId)),
  toggle: (nodeId) => mutate(set, get, (state) => toggleSelection(state, nodeId)),
  deselect: () => mutate(set, get, clearSelection),

  insertSubtree: (subtree, subtreeRootId, index) =>
    mutate(set, get, (state) => insert(state, subtree, subtreeRootId, index)),
  deleteNode: (nodeId) => mutate(set, get, (state) => remove(state, nodeId)),
  moveNode: (nodeId, newParentId, index) =>
    mutate(set, get, (state) => move(state, nodeId, newParentId, index)),
  reorderNode: (parentId, nodeId, toIndex) =>
    mutate(set, get, (state) => reorder(state, parentId, nodeId, toIndex)),
  duplicateNode: (nodeId) => mutate(set, get, (state) => duplicate(
    state,
    nodeId,
    // Monotonic so a second duplicate of the same node cannot collide with the first.
    (original) => `${original}-copy-${(duplicateCounter += 1)}`,
  )),
  applyClasses: (tokens) => mutate(set, get, (state) => restyle(state, tokens)),
  /** What a properties panel calls. Null clears the prop rather than writing an empty value. */
  setProp: (name, value) => mutate(set, get, (state) => setProp(state, name, value)),

  undoEdit: () => mutate(set, get, undo),
  redoEdit: () => mutate(set, get, redo),

  saveModule: async () => {
    const { workspace, editor, saving } = get()
    // A second concurrent save would race on the base hash and one would be refused as
    // stale, which reads to the author as a random failure.
    if (!workspace || !editor || saving) return false

    set({ saving: true })
    try {
      const outcome = await save(workspace, editor)
      set({
        editor: outcome.state,
        problems: outcome.saved ? [] : outcome.problems,
        saving: false,
      })
      return outcome.saved
    } catch (error) {
      set({
        saving: false,
        problems: [{
          // A thrown error is a transport or runtime failure, not a rejected edit, so
          // it gets its own code rather than borrowing an edit refusal's.
          code: 'save-failed',
          message: error instanceof Error ? error.message : 'The save failed.',
        }],
      })
      return false
    }
  },
}))

/** Apply a pure transition, keeping the store's problem list in step with it. */
function mutate(
  set: (partial: Partial<Store>) => void,
  get: () => Store,
  transition: (state: EditorState) => EditorState,
): void {
  const { editor } = get()
  if (!editor) return
  const next = transition(editor)
  // Reference equality means the transition declined; skip the set so React does not
  // re-render for a no-op.
  if (next === editor) return
  set({ editor: next, problems: next.problems })
}

/* Selectors. Each reads one value so a component re-renders only for what it uses. */

export const useOpenModule = (): ReactIrModule | null =>
  useReactEditorStore((s) => s.editor?.module ?? null)

export const useSelection = (): readonly string[] =>
  useReactEditorStore((s) => s.editor?.selection ?? EMPTY)

export const useSelectedNode = (): ReactIrNode | null =>
  useReactEditorStore((s) => {
    const id = s.editor?.selection[0]
    return id === undefined ? null : s.editor?.module.nodes[id] ?? null
  })

export const useIsDirty = (): boolean =>
  useReactEditorStore((s) => (s.editor ? isDirtyOf(s.editor) : false))

export const useCanUndo = (): boolean =>
  useReactEditorStore((s) => (s.editor ? canUndoOf(s.editor) : false))

export const useCanRedo = (): boolean =>
  useReactEditorStore((s) => (s.editor ? canRedoOf(s.editor) : false))

export const useLayerOrder = (): readonly string[] =>
  useReactEditorStore((s) => (s.editor ? layerOrder(s.editor) : EMPTY))

export const useEditorProblems = (): readonly EditorProblem[] =>
  useReactEditorStore((s) => s.problems)

export const useIsSaving = (): boolean => useReactEditorStore((s) => s.saving)

/** Shared empty array so selectors returning "nothing" keep a stable identity. */
const EMPTY: readonly string[] = Object.freeze([])
