/**
 * Wires the module list to the editor: the store it reads through, and what happens on a click.
 *
 * Kept separate from `ModuleListPanel` so the panel stays presentational and testable without a
 * network or a store — this file is the part that reaches real state.
 */
import { useCallback, useMemo, useState } from 'react'
import { useEditorStore } from '@site/store/store'
import { createHttpModuleStore } from '@site/canvas/httpModuleStore'
import { openReactModule } from '@site/canvas/openReactModule'
import { ModuleListPanel } from './ModuleListPanel'

export function ModuleListMount() {
  const setActiveDocument = useEditorStore((state) => state.setActiveDocument)
  const activeDocument = useEditorStore((state) => state.activeDocument)
  const [failure, setFailure] = useState<string | null>(null)

  /**
   * Memoised so the list is not refetched on every render — the panel loads when its store identity
   * changes, so a fresh store each render would request the list in a loop.
   */
  const store = useMemo(() => createHttpModuleStore(), [])

  const handleOpen = useCallback((path: string) => {
    setFailure(null)
    void openReactModule(path, setActiveDocument).then((outcome) => {
      // SHOWN rather than swallowed: the author pressed a button, so a failure that only logs reads as
      // a dead control and they press it again.
      if (!outcome.ok) setFailure(outcome.reason)
    })
  }, [setActiveDocument])

  return (
    <div>
      {failure === null ? null : (
        <p role="alert" className="p-3 text-sm text-destructive">{failure}</p>
      )}
      <ModuleListPanel
        store={store}
        onOpen={handleOpen}
        openPath={activeDocument?.kind === 'reactModule' ? activeDocument.path : null}
      />
    </div>
  )
}
