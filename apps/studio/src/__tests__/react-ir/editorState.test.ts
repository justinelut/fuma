import { describe, it, expect } from 'bun:test'
import {
  canRedo,
  canUndo,
  clearSelection,
  duplicate,
  initialState,
  insert,
  isDirty,
  layerOrder,
  move,
  redo,
  remove,
  reorder,
  replaceStyle,
  restyle,
  save,
  selectNode,
  setAnimation,
  toggleSelection,
  undo,
} from '@core/react-ir/editorState'
import { ModuleWorkspace, createMemoryModuleStore } from '@core/react-ir/workspace'
import type { ReactIrModule, ReactIrNode } from '@core/react-ir/nodes'

const element = (
  id: string,
  children: string[] = [],
  extra: Record<string, unknown> = {},
): ReactIrNode => ({
  kind: 'element', id, tag: 'div', classTokens: [], children, ...extra,
} as unknown as ReactIrNode)

function moduleOf(): ReactIrModule {
  return {
    version: 1, id: 'm1', path: 'app/page.tsx', symbol: 'Page', kind: 'page',
    rootNodeId: 'root',
    nodes: {
      root: element('root', ['a', 'b']),
      a: element('a', ['a1']),
      a1: element('a1'),
      b: element('b'),
    },
  } as unknown as ReactIrModule
}

const start = () => initialState('app/page.tsx', moduleOf(), 'a'.repeat(64))

describe('initial state', () => {
  it('starts clean with nothing selected', () => {
    const state = start()
    expect(isDirty(state)).toBe(false)
    expect(state.selection).toEqual([])
    expect(canUndo(state)).toBe(false)
    expect(canRedo(state)).toBe(false)
  })
})

describe('selection', () => {
  it('selects one node', () => {
    expect(selectNode(start(), 'a').selection).toEqual(['a'])
  })

  it('ignores a node that does not exist', () => {
    // Selecting nothing is better than selecting a ghost the inspector cannot read.
    expect(selectNode(start(), 'ghost').selection).toEqual([])
  })

  it('adds and removes with toggle', () => {
    let state = toggleSelection(start(), 'a')
    state = toggleSelection(state, 'b')
    expect(state.selection).toEqual(['a', 'b'])
    state = toggleSelection(state, 'a')
    expect(state.selection).toEqual(['b'])
  })

  it('clears', () => {
    expect(clearSelection(selectNode(start(), 'a')).selection).toEqual([])
  })

  it('drops a selected node once it is deleted', () => {
    // A panel reading a missing node shows an empty inspector that looks broken rather
    // than empty.
    const state = remove(selectNode(start(), 'a'), 'a')
    expect(state.selection).toEqual([])
  })
})

describe('editing marks the document dirty', () => {
  it('becomes dirty on the first change', () => {
    const state = remove(start(), 'b')
    expect(isDirty(state)).toBe(true)
  })

  it('records an undo step', () => {
    expect(canUndo(remove(start(), 'b'))).toBe(true)
  })
})

describe('a refused edit changes nothing', () => {
  it('records the problem', () => {
    const state = remove(start(), 'root')
    expect(state.problems[0]?.code).toBe('root-not-deletable')
  })

  it('does not consume an undo step', () => {
    // Otherwise undo would appear to do nothing.
    const state = remove(start(), 'root')
    expect(canUndo(state)).toBe(false)
  })

  it('does not mark the document dirty', () => {
    expect(isDirty(remove(start(), 'root'))).toBe(false)
  })

  it('leaves the module untouched', () => {
    const before = start()
    const after = remove(before, 'root')
    expect(after.module).toBe(before.module)
  })

  it('clears problems on the next successful edit', () => {
    const refused = remove(start(), 'root')
    expect(remove(refused, 'b').problems).toEqual([])
  })
})

describe('undo and redo', () => {
  it('restores the previous module', () => {
    const state = remove(start(), 'b')
    const back = undo(state)
    expect(back.module.nodes['b']).toBeDefined()
  })

  it('makes redo available after undo', () => {
    const back = undo(remove(start(), 'b'))
    expect(canRedo(back)).toBe(true)
    expect(redo(back).module.nodes['b']).toBeUndefined()
  })

  it('does nothing when there is no history', () => {
    const state = start()
    expect(undo(state)).toBe(state)
    expect(redo(state)).toBe(state)
  })

  it('discards the redo branch when a new edit follows an undo', () => {
    // Keeping it would let redo jump to a future that no longer follows from the
    // present.
    let state = remove(start(), 'b')
    state = undo(state)
    state = remove(state, 'a')
    expect(canRedo(state)).toBe(false)
  })

  it('leaves the document dirty after undo', () => {
    // Undoing to a state matching disk is still a divergence from what was saved most
    // recently; only a save reconciles them.
    expect(isDirty(undo(remove(start(), 'b')))).toBe(true)
  })

  it('prunes a selection the undo invalidates', () => {
    let state = insert(start(), { fresh: element('fresh') }, 'fresh')
    expect(state.selection).toEqual(['fresh'])
    state = undo(state)
    expect(state.selection).toEqual([])
  })

  it('survives many steps', () => {
    let state = start()
    for (const id of ['n1', 'n2', 'n3', 'n4']) {
      state = insert(state, { [id]: element(id) }, id)
    }
    for (let step = 0; step < 4; step += 1) state = undo(state)
    expect(canUndo(state)).toBe(false)
    expect(Object.keys(state.module.nodes).sort()).toEqual(['a', 'a1', 'b', 'root'])
  })
})

