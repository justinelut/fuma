import { describe, it, expect } from 'bun:test'
import {
  clearClassFamily,
  deleteNode,
  duplicateNode,
  insertNodes,
  isSelfOrDescendant,
  moveNode,
  parentOf,
  reorderChild,
  setClassTokens,
  verifyTree,
} from '@core/react-ir/edit'
import { generateModule } from '@core/react-ir/generate'
import { readModuleSource } from '@core/react-ir/read'
import type { ReactIrModule, ReactIrNode } from '@core/react-ir/nodes'

const element = (
  id: string,
  children: string[] = [],
  extra: Record<string, unknown> = {},
): ReactIrNode => ({
  kind: 'element', id, tag: 'div', classTokens: [], children, ...extra,
} as unknown as ReactIrNode)

function tree(nodes: Record<string, ReactIrNode>, rootNodeId = 'root'): ReactIrModule {
  return {
    version: 1, id: 'm1', path: 'app/page.tsx', symbol: 'Page', kind: 'page',
    rootNodeId, nodes,
  } as unknown as ReactIrModule
}

const base = () => tree({
  root: element('root', ['a', 'b']),
  a: element('a', ['a1']),
  a1: element('a1'),
  b: element('b'),
})

describe('navigating the tree', () => {
  it('finds a node’s parent', () => {
    expect(parentOf(base(), 'a1')).toBe('a')
    expect(parentOf(base(), 'root')).toBeNull()
  })

  it('knows a node is inside another', () => {
    expect(isSelfOrDescendant(base(), 'a', 'a1')).toBe(true)
    expect(isSelfOrDescendant(base(), 'a', 'a')).toBe(true)
    expect(isSelfOrDescendant(base(), 'a', 'b')).toBe(false)
  })
})

describe('inserting', () => {
  it('inserts a subtree at the end by default', () => {
    const result = insertNodes(base(), 'root', { n: element('n') }, 'n')
    expect(result.ok).toBe(true)
    expect(result.module.nodes['root']?.children).toEqual(['a', 'b', 'n'])
    expect(result.createdIds).toEqual(['n'])
  })

  it('inserts at an index', () => {
    const result = insertNodes(base(), 'root', { n: element('n') }, 'n', 1)
    expect(result.module.nodes['root']?.children).toEqual(['a', 'n', 'b'])
  })

  it('inserts a whole subtree as one operation', () => {
    // A block insertion should be a single undo step, not one per element.
    const result = insertNodes(base(), 'root', {
      w: element('w', ['w1']), w1: element('w1'),
    }, 'w')
    expect(result.ok).toBe(true)
    expect(result.createdIds?.length).toBe(2)
    expect(verifyTree(result.module)).toEqual([])
  })

  it('refuses colliding ids rather than renaming', () => {
    // Renaming would break references inside the subtree.
    const result = insertNodes(base(), 'root', { a: element('a') }, 'a')
    expect(result.ok).toBe(false)
    expect(result.problems[0]?.code).toBe('duplicate-id')
  })

  it('refuses a parent that cannot hold children', () => {
    const withText = tree({
      root: element('root', ['t']),
      t: { kind: 'text', id: 't', value: 'hi', children: [] } as unknown as ReactIrNode,
    })
    const result = insertNodes(withText, 't', { n: element('n') }, 'n')
    expect(result.ok).toBe(false)
    expect(result.problems[0]?.code).toBe('children-not-allowed')
  })

  it('refuses a locked parent', () => {
    const locked = tree({ root: element('root', [], { locked: true }) })
    expect(insertNodes(locked, 'root', { n: element('n') }, 'n').problems[0]?.code)
      .toBe('locked-node')
  })

  it('refuses an index outside the sibling range', () => {
    expect(insertNodes(base(), 'root', { n: element('n') }, 'n', 9).problems[0]?.code)
      .toBe('index-out-of-range')
  })

  it('leaves the original module untouched when it refuses', () => {
    const module = base()
    insertNodes(module, 'root', { a: element('a') }, 'a')
    expect(module.nodes['root']?.children).toEqual(['a', 'b'])
  })
})

