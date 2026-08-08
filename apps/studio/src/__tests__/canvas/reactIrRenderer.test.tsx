import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import {
  CANVAS_NODE_ATTRIBUTE,
  isSelectable,
  nodeIdFromElement,
  renderModuleForCanvas,
  resolveForCanvas,
  visibleNodeIds,
} from '@site/canvas/reactIrRenderer'
import type { ReactIrModule, ReactIrNode } from '@core/react-ir/nodes'

afterEach(cleanup)

const element = (
  id: string,
  tag: string,
  children: string[] = [],
  extra: Record<string, unknown> = {},
): ReactIrNode => ({
  kind: 'element', id, tag, classTokens: [], children, ...extra,
} as unknown as ReactIrNode)

function moduleOf(nodes: Record<string, ReactIrNode>, rootNodeId = 'root'): ReactIrModule {
  return {
    version: 1, id: 'm1', path: 'app/page.tsx', symbol: 'Page', kind: 'page',
    rootNodeId, nodes,
  } as unknown as ReactIrModule
}

function renderModule(module: ReactIrModule, options: Record<string, unknown> = {}) {
  const tree = renderModuleForCanvas({ module, ...options } as never)
  return render(tree)
}

describe('rendering elements', () => {
  it('renders the tag with its class tokens', () => {
    const { container } = renderModule(moduleOf({
      root: element('root', 'section', [], { classTokens: ['grid', 'gap-6'] }),
    }))
    const node = container.querySelector('section')
    expect(node).not.toBeNull()
    expect(node?.className).toBe('grid gap-6')
  })

  it('marks every element with its node id for selection', () => {
    // The attribute the canvas selects and measures by.
    const { container } = renderModule(moduleOf({
      root: element('root', 'section', ['title']),
      title: element('title', 'h1'),
    }))
    expect(container.querySelector(`[${CANVAS_NODE_ATTRIBUTE}="root"]`)).not.toBeNull()
    expect(container.querySelector(`[${CANVAS_NODE_ATTRIBUTE}="title"]`)).not.toBeNull()
  })

  it('marks selected nodes without marking their unselected siblings', () => {
    const module = moduleOf({
      root: element('root', 'section', ['title']),
      title: element('title', 'h1'),
    })
    const { container } = renderModule(module, { selectedNodeIds: new Set(['title']) })
    expect(container.querySelector('[data-node-id="title"]')?.getAttribute('data-canvas-selected'))
      .toBe('true')
    expect(container.querySelector('[data-node-id="root"]')?.hasAttribute('data-canvas-selected'))
      .toBe(false)
  })

  it('nests children inside their parent', () => {
    const { container } = renderModule(moduleOf({
      root: element('root', 'section', ['title']),
      title: element('title', 'h1'),
    }))
    expect(container.querySelector('section > h1')).not.toBeNull()
  })

  it('renders text as the element’s content', () => {
    const { container } = renderModule(moduleOf({
      root: element('root', 'h1', ['t']),
      t: { kind: 'text', id: 't', value: 'Own your site', children: [] } as unknown as ReactIrNode,
    }))
    expect(container.querySelector('h1')?.textContent).toBe('Own your site')
  })

  it('renders a void element without children', () => {
    // React throws if a void element is given children, even an empty array.
    expect(() => renderModule(moduleOf({ root: element('root', 'img') }))).not.toThrow()
  })

  it('applies the style escape hatch', () => {
    const { container } = renderModule(moduleOf({
      root: element('root', 'div', [], { style: { clipPath: 'circle(50%)' } }),
    }))
    expect(container.querySelector('div')?.getAttribute('style')).toContain('circle(50%)')
  })

  it('omits event handlers, which affect no layout and warn in React', () => {
    const { container } = renderModule(moduleOf({
      root: element('root', 'button', [], {
        attributes: {
          onClick: { kind: 'expression', expression: { kind: 'literal', value: 'run' } },
          id: { kind: 'expression', expression: { kind: 'literal', value: 'cta' } },
        },
      }),
    }))
    const node = container.querySelector('button')
    expect(node?.getAttribute('id')).toBe('cta')
    expect(node?.getAttribute('onClick')).toBeNull()
  })
})

