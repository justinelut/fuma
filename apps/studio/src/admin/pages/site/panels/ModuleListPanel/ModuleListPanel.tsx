/**
 * Lists the tenant's React IR modules and opens one on the canvas.
 *
 * This is the ENTRY POINT for the React canvas mode. Without it the mode was unreachable: the document
 * kind existed, the surface rendered, the endpoint served source — and nothing called
 * `setActiveDocument({ kind: 'reactModule' })`, so no author could get there. A feature nothing can
 * reach is indistinguishable from one that was never built.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@admin/fuma/ui/button'
import { Input } from '@admin/fuma/ui/input'
import { FileCode, RefreshCw } from 'lucide-react'
import type { ModuleStore } from '@core/react-ir/workspace'

export type ModuleListPanelProps = Readonly<{
  /** Supplied rather than constructed here, so a test drives it without a network. */
  store: ModuleStore
  /** Called with the chosen path. The caller owns opening, because it holds the editor store. */
  onOpen: (path: string) => void
  /** The path already open, so the list can mark it rather than offering it as a fresh choice. */
  openPath?: string | null
}>

/** Above this many, scanning the list costs more than typing. Matches the switcher's own reasoning. */
const SEARCHABLE_THRESHOLD = 8

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; paths: readonly string[] }
  /** A FAILURE is its own state: an empty list means "no modules", which is a different fact. */
  | { kind: 'failed'; message: string }

export function ModuleListPanel({ store, onOpen, openPath = null }: ModuleListPanelProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [query, setQuery] = useState('')

  const load = useCallback(() => {
    setState({ kind: 'loading' })
    let active = true
    void store.list().then(
      (paths) => {
        // Guarded so a resolve that lands after a reload cannot overwrite the newer answer.
        if (active) setState({ kind: 'ready', paths: [...paths].sort() })
      },
      (error: unknown) => {
        if (!active) return
        setState({
          kind: 'failed',
          message: error instanceof Error ? error.message : 'Could not list modules.',
        })
      },
    )
    return () => { active = false }
  }, [store])

  useEffect(() => load(), [load])

  if (state.kind === 'loading') {
    return <p className="p-3 text-sm text-muted-foreground" role="status" aria-busy="true">Loading modules…</p>
  }

  if (state.kind === 'failed') {
    // Reported WITH a retry, because the commonest cause is transient and the alternative is an
    // author concluding their site has no source.
    return (
      <div className="grid gap-3 p-3">
        <p role="alert" className="text-sm text-destructive">{state.message}</p>
        <Button variant="secondary" size="sm" type="button" onClick={load}>
          <RefreshCw aria-hidden="true" /> Try again
        </Button>
      </div>
    )
  }

  const term = query.trim().toLowerCase()
  const matches = term === '' ? state.paths : state.paths.filter((path) => path.toLowerCase().includes(term))

  return (
    <div className="grid gap-3 p-3" data-testid="module-list-panel">
      {state.paths.length >= SEARCHABLE_THRESHOLD && (
        <Input
          type="search"
          aria-label="Search modules"
          placeholder="Search modules"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}

      {state.paths.length === 0 ? (
        // Distinct from a failed load, and from an empty search: this site genuinely has no modules.
        <p className="text-sm text-muted-foreground">No modules yet. One is created when a site is provisioned.</p>
      ) : matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">No modules match that search.</p>
      ) : (
        <ul className="grid gap-1" aria-label="React modules">
          {matches.map((path) => {
            const isOpen = path === openPath
            return (
              <li key={path}>
                <Button
                  variant={isOpen ? 'secondary' : 'ghost'}
                  size="sm"
                  type="button"
                  className="w-full justify-start font-mono text-xs"
                  // Announced rather than only shaded, because colour alone is not a label.
                  aria-current={isOpen ? 'true' : undefined}
                  onClick={() => { if (!isOpen) onOpen(path) }}
                  disabled={isOpen}
                >
                  <FileCode aria-hidden="true" />
                  {path}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
