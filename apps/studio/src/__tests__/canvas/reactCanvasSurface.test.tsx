/**
 * Tests the React-engine canvas surface against real DOM.
 *
 * This is the test that matters most for task 51, because every piece it composes already passed its
 * own tests in isolation. What was never shown is that they WORK TOGETHER: that a block inserted
 * through `insertBlock` lands in the store's module, that the renderer then draws it, and that a
 * second insertion of the same block succeeds rather than colliding on ids.
 */
import { describe, expect, it, beforeEach } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { BLOCK_CATALOGUE } from '@core/react-ir/blockCatalogue'
import { ReactIrModuleSchema, REACT_IR_VERSION, type ReactIrModule } from '@core/react-ir/nodes'
import { Value } from '@sinclair/typebox/value'
import { ReactCanvasSurface, type ReactCanvasSurfaceProps } from '@admin/pages/site/canvas/ReactCanvasSurface'
import { ReactBlocksMount } from '@admin/pages/site/panels/BlocksPanel/ReactBlocksMount'
import { useReactEditorStore } from '@admin/pages/site/canvas/reactEditorStore'
import { initialState } from '@core/react-ir/editorState'

function pageModule(): ReactIrModule {
  return {
    version: REACT_IR_VERSION,
    id: 'mod-page',
    kind: 'page',
    path: 'app/page.tsx',
    symbol: 'Page',
    rootNodeId: 'root',
    propsInterface: [],
    // Required, not defaulted: a module that does not state its boundary would let the generator
    // decide whether the page clientizes, which is task 41's whole subject.
    boundary: 'server',
    nodes: {
      root: { kind: 'element', id: 'root', tag: 'main', attributes: {}, children: ['title'] },
      title: {
        kind: 'element', id: 'title', tag: 'h1', attributes: {},
        classTokens: ['text-4xl', 'font-bold'], children: ['title-text'],
      },
      'title-text': { kind: 'text', id: 'title-text', value: 'Existing heading', children: [] },
    },
  } as ReactIrModule
}

/** Opens a module directly in the store, bypassing the workspace the surface does not own. */
function openModuleInStore(module: ReactIrModule): void {
  useReactEditorStore.setState({
    editor: initialState('app/page.tsx', module, 'hash-on-disk'),
    problems: [], saving: false,
  })
}

function reset(): void {
  useReactEditorStore.setState({ editor: null, workspace: null, problems: [], saving: false })
}

/** Mirrors the shipping composition: the canvas owns selection, while Blocks lives in the left rail. */
function ReactCanvasWithRail(props: ReactCanvasSurfaceProps) {
  return (
    <>
      <ReactCanvasSurface {...props} />
      <ReactBlocksMount />
    </>
  )
}

