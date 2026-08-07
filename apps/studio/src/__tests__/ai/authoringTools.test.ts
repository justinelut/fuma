import { describe, it, expect } from 'bun:test'
import {
  runAuthorModule,
  runEditModule,
  runListModules,
  runReadModule,
} from '@core/ai/authoringTools'
import { ModuleWorkspace, createMemoryModuleStore } from '@core/react-ir/workspace'

const page = `export default function Page() {
  return (
    <section /* @fuma root */ className="grid gap-6">
      <h1 /* @fuma title */ className="text-4xl">Hello</h1>
    </section>
  )
}
`

function space() {
  return new ModuleWorkspace(createMemoryModuleStore())
}

describe('authoring a module', () => {
  it('writes a valid module and reports addressable nodes', async () => {
    const result = await runAuthorModule(space(), {
      path: 'app/page.tsx', kind: 'page', source: page,
    })
    expect(result.ok).toBe(true)
    expect(result.nodeIds).toContain('root')
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.summary).toMatch(/addressable nodes/)
  })

  it('refuses an unauthorable path and says where to write instead', async () => {
    const result = await runAuthorModule(space(), {
      path: 'next.config.tsx', kind: 'page', source: page,
    })
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/app\/ or components\//)
  })

  it('refuses to overwrite an existing module, returning its hash', async () => {
    // Authoring is for new files. An accidental overwrite is what the edit tool's
    // base hash exists to prevent, so it should go through that path.
    const workspace = space()
    await runAuthorModule(workspace, { path: 'app/page.tsx', kind: 'page', source: page })
    const second = await runAuthorModule(workspace, {
      path: 'app/page.tsx', kind: 'page', source: page,
    })
    expect(second.ok).toBe(false)
    expect(second.summary).toMatch(/site_edit_module/)
    expect(second.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('returns diagnostics with line numbers a model can act on', async () => {
    const result = await runAuthorModule(space(), {
      path: 'app/page.tsx',
      kind: 'page',
      source: `export default function Page(props: { rest: object }) {
  return <section {...props.rest} />
}
`,
    })
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/spread-denied/)
    expect(result.summary).toMatch(/line \d+/)
    expect(result.problems?.length).toBeGreaterThan(0)
  })

  it('warns about classes that bypass the theme without failing', async () => {
    // An arbitrary value is sometimes right; drift is worth naming while it is small.
    const result = await runAuthorModule(space(), {
      path: 'app/page.tsx',
      kind: 'page',
      source: `export default function Page() {
  return <div /* @fuma root */ className="bg-[#f3f3f3] text-[13px]" />
}
`,
    })
    expect(result.ok).toBe(true)
    expect(result.offTheme).toEqual(['bg-[#f3f3f3]', 'text-[13px]'])
    expect(result.summary).toMatch(/bypass the theme/)
  })

  it('says nothing about the theme when the scale was used', async () => {
    const result = await runAuthorModule(space(), {
      path: 'app/page.tsx', kind: 'page', source: page,
    })
    expect(result.offTheme).toBeUndefined()
    expect(result.summary).not.toMatch(/bypass/)
  })
})

describe('editing a module', () => {
  it('updates an existing module', async () => {
    const workspace = space()
    await runAuthorModule(workspace, { path: 'app/page.tsx', kind: 'page', source: page })
    const result = await runEditModule(workspace, {
      path: 'app/page.tsx', source: page.replace('Hello', 'Updated'),
    })
    expect(result.ok).toBe(true)
    expect((await workspace.read('app/page.tsx'))?.source).toContain('Updated')
  })

  it('refuses to edit something that does not exist', async () => {
    const result = await runEditModule(space(), { path: 'app/page.tsx', source: page })
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/site_author_module/)
  })

  it('accepts an edit whose base hash matches', async () => {
    const workspace = space()
    const first = await runAuthorModule(workspace, {
      path: 'app/page.tsx', kind: 'page', source: page,
    })
    const result = await runEditModule(workspace, {
      path: 'app/page.tsx',
      source: page.replace('Hello', 'Updated'),
      baseHash: first.hash ?? '',
    })
    expect(result.ok).toBe(true)
  })

  it('refuses a stale base and returns the current hash for a retry', async () => {
    // Handing back the right base turns a conflict into one more call rather than a
    // read followed by a guess.
    const workspace = space()
    await runAuthorModule(workspace, { path: 'app/page.tsx', kind: 'page', source: page })
    const result = await runEditModule(workspace, {
      path: 'app/page.tsx',
      source: page.replace('Hello', 'Overwritten'),
      baseHash: 'f'.repeat(64),
    })
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/stale-base/)
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/)
    expect((await workspace.read('app/page.tsx'))?.source).toContain('Hello')
  })
})

describe('reading a module', () => {
  it('returns the source and the hash to edit against', async () => {
    const workspace = space()
    await runAuthorModule(workspace, { path: 'app/page.tsx', kind: 'page', source: page })
    const result = await runReadModule(workspace, { path: 'app/page.tsx' })
    expect(result.ok).toBe(true)
    expect(result.source).toBe(page)
    expect(result.summary).toMatch(/baseHash/)
  })

  it('lists what exists when the path is wrong', async () => {
    // A dead end becomes a next step.
    const workspace = space()
    await runAuthorModule(workspace, { path: 'app/page.tsx', kind: 'page', source: page })
    const result = await runReadModule(workspace, { path: 'app/missing.tsx' })
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/app\/page\.tsx/)
  })

  it('says so when nothing has been authored', async () => {
    const result = await runReadModule(space(), { path: 'app/page.tsx' })
    expect(result.summary).toMatch(/no modules have been authored/i)
  })

  it('warns when identity would not survive an edit', async () => {
    // Text nodes carry no anchor, so a reformat could shift identity. Saying so is
    // better than letting the model discover it by losing an element's id.
    const workspace = space()
    await runAuthorModule(workspace, { path: 'app/page.tsx', kind: 'page', source: page })
    const result = await runReadModule(workspace, { path: 'app/page.tsx' })
    expect(result.summary).toMatch(/@fuma/)
  })
})

describe('listing modules', () => {
  it('reports every authored module', async () => {
    const workspace = space()
    await runAuthorModule(workspace, { path: 'app/page.tsx', kind: 'page', source: page })
    await runAuthorModule(workspace, { path: 'components/Hero.tsx', kind: 'component', source: page })
    const result = await runListModules(workspace)
    expect(result.summary).toMatch(/2 module/)
    expect(result.summary).toMatch(/components\/Hero\.tsx/)
  })

  it('reports an empty workspace plainly', async () => {
    expect((await runListModules(space())).summary).toMatch(/No modules/)
  })
})
