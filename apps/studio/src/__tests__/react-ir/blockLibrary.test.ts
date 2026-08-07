/**
 * Tasks 81/82/83: the Blocks library, composed from shadcn, with variants.
 *
 * Everything here runs against the REAL editor (edit.ts) and the REAL tenant component set
 * (shadcnBaseline), because the central claim - that a stored subtree cannot be inserted twice - is a
 * behaviour of the shipped code rather than a property of my model.
 */
import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import {
  BLOCK_CONTRACT,
  familyOf,
  idSourceFor,
  insertBlock,
  instantiateBlock,
  reviewBlock,
  type BlockDefinition,
} from '../../core/react-ir/blockLibrary'
import {
  BLOCK_CATALOGUE,
  BLOCK_CATEGORY_ORDER,
  blocksInCategory,
} from '../../core/react-ir/blockCatalogue'
import { insertNodes, verifyTree } from '../../core/react-ir/edit'
import {
  ReactIrModuleSchema,
  REACT_IR_VERSION,
  childIdsOf,
  type ReactIrModule,
} from '../../core/react-ir/nodes'
import { TENANT_SHADCN_COMPONENTS } from '../../core/generatedSite/shadcnBaseline'

const TENANT_NAMES = TENANT_SHADCN_COMPONENTS.map((c) => c.name)

/** An empty page, valid against the shipped schema. */
function emptyPage(): ReactIrModule {
  const built = {
    version: REACT_IR_VERSION,
    id: 'page-under-test',
    path: 'app/page.tsx',
    symbol: 'Page',
    kind: 'page',
    boundary: 'server',
    rootNodeId: 'root',
    nodes: { root: { id: 'root', kind: 'element', tag: 'main', attributes: {}, children: [] } },
    propsInterface: [],
  } as unknown as ReactIrModule
  expect(Value.Check(ReactIrModuleSchema, built)).toBe(true)
  return built
}

const hero = BLOCK_CATALOGUE.find((b) => b.id === 'hero.centred')!

describe('THE CONSTRAINT: a stored subtree cannot be inserted twice', () => {
  it('the real editor refuses a colliding id rather than renaming', () => {
    // This is the fact the whole library is shaped around, asserted against edit.ts itself.
    const page = emptyPage()
    const first = insertNodes(page, 'root', hero.subtree, hero.rootId, 0)
    expect(first.ok).toBe(true)
    const second = insertNodes(first.module, 'root', hero.subtree, hero.rootId, 1)
    expect(second.ok).toBe(false)
    expect(second.problems.map((p) => p.code)).toContain('duplicate-id')
    // Its own message states the caller's obligation, which is what instantiateBlock discharges.
    expect(second.problems[0]!.message).toContain('fresh ids')
  })

  it('so inserting the SAME block twice through insertBlock succeeds', () => {
    // Three feature cards or two calls to action is the normal case, not an edge case.
    const page = emptyPage()
    const mint = idSourceFor(page)
    const first = insertBlock(page, 'root', hero, mint, 0)
    expect(first.ok).toBe(true)
    const second = insertBlock(first.module, 'root', hero, mint, 1)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    // Both instances are present and distinct.
    expect(childIdsOf(second.module.nodes.root!)).toHaveLength(2)
    expect(verifyTree(second.module)).toHaveLength(0)
  })

  it('and a third insertion still works, so the library does not degrade with use', () => {
    let page = emptyPage()
    const mint = idSourceFor(page)
    for (let i = 0; i < 3; i += 1) {
      const result = insertBlock(page, 'root', hero, mint, i)
      expect(result.ok).toBe(true)
      if (result.ok) page = result.module
    }
    expect(childIdsOf(page.nodes.root!)).toHaveLength(3)
    expect(verifyTree(page)).toHaveLength(0)
  })
})