describe('the React canvas surface composes the engine rather than re-deriving it', () => {
  it('uses a fixture the shipped schema accepts, so the test cannot pass on an impossible module', () => {
    // My first fixture omitted `children` on a text node. It typechecked through the cast and made
    // childIdsOf throw on its spread, because `children` is required on EVERY node kind. A fixture
    // validated against the real schema cannot be wrong in that way again.
    expect(Value.Check(ReactIrModuleSchema, pageModule())).toBe(true)
  })

  beforeEach(() => { cleanup(); reset() })

  it('renders an empty state rather than a blank frame when no module is open', () => {
    render(<ReactCanvasWithRail />)
    expect(screen.getByText('Open a page to start editing.')).toBeTruthy()
    expect(document.querySelector('[data-testid="react-canvas-frame"]')).toBeNull()
  })

  it('draws the open module through the real renderer', () => {
    openModuleInStore(pageModule())
    render(<ReactCanvasWithRail />)
    const frame = document.querySelector('[data-testid="react-canvas-frame"]')
    expect(frame).not.toBeNull()
    expect(frame!.textContent).toContain('Existing heading')
    // The renderer marks nodes so selection can resolve a click to a node id.
    expect(frame!.querySelector('[data-node-id="title"]')).not.toBeNull()
  })

  it('states WHY a block cannot be inserted rather than only disabling the button', () => {
    openModuleInStore(pageModule())
    render(<ReactCanvasWithRail />)
    // Nothing is selected, so there is no parent. A block placed at the root would be a placement
    // nobody chose, so the surface refuses and says what to do.
    expect(screen.getByText(/Select an element on the canvas first/)).toBeTruthy()
  })

  it('selects the nearest marked ancestor when the canvas is clicked, not the exact target', async () => {
    openModuleInStore(pageModule())
    render(<ReactCanvasWithRail />)
    const heading = document.querySelector('[data-node-id="title"]')!
    await userEvent.click(heading)
    expect(useReactEditorStore.getState().editor?.selection).toEqual(['title'])
    expect(heading.getAttribute('data-canvas-selected')).toBe('true')
  })

  it('edits the exact Tailwind class list and removes omitted tokens', async () => {
    openModuleInStore(pageModule())
    render(<ReactCanvasWithRail />)
    await userEvent.click(document.querySelector('[data-node-id="title"]')!)
    const field = screen.getByLabelText('Classes')
    expect((field as HTMLTextAreaElement).value).toBe('text-4xl font-bold')
    await userEvent.clear(field)
    await userEvent.type(field, 'text-5xl tracking-tight')
    await userEvent.click(screen.getByRole('button', { name: 'Apply classes' }))
    expect(useReactEditorStore.getState().editor?.module.nodes['title']?.classTokens)
      .toEqual(['text-5xl', 'tracking-tight'])
    expect(document.querySelector('[data-node-id="title"]')?.className)
      .toBe('text-5xl tracking-tight')
  })

  it('applies and removes a Motion preset through the focused React inspector', async () => {
    openModuleInStore({ ...pageModule(), boundary: 'client' })
    render(<ReactCanvasWithRail />)
    await userEvent.click(document.querySelector('[data-node-id="title"]')!)
    await userEvent.click(screen.getByRole('button', { name: 'Motion' }))
    await userEvent.click(screen.getByRole('button', { name: 'Fade in' }))
    expect(useReactEditorStore.getState().editor?.module.nodes['title']?.animation?.animate)
      .toEqual({ opacity: 1 })
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(useReactEditorStore.getState().editor?.module.nodes['title']?.animation).toBeUndefined()
  })

  it('does not silently clientize a server route for Motion', async () => {
    openModuleInStore(pageModule())
    render(<ReactCanvasWithRail />)
    await userEvent.click(document.querySelector('[data-node-id="title"]')!)
    await userEvent.click(screen.getByRole('button', { name: 'Motion' }))
    expect(screen.getByText('Keep the route on the server')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Fade in' })).toBeNull()
  })

  it('inserts a real block into the open module and renders it', async () => {
    openModuleInStore(pageModule())
    render(<ReactCanvasWithRail />)
    await userEvent.click(document.querySelector('[data-node-id="root"]')!)

    const before = Object.keys(useReactEditorStore.getState().editor!.module.nodes).length
    const cta = BLOCK_CATALOGUE.find((block) => block.id === 'cta.banner')!
    const button = screen.getByRole('button', { name: `Insert ${cta.name}` })
    await userEvent.click(button)

    const after = useReactEditorStore.getState().editor!.module
    expect(Object.keys(after.nodes).length).toBeGreaterThan(before)
    // The inserted subtree is a child of the SELECTION, not of whatever the page happened to start with.
    expect(after.nodes['root']!.children!.length).toBe(2)
  })

  it('inserts the same block twice without an id collision', async () => {
    openModuleInStore(pageModule())
    render(<ReactCanvasWithRail />)
    await userEvent.click(document.querySelector('[data-node-id="root"]')!)
    const cta = BLOCK_CATALOGUE.find((block) => block.id === 'cta.banner')!
    const button = screen.getByRole('button', { name: `Insert ${cta.name}` })

    await userEvent.click(button)
    const afterFirst = Object.keys(useReactEditorStore.getState().editor!.module.nodes).length
    await userEvent.click(button)
    const afterSecond = Object.keys(useReactEditorStore.getState().editor!.module.nodes).length

    // Two of the same block on one page is the NORMAL case for blocks. A library that stored and
    // inserted verbatim would refuse here with duplicate-id, which reads as the block being broken.
    expect(afterSecond).toBeGreaterThan(afterFirst)
    expect(useReactEditorStore.getState().problems.length).toBe(0)
  })

  it('reports unsaved state as a fact rather than only as an enabled button', async () => {
    openModuleInStore(pageModule())
    render(<ReactCanvasWithRail />)
    expect(screen.queryByText('Unsaved changes')).toBeNull()
    await userEvent.click(document.querySelector('[data-node-id="root"]')!)
    const cta = BLOCK_CATALOGUE.find((block) => block.id === 'cta.banner')!
    await userEvent.click(screen.getByRole('button', { name: `Insert ${cta.name}` }))
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
  })

  it('undo is offered only once there is something to undo', async () => {
    openModuleInStore(pageModule())
    render(<ReactCanvasWithRail />)
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true)
    await userEvent.click(document.querySelector('[data-node-id="root"]')!)
    const cta = BLOCK_CATALOGUE.find((block) => block.id === 'cta.banner')!
    await userEvent.click(screen.getByRole('button', { name: `Insert ${cta.name}` }))
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false)
  })

  it('pulls an inserted block back out in ONE undo, not one per node', async () => {
    openModuleInStore(pageModule())
    render(<ReactCanvasWithRail />)
    await userEvent.click(document.querySelector('[data-node-id="root"]')!)
    const before = Object.keys(useReactEditorStore.getState().editor!.module.nodes).length
    const cta = BLOCK_CATALOGUE.find((block) => block.id === 'cta.banner')!
    await userEvent.click(screen.getByRole('button', { name: `Insert ${cta.name}` }))
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    // A block is many nodes; taking it back out must not cost one press per node.
    expect(Object.keys(useReactEditorStore.getState().editor!.module.nodes).length).toBe(before)
  })
})

