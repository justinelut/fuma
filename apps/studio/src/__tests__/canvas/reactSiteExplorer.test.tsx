import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { TENANT_SHADCN_COMPONENTS } from '@core/generatedSite/shadcnBaseline'
import { TENANT_SHADCN_INSERTABLES } from '@core/generatedSite/shadcnInsertables'
import { initialState } from '@core/react-ir/editorState'
import { ModuleWorkspace, createMemoryModuleStore } from '@core/react-ir/workspace'
import { REACT_IR_VERSION, type ReactIrModule } from '@core/react-ir/nodes'
import { ReactComponentsMount } from '@site/panels/SiteExplorerPanel/ReactComponentsMount'
import { ReactSiteExplorerPanel } from '@site/panels/SiteExplorerPanel/ReactSiteExplorerPanel'
import { setModuleWorkspaceForSession } from '@site/canvas/openReactModule'
import { useReactEditorStore } from '@site/canvas/reactEditorStore'
import { useEditorStore } from '@site/store/store'

function pageModule(): ReactIrModule {
  return {
    version: REACT_IR_VERSION,
    id: 'page-module',
    kind: 'page',
    path: 'app/page.tsx',
    symbol: 'Page',
    rootNodeId: 'root',
    propsInterface: [],
    boundary: 'server',
    nodes: {
      root: { kind: 'element', id: 'root', tag: 'main', attributes: {}, children: [] },
    },
  }
}

beforeEach(() => {
  useReactEditorStore.setState({ editor: null, workspace: null, problems: [], saving: false })
  useEditorStore.setState({ activeDocument: { kind: 'reactModule', path: 'app/page.tsx' } })
})

afterEach(() => {
  cleanup()
  setModuleWorkspaceForSession(null)
})

describe('the React Site explorer preserves Instatic\'s established hierarchy', () => {
  it('shows Templates, Components and Blocks in the existing Site body', async () => {
    const store = createMemoryModuleStore()
    await store.put('app/page.tsx', 'source', 'h1', '')
    await store.put('app/layout.tsx', 'source', 'h2', '')
    await store.put('components/AiHero.tsx', 'source', 'h3', '')
    setModuleWorkspaceForSession(new ModuleWorkspace(store))

    render(<ReactSiteExplorerPanel />)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Templates' })).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'Components' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Blocks' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /AiHero/ })).toBeTruthy()
    expect(screen.getByText('Preinstalled shadcn')).toBeTruthy()
  })

  it('lists every preinstalled file through explicit export metadata', () => {
    expect(TENANT_SHADCN_INSERTABLES).toHaveLength(24)
    expect(TENANT_SHADCN_INSERTABLES.map((entry) => entry.file).sort())
      .toEqual(TENANT_SHADCN_COMPONENTS.map((entry) => entry.name).sort())
    expect(new Set(TENANT_SHADCN_INSERTABLES.map((entry) => entry.symbol)).size).toBe(24)
    expect(TENANT_SHADCN_INSERTABLES.find((entry) => entry.file === 'radio-group')?.symbol)
      .toBe('RadioGroup')

    for (const entry of TENANT_SHADCN_INSERTABLES) {
      const source = readFileSync(join(import.meta.dir, '..', '..', 'admin', 'fuma', 'ui', `${entry.file}.tsx`), 'utf8')
      const exportBlock = source.slice(source.lastIndexOf('export {'))
      expect(exportBlock).toMatch(new RegExp(`\\b${entry.symbol}\\b`))
    }
  })
})

describe('preinstalled shadcn insertion uses only the React IR store', () => {
  it('inserts a component call under the selected parent and selects it in one undo step', async () => {
    const module = pageModule()
    useReactEditorStore.setState({
      editor: { ...initialState(module.path, module, 'on-disk'), selection: ['root'] },
      problems: [],
    })

    render(<ReactComponentsMount />)
    await userEvent.click(screen.getByRole('button', { name: 'Insert Button' }))

    const editor = useReactEditorStore.getState().editor!
    const insertedId = editor.module.nodes.root!.children[0]!
    const inserted = editor.module.nodes[insertedId]
    expect(inserted?.kind).toBe('component')
    if (inserted?.kind !== 'component') throw new Error('Expected a component node.')
    expect(inserted.component).toEqual({
      id: 'ui.button',
      symbol: 'Button',
      source: '@/components/ui/button',
    })
    expect(editor.selection).toEqual([insertedId])
    expect(editor.past).toHaveLength(1)

    act(() => useReactEditorStore.getState().undoEdit())
    expect(useReactEditorStore.getState().editor?.module.nodes.root?.children).toEqual([])
  })

  it('explains the selected-parent requirement instead of silently disabling insertion', () => {
    const module = pageModule()
    useReactEditorStore.setState({ editor: initialState(module.path, module, 'on-disk') })
    render(<ReactComponentsMount />)
    expect(screen.getByRole('status').textContent).toContain('Select an element on the canvas first')
    expect((screen.getByRole('button', { name: 'Insert Button' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders all 24 insert controls from the same catalogue the tenant receives', () => {
    render(<ReactComponentsMount />)
    for (const entry of TENANT_SHADCN_INSERTABLES) {
      expect(screen.getByRole('button', { name: `Insert ${entry.symbol}` })).toBeTruthy()
    }
  })
})
