/**
 * The React-engine editing surface — the piece task 51 exists to build.
 *
 * Everything it composes was built and tested separately and, until now, was not joined to anything:
 * `reactEditorStore` (state + undo), `reactIrRenderer` (IR -> live DOM), `blockLibrary.insertBlock`
 * (fresh ids + remapped references), `BlocksPanel` and `AnimationPanel`. A foundation that is never
 * composed is a foundation nobody has shown to work, which is the state the previous iterations left
 * it in and the reason this file is the last structural blocker rather than another model.
 *
 * WHY THIS IS A SEPARATE SURFACE RATHER THAN AN EDIT TO THE EXISTING CANVAS. The shipping canvas is
 * 11,701 lines across 69 files and holds a module+props `PageNode` tree; this holds a `ReactIrModule`.
 * They are different documents, so there is no incremental edit that leaves both working - a partial
 * conversion would leave a canvas that renders one model and saves the other. Standing this up beside
 * the old one means the React engine is reachable and provably editable before anything is deleted,
 * and the deletion becomes a removal of something already replaced rather than a leap.
 *
 * The selection rule is the one thing the panels cannot decide for themselves: a block needs a parent,
 * and only the canvas knows what is selected. So `BlocksPanel` is handed a reason when nothing is
 * selected rather than a disabled button with no explanation.
 */
import { useCallback, useMemo, useState } from 'react'
import { idSourceFor, insertBlock } from '@core/react-ir/blockLibrary'
import { Button } from '@admin/fuma/ui/button'
import { blockFromSubtree } from '@core/react-ir/blockAuthoring'
import type { BlockDefinition } from '@core/react-ir/blockLibrary'
import { TENANT_SHADCN_COMPONENTS } from '@core/generatedSite/shadcnBaseline'
import { BlocksPanel } from '../panels/BlocksPanel/BlocksPanel'
import { ReactPropertiesMount } from '../panels/ReactPropertiesPanel/ReactPropertiesMount'
import {
  useCanRedo,
  useCanUndo,
  useEditorProblems,
  useIsDirty,
  useIsSaving,
  useOpenModule,
  useReactEditorStore,
  useSelection,
} from './reactEditorStore'
import { nodeIdFromElement, renderModuleForCanvas } from './reactIrRenderer'

export type ReactCanvasSurfaceProps = Readonly<{
  /** Rendered instead of the canvas when no module is open, so the empty state is the caller's words. */
  emptyLabel?: string
  /**
   * The path the CALLER believes is open, checked against the module this store actually holds.
   *
   * Two pieces of state can name a module - the canvas document and this editor store - and if they
   * disagree the canvas would render module B while the author believes they opened A, so every edit
   * would land somewhere they are not looking. Optional, because a caller that does not track a path
   * separately has nothing to disagree with.
   */
  expectedPath?: string
  /**
   * Receives a block built from the current selection.
   *
   * The CALLER owns where it goes, because this surface has no storage and inventing one here would
   * make a saved block look persisted when it lives only until the tab closes.
   */
  onSaveBlock?: (block: BlockDefinition) => void
}>