describe('moving', () => {
  it('moves a node to a new parent', () => {
    const result = moveNode(base(), 'a1', 'b')
    expect(result.ok).toBe(true)
    expect(result.module.nodes['b']?.children).toEqual(['a1'])
    expect(result.module.nodes['a']?.children).toEqual([])
  })

  it('refuses to move a node inside itself', () => {
    // A cycle would make the tree ungeneratable, and the failure would appear far
    // from the drag that caused it.
    const result = moveNode(base(), 'a', 'a1')
    expect(result.ok).toBe(false)
    expect(result.problems[0]?.code).toBe('cycle-refused')
  })

  it('refuses to move a node into itself directly', () => {
    expect(moveNode(base(), 'a', 'a').problems[0]?.code).toBe('cycle-refused')
  })

  it('refuses to move the root', () => {
    expect(moveNode(base(), 'root', 'a').problems[0]?.code).toBe('cycle-refused')
  })

  it('refuses when the source parent is locked', () => {
    const locked = tree({
      root: element('root', ['a', 'b']),
      a: element('a', ['a1'], { locked: true }),
      a1: element('a1'),
      b: element('b'),
    })
    expect(moveNode(locked, 'a1', 'b').problems[0]?.code).toBe('locked-node')
  })

  it('keeps the tree verifiable after a move', () => {
    expect(verifyTree(moveNode(base(), 'a1', 'b').module)).toEqual([])
  })
})

describe('deleting', () => {
  it('removes a node and its whole subtree', () => {
    // Leaving descendants behind would orphan them in the node map.
    const result = deleteNode(base(), 'a')
    expect(result.ok).toBe(true)
    expect(result.module.nodes['a']).toBeUndefined()
    expect(result.module.nodes['a1']).toBeUndefined()
    expect(result.module.nodes['root']?.children).toEqual(['b'])
  })

  it('refuses to delete the root and says what to do instead', () => {
    const result = deleteNode(base(), 'root')
    expect(result.ok).toBe(false)
    expect(result.problems[0]?.code).toBe('root-not-deletable')
    expect(result.problems[0]?.message).toMatch(/Replace it instead/)
  })

  it('refuses a locked node', () => {
    const locked = tree({
      root: element('root', ['a']),
      a: element('a', [], { locked: true }),
    })
    expect(deleteNode(locked, 'a').problems[0]?.code).toBe('locked-node')
  })

  it('leaves no dangling references', () => {
    expect(verifyTree(deleteNode(base(), 'a').module)).toEqual([])
  })
})

describe('duplicating', () => {
  it('places the copy immediately after the original', () => {
    const result = duplicateNode(base(), 'a', (id) => `${id}-copy`)
    expect(result.ok).toBe(true)
    expect(result.module.nodes['root']?.children).toEqual(['a', 'a-copy', 'b'])
  })

  it('remaps references inside the copy', () => {
    // Without remapping, the copy's children would still point at the original's, so
    // editing one would change both.
    const result = duplicateNode(base(), 'a', (id) => `${id}-copy`)
    expect(result.module.nodes['a-copy']?.children).toEqual(['a1-copy'])
    expect(result.module.nodes['a1-copy']).toBeDefined()
    expect(result.module.nodes['a']?.children).toEqual(['a1'])
  })

  it('refuses when the generated id already exists', () => {
    expect(duplicateNode(base(), 'a', () => 'b').problems[0]?.code).toBe('duplicate-id')
  })

  it('refuses to duplicate the root', () => {
    expect(duplicateNode(base(), 'root', (id) => `${id}-copy`).problems[0]?.code)
      .toBe('cycle-refused')
  })

  it('produces a verifiable tree', () => {
    expect(verifyTree(duplicateNode(base(), 'a', (id) => `${id}-copy`).module)).toEqual([])
  })

  it('generates valid source for the duplicated tree', () => {
    // The real test of a tree edit is that the result still emits code.
    const result = duplicateNode(base(), 'a', (id) => `${id}-copy`)
    expect(() => generateModule(result.module)).not.toThrow()
  })
})