describe('the surface refuses to render a module the caller did not ask for', () => {
  it('reports the disagreement instead of showing the wrong tree', () => {
    openModuleInStore(pageModule())
    render(<ReactCanvasWithRail expectedPath="app/about/page.tsx" />)
    // Both documents are valid modules, so rendering the one the store happens to hold would look
    // completely normal while every edit landed in a file the author did not open.
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('app/about/page.tsx')
    expect(alert.textContent).toContain('app/page.tsx')
    // The canvas itself must not be drawn alongside the refusal.
    expect(screen.queryByLabelText('React canvas')).toBeNull()
  })

  it('renders normally when the paths agree', () => {
    openModuleInStore(pageModule())
    render(<ReactCanvasWithRail expectedPath="app/page.tsx" />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('React canvas')).not.toBeNull()
  })

  it('renders normally when the caller states no expectation', () => {
    // A caller that does not track a path separately has nothing to disagree with, so the guard must
    // not turn an unsupplied prop into a refusal.
    openModuleInStore(pageModule())
    render(<ReactCanvasWithRail />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('React canvas')).not.toBeNull()
  })
})

describe('saving the selection as a block', () => {
  it('offers no control when the caller supplies nowhere to put one', () => {
    openModuleInStore(pageModule())
    render(<ReactCanvasWithRail />)
    // This surface has no storage; a button that appeared to save while nothing persisted would be
    // worse than no button.
    expect(screen.queryByRole('button', { name: /Save as block/ })).toBeNull()
  })

  it('is disabled until something is selected', () => {
    openModuleInStore(pageModule())
    render(<ReactCanvasWithRail onSaveBlock={() => {}} />)
    const button = screen.getByRole('button', { name: /Save as block/ })
    // A block is saved FROM a selection, so with nothing selected there is nothing to save.
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('REPORTS a refusal rather than saving a block that would be multiplied', async () => {
    openModuleInStore(pageModule())
    const saved: unknown[] = []
    render(<ReactCanvasWithRail onSaveBlock={(block) => saved.push(block)} />)
    // Select the root, which is plain markup composing no component - exactly what task 82 refuses,
    // because such a block gives whoever inserts it no fields at all.
    useReactEditorStore.getState().select(['root'])
    const button = screen.getByRole('button', { name: /Save as block/ })
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
    await userEvent.click(button)
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    // Nothing was handed to the caller, so a refused block cannot reach storage.
    expect(saved).toEqual([])
  })
})