describe('hidden nodes', () => {
  it('leaves a hidden node out of the rendered tree', () => {
    // Hiding stays reversible because the node remains in the IR.
    const { container } = renderModule(moduleOf({
      root: element('root', 'section', ['shown', 'gone']),
      shown: element('shown', 'p'),
      gone: element('gone', 'span', [], { hidden: true }),
    }))
    expect(container.querySelector('p')).not.toBeNull()
    expect(container.querySelector('span')).toBeNull()
  })

  it('excludes hidden nodes from the visible order', () => {
    // The layer list should agree with what is actually on screen.
    const module = moduleOf({
      root: element('root', 'section', ['shown', 'gone']),
      shown: element('shown', 'p'),
      gone: element('gone', 'span', [], { hidden: true }),
    })
    expect(visibleNodeIds(module)).toEqual(['root', 'shown'])
  })
})

describe('components and opaque regions', () => {
  it('renders a labelled stand-in for a component', () => {
    // The implementation is not available here, so guessing at its markup would let
    // an author trust a layout that is not real.
    const { container } = renderModule(moduleOf({
      root: {
        kind: 'component', id: 'root',
        component: { id: 'x', symbol: 'Hero', source: './Hero' },
        props: {}, slots: {}, classTokens: ['grid'], children: [],
      } as unknown as ReactIrNode,
    }))
    const node = container.querySelector('[data-component-symbol="Hero"]')
    expect(node).not.toBeNull()
    expect(node?.getAttribute(CANVAS_NODE_ATTRIBUTE)).toBe('root')
  })

  it('marks an opaque region rather than executing it', () => {
    const { container } = renderModule(moduleOf({
      root: {
        kind: 'opaque', id: 'root', symbol: 'Legacy', source: './legacy',
        sourceHash: 'a'.repeat(64), children: [],
      } as unknown as ReactIrNode,
    }))
    expect(container.querySelector('[data-opaque="Legacy"]')).not.toBeNull()
  })

  it('marks the outlet slot without inventing page content', () => {
    const { container } = renderModule(moduleOf({
      root: element('root', 'div', ['slot']),
      slot: { kind: 'outlet', id: 'slot', children: [] } as unknown as ReactIrNode,
    }))
    expect(container.querySelector('[data-outlet]')).not.toBeNull()
  })
})

describe('repeat preview', () => {
  const repeatModule = moduleOf({
    root: {
      kind: 'repeat', id: 'root', source: { id: 'posts' }, key: 'id',
      variants: ['row'], children: [],
    } as unknown as ReactIrNode,
    row: element('row', 'article', ['title']),
    title: {
      kind: 'expression', id: 'title',
      expression: { kind: 'member', scope: 'item', path: ['title'], format: 'text' },
      children: [],
    } as unknown as ReactIrNode,
  })

  it('renders one unbound variant when no sample rows exist', () => {
    // An empty region would look like a broken loop rather than an unbound one.
    const { container } = renderModule(repeatModule)
    expect(container.querySelector('[data-repeat-unbound]')).not.toBeNull()
    expect(container.querySelectorAll('article')).toHaveLength(1)
  })

  it('renders one variant per sample row', () => {
    const { container } = renderModule(repeatModule, {
      sampleRows: { posts: [{ id: 1, title: 'First' }, { id: 2, title: 'Second' }] },
    })
    expect(container.querySelectorAll('article')).toHaveLength(2)
    expect(container.textContent).toContain('First')
    expect(container.textContent).toContain('Second')
  })

  it('caps the preview so the canvas stays about judging design', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({ id: index, title: `Row ${index}` }))
    const { container } = renderModule(repeatModule, { sampleRows: { posts: rows } })
    expect(container.querySelectorAll('article')).toHaveLength(3)
  })

  it('respects an explicit sample limit', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({ id: index, title: `Row ${index}` }))
    const { container } = renderModule(repeatModule, {
      sampleRows: { posts: rows }, sampleLimit: 5,
    })
    expect(container.querySelectorAll('article')).toHaveLength(5)
  })
})