describe('class tokens', () => {
  it('replaces a conflicting token rather than appending', () => {
    // Appending would leave both and make the outcome depend on emission order.
    const module = tree({ root: element('root', [], { classTokens: ['p-4', 'flex'] }) })
    const result = setClassTokens(module, 'root', ['p-8'])
    expect(result.module.nodes['root']?.classTokens).toEqual(['p-8', 'flex'])
  })

  it('adds a non-conflicting token', () => {
    const module = tree({ root: element('root', [], { classTokens: ['flex'] }) })
    expect(setClassTokens(module, 'root', ['gap-2']).module.nodes['root']?.classTokens)
      .toEqual(['flex', 'gap-2'])
  })

  it('keeps a responsive override beside its base', () => {
    const module = tree({ root: element('root', [], { classTokens: ['p-4'] }) })
    expect(setClassTokens(module, 'root', ['md:p-8']).module.nodes['root']?.classTokens)
      .toEqual(['p-4', 'md:p-8'])
  })

  it('clears a whole family', () => {
    const module = tree({ root: element('root', [], { classTokens: ['p-4', 'flex', 'gap-2'] }) })
    expect(clearClassFamily(module, 'root', 'p-8').module.nodes['root']?.classTokens)
      .toEqual(['flex', 'gap-2'])
  })

  it('refuses a node that renders no element of its own', () => {
    const withText = tree({
      root: element('root', ['t']),
      t: { kind: 'text', id: 't', value: 'hi', children: [] } as unknown as ReactIrNode,
    })
    expect(setClassTokens(withText, 't', ['p-4']).problems[0]?.code)
      .toBe('children-not-allowed')
  })

  it('refuses a locked node', () => {
    const locked = tree({ root: element('root', [], { locked: true }) })
    expect(setClassTokens(locked, 'root', ['p-4']).problems[0]?.code).toBe('locked-node')
  })
})

describe('reordering', () => {
  it('moves a child to a new index', () => {
    const result = reorderChild(base(), 'root', 'b', 0)
    expect(result.module.nodes['root']?.children).toEqual(['b', 'a'])
  })

  it('refuses a node that is not a child of the parent', () => {
    expect(reorderChild(base(), 'root', 'a1', 0).problems[0]?.code).toBe('unknown-node')
  })

  it('refuses an out-of-range index', () => {
    expect(reorderChild(base(), 'root', 'a', 5).problems[0]?.code).toBe('index-out-of-range')
  })
})

describe('verifying a tree', () => {
  it('passes a sound tree', () => {
    expect(verifyTree(base())).toEqual([])
  })

  it('reports a missing root', () => {
    expect(verifyTree(tree({ a: element('a') }, 'root'))[0]?.message).toMatch(/not in the node map/)
  })

  it('reports an unreachable node', () => {
    const orphaned = tree({ root: element('root'), stray: element('stray') })
    expect(verifyTree(orphaned)[0]?.message).toMatch(/unreachable/)
  })

  it('reports a dangling child reference', () => {
    const dangling = tree({ root: element('root', ['ghost']) })
    expect(verifyTree(dangling).some((problem) => problem.message.includes('does not exist')))
      .toBe(true)
  })

  it('reports a node claimed by two parents', () => {
    // Not a cycle, but equally broken: the output would contain it twice under one id.
    const shared = tree({
      root: element('root', ['a', 'b']),
      a: element('a', ['shared']),
      b: element('b', ['shared']),
      shared: element('shared'),
    })
    expect(verifyTree(shared).some((problem) => problem.code === 'duplicate-id')).toBe(true)
  })

  it('reports children on a node that cannot hold them', () => {
    const bad = tree({
      root: element('root', ['t']),
      t: { kind: 'text', id: 't', value: 'x', children: ['n'] } as unknown as ReactIrNode,
      n: element('n'),
    })
    expect(verifyTree(bad).some((problem) => problem.code === 'children-not-allowed')).toBe(true)
  })
})

