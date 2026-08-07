/**
 * Opening a module: the one place that joins the workspace, the editor store and the canvas document.
 *
 * The ordering is the whole point. Switching the canvas document BEFORE the module opens would render
 * the React canvas against whatever the store still held — the previous module, or none — so a failed
 * open would leave the author looking at the wrong file with nothing indicating a problem.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { ModuleWorkspace, createMemoryModuleStore } from '@core/react-ir/workspace'
import { useReactEditorStore } from '@site/canvas/reactEditorStore'
import {
  openReactModule,
  persistSavedBlock,
  moduleWorkspaceForSession,
  setModuleWorkspaceForSession,
} from '@site/canvas/openReactModule'
import type { ActiveDocument } from '@site/store/slices/uiSlice'

const SOURCE = `export default function Page() {
  return (
    <main className="p-6">
      <h1 className="text-3xl">Hello</h1>
    </main>
  )
}
`

afterEach(() => {
  setModuleWorkspaceForSession(null)
  useReactEditorStore.setState({ editor: null, workspace: null, problems: [], saving: false })
})

/** A workspace holding one real module, written through the workspace's own accepted path. */
async function workspaceWith(path: string, source: string): Promise<ModuleWorkspace> {
  const workspace = new ModuleWorkspace(createMemoryModuleStore())
  // Positional signature: write(path, source, options) - NOT an object.
  const written = await workspace.write(path, source)
  // WriteResult reports `written`, not `ok`.
  expect(written.written, JSON.stringify(written.problems)).toBe(true)
  return workspace
}

describe('a successful open', () => {
  it('switches the canvas document to the module it opened', async () => {
    setModuleWorkspaceForSession(await workspaceWith('app/page.tsx', SOURCE))
    const documents: (ActiveDocument | null)[] = []
    const outcome = await openReactModule('app/page.tsx', (doc) => documents.push(doc))
    expect(outcome.ok).toBe(true)
    expect(documents).toEqual([{ kind: 'reactModule', path: 'app/page.tsx' }])
  })

  it('leaves the editor store holding that module, so the canvas and document agree', async () => {
    setModuleWorkspaceForSession(await workspaceWith('app/page.tsx', SOURCE))
    await openReactModule('app/page.tsx', () => {})
    // The surface refuses when these disagree, so they must be set from one place.
    expect(useReactEditorStore.getState().editor?.path).toBe('app/page.tsx')
  })
})

describe('a failed open does NOT switch the document', () => {
  it('leaves the author where they were when the module is absent', async () => {
    // Empty workspace: nothing to open.
    setModuleWorkspaceForSession(new ModuleWorkspace(createMemoryModuleStore()))
    const documents: (ActiveDocument | null)[] = []
    const outcome = await openReactModule('app/missing/page.tsx', (doc) => documents.push(doc))
    expect(outcome.ok).toBe(false)
    // Switching anyway would show the React canvas against no module — an empty surface that reads as
    // a broken product rather than as a file that is not there.
    expect(documents).toEqual([])
  })

  it('carries a reason rather than failing silently', async () => {
    setModuleWorkspaceForSession(new ModuleWorkspace(createMemoryModuleStore()))
    const outcome = await openReactModule('app/missing/page.tsx', () => {})
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      // A swallowed failure reads as a dead control: the author clicks and nothing happens.
      expect(outcome.reason).toContain('app/missing/page.tsx')
      expect(outcome.reason.length).toBeGreaterThan(10)
    }
  })

  it('reports a transport failure rather than throwing through the caller', async () => {
    const exploding = new ModuleWorkspace({
      async get() { throw new Error('network down') },
      async put() {}, async delete() {}, async list() { return [] },
    })
    setModuleWorkspaceForSession(exploding)
    const documents: (ActiveDocument | null)[] = []
    const outcome = await openReactModule('app/page.tsx', (doc) => documents.push(doc))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('network down')
    expect(documents).toEqual([])
  })
})

describe('the workspace is built once per session', () => {
  it('returns the same instance, so the conflict base is not forgotten', () => {
    setModuleWorkspaceForSession(null)
    const first = moduleWorkspaceForSession()
    const second = moduleWorkspaceForSession()
    // The HTTP store remembers the hash it last read per path, and that memory is what lets the SERVER
    // refuse a conflicting write. A fresh store per open would forget it, so every save would carry a
    // null base and the second session to save would silently overwrite the first.
    expect(second).toBe(first)
  })
})

describe('persisting a saved block as a component module', () => {
  const block = {
    id: 'saved.hero', name: 'My hero', category: 'hero' as const,
    description: 'Saved from the home page.', variantOf: null, rootId: 'section',
    subtree: {
      section: { kind: 'element', id: 'section', tag: 'section', attributes: {}, children: ['cta'] },
      cta: {
        kind: 'component', id: 'cta',
        component: { id: 'button', symbol: 'Button', source: '@/components/ui/button' },
        children: [],
      },
    },
  } as never

  it('writes it where the store keys it as a component', async () => {
    const workspace = new ModuleWorkspace(createMemoryModuleStore())
    setModuleWorkspaceForSession(workspace)
    const outcome = await persistSavedBlock(block)
    expect(outcome.ok, outcome.ok ? '' : outcome.reason).toBe(true)
    if (!outcome.ok) return
    expect(outcome.path).toBe('components/blocks/MyHero.tsx')
    // Written through the SAME workspace the canvas reads, so a saved block cannot enter the tenant's
    // source by a weaker path than an author's own typing takes.
    expect(await workspace.read('components/blocks/MyHero.tsx')).not.toBeNull()
  })

  it('REFUSES a name that already exists rather than replacing earlier work', async () => {
    const workspace = new ModuleWorkspace(createMemoryModuleStore())
    setModuleWorkspaceForSession(workspace)
    expect((await persistSavedBlock(block)).ok).toBe(true)
    const second = await persistSavedBlock(block)
    // WriteOptions has no "must not exist" mode and an omitted base means NO conflict check, so
    // without the explicit read this would have silently overwritten the first save.
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toContain('already exists')
  })

  it('reports a generation refusal without writing anything', async () => {
    const workspace = new ModuleWorkspace(createMemoryModuleStore())
    setModuleWorkspaceForSession(workspace)
    const broken = { ...(block as unknown as Record<string, unknown>), rootId: 'missing' } as never
    const outcome = await persistSavedBlock(broken)
    expect(outcome.ok).toBe(false)
    expect(await workspace.list()).toEqual([])
  })
})