describe('resolving expressions for display', () => {
  const context = { module: moduleOf({ root: element('root', 'div') }) }

  it('shows a literal directly', () => {
    expect(resolveForCanvas({ kind: 'literal', value: 'Hello' } as never, context as never))
      .toBe('Hello')
  })

  it('reads a field from the row being mapped', () => {
    expect(resolveForCanvas(
      { kind: 'member', scope: 'item', path: ['title'], format: 'text' } as never,
      context as never,
      { title: 'From the row' },
    )).toBe('From the row')
  })

  it('prefers the declared fallback when the value is missing', () => {
    // The fallback is what the page will actually show, so preferring it keeps the
    // canvas honest.
    expect(resolveForCanvas(
      { kind: 'member', scope: 'item', path: ['title'], format: 'text', fallback: 'Untitled' } as never,
      context as never,
      {},
    )).toBe('Untitled')
  })

  it('names the binding when there is neither value nor fallback', () => {
    // A visible placeholder beats an empty space: the author can see the binding
    // exists and where it lands.
    expect(resolveForCanvas(
      { kind: 'member', scope: 'entry', path: ['author', 'name'], format: 'text' } as never,
      context as never,
    )).toBe('{entry.author.name}')
  })

  it('assembles a template around its parts', () => {
    expect(resolveForCanvas({
      kind: 'template',
      quasis: ['By ', ''],
      parts: [{ kind: 'literal', value: 'Ada' }],
    } as never, context as never)).toBe('By Ada')
  })

  it('shows the true branch of a conditional', () => {
    expect(resolveForCanvas({
      kind: 'conditional',
      test: { scope: 'item', path: ['featured'], operator: 'exists' },
      whenTrue: { kind: 'literal', value: 'Featured' },
      whenFalse: { kind: 'literal', value: 'Standard' },
    } as never, context as never)).toBe('Featured')
  })

  it('reads a prop when one is supplied', () => {
    expect(resolveForCanvas(
      { kind: 'member', scope: 'prop', path: ['heading'], format: 'text' } as never,
      { ...context, props: { heading: 'Given' } } as never,
    )).toBe('Given')
  })
})

describe('selection helpers', () => {
  it('finds the node id from a nested DOM element', () => {
    const { container } = renderModule(moduleOf({
      root: element('root', 'section', ['title']),
      title: element('title', 'h1'),
    }))
    expect(nodeIdFromElement(container.querySelector('h1'))).toBe('title')
  })

  it('walks up to the nearest marked ancestor', () => {
    const { container } = renderModule(moduleOf({
      root: element('root', 'section', ['t']),
      t: { kind: 'text', id: 't', value: 'Hello', children: [] } as unknown as ReactIrNode,
    }))
    // Text renders as a bare string, so the nearest marked element is the parent.
    expect(nodeIdFromElement(container.querySelector('section'))).toBe('root')
  })

  it('returns null outside the canvas', () => {
    expect(nodeIdFromElement(null)).toBeNull()
  })

  it('treats text and expression nodes as unselectable by pointer', () => {
    // They render as bare strings with no element of their own, so there is nothing
    // for a pointer to hit; the layer list selects them instead.
    expect(isSelectable({ kind: 'text' } as never)).toBe(false)
    expect(isSelectable({ kind: 'expression' } as never)).toBe(false)
    expect(isSelectable({ kind: 'element' } as never)).toBe(true)
    expect(isSelectable(undefined)).toBe(false)
  })
})