describe('the full canvas editing cycle', () => {
  const source = `export default function Page() {
  return (
    <section /* @fuma root */ className="grid gap-6">
      <h1 /* @fuma title */ className="text-4xl">Hello</h1>
      <p /* @fuma copy */ className="text-base">Body</p>
    </section>
  )
}
`

  function moduleFromSource() {
    const read = readModuleSource('app/page.tsx', source)
    expect(read.diagnostics).toEqual([])
    return {
      version: 1, id: 'm1', path: 'app/page.tsx', symbol: 'Page', kind: 'page',
      rootNodeId: read.rootNodeId, nodes: read.nodes,
    } as unknown as ReactIrModule
  }

  it('reads real source, edits it, and regenerates valid source', () => {
    // This is the operation the canvas performs on every interaction, so it has to
    // survive the whole loop rather than each step in isolation.
    let module = moduleFromSource()

    module = setClassTokens(module, 'title', ['text-5xl']).module
    module = insertNodes(module, 'root', {
      cta: element('cta', [], { tag: 'button', classTokens: ['bg-primary'] }),
    }, 'cta').module
    module = moveNode(module, 'cta', 'root', 0).module

    expect(verifyTree(module)).toEqual([])
    expect(module.nodes['root']?.children).toEqual(['cta', 'title', 'copy'])

    const generated = generateModule(module, { anchorComments: true })
    const reread = readModuleSource('app/page.tsx', generated.code)
    expect(reread.diagnostics).toEqual([])
  })

  it('preserves every element id through an edit cycle', () => {
    // Identity is what lets a second edit address the same element. Losing it would
    // make consecutive edits unreliable in a way that is hard to notice.
    let module = moduleFromSource()
    module = insertNodes(module, 'root', {
      cta: element('cta', [], { tag: 'button', classTokens: ['bg-primary'] }),
    }, 'cta').module

    const generated = generateModule(module, { anchorComments: true })
    const reread = readModuleSource('app/page.tsx', generated.code)
    for (const id of ['root', 'title', 'copy', 'cta']) {
      expect(reread.nodes[id]).toBeDefined()
    }
  })

  it('replaces a conflicting size rather than stacking two', () => {
    // Found by running this cycle: text-4xl and text-5xl both survived, leaving the
    // outcome to Tailwind's emission order.
    const module = moduleFromSource()
    const result = setClassTokens(module, 'title', ['text-5xl'])
    expect(result.module.nodes['title']?.classTokens).toEqual(['text-5xl'])
  })

  it('deletes through the cycle without leaving damage', () => {
    let module = moduleFromSource()
    module = deleteNode(module, 'copy').module
    expect(verifyTree(module)).toEqual([])
    const reread = readModuleSource('app/page.tsx',
      generateModule(module, { anchorComments: true }).code)
    expect(reread.diagnostics).toEqual([])
    expect(reread.nodes['copy']).toBeUndefined()
  })

  it('survives repeated edit cycles without drift', () => {
    // Two rounds, because a transformation that is not idempotent shows up on the
    // second pass rather than the first.
    let module = moduleFromSource()
    for (let round = 0; round < 2; round += 1) {
      const generated = generateModule(module, { anchorComments: true })
      const reread = readModuleSource('app/page.tsx', generated.code)
      expect(reread.diagnostics).toEqual([])
      module = {
        ...module, nodes: reread.nodes, rootNodeId: reread.rootNodeId,
      } as unknown as ReactIrModule
    }
    expect(verifyTree(module)).toEqual([])
  })
})
