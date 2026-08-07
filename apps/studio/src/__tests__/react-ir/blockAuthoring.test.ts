/**
 * Saving a designed subtree AS a block — the user-authored half of the Blocks library.
 *
 * The correctness lives in the extraction being CLOSED. `instantiateBlock` mints fresh ids and remaps
 * references; a reference pointing outside the subtree survives that remap as a DANGLING id, and the
 * tree then fails verifyTree at save time — far from the insert, and further still from the save that
 * created the block.
 */
import { describe, expect, it } from 'bun:test'
import { blockFromSubtree } from '@core/react-ir/blockAuthoring'
import { insertBlock, idSourceFor } from '@core/react-ir/blockLibrary'
import { verifyTree } from '@core/react-ir/edit'
import { TENANT_SHADCN_COMPONENTS } from '@core/generatedSite/shadcnBaseline'
import { REACT_IR_VERSION, type ReactIrModule } from '@core/react-ir/nodes'

const TENANT = TENANT_SHADCN_COMPONENTS.map((component) => component.name)

const META = {
  id: 'my.hero',
  name: 'My hero',
  category: 'hero' as const,
  description: 'The hero I designed for this site.',
}

/** A page whose `section` composes a real tenant component, which is what task 82 requires. */
function page(): ReactIrModule {
  return {
    version: REACT_IR_VERSION,
    id: 'mod-1',
    kind: 'page',
    path: 'app/page.tsx',
    symbol: 'Page',
    rootNodeId: 'root',
    propsInterface: [],
    boundary: 'server',
    nodes: {
      root: { kind: 'element', id: 'root', tag: 'main', attributes: {}, children: ['section', 'other'] },
      section: { kind: 'element', id: 'section', tag: 'section', attributes: {}, children: ['title', 'cta'] },
      title: { kind: 'element', id: 'title', tag: 'h1', attributes: {}, children: ['titleText'] },
      titleText: { kind: 'text', id: 'titleText', value: 'Hello', children: [] },
      cta: {
        kind: 'component',
        id: 'cta',
        component: { id: 'button', symbol: 'Button', source: '@/components/ui/button' },
        children: [],
      },
      other: { kind: 'element', id: 'other', tag: 'footer', attributes: {}, children: [] },
    },
  } as ReactIrModule
}

describe('extracting a section', () => {
  it('collects the node and everything it reaches, and nothing else', () => {
    const result = blockFromSubtree(page(), 'section', META, TENANT)
    expect(result.ok, JSON.stringify(result.ok ? [] : result.problems)).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.block.subtree).sort()).toEqual(['cta', 'section', 'title', 'titleText'])
    // The sibling the author did not select must not be dragged in.
    expect(result.block.subtree['other']).toBeUndefined()
    expect(result.block.rootId).toBe('section')
  })

  it('produces a block that INSERTS cleanly, which is the property that matters', () => {
    const result = blockFromSubtree(page(), 'section', META, TENANT)
    if (!result.ok) throw new Error('expected a block')
    const target = page()
    const inserted = insertBlock(target, 'root', result.block, idSourceFor(target))
    expect(inserted.ok, JSON.stringify(inserted.problems)).toBe(true)
    // verifyTree is what a dangling reference would fail, so a clean tree proves the extraction closed.
    expect(verifyTree(inserted.module).length).toBe(0)
  })

  it('inserts TWICE without an id collision, so a saved block behaves like a shipped one', () => {
    const result = blockFromSubtree(page(), 'section', META, TENANT)
    if (!result.ok) throw new Error('expected a block')
    let module = page()
    const first = insertBlock(module, 'root', result.block, idSourceFor(module))
    expect(first.ok).toBe(true)
    module = first.module
    const second = insertBlock(module, 'root', result.block, idSourceFor(module))
    // Inserting the same block twice is the NORMAL case; a library that refuses the second reads as
    // the block being broken rather than as ids colliding.
    expect(second.ok, JSON.stringify(second.problems)).toBe(true)
    expect(verifyTree(second.module).length).toBe(0)
  })

  it('is saved as a BASE, never a variant', () => {
    const result = blockFromSubtree(page(), 'section', META, TENANT)
    if (!result.ok) throw new Error('expected a block')
    // Guessing a family from a saved selection would put unrelated blocks under one picker heading.
    expect(result.block.variantOf).toBeNull()
  })
})

describe('refusals', () => {
  it('refuses a node that is not on the page', () => {
    const result = blockFromSubtree(page(), 'nope', META, TENANT)
    expect(result.ok).toBe(false)
  })

  it('refuses a blank name or id', () => {
    const result = blockFromSubtree(page(), 'section', { ...META, name: '  ' }, TENANT)
    expect(result.ok).toBe(false)
  })

  it('refuses a blank description', () => {
    // The picker states what a block is FOR so it is choosable without inserting each one; a blank
    // description makes the author's own block the one they cannot identify later.
    const result = blockFromSubtree(page(), 'section', { ...META, description: '' }, TENANT)
    expect(result.ok).toBe(false)
  })

  it('refuses a hidden section', () => {
    const module = page()
    const hidden = {
      ...module,
      nodes: { ...module.nodes, section: { ...module.nodes['section'], hidden: true } },
    } as ReactIrModule
    const result = blockFromSubtree(hidden, 'section', META, TENANT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.some((p) => p.code === 'unreachable-node')).toBe(true)
  })

  it('refuses a subtree that references a node the page does not have', () => {
    const module = page()
    const broken = {
      ...module,
      nodes: {
        ...module.nodes,
        section: { ...module.nodes['section'], children: ['title', 'cta', 'ghost'] },
      },
    } as ReactIrModule
    const result = blockFromSubtree(broken, 'section', META, TENANT)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problems.some((p) => p.code === 'reference-outside-block')).toBe(true)
    }
  })

  it('applies the SAME review the shipped catalogue passes', () => {
    // A section of pure markup composes no component, so it gives whoever inserts it no fields at all
    // — the rule task 82 enforces on the built-in blocks.
    const module = page()
    const markupOnly = {
      ...module,
      nodes: { ...module.nodes, section: { ...module.nodes['section'], children: ['title'] } },
    } as ReactIrModule
    const result = blockFromSubtree(markupOnly, 'section', META, TENANT)
    expect(result.ok).toBe(false)
  })

  it('refuses a component the tenant does not receive', () => {
    const module = page()
    const unavailable = {
      ...module,
      nodes: {
        ...module.nodes,
        cta: {
          ...module.nodes['cta'],
          component: { id: 'carousel', symbol: 'Carousel', source: '@/components/ui/carousel' },
        },
      },
    } as ReactIrModule
    // Carousel is one of the seven excluded because its package is not pinned, so inserting it would
    // fail the TENANT'S build on a missing module.
    const result = blockFromSubtree(unavailable, 'section', META, TENANT)
    expect(result.ok).toBe(false)
  })

  it('reports EVERY problem rather than stopping at the first', () => {
    const result = blockFromSubtree(page(), 'section', { ...META, name: '', description: '' }, TENANT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.length).toBeGreaterThan(1)
  })
})