describe('instantiation remaps references, not just ids', () => {
  it('every child reference points inside the copy', () => {
    // Remapping ids without remapping references is the failure that leaves two parents for one node,
    // and verifyTree only catches it at save time.
    const instance = instantiateBlock(hero, idSourceFor(emptyPage()))
    for (const node of Object.values(instance.subtree)) {
      for (const childId of childIdsOf(node)) {
        expect(instance.subtree[childId]).toBeDefined()
      }
    }
  })

  it('no original id survives in the copy', () => {
    const instance = instantiateBlock(hero, idSourceFor(emptyPage()))
    for (const originalId of Object.keys(hero.subtree)) {
      expect(instance.subtree[originalId]).toBeUndefined()
    }
  })

  it('node ids held inside a component slot are remapped too', () => {
    // childIdsOf reads slots as well as children, so a remap that skipped them would produce a copy
    // sharing the original's nodes.
    const withSlot: BlockDefinition = {
      id: 'probe.slot', name: 'Probe', category: 'features', description: 'x', variantOf: null,
      rootId: 'p-root',
      subtree: {
        'p-root': {
          id: 'p-root', kind: 'component',
          component: { id: 'ui.card', symbol: 'Card', source: '@/components/ui/card' },
          children: [], slots: { footer: ['p-child'] },
        } as never,
        'p-child': { id: 'p-child', kind: 'element', tag: 'div', attributes: {}, children: [] } as never,
      },
    } as unknown as BlockDefinition
    const instance = instantiateBlock(withSlot, idSourceFor(emptyPage()))
    const root = instance.subtree[instance.rootId]! as unknown as { slots: Record<string, string[]> }
    expect(root.slots.footer![0]).not.toBe('p-child')
    expect(instance.subtree[root.slots.footer![0]!]).toBeDefined()
  })

  it('the minted id keeps the readable part of the original', () => {
    // `hero-title-0` says which node it is in a diagnostic; `n-14` does not.
    const instance = instantiateBlock(hero, idSourceFor(emptyPage()))
    expect(instance.idMap['hero-title']).toContain('hero-title')
  })

  it('and does not accumulate counters when a block is instantiated repeatedly', () => {
    const page = emptyPage()
    const mint = idSourceFor(page)
    const once = instantiateBlock(hero, mint)
    const rebuilt: BlockDefinition = { ...hero, subtree: once.subtree, rootId: once.rootId }
    const twice = instantiateBlock(rebuilt, mint)
    for (const id of Object.keys(twice.subtree)) {
      // At most one trailing counter, never `hero-title-3-7`.
      expect(id).not.toMatch(/-\d+-\d+$/)
    }
  })

  it('the mint never produces an id the page already holds', () => {
    // Otherwise the mint itself causes the collision it exists to avoid.
    const page = emptyPage()
    const occupied = { ...page, nodes: { ...page.nodes, 'hero-title-0': page.nodes.root! } } as ReactIrModule
    const instance = instantiateBlock(hero, idSourceFor(occupied))
    expect(Object.values(instance.idMap)).not.toContain('hero-title-0')
  })
})