describe('inserting', () => {
  it('adds under the selected node', () => {
    const state = insert(selectNode(start(), 'b'), { fresh: element('fresh') }, 'fresh')
    expect(state.module.nodes['b']?.children).toEqual(['fresh'])
  })

  it('adds under the root when nothing is selected', () => {
    const state = insert(start(), { fresh: element('fresh') }, 'fresh')
    expect(state.module.nodes['root']?.children).toContain('fresh')
  })

  it('selects what was inserted', () => {
    // The author almost always wants to act on it next.
    expect(insert(start(), { fresh: element('fresh') }, 'fresh').selection).toEqual(['fresh'])
  })
})

describe('moving and reordering', () => {
  it('moves a node to a new parent', () => {
    const state = move(start(), 'a1', 'b')
    expect(state.module.nodes['b']?.children).toEqual(['a1'])
  })

  it('refuses a move that would create a cycle', () => {
    const state = move(start(), 'a', 'a1')
    expect(state.problems[0]?.code).toBe('cycle-refused')
    expect(isDirty(state)).toBe(false)
  })

  it('reorders among siblings', () => {
    const state = reorder(start(), 'root', 'b', 0)
    expect(state.module.nodes['root']?.children).toEqual(['b', 'a'])
  })
})

describe('duplicating', () => {
  it('selects the copy rather than the original', () => {
    // Otherwise a repeated duplicate stacks copies of the same node.
    const state = duplicate(start(), 'a', (id) => `${id}-copy`)
    expect(state.selection).toEqual(['a-copy'])
  })

  it('produces an independent copy', () => {
    const state = duplicate(start(), 'a', (id) => `${id}-copy`)
    expect(state.module.nodes['a-copy']?.children).toEqual(['a1-copy'])
    expect(state.module.nodes['a']?.children).toEqual(['a1'])
  })
})

describe('restyling a selection', () => {
  it('applies to every selected node', () => {
    let state = toggleSelection(start(), 'a')
    state = toggleSelection(state, 'b')
    state = restyle(state, ['p-4'])
    expect(state.module.nodes['a']?.classTokens).toEqual(['p-4'])
    expect(state.module.nodes['b']?.classTokens).toEqual(['p-4'])
  })

  it('records one undo step for the whole gesture', () => {
    // Styling three nodes at once is one action to the author, so it should be one undo.
    let state = toggleSelection(start(), 'a')
    state = toggleSelection(state, 'b')
    const before = state.past.length
    state = restyle(state, ['p-4'])
    expect(state.past.length).toBe(before + 1)
  })

  it('styles what it can in a mixed selection', () => {
    // A node that cannot carry classes is skipped rather than failing the gesture.
    const withText = {
      ...moduleOf(),
      nodes: {
        ...moduleOf().nodes,
        t: { kind: 'text', id: 't', value: 'hi', children: [] } as unknown as ReactIrNode,
      },
    } as unknown as ReactIrModule
    let state = initialState('app/page.tsx', withText, 'a'.repeat(64))
    state = toggleSelection(state, 'a')
    state = toggleSelection(state, 't')
    state = restyle(state, ['p-4'])
    expect(state.module.nodes['a']?.classTokens).toEqual(['p-4'])
  })

  it('reports when nothing in the selection is styleable', () => {
    const textOnly = {
      version: 1, id: 'm1', path: 'app/page.tsx', symbol: 'Page', kind: 'page',
      rootNodeId: 'root',
      nodes: {
        root: element('root', ['t']),
        t: { kind: 'text', id: 't', value: 'hi', children: [] } as unknown as ReactIrNode,
      },
    } as unknown as ReactIrModule
    const state = restyle(selectNode(initialState('app/page.tsx', textOnly, 'a'.repeat(64)), 't'), ['p-4'])
    expect(state.problems[0]?.message).toMatch(/None of the selected nodes can carry classes/)
    expect(isDirty(state)).toBe(false)
  })

  it('does nothing with an empty selection', () => {
    const state = start()
    expect(restyle(state, ['p-4'])).toBe(state)
  })
})

