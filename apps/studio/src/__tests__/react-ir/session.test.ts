import { describe, it, expect } from 'bun:test'
import { commitEdit, createModule, loadModule } from '@core/react-ir/session'
import { ModuleWorkspace, createMemoryModuleStore } from '@core/react-ir/workspace'
import { deleteNode, insertNodes, moveNode, setClassTokens } from '@core/react-ir/edit'
import type { ReactIrModule, ReactIrNode } from '@core/react-ir/nodes'

const source = `export default function Page() {
  return (
    <section /* @fuma root */ className="grid gap-6">
      <h1 /* @fuma title */ className="text-4xl">Hello</h1>
      <p /* @fuma copy */ className="text-base">Body</p>
    </section>
  )
}
`

const element = (id: string, extra: Record<string, unknown> = {}): ReactIrNode => ({
  kind: 'element', id, tag: 'div', classTokens: [], children: [], ...extra,
} as unknown as ReactIrNode)

async function seeded() {
  const workspace = new ModuleWorkspace(createMemoryModuleStore())
  const written = await workspace.write('app/page.tsx', source)
  expect(written.written).toBe(true)
  return { workspace, hash: written.module?.hash ?? '' }
}

describe('loading a module', () => {
  it('returns the IR and the hash together', async () => {
    // Only useful together: an edit that does not declare its base cannot detect a
    // concurrent change.
    const { workspace, hash } = await seeded()
    const loaded = await loadModule(workspace, 'app/page.tsx')
    expect('module' in loaded).toBe(true)
    if (!('module' in loaded)) return
    expect(loaded.hash).toBe(hash)
    expect(loaded.module.rootNodeId).toBe('root')
  })

  it('reports a module that does not exist', async () => {
    const { workspace } = await seeded()
    const loaded = await loadModule(workspace, 'app/missing.tsx')
    expect('problems' in loaded).toBe(true)
    if (!('problems' in loaded)) return
    expect(loaded.problems[0]?.code).toBe('not-found')
  })

  it('infers the client boundary from the source directive', async () => {
    const workspace = new ModuleWorkspace(createMemoryModuleStore())
    await workspace.write('app/page.tsx',
      `'use client'\n\nexport default function Page() {\n  return <div /* @fuma root */ className="grid" />\n}\n`)
    const loaded = await loadModule(workspace, 'app/page.tsx')
    if (!('module' in loaded)) throw new Error('expected a module')
    expect(loaded.module.boundary).toBe('client')
  })
})

