import { useCallback, useEffect, useState } from 'react'
import { FileCode, RefreshCw } from 'lucide-react'
import { Button } from '@admin/fuma/ui/button'
import { TENANT_SHADCN_INSERTABLES } from '@core/generatedSite/shadcnInsertables'
import { useEditorStore } from '@site/store/store'
import { moduleWorkspaceForSession, openReactModule } from '@site/canvas/openReactModule'
import { ReactBlocksMount } from '@site/panels/BlocksPanel/ReactBlocksMount'
import { ReactComponentsMount } from './ReactComponentsMount'
import styles from './SiteExplorerPanel.module.css'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; paths: readonly string[] }
  | { kind: 'failed'; message: string }

export function ReactSiteExplorerPanel({ editable = true }: Readonly<{ editable?: boolean }>) {
  const activeDocument = useEditorStore((state) => state.activeDocument)
  const setActiveDocument = useEditorStore((state) => state.setActiveDocument)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [openFailure, setOpenFailure] = useState<string | null>(null)

  const load = useCallback(() => {
    let active = true
    setState({ kind: 'loading' })
    void moduleWorkspaceForSession().list().then(
      (paths) => {
        if (active) setState({ kind: 'ready', paths: [...paths].sort() })
      },
      (error: unknown) => {
        if (active) {
          setState({
            kind: 'failed',
            message: error instanceof Error ? error.message : 'Could not list modules.',
          })
        }
      },
    )
    return () => { active = false }
  }, [])

  useEffect(() => load(), [load])

  function open(path: string) {
    setOpenFailure(null)
    void openReactModule(path, setActiveDocument).then((outcome) => {
      if (!outcome.ok) setOpenFailure(outcome.reason)
    })
  }

  const paths = state.kind === 'ready' ? state.paths : []
  const templates = paths.filter((path) => /(^|\/)(page|layout)\.tsx$/.test(path))
  const components = paths.filter((path) => (
    (path.startsWith('components/') || path.startsWith('src/components/'))
    && !path.startsWith('components/ui/')
    && !path.startsWith('src/components/ui/')
  ))
  const openPath = activeDocument?.kind === 'reactModule' ? activeDocument.path : null

  return (
    <div className={styles.panelBody} data-testid="react-site-explorer-panel">
      {state.kind === 'failed' ? (
        <div className={styles.loadProblem}>
          <p role="alert">{state.message}</p>
          <Button type="button" variant="secondary" size="sm" onClick={load}>
            <RefreshCw aria-hidden="true" /> Try again
          </Button>
        </div>
      ) : null}
      {openFailure === null ? null : <p role="alert" className={styles.embeddedProblem}>{openFailure}</p>}

      <ModuleSection
        title="Templates"
        paths={templates}
        openPath={openPath}
        loading={state.kind === 'loading'}
        empty="No page or layout modules yet."
        onOpen={open}
      />

      <section className={styles.section} aria-labelledby="react-site-components">
        <div className={styles.sectionHeader}>
          <h2 id="react-site-components" className={styles.sectionTitle}>Components</h2>
          <span className={styles.sectionCount}>{components.length + TENANT_SHADCN_INSERTABLES.length}</span>
        </div>
        <ModuleRows
          paths={components}
          openPath={openPath}
          loading={state.kind === 'loading'}
          empty="No authored component modules yet."
          onOpen={open}
        />
        {editable ? <ReactComponentsMount /> : null}
      </section>

      {editable ? <ReactBlocksMount /> : null}
    </div>
  )
}

function ModuleSection({
  title,
  paths,
  openPath,
  loading,
  empty,
  onOpen,
}: Readonly<{
  title: string
  paths: readonly string[]
  openPath: string | null
  loading: boolean
  empty: string
  onOpen: (path: string) => void
}>) {
  const id = `react-site-${title.toLowerCase()}`
  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles.sectionHeader}>
        <h2 id={id} className={styles.sectionTitle}>{title}</h2>
        <span className={styles.sectionCount}>{paths.length}</span>
      </div>
      <ModuleRows
        paths={paths}
        openPath={openPath}
        loading={loading}
        empty={empty}
        onOpen={onOpen}
      />
    </section>
  )
}

function ModuleRows({
  paths,
  openPath,
  loading,
  empty,
  onOpen,
}: Readonly<{
  paths: readonly string[]
  openPath: string | null
  loading: boolean
  empty: string
  onOpen: (path: string) => void
}>) {
  if (loading) return <p className={styles.sectionEmpty} role="status">Loading…</p>
  if (paths.length === 0) return <p className={styles.sectionEmpty}>{empty}</p>
  return (
    <div className={styles.rows}>
      {paths.map((path) => {
        const current = path === openPath
        return (
          <button
            key={path}
            type="button"
            className={`${styles.row} ${current ? styles.rowActive : ''}`}
            aria-current={current ? 'true' : undefined}
            disabled={current}
            onClick={() => { if (!current) onOpen(path) }}
          >
            <FileCode aria-hidden="true" size={14} />
            <span className={styles.rowLabel}>{fileLabel(path)}</span>
            <span className={styles.rowMeta}>{moduleKind(path)}</span>
          </button>
        )
      })}
    </div>
  )
}

function fileLabel(path: string): string {
  if (/(^|\/)page\.tsx$/.test(path)) {
    const segment = path.replace(/(^|\/)page\.tsx$/, '').split('/').filter(Boolean).at(-1)
    return segment === undefined || segment === 'app' ? 'Home' : segment
  }
  return path.split('/').at(-1)?.replace(/\.tsx$/, '') ?? path
}

function moduleKind(path: string): string {
  if (/(^|\/)layout\.tsx$/.test(path)) return 'Layout'
  if (/(^|\/)page\.tsx$/.test(path)) return 'Page'
  return 'Component'
}
