import { describe, it, expect } from 'bun:test'
import { insertNodes, verifyTree } from '@core/react-ir/edit'
import type { ReactIrModule, ReactIrNode } from '@core/react-ir/nodes'

/**
 * The Blocks decision, enforced where it is mechanically checkable.
 *
 * A Block is a saved subtree copied on insert, not a component with a fixed props
 * interface. These tests hold the engine to the properties that decision requires,
 * so the design cannot drift without something failing.
 */

const element = (
  id: string,
  children: string[] = [],
  extra: Record<string, unknown> = {},
): ReactIrNode => ({
  kind: 'element', id, tag: 'div', classTokens: [], children, ...extra,
} as unknown as ReactIrNode)

function page(): ReactIrModule {
  return {
    version: 1, id: 'm1', path: 'app/page.tsx', symbol: 'Page', kind: 'page',
    rootNodeId: 'root',
    nodes: { root: element('root') },
  } as unknown as ReactIrModule
}

/** A hero Block: several nodes with one root, as a Block is actually stored. */
const heroBlock: Readonly<Record<string, ReactIrNode>> = {
  hero: element('hero', ['heroTitle', 'heroCta'], { tag: 'section' }),
  heroTitle: element('heroTitle', [], { tag: 'h1' }),
  heroCta: element('heroCta', [], { tag: 'button' }),
}

describe('a Block is a subtree, inserted as one operation', () => {
  it('inserts every node in the subtree in a single call', () => {
    // One operation means one undo step. Inserting a hero should not be six
    // separate undos.
    const result = insertNodes(page(), 'root', heroBlock, 'hero')
    expect(result.ok).toBe(true)
    expect(result.createdIds?.length).toBe(3)
  })

  it('produces a sound tree with the subtree attached', () => {
    const result = insertNodes(page(), 'root', heroBlock, 'hero')
    expect(verifyTree(result.module)).toEqual([])
    expect(result.module.nodes['root']?.children).toEqual(['hero'])
    expect(result.module.nodes['hero']?.children).toEqual(['heroTitle', 'heroCta'])
  })

  it('refuses colliding ids rather than renaming them', () => {
    // Renaming would break the references the subtree makes to its own children,
    // so a Block must be inserted with freshly generated ids.
    const occupied = {
      ...page(),
      nodes: { root: element('root', ['hero']), hero: element('hero') },
    } as unknown as ReactIrModule
    const result = insertNodes(occupied, 'root', heroBlock, 'hero')
    expect(result.ok).toBe(false)
    expect(result.problems[0]?.code).toBe('duplicate-id')
  })
})

describe('an inserted Block is editable afterwards', () => {
  it('allows its children to be rearranged', () => {
    // The whole reason a Block is a subtree rather than a component: rearranging
    // after insert is ordinary work, not a violation.
    const inserted = insertNodes(page(), 'root', heroBlock, 'hero').module
    const heroChildren = inserted.nodes['hero']?.children ?? []
    expect(heroChildren).toEqual(['heroTitle', 'heroCta'])

    // Nothing in the model marks these as fixed.
    const node = inserted.nodes['hero']
    expect(node && 'locked' in node && node.locked).toBeFalsy()
  })

  it('does not tie the copy back to a source that could change it', () => {
    // A Block carries no reference to its origin, which is what makes insertion a
    // copy. It is also why Blocks do not update retroactively — a real cost,
    // accepted deliberately.
    const inserted = insertNodes(page(), 'root', heroBlock, 'hero').module
    const node = inserted.nodes['hero'] as Record<string, unknown>
    expect(node['blockId']).toBeUndefined()
    expect(node['sourceBlock']).toBeUndefined()
  })
})

describe('two independent Blocks', () => {
  it('do not share nodes after both are inserted', () => {
    // Sharing would mean editing one changed the other, which is the failure mode
    // the copy semantics exist to avoid.
    let module = insertNodes(page(), 'root', heroBlock, 'hero').module
    const second: Record<string, ReactIrNode> = {
      hero2: element('hero2', ['hero2Title'], { tag: 'section' }),
      hero2Title: element('hero2Title', [], { tag: 'h1' }),
    }
    module = insertNodes(module, 'root', second, 'hero2').module

    expect(verifyTree(module)).toEqual([])
    expect(module.nodes['hero']?.children).toEqual(['heroTitle', 'heroCta'])
    expect(module.nodes['hero2']?.children).toEqual(['hero2Title'])
  })
})
