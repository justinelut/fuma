import { useMemo, useState } from 'react'
import { Braces, Redo2, Save, Undo2 } from 'lucide-react'
import { Button } from '@admin/fuma/ui/button'
import { blockFromSubtree } from '@core/react-ir/blockAuthoring'
import type { BlockDefinition } from '@core/react-ir/blockLibrary'
import { TENANT_SHADCN_COMPONENTS } from '@core/generatedSite/shadcnBaseline'
import { renderModuleForCanvas } from './reactIrRenderer'
import { ReactInspector } from './ReactInspector'
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
import styles from './ReactCanvasSurface.module.css'

const TENANT_COMPONENT_NAMES = TENANT_SHADCN_COMPONENTS.map((component) => component.name)

export interface ReactCanvasSurfaceProps {
  /** Refuse to draw if the React store and the shell name different files. */
  expectedPath?: string
  /** Optional persistence seam for saving a selected subtree to the Blocks library. */
  onSaveBlock?: (block: BlockDefinition) => void
}

export function ReactCanvasSurface({ expectedPath, onSaveBlock }: ReactCanvasSurfaceProps = {}) {
  const module = useOpenModule()
  const selection = useSelection()
  const problems = useEditorProblems()
  const dirty = useIsDirty()
  const saving = useIsSaving()
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()
  const select = useReactEditorStore((state) => state.select)
  const undo = useReactEditorStore((state) => state.undoEdit)
  const redo = useReactEditorStore((state) => state.redoEdit)
  const save = useReactEditorStore((state) => state.saveModule)
  const [surfaceProblems, setSurfaceProblems] = useState<readonly string[]>([])

  const selectedNodeIds = useMemo(() => new Set(selection), [selection])
  const rendered = useMemo(
    () => module
      ? renderModuleForCanvas({ module, selectedNodeIds })
      : null,
    [module, selectedNodeIds],
  )

  if (module === null) {
    return (
      <section className={styles.workbench} aria-label="React canvas surface">
        <div className={styles.mismatch} role="status">
          <Braces aria-hidden="true" />
          <strong>Open a page to start editing.</strong>
          <span>Choose a React page, layout, or component from Components.</span>
        </div>
      </section>
    )
  }

  if (expectedPath !== undefined && module.path !== expectedPath) {
    return (
      <section className={styles.workbench} aria-label="React canvas surface">
        <div className={styles.mismatch} role="alert">
          <strong>The open React document does not match the canvas.</strong>
          <span>Expected {expectedPath}, but the React editor holds {module.path}.</span>
        </div>
      </section>
    )
  }

  const issueMessages = [
    ...problems.map((problem) => problem.message),
    ...surfaceProblems,
  ]
  const documentTitle = module.path.split('/').filter(Boolean).at(-1) ?? module.path
  const canSaveBlock = selection.length === 1

  function saveSelectionAsBlock(): void {
    if (!onSaveBlock || selection.length !== 1) return
    const node = module!.nodes[selection[0]!]
    const name = node?.label?.trim() || `Saved ${node?.kind ?? 'section'}`
    const result = blockFromSubtree(module!, selection[0]!, {
      id: `saved.${selection[0]}`,
      name,
      category: 'features',
      description: `Reusable section saved from ${module!.path}.`,
    }, TENANT_COMPONENT_NAMES)
    if (!result.ok) {
      setSurfaceProblems(result.problems.map((problem) => problem.message))
      return
    }
    setSurfaceProblems([])
    onSaveBlock(result.block)
  }

  return (
    <section
      className={styles.workbench}
      data-testid="react-canvas-surface"
      aria-label="React canvas surface"
    >
      <header className={styles.commandBar}>
        <div className={styles.documentIdentity}>
          <div className={styles.documentIdentityTop}>
            <span className={styles.documentKind}>{module.kind}</span>
            <span className={styles.documentPath}>{module.path}</span>
          </div>
          <div className={styles.documentMeta}>
            <span className={styles.technologyPill}>React IR</span>
            <span className={styles.boundaryPill}>{module.boundary} boundary</span>
          </div>
        </div>

        <div className={styles.commandSpacer} />

        <span className={styles.saveState} data-dirty={dirty ? 'true' : 'false'} aria-live="polite">
          <span className={styles.saveStateDot} aria-hidden="true" />
          {saving ? 'Writing TSX…' : dirty ? 'Unsaved changes' : 'Source saved'}
        </span>

        <div className={styles.commandActions}>
          {onSaveBlock && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canSaveBlock || saving}
              onClick={saveSelectionAsBlock}
            >
              Save as block
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Undo"
            title="Undo"
            disabled={!canUndo || saving}
            onClick={undo}
          >
            <Undo2 aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Redo"
            title="Redo"
            disabled={!canRedo || saving}
            onClick={redo}
          >
            <Redo2 aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!dirty || saving}
            onClick={() => { void save() }}
          >
            <Save aria-hidden="true" />
            {saving ? 'Saving…' : 'Save module'}
          </Button>
        </div>
      </header>

      <div className={styles.workspace}>
        <main className={styles.stage} aria-label="React canvas stage">
          <span className={styles.stageLabel}>Live component canvas</span>
          <div className={styles.artboardShell}>
            <div className={styles.artboardChrome} aria-hidden="true">
              <span className={styles.artboardLights}><span /><span /><span /></span>
              <span className={styles.artboardTitle}>{documentTitle}</span>
            </div>
            <div
              className={styles.artboardViewport}
              data-testid="react-canvas-frame"
              aria-label="React canvas"
              onClickCapture={(event) => {
                const target = event.target
                if (!(target instanceof Element)) return
                if (target.closest('a')) event.preventDefault()
                const layer = target.closest<HTMLElement>('[data-node-id]')
                if (layer?.dataset.nodeId) select(layer.dataset.nodeId)
              }}
            >
              {rendered ?? (
                <div className={styles.emptyCanvas}>
                  <strong>This module has no renderable root.</strong>
                  <p>Insert a component or block from the left rail to begin composing the React tree.</p>
                </div>
              )}
            </div>
          </div>
          {issueMessages.length > 0 && (
            <ul className={styles.problemTray} aria-label="React module problems">
              {issueMessages.map((problem, index) => (
                <li role="alert" key={`${problem}-${index}`}>{problem}</li>
              ))}
            </ul>
          )}
        </main>
        <ReactInspector />
      </div>
    </section>
  )
}
