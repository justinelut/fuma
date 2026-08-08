import { useMemo, useState } from 'react'
import { Braces, Plus } from 'lucide-react'
import { Button } from '@admin/fuma/ui/button'
import { Input } from '@admin/fuma/ui/input'
import {
  TENANT_SHADCN_INSERTABLES,
  type ShadcnInsertable,
} from '@core/generatedSite/shadcnInsertables'
import { insertNodes } from '@core/react-ir/edit'
import { idSourceFor } from '@core/react-ir/blockLibrary'
import type { ReactIrNode } from '@core/react-ir/nodes'
import {
  useOpenModule,
  useReactEditorStore,
  useSelection,
} from '@site/canvas/reactEditorStore'
import styles from './SiteExplorerPanel.module.css'

/** A valid React component-call node for one explicitly catalogued shadcn export. */
export function shadcnNodeFor(entry: ShadcnInsertable, id: string): ReactIrNode {
  return {
    kind: 'component',
    id,
    component: {
      id: entry.componentId,
      symbol: entry.symbol,
      source: entry.source,
    },
    props: {},
    slots: {},
    classTokens: [],
    children: [],
  }
}

/**
 * Preinstalled component picker embedded beneath Explorer -> Site -> Components.
 *
 * This is the intentional store boundary: it reads only the React editor store and inserts through
 * the same `insertSubtree` transition as Blocks. No PageNode mutation is imported or reachable here.
 */
export function ReactComponentsMount() {
  const module = useOpenModule()
  const selection = useSelection()
  const insertSubtree = useReactEditorStore((state) => state.insertSubtree)
  const [query, setQuery] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const selectedId = selection.length === 1 ? selection[0]! : null

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (term === '') return TENANT_SHADCN_INSERTABLES
    return TENANT_SHADCN_INSERTABLES.filter((entry) => (
      entry.symbol.toLowerCase().includes(term)
      || entry.file.includes(term)
      || entry.source.toLowerCase().includes(term)
    ))
  }, [query])

  const unavailableReason = module === null
    ? 'Open a React page or component from Explorer before inserting a component.'
    : selectedId === null
      ? selection.length > 1
        ? 'Select one element on the canvas — a component goes inside one parent.'
        : 'Select an element on the canvas first. The component will be inserted inside it.'
      : null

  function insert(entry: ShadcnInsertable) {
    if (module === null || selectedId === null) return
    const id = idSourceFor(module)(`${entry.file}-component`)
    const node = shadcnNodeFor(entry, id)
    const subtree = Object.freeze({ [id]: node })

    // Preflight with the same pure operation the store uses so a text node, locked parent or other
    // invalid target gets an actionable local reason instead of a button that appears to do nothing.
    const checked = insertNodes(module, selectedId, subtree, id)
    if (!checked.ok) {
      setProblem(checked.problems[0]?.message ?? `${entry.symbol} could not be inserted here.`)
      return
    }

    setProblem(null)
    insertSubtree(subtree, id)
  }

  return (
    <div className={styles.embeddedLibrary} data-testid="react-components-mount">
      <div className={styles.embeddedHeader}>
        <Braces aria-hidden="true" size={13} />
        <h3>Preinstalled shadcn</h3>
        <span>{TENANT_SHADCN_INSERTABLES.length}</span>
      </div>
      <Input
        type="search"
        aria-label="Search preinstalled components"
        placeholder="Search components"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {unavailableReason === null ? null : (
        <p role="status" className={styles.embeddedNotice}>{unavailableReason}</p>
      )}
      {problem === null ? null : (
        <p role="alert" className={styles.embeddedProblem}>{problem}</p>
      )}
      {matches.length === 0 ? (
        <p className={styles.embeddedNotice}>No components match that search.</p>
      ) : (
        <ul className={styles.insertRows} aria-label="Preinstalled shadcn components">
          {matches.map((entry) => (
            <li key={entry.file} className={styles.insertRow}>
              <div className={styles.insertRowText}>
                <span>{entry.symbol}</span>
                <code>{entry.source}</code>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Insert ${entry.symbol}`}
                title={`Insert ${entry.symbol}`}
                disabled={unavailableReason !== null}
                onClick={() => insert(entry)}
              >
                <Plus aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