describe('a block insertion is ONE undo step', () => {
  it('because it goes through a single insertNodes call', () => {
    // Pulling an inserted hero back out must not take eleven presses of undo, which is why edit.ts
    // made whole-subtree insertion the mechanism.
    const page = emptyPage()
    const result = insertBlock(page, 'root', hero, idSourceFor(page), 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // One operation produced every node at once, so the previous module is the whole undo state.
    expect(Object.keys(result.module.nodes).length).toBeGreaterThan(Object.keys(page.nodes).length + 1)
    expect(Object.keys(page.nodes)).toHaveLength(1)
  })
})

describe('82: every shipped block composes only components a tenant receives', () => {
  it('the whole catalogue reviews clean against the REAL tenant set', () => {
    // A gate that cries wolf on the shipped set gets switched off, so this is the control case.
    for (const block of BLOCK_CATALOGUE) {
      expect(reviewBlock(block, TENANT_NAMES)).toEqual([])
    }
  })

  it('and a block naming an unavailable component is refused with the build consequence named', () => {
    // Proven both ways: `carousel` is one of the seven task 71 excluded for an unpinned package.
    const rogue: BlockDefinition = {
      ...hero,
      id: 'rogue',
      subtree: {
        ...hero.subtree,
        'hero-button': {
          id: 'hero-button', kind: 'component',
          component: { id: 'ui.carousel', symbol: 'Carousel', source: '@/components/ui/carousel' },
          children: [],
        } as never,
      },
    }
    const problems = reviewBlock(rogue, TENANT_NAMES)
    expect(problems.map((p) => p.code)).toContain('component-not-available-to-tenant')
    expect(problems.find((p) => p.code === 'component-not-available-to-tenant')!.message).toContain('fail to build')
  })

  it('a compound export like CardHeader resolves to its own file', () => {
    // The tenant set is keyed by file name while a node names the exported symbol; a strict comparison
    // would report every correct Card block as naming something unavailable.
    const features = BLOCK_CATALOGUE.find((b) => b.id === 'features.three')!
    const symbols = Object.values(features.subtree)
      .filter((n) => n.kind === 'component')
      .map((n) => (n as unknown as { component: { symbol: string } }).component.symbol)
    expect(symbols).toContain('CardHeader')
    expect(reviewBlock(features, TENANT_NAMES)).toEqual([])
  })

  it('every component a block names really is in the tenant set', () => {
    const available = new Set(TENANT_NAMES)
    for (const block of BLOCK_CATALOGUE) {
      for (const node of Object.values(block.subtree)) {
        if (node.kind !== 'component') continue
        const file = (node as unknown as { component: { source: string } }).component.source
          .replace('@/components/ui/', '')
        expect(available.has(file)).toBe(true)
      }
    }
  })

  it('bare elements are still used for structure, so this does not contradict task 61', () => {
    // Wrapping a section in a component would add indirection the canvas cannot style.
    const tags = Object.values(hero.subtree)
      .filter((n) => n.kind === 'element')
      .map((n) => (n as unknown as { tag: string }).tag)
    expect(tags).toContain('section')
    expect(tags).toContain('h1')
  })
})

describe('the review catches blocks that would fail after insertion', () => {
  it('a block composing nothing has no configurable content', () => {
    const markupOnly: BlockDefinition = {
      id: 'markup', name: 'Markup', category: 'features', description: 'x', variantOf: null,
      rootId: 'm-root',
      subtree: { 'm-root': { id: 'm-root', kind: 'element', tag: 'section', attributes: {}, children: [] } as never },
    }
    expect(reviewBlock(markupOnly, TENANT_NAMES).map((p) => p.code)).toContain('block-composes-nothing')
  })

  it('a root not in the subtree stops the review rather than reporting everything unreachable', () => {
    const broken: BlockDefinition = { ...hero, rootId: 'absent' }
    const problems = reviewBlock(broken, TENANT_NAMES)
    expect(problems).toHaveLength(1)
    expect(problems[0]!.code).toBe('root-not-in-subtree')
  })

  it('an unreachable node is reported, because it never renders yet travels with every insert', () => {
    const withOrphan: BlockDefinition = {
      ...hero,
      subtree: {
        ...hero.subtree,
        orphan: { id: 'orphan', kind: 'element', tag: 'div', attributes: {}, children: [] } as never,
      },
    }
    const problems = reviewBlock(withOrphan, TENANT_NAMES)
    expect(problems.map((p) => p.code)).toContain('unreachable-node')
    expect(problems.find((p) => p.code === 'unreachable-node')!.nodeId).toBe('orphan')
  })

  it('a reference the block does not contain is reported before it becomes a dangling id', () => {
    const dangling: BlockDefinition = {
      ...hero,
      subtree: {
        ...hero.subtree,
        'hero-root': { ...(hero.subtree['hero-root'] as never), children: ['hero-title', 'not-here'] } as never,
      },
    }
    expect(reviewBlock(dangling, TENANT_NAMES).map((p) => p.code)).toContain('reference-outside-block')
  })
})

describe('83: the shipped set and its variants', () => {
  it('covers the sections a page repeats', () => {
    const categories = new Set(BLOCK_CATALOGUE.map((b) => b.category))
    expect(categories.has('hero')).toBe(true)
    expect(categories.has('features')).toBe(true)
    expect(categories.has('call-to-action')).toBe(true)
  })

  it('a variant is its own saved subtree, not a prop', () => {
    const split = BLOCK_CATALOGUE.find((b) => b.id === 'hero.split')!
    expect(split.variantOf).toBe('hero.centred')
    // It differs in its TREE - a media column - which no prop on the centred block could express.
    expect(Object.keys(split.subtree)).toContain('split-media')
  })

  it('familyOf groups a variant with its base, base first', () => {
    const family = familyOf(BLOCK_CATALOGUE, 'hero.centred')
    expect(family.map((b) => b.id)).toEqual(['hero.centred', 'hero.split'])
  })

  it('every block id is unique, or a picker would offer the same one twice', () => {
    const ids = BLOCK_CATALOGUE.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every variantOf names a block that exists', () => {
    const ids = new Set(BLOCK_CATALOGUE.map((b) => b.id))
    for (const block of BLOCK_CATALOGUE) {
      if (block.variantOf !== null) expect(ids.has(block.variantOf)).toBe(true)
    }
  })

  it('every block states what it is FOR, so the picker is choosable without inserting each one', () => {
    for (const block of BLOCK_CATALOGUE) {
      expect(block.description.length).toBeGreaterThan(30)
      expect(block.name.length).toBeGreaterThan(0)
    }
  })

  it('every category in the order list is a real category value', () => {
    for (const category of BLOCK_CATEGORY_ORDER) {
      expect(blocksInCategory(category).every((b) => b.category === category)).toBe(true)
    }
  })

  it('the set stays small enough to read', () => {
    // A library of forty near-identical heroes makes choosing harder than building.
    expect(BLOCK_CATALOGUE.length).toBeLessThanOrEqual(12)
  })
})

describe('every shipped block actually inserts into a real page', () => {
  it('all of them, verified clean by the real verifyTree', () => {
    // The strongest single check here: a block that cannot be inserted is not a block.
    for (const block of BLOCK_CATALOGUE) {
      const page = emptyPage()
      const result = insertBlock(page, 'root', block, idSourceFor(page), 0)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(verifyTree(result.module)).toHaveLength(0)
      expect(Value.Check(ReactIrModuleSchema, result.module)).toBe(true)
    }
  })

  it('and two different blocks coexist in one page', () => {
    let page = emptyPage()
    const mint = idSourceFor(page)
    for (const block of [hero, BLOCK_CATALOGUE.find((b) => b.id === 'cta.banner')!]) {
      const result = insertBlock(page, 'root', block, mint)
      expect(result.ok).toBe(true)
      if (result.ok) page = result.module
    }
    expect(verifyTree(page)).toHaveLength(0)
  })
})

describe('the contract states what a block does not promise', () => {
  it('including that it does not update retroactively', () => {
    expect(BLOCK_CONTRACT.noRetroactiveUpdate).toContain('does not change pages')
    expect(BLOCK_CONTRACT.copiedOnInsert).toContain('copied')
    expect(BLOCK_CONTRACT.freshIdsEveryInsert).toContain('refuses colliding ids')
    expect(BLOCK_CONTRACT.variantsAreSeparateBlocks).toContain('own saved subtree')
  })
})