describe('committing an edit', () => {
  it('writes the regenerated source and returns the new hash', async () => {
    const { workspace, hash } = await seeded()
    const result = await commitEdit(workspace, 'app/page.tsx', hash,
      (module) => setClassTokens(module, 'title', ['text-5xl']))
    expect(result.ok).toBe(true)
    expect(result.source).toContain('text-5xl')
    expect(result.hash).not.toBe(hash)
  })

  it('composes several operations into one write', async () => {
    // What makes inserting a block and positioning it a single undo step.
    const { workspace, hash } = await seeded()
    const result = await commitEdit(workspace, 'app/page.tsx', hash, (module) => {
      const inserted = insertNodes(module, 'root', {
        cta: element('cta', { tag: 'button', classTokens: ['bg-primary'] }),
      }, 'cta')
      if (!inserted.ok) return inserted
      return moveNode(inserted.module, 'cta', 'root', 0)
    })
    expect(result.ok).toBe(true)
    expect(result.module?.nodes['root']?.children).toEqual(['cta', 'title', 'copy'])
  })

  it('leaves the file untouched when the edit is refused', async () => {
    // A failed interaction must not half-apply.
    const { workspace, hash } = await seeded()
    const result = await commitEdit(workspace, 'app/page.tsx', hash,
      (module) => deleteNode(module, 'root'))
    expect(result.ok).toBe(false)
    expect(result.problems[0]?.code).toBe('root-not-deletable')
    expect((await workspace.read('app/page.tsx'))?.source).toBe(source)
  })

  it('refuses an edit based on a stale hash', async () => {
    const { workspace } = await seeded()
    const result = await commitEdit(workspace, 'app/page.tsx', 'f'.repeat(64),
      (module) => setClassTokens(module, 'title', ['text-5xl']))
    expect(result.ok).toBe(false)
    expect(result.problems[0]?.code).toBe('stale-base')
    expect((await workspace.read('app/page.tsx'))?.source).toBe(source)
  })

  it('catches a composed edit that leaves the tree inconsistent', async () => {
    // An individual operation can be sound while a sequence is not, so the tree is
    // verified after the whole edit rather than only inside each step.
    const { workspace, hash } = await seeded()
    const result = await commitEdit(workspace, 'app/page.tsx', hash, (module) => ({
      ok: true,
      problems: [],
      module: {
        ...module,
        nodes: { ...module.nodes, root: { ...module.nodes['root'], children: ['ghost'] } },
      } as unknown as ReactIrModule,
    }))
    expect(result.ok).toBe(false)
    expect(result.problems[0]?.message).toMatch(/left the tree inconsistent/)
  })

  it('surfaces a generator refusal rather than writing nothing silently', async () => {
    // The generator refuses Motion on a server module. That message is far more
    // useful than an unexplained no-op.
    const { workspace, hash } = await seeded()
    const result = await commitEdit(workspace, 'app/page.tsx', hash, (module) => ({
      ok: true,
      problems: [],
      module: {
        ...module,
        boundary: 'server',
        nodes: {
          ...module.nodes,
          title: { ...module.nodes['title'], animation: { animate: { opacity: 1 } } },
        },
      } as unknown as ReactIrModule,
    }))
    expect(result.ok).toBe(false)
    expect(result.problems[0]?.message).toMatch(/boundary/)
  })

  it('produces source that reads back cleanly', async () => {
    const { workspace, hash } = await seeded()
    await commitEdit(workspace, 'app/page.tsx', hash,
      (module) => setClassTokens(module, 'title', ['text-5xl']))
    const reloaded = await loadModule(workspace, 'app/page.tsx')
    expect('module' in reloaded).toBe(true)
  })

  it('allows a second edit against the hash it returned', async () => {
    // Consecutive edits are the normal case, so the returned hash has to be usable
    // without another read.
    const { workspace, hash } = await seeded()
    const first = await commitEdit(workspace, 'app/page.tsx', hash,
      (module) => setClassTokens(module, 'title', ['text-5xl']))
    const second = await commitEdit(workspace, 'app/page.tsx', first.hash ?? '',
      (module) => setClassTokens(module, 'copy', ['text-lg']))
    expect(second.ok).toBe(true)
  })
})

describe('creating a module from a tree', () => {
  const fresh = {
    version: 1, id: 'components/Hero.tsx', path: 'components/Hero.tsx',
    symbol: 'Hero', kind: 'component', rootNodeId: 'root',
    nodes: { root: element('root', { classTokens: ['grid'] }) },
  } as unknown as ReactIrModule

  it('writes a module that did not exist', async () => {
    const workspace = new ModuleWorkspace(createMemoryModuleStore())
    const result = await createModule(workspace, fresh)
    expect(result.ok).toBe(true)
    expect(await workspace.read('components/Hero.tsx')).not.toBeNull()
  })

  it('refuses to create over an existing module', async () => {
    const workspace = new ModuleWorkspace(createMemoryModuleStore())
    await createModule(workspace, fresh)
    const again = await createModule(workspace, fresh)
    expect(again.ok).toBe(false)
    expect(again.problems[0]?.message).toMatch(/already exists/)
  })

  it('refuses a tree that is already inconsistent', async () => {
    const workspace = new ModuleWorkspace(createMemoryModuleStore())
    const broken = { ...fresh, rootNodeId: 'absent' } as unknown as ReactIrModule
    const result = await createModule(workspace, broken)
    expect(result.ok).toBe(false)
  })
})
