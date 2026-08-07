import { describe, it, expect } from 'bun:test'
import {
  ModuleWorkspace,
  createMemoryModuleStore,
  hashSource,
} from '@core/react-ir/workspace'

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

const at = () => '2026-01-01T00:00:00.000Z'

describe('writing a module', () => {
  it('accepts a readable module and reports its nodes', async () => {
    const result = await workspace().write('app/page.tsx', page, { now: at })
    expect(result.written).toBe(true)
    expect(result.problems).toEqual([])
    expect(result.module?.nodeIds).toContain('root')
    expect(result.module?.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('refuses a module the canvas could not show', async () => {
    // Accepting it would produce a site that builds but cannot be edited.
    const result = await workspace().write('app/page.tsx',
      `export default function Page(props: { rest: object }) {
  return <section {...props.rest} />
}
`)
    expect(result.written).toBe(false)
    expect(result.problems.map((problem) => problem.code)).toContain('spread-denied')
  })

  it('refuses a module that returns no JSX', async () => {
    const result = await workspace().write('app/page.tsx',
      'export default function Page() {\n  return null\n}\n')
    expect(result.written).toBe(false)
    expect(result.problems.some((problem) => problem.code === 'no-default-export'
      || problem.code === 'unreadable')).toBe(true)
  })

  it('refuses a runtime-assembled class', async () => {
    const result = await workspace().write('app/page.tsx',
      `export default function Page() {
  return <div className={"bg-" + "red-500"} />
}
`)
    expect(result.written).toBe(false)
  })

  it('does not store anything when it refuses', async () => {
    // A rejected write that still persisted would leave the site in a state the
    // validator had already said no to.
    const space = workspace()
    await space.write('app/page.tsx',
      `export default function Page(props: { rest: object }) {
  return <section {...props.rest} />
}
`)
    expect(await space.read('app/page.tsx')).toBeNull()
  })
})

describe('reading back', () => {
  it('returns the source with the hash a later edit can declare', async () => {
    const space = workspace()
    const written = await space.write('app/page.tsx', page, { now: at })
    const read = await space.read('app/page.tsx')
    expect(read?.source).toBe(page)
    expect(read?.hash).toBe(written.module?.hash)
  })

  it('returns null for a module that does not exist', async () => {
    expect(await workspace().read('app/missing.tsx')).toBeNull()
  })

  it('lists modules in a stable order', async () => {
    const space = workspace()
    await space.write('app/z.tsx', page, { now: at })
    await space.write('app/a.tsx', page, { now: at })
    expect(await space.list()).toEqual(['app/a.tsx', 'app/z.tsx'])
  })
})

describe('concurrent edits', () => {
  it('accepts a write whose base matches what is stored', async () => {
    const space = workspace()
    const first = await space.write('app/page.tsx', page, { now: at })
    const second = await space.write('app/page.tsx',
      page.replace('Hello', 'Updated'),
      { baseHash: first.module?.hash, now: at })
    expect(second.written).toBe(true)
  })

  it('refuses a write based on a stale hash', async () => {
    // Two editors, or a person and the AI, must not silently lose one side's work.
    const space = workspace()
    await space.write('app/page.tsx', page, { now: at })
    const result = await space.write('app/page.tsx',
      page.replace('Hello', 'Overwritten'),
      { baseHash: 'f'.repeat(64), now: at })
    expect(result.written).toBe(false)
    expect(result.problems[0]?.code).toBe('stale-base')
    expect(result.problems[0]?.message).toMatch(/Read it again/)
  })

  it('treats a deleted module as a conflict, not a fresh write', async () => {
    const space = workspace()
    const first = await space.write('app/page.tsx', page, { now: at })
    await space.remove('app/page.tsx')
    const result = await space.write('app/page.tsx', page, {
      baseHash: first.module?.hash, now: at,
    })
    expect(result.written).toBe(false)
    expect(result.problems[0]?.message).toMatch(/no longer exists/)
  })

  it('keeps the stored source unchanged after a refused write', async () => {
    const space = workspace()
    await space.write('app/page.tsx', page, { now: at })
    await space.write('app/page.tsx', page.replace('Hello', 'Overwritten'),
      { baseHash: 'f'.repeat(64), now: at })
    expect((await space.read('app/page.tsx'))?.source).toContain('Hello')
  })
})

describe('hashing', () => {
  it('is stable for the same content', async () => {
    expect(await hashSource('abc')).toBe(await hashSource('abc'))
  })

  it('differs for different content', async () => {
    expect(await hashSource('abc')).not.toBe(await hashSource('abd'))
  })

  it('produces a hex digest of the expected width', async () => {
    expect(await hashSource('abc')).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('boundary analysis across the workspace', () => {
  it('reads the client directive from the source rather than assuming', async () => {
    const space = workspace()
    await space.write('app/page.tsx',
      `'use client'

export default function Page() {
  return <div /* @fuma root */ className="grid" />
}
`, { now: at })
    const analysis = await space.analyseBoundaries()
    expect(analysis.boundaries[0]?.client).toBe(true)
  })

  it('leaves a server module alone', async () => {
    const space = workspace()
    await space.write('app/page.tsx', page, { now: at })
    const analysis = await space.analyseBoundaries()
    expect(analysis.boundaries[0]?.client).toBe(false)
  })

  it('reports an animated route as an avoidable boundary', async () => {
    // The animation could live in a leaf instead, which is the whole reason to
    // measure this across the workspace rather than per file.
    const space = workspace()
    await space.write('app/page.tsx',
      `'use client'

import { motion } from 'motion/react'

export default function Page() {
  return <motion.div /* @fuma root */ className="grid" animate={{ opacity: 1 }} />
}
`, { now: at })
    const analysis = await space.analyseBoundaries()
    expect(analysis.avoidable).toHaveLength(1)
    expect(analysis.avoidable[0]?.advice).toMatch(/Extract them/)
  })

  it('skips a module that produced no root', async () => {
    // Nothing was stored for it, so it cannot appear in the analysis either.
    const space = workspace()
    await space.write('app/page.tsx', page, { now: at })
    const analysis = await space.analyseBoundaries()
    expect(analysis.boundaries).toHaveLength(1)
  })
})
