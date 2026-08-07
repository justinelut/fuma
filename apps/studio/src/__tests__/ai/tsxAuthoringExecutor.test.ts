import { describe, it, expect, afterEach } from 'bun:test'
import {
  TSX_AUTHORING_TOOLS,
  executeAuthorModule,
  executeEditModule,
  executeListModules,
  executeReadModule,
  getAgentModuleWorkspace,
  setAgentModuleWorkspace,
} from '@admin/pages/site/agent/tsxAuthoringTools'
import { ModuleWorkspace, createMemoryModuleStore } from '@core/react-ir/workspace'

const page = `export default function Page() {
  return (
    <section /* @fuma root */ className="grid gap-6">
      <h1 /* @fuma title */ className="text-4xl">Hello</h1>
    </section>
  )
}
`

function workspace() {
  return new ModuleWorkspace(createMemoryModuleStore())
}

afterEach(() => {
  setAgentModuleWorkspace(null)
})

describe('workspace registration', () => {
  it('throws with actionable advice when nothing is registered', async () => {
    // Failing loudly at startup beats writing to the wrong place.
    setAgentModuleWorkspace(null)
    expect(() => getAgentModuleWorkspace()).toThrow(/setAgentModuleWorkspace/)
  })

  it('returns the registered workspace', () => {
    const space = workspace()
    setAgentModuleWorkspace(space)
    expect(getAgentModuleWorkspace()).toBe(space)
  })
})

describe('the authoring tool surface', () => {
  it('names exactly the four TSX tools', () => {
    expect([...TSX_AUTHORING_TOOLS].sort()).toEqual([
      'site_author_module',
      'site_edit_module',
      'site_list_modules',
      'site_read_module',
    ])
  })

  it('does not claim any HTML tool', () => {
    // The point of the conversion: authoring never goes through HTML again.
    expect(TSX_AUTHORING_TOOLS.has('site_insert_html')).toBe(false)
    expect(TSX_AUTHORING_TOOLS.has('site_replace_node_html')).toBe(false)
  })
})

describe('authoring through the executor', () => {
  it('writes a module and reports its nodes', async () => {
    const result = await executeAuthorModule(workspace(), {
      path: 'app/page.tsx', kind: 'page', source: page,
    })
    expect(result.ok).toBe(true)
    const data = result.data as { nodeIds: string[], hash: string }
    expect(data.nodeIds).toContain('root')
    expect(data.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('returns a failure carrying the diagnostic, not just "failed"', async () => {
    // A model told only that something failed retries the same thing; one told which
    // rule and which line corrects itself.
    const result = await executeAuthorModule(workspace(), {
      path: 'app/page.tsx',
      kind: 'page',
      source: `export default function Page(props: { rest: object }) {
  return <section {...props.rest} />
}
`,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/spread-denied/)
    expect(result.error).toMatch(/line \d+/)
  })

  it('refuses a path outside the source workspace', async () => {
    const result = await executeAuthorModule(workspace(), {
      path: 'next.config.tsx', kind: 'page', source: page,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/app\/ or components\//)
  })

  it('surfaces theme drift as a warning on a successful write', async () => {
    const result = await executeAuthorModule(workspace(), {
      path: 'app/page.tsx',
      kind: 'page',
      source: `export default function Page() {
  return <div /* @fuma root */ className="bg-[#f3f3f3]" />
}
`,
    })
    expect(result.ok).toBe(true)
    const data = result.data as { offTheme?: string[], summary: string }
    expect(data.offTheme).toEqual(['bg-[#f3f3f3]'])
    expect(data.summary).toMatch(/bypass the theme/)
  })
})

describe('editing through the executor', () => {
  it('edits an existing module', async () => {
    const space = workspace()
    await executeAuthorModule(space, { path: 'app/page.tsx', kind: 'page', source: page })
    const result = await executeEditModule(space, {
      path: 'app/page.tsx', source: page.replace('Hello', 'Updated'),
    })
    expect(result.ok).toBe(true)
    expect((await space.read('app/page.tsx'))?.source).toContain('Updated')
  })

  it('refuses a stale base and hands back the current hash', async () => {
    const space = workspace()
    await executeAuthorModule(space, { path: 'app/page.tsx', kind: 'page', source: page })
    const result = await executeEditModule(space, {
      path: 'app/page.tsx',
      source: page.replace('Hello', 'Overwritten'),
      baseHash: 'f'.repeat(64),
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/stale-base/)
    expect((await space.read('app/page.tsx'))?.source).toContain('Hello')
  })
})

describe('reading through the executor', () => {
  it('returns the source and hash', async () => {
    const space = workspace()
    await executeAuthorModule(space, { path: 'app/page.tsx', kind: 'page', source: page })
    const result = await executeReadModule(space, { path: 'app/page.tsx' })
    expect(result.ok).toBe(true)
    const data = result.data as { source: string, hash: string }
    expect(data.source).toBe(page)
    expect(data.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('lists what exists when the path is wrong', async () => {
    const space = workspace()
    await executeAuthorModule(space, { path: 'app/page.tsx', kind: 'page', source: page })
    const result = await executeReadModule(space, { path: 'app/nope.tsx' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/app\/page\.tsx/)
  })
})

describe('listing through the executor', () => {
  it('reports every module', async () => {
    const space = workspace()
    await executeAuthorModule(space, { path: 'app/page.tsx', kind: 'page', source: page })
    await executeAuthorModule(space, {
      path: 'components/Hero.tsx', kind: 'component', source: page,
    })
    const result = await executeListModules(space)
    expect(result.ok).toBe(true)
    const data = result.data as { summary: string }
    expect(data.summary).toMatch(/2 module/)
  })
})
