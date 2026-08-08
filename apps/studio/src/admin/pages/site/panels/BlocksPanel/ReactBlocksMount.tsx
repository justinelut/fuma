/**
 * Left-rail mount for the shadcn-composed Blocks catalogue.
 *
 * The rail is driven by the legacy shell store while the open module and selection live in the
 * React-IR store. This component is the intentional bridge: it reads no PageNode state and therefore
 * cannot insert a React subtree into the legacy document model.
 */
import { useCallback, useState } from 'react'
import { idSourceFor, insertBlock, type BlockDefinition } from '@core/react-ir/blockLibrary'
import {
  useOpenModule,
  useReactEditorStore,
  useSelection,
} from '@site/canvas/reactEditorStore'
import { BlocksPanel } from './BlocksPanel'

export function ReactBlocksMount() {
  const module = useOpenModule()
  const selection = useSelection()
  const insertSubtree = useReactEditorStore((state) => state.insertSubtree)
  const [problem, setProblem] = useState<string | null>(null)
  const selectedId = selection.length === 1 ? selection[0]! : null

  const unavailableReason = module === null
    ? 'Open a React page or component from Explorer before inserting a block.'
    : selectedId === null
      ? selection.length > 1
        ? 'Select one element on the canvas — a block goes inside one parent.'
        : 'Select an element on the canvas first. The block will be inserted inside it.'
      : null

  const handleInsert = useCallback((block: BlockDefinition) => {
    if (module === null || selectedId === null) return
    const result = insertBlock(module, selectedId, block, idSourceFor(module))
    if (!result.ok || result.instance === undefined) {
      setProblem(result.problems[0]?.message ?? 'The block could not be inserted here.')
      return
    }
    setProblem(null)
    insertSubtree(result.instance.subtree, result.instance.rootId)
  }, [insertSubtree, module, selectedId])

  return (
    <div data-testid="react-blocks-mount">
      {problem === null ? null : (
        <p role="alert" className="px-4 pt-4 text-sm text-destructive">{problem}</p>
      )}
      <BlocksPanel onInsert={handleInsert} unavailableReason={unavailableReason} />
    </div>
  )
}