describe('exact Tailwind and Motion inspector edits', () => {
  it('replaces and clears the selected node class list as undoable edits', () => {
    let state = selectNode(start(), 'a')
    state = replaceStyle(state, ['grid', 'gap-4'])
    expect(state.module.nodes['a']?.classTokens).toEqual(['grid', 'gap-4'])
    state = replaceStyle(state, [])
    expect(state.module.nodes['a']?.classTokens).toEqual([])
    expect(undo(state).module.nodes['a']?.classTokens).toEqual(['grid', 'gap-4'])
  })

  it('writes, removes, and undoes Motion as one edit per change', () => {
    const animation = { initial: { opacity: 0 }, animate: { opacity: 1 } }
    let state = setAnimation(selectNode(start(), 'a'), animation)
    expect(state.module.nodes['a']?.animation).toEqual(animation)
    state = setAnimation(state, null)
    expect(state.module.nodes['a']?.animation).toBeUndefined()
    expect(undo(state).module.nodes['a']?.animation).toEqual(animation)
  })

  it('refuses an exact edit when multiple layers are selected', () => {
    let state = toggleSelection(start(), 'a')
    state = toggleSelection(state, 'b')
    state = replaceStyle(state, ['grid'])
    expect(state.problems[0]?.message).toMatch(/single element/)
    expect(isDirty(state)).toBe(false)
  })
})

describe('layer order', () => {
  it('walks the tree depth-first', () => {
    expect(layerOrder(start())).toEqual(['root', 'a', 'a1', 'b'])
  })

  it('excludes hidden nodes so it agrees with the canvas', () => {
    const withHidden = {
      ...moduleOf(),
      nodes: { ...moduleOf().nodes, b: element('b', [], { hidden: true }) },
    } as unknown as ReactIrModule
    expect(layerOrder(initialState('app/page.tsx', withHidden, 'a'.repeat(64))))
      .toEqual(['root', 'a', 'a1'])
  })
})

describe('saving', () => {
  const source = `export default function Page() {
  return (
    <section /* @fuma root */ className="grid">
      <h1 /* @fuma title */ className="text-4xl">Hello</h1>
    </section>
  )
}
`

  async function seeded() {
    const workspace = new ModuleWorkspace(createMemoryModuleStore())
    const written = await workspace.write('app/page.tsx', source)
    const loaded = await workspace.read('app/page.tsx')
    const module = {
      version: 1, id: 'app/page.tsx', path: 'app/page.tsx', symbol: 'Page', kind: 'page',
      rootNodeId: 'root',
      nodes: {
        root: element('root', ['title'], { tag: 'section', classTokens: ['grid'] }),
        title: element('title', [], { tag: 'h1', classTokens: ['text-4xl'] }),
      },
    } as unknown as ReactIrModule
    return {
      workspace,
      state: initialState('app/page.tsx', module, written.module?.hash ?? loaded?.hash ?? ''),
    }
  }

  it('does not write when nothing changed', async () => {
    // Rewriting an unchanged file would bump its hash and make every other editor's
    // base stale for no reason.
    const { workspace, state } = await seeded()
    const before = (await workspace.read('app/page.tsx'))?.hash
    const outcome = await save(workspace, state)
    expect(outcome.saved).toBe(true)
    expect((await workspace.read('app/page.tsx'))?.hash).toBe(before)
  })

  it('writes a dirty document and clears the dirty flag', async () => {
    const { workspace, state } = await seeded()
    const edited = restyle(selectNode(state, 'title'), ['text-5xl'])
    expect(isDirty(edited)).toBe(true)

    const outcome = await save(workspace, edited)
    expect(outcome.saved).toBe(true)
    if (!outcome.saved) return
    expect(isDirty(outcome.state)).toBe(false)
    expect((await workspace.read('app/page.tsx'))?.source).toContain('text-5xl')
  })

  it('reports a save it could not perform', async () => {
    const { workspace, state } = await seeded()
    await workspace.remove('app/page.tsx')
    const outcome = await save(workspace, remove(state, 'title'))
    expect(outcome.saved).toBe(false)
    if (outcome.saved) return
    expect(outcome.problems.length).toBeGreaterThan(0)
  })

  it('reports the real diagnostic code rather than a placeholder', async () => {
    // Flattening every load problem to one code discards what the author needs: a
    // missing file and an unsupported syntax need different responses.
    const { workspace, state } = await seeded()
    await workspace.remove('app/page.tsx')
    const outcome = await save(workspace, remove(state, 'title'))
    if (outcome.saved) throw new Error('expected the save to fail')
    expect(outcome.problems[0]?.code).toBe('not-found')
  })

  it('records the problems on state as well as the outcome', async () => {
    // So a surface showing problems does not need the outcome object to display them.
    const { workspace, state } = await seeded()
    await workspace.remove('app/page.tsx')
    const outcome = await save(workspace, remove(state, 'title'))
    expect(outcome.state.problems.length).toBeGreaterThan(0)
  })

  it('leaves the document dirty when the save failed', async () => {
    // Clearing the flag would let the editor believe it is in sync when it is not.
    const { workspace, state } = await seeded()
    await workspace.remove('app/page.tsx')
    const outcome = await save(workspace, remove(state, 'title'))
    expect(isDirty(outcome.state)).toBe(true)
  })
})