export function ReactCanvasSurface(
  { emptyLabel = 'Open a page to start editing.', expectedPath, onSaveBlock: handleSaveBlock }: ReactCanvasSurfaceProps,
) {
  const module = useOpenModule()
  const selection = useSelection()
  const problems = useEditorProblems()
  const dirty = useIsDirty()
  const saving = useIsSaving()
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()
  const select = useReactEditorStore((s) => s.select)
  const insertSubtree = useReactEditorStore((s) => s.insertSubtree)
  const undoEdit = useReactEditorStore((s) => s.undoEdit)
  const redoEdit = useReactEditorStore((s) => s.redoEdit)
  const saveModule = useReactEditorStore((s) => s.saveModule)
  const [insertProblem, setInsertProblem] = useState<string | null>(null)
  const [blockProblem, setBlockProblem] = useState<string | null>(null)

  const selectedId = selection.length === 1 ? selection[0]! : null

  /**
   * A block goes INSIDE the selection, so with nothing selected there is no parent and the panel is
   * told why. Falling back to the root instead would put a hero wherever the page happens to begin,
   * which is a placement nobody chose and one they then have to undo.
   */
  const unavailableReason = module === null
    ? 'Open a page before inserting a block.'
    : selectedId === null
      ? selection.length > 1
        ? 'Select a single element — a block goes inside one parent.'
        : 'Select an element on the canvas first. A block is inserted inside it.'
      : null

  const onInsert = useCallback((block: BlockDefinition) => {
    if (module === null || selectedId === null) return
    const result = insertBlock(module, selectedId, block, idSourceFor(module))
    if (!result.ok || result.instance === undefined) {
      // The refusal is shown rather than dropped: a button that does nothing reads as a broken
      // product, and `insertNodes` refuses for reasons an author can act on (a childless parent).
      setInsertProblem(result.problems[0]?.message ?? 'The block could not be inserted here.')
      return
    }
    setInsertProblem(null)
    insertSubtree(result.instance.subtree, result.instance.rootId)
  }, [insertSubtree, module, selectedId])

  /**
   * Selection reads the nearest marked ancestor rather than the exact click target, because a click
   * usually lands on a text node inside the element somebody meant to select.
   */
  const onCanvasClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const nodeId = nodeIdFromElement(event.target as Element)
    if (nodeId !== null) select(nodeId)
  }, [select])

  // The renderer returns a React element, so it is rendered as children rather than appended to a
  // ref - going through the DOM would put the canvas outside React's reconciliation and lose the
  // element on the next state change.
  /**
   * Turns the selected section into a reusable block.
   *
   * REFUSALS ARE SHOWN. A block is inserted many times across many pages, so a defect saved here is
   * multiplied - and because task 89 made blocks copies rather than references, every copy has to be
   * found and fixed by hand. Reporting the reason is what lets the author fix it once.
   */
  const onSaveBlock = useCallback(() => {
    setBlockProblem(null)
    if (module === null || selectedId === null || handleSaveBlock === undefined) return
    const name = selectedId
    const result = blockFromSubtree(
      module,
      selectedId,
      {
        id: `saved.${name}`,
        name: `Saved ${name}`,
        description: `Saved from ${module.path}.`,
        category: 'hero',
      },
      TENANT_SHADCN_COMPONENTS.map((component) => component.name),
    )
    if (!result.ok) {
      setBlockProblem(result.problems.map((problem) => problem.message).join(' '))
      return
    }
    handleSaveBlock(result.block)
  }, [module, selectedId, handleSaveBlock])

  const rendered = useMemo(() => (module === null ? null : renderModuleForCanvas({ module })), [module])

  /**
   * REFUSES rather than renders when the caller's path and the open module disagree.
   *
   * Rendering the module the store happens to hold would show the author a tree they did not open and
   * accept edits into it - and both documents are valid modules, so nothing would look wrong. Placed
   * after every hook so the hook order does not depend on whether the two agree.
   */
  if (module !== null && expectedPath !== undefined && module.path !== expectedPath) {
    return (
      <div className="grid min-h-0 gap-3 p-6" data-testid="react-canvas-surface">
        <p role="alert" className="rounded-md border border-destructive/50 p-4 text-sm text-destructive">
          This canvas was asked for {expectedPath} but {module.path} is open. Nothing is shown, because
          editing the wrong file looks exactly like editing the right one.
        </p>
      </div>
    )
  }

  return (
    <div className="grid min-h-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]" data-testid="react-canvas-surface">
      <section className="grid min-h-0 gap-3" aria-label="React canvas">
        <header className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" type="button" disabled={!canUndo} onClick={undoEdit}>Undo</Button>
          <Button variant="secondary" size="sm" type="button" disabled={!canRedo} onClick={redoEdit}>Redo</Button>
          <Button
            size="sm"
            type="button"
            disabled={!dirty || saving}
            onClick={() => { void saveModule() }}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {/* Unsaved state is stated rather than implied by an enabled button, because a button is a
              control and this is a fact about the document. */}
          {handleSaveBlock === undefined ? null : (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={selectedId === null}
              onClick={onSaveBlock}
            >
              Save as block
            </Button>
          )}
          {dirty ? <span className="text-sm text-muted-foreground" role="status">Unsaved changes</span> : null}
          {blockProblem === null ? null : (
            <span role="alert" className="text-sm text-destructive">{blockProblem}</span>
          )}
        </header>
        {module === null
          ? <p className="rounded-md border border-dashed border-border p-6 text-center text-muted-foreground">{emptyLabel}</p>
          : (
            <div
              onClick={onCanvasClick}
              className="min-h-0 overflow-auto rounded-md border border-border bg-card p-4"
              data-testid="react-canvas-frame"
            >
              {rendered}
            </div>
          )}
        {problems.length > 0 ? (
          <ul className="m-0 grid list-none gap-1 p-0" aria-label="Editor problems">
            {problems.map((problem) => (
              <li key={`${problem.code}-${problem.message}`} className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                {problem.message}
              </li>
            ))}
          </ul>
        ) : null}
        {insertProblem !== null ? (
          <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive" role="alert">{insertProblem}</p>
        ) : null}
      </section>
      <aside className="grid min-h-0 content-start gap-4" aria-label="Component properties and blocks">
        {/* Where task 72's derived cva variant controls become editable. */}
        <ReactPropertiesMount />
        <BlocksPanel onInsert={onInsert} unavailableReason={unavailableReason} />
      </aside>
    </div>
  )
}
