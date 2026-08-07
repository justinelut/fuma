/**
 * The Zustand binding for React-IR editing.
 *
 * Tested by driving the store's actions directly rather than through components: the
 * store is where the wiring lives, and a headless test proves the wiring without
 * depending on any particular panel existing yet.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { useReactEditorStore } from '@admin/pages/site/canvas/reactEditorStore'
import { ModuleWorkspace, createMemoryModuleStore } from '@core/react-ir/workspace'

const source = `export default function Page() {
  return (
    <section /* @fuma root */ className="grid gap-4">
      <h1 /* @fuma title */ className="text-4xl">Hello</h1>
      <p /* @fuma copy */ className="text-base">Body</p>
    </section>
  )
}
`

const store = () => useReactEditorStore.getState()

async function attached(): Promise<ModuleWorkspace> {
  const workspace = new ModuleWorkspace(createMemoryModuleStore())
  await workspace.write('app/page.tsx', source)
  store().attachWorkspace(workspace)
  return workspace
}

beforeEach(() => {
  useReactEditorStore.setState({
    editor: null, workspace: null, saving: false, problems: [],
  })
})

describe('opening a module', () => {
  it('starts with nothing open', () => {
    expect(store().editor).toBeNull()
  })

  it('loads the module and its nodes', async () => {
    await attached()
    await store().open('app/page.tsx')
    expect(store().editor?.module.nodes['title']).toBeDefined()
  })

  it('preserves the component name from source', async () => {
    await attached()
    await store().open('app/page.tsx')
    expect(store().editor?.module.symbol).toBe('Page')
  })

  it('reports a module that cannot be read instead of opening an empty one', async () => {
    await attached()
    await store().open('app/missing.tsx')
    expect(store().editor).toBeNull()
    expect(store().problems.length).toBeGreaterThan(0)
  })

  it('throws when no workspace is attached', async () => {
    // Loud rather than silent: it would otherwise read as an empty file.
    await expect(store().open('app/page.tsx')).rejects.toThrow(/workspace/i)
  })

  it('closes back to nothing open', async () => {
    await attached()
    await store().open('app/page.tsx')
    store().close()
    expect(store().editor).toBeNull()
  })
})

describe('gestures reach the state layer', () => {
  beforeEach(async () => {
    await attached()
    await store().open('app/page.tsx')
  })

  it('selects a node', () => {
    store().select('title')
    expect(store().editor?.selection).toEqual(['title'])
  })

  it('applies classes to the selection', () => {
    store().select('title')
    store().applyClasses(['text-5xl'])
    expect(store().editor?.module.nodes['title']?.classTokens).toEqual(['text-5xl'])
  })

  it('deletes and undoes', () => {
    store().deleteNode('copy')
    expect(store().editor?.module.nodes['copy']).toBeUndefined()
    store().undoEdit()
    expect(store().editor?.module.nodes['copy']).toBeDefined()
  })

  it('gives each duplicate a distinct id', () => {
    // A shared id would collide and the second duplicate would be refused.
    store().duplicateNode('copy')
    const first = store().editor?.selection[0]
    store().duplicateNode('copy')
    const second = store().editor?.selection[0]
    expect(first).not.toBe(second)
  })

  it('reorders siblings', () => {
    store().reorderNode('root', 'copy', 0)
    expect(store().editor?.module.nodes['root']?.children).toEqual(['copy', 'title'])
  })

  it('surfaces a refusal without changing the module', () => {
    const before = store().editor?.module
    store().deleteNode('root')
    expect(store().problems[0]?.code).toBe('root-not-deletable')
    expect(store().editor?.module).toBe(before)
  })

  it('ignores gestures when nothing is open', () => {
    store().close()
    store().deleteNode('title')
    expect(store().editor).toBeNull()
  })
})

describe('saving through the store', () => {
  it('writes the edited source', async () => {
    const workspace = await attached()
    await store().open('app/page.tsx')
    store().select('title')
    store().applyClasses(['text-5xl'])

    expect(await store().saveModule()).toBe(true)
    expect((await workspace.read('app/page.tsx'))?.source).toContain('text-5xl')
  })

  it('clears the dirty flag on success', async () => {
    await attached()
    await store().open('app/page.tsx')
    store().deleteNode('copy')
    await store().saveModule()
    expect(store().editor?.savedHash).not.toBeNull()
  })

  it('declines a save when nothing is open', async () => {
    await attached()
    expect(await store().saveModule()).toBe(false)
  })

  it('declines a second save while one is in flight', async () => {
    // Two concurrent saves race on the base hash and one is refused as stale, which
    // reads to the author as a random failure.
    await attached()
    await store().open('app/page.tsx')
    store().deleteNode('copy')
    const [first, second] = await Promise.all([
      store().saveModule(),
      store().saveModule(),
    ])
    expect([first, second].filter(Boolean).length).toBe(1)
  })

  it('leaves saving false after a failure', async () => {
    // A stuck flag would disable saving for the rest of the session.
    const workspace = await attached()
    await store().open('app/page.tsx')
    store().deleteNode('copy')
    await workspace.remove('app/page.tsx')
    await store().saveModule()
    expect(store().saving).toBe(false)
    expect(store().problems.length).toBeGreaterThan(0)
  })
})
