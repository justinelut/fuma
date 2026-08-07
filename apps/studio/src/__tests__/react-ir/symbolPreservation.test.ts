/**
 * The component name must survive a round trip.
 *
 * Regenerating a module used to emit `export default function Module()` regardless of
 * what the source said, silently renaming every component in the workspace. That breaks
 * named imports in other files and makes every component read as the same name in a
 * stack trace, and it violates the rule that hand-written source is authoritative.
 */

import { describe, it, expect } from 'bun:test'
import { readModuleSource } from '@core/react-ir/read'
import { loadModule, commitEdit } from '@core/react-ir/session'
import { ModuleWorkspace, createMemoryModuleStore } from '@core/react-ir/workspace'

const body = '  return <div /* @fuma r */ className="a">x</div>\n'

describe('the reader captures the declared component name', () => {
  it('reads a default-exported function', () => {
    expect(readModuleSource('app/page.tsx', `export default function Page() {\n${body}}\n`).symbol)
      .toBe('Page')
  })

  it('reads a named-exported function', () => {
    expect(readModuleSource('components/Hero.tsx', `export function Hero() {\n${body}}\n`).symbol)
      .toBe('Hero')
  })

  it('reads an arrow function assigned to a const', () => {
    // Component files are written both ways; losing the name in either renames it.
    expect(readModuleSource('components/Card.tsx', `export const Card = () => {\n${body}}\n`).symbol)
      .toBe('Card')
  })

  it('reports null for an anonymous default export rather than inventing a name', () => {
    expect(readModuleSource('app/page.tsx', `export default function () {\n${body}}\n`).symbol)
      .toBeNull()
  })
})

describe('the session preserves the name through a write', () => {
  async function roundTrip(path: string, source: string): Promise<string> {
    const workspace = new ModuleWorkspace(createMemoryModuleStore())
    await workspace.write(path, source)
    const loaded = await loadModule(workspace, path)
    if ('problems' in loaded) throw new Error(loaded.problems[0]?.message ?? 'refused')
    await commitEdit(workspace, path, loaded.hash, (module) => ({
      ok: true, problems: [], module,
    }))
    return (await workspace.read(path))?.source ?? ''
  }

  it('keeps a page component named as written', async () => {
    const written = await roundTrip('app/page.tsx', `export default function Page() {\n${body}}\n`)
    expect(written).toContain('function Page(')
    expect(written).not.toContain('function Module(')
  })

  it('keeps a component named as written', async () => {
    // The case that actually breaks other files: an importer expects `Hero`.
    const written = await roundTrip('components/Hero.tsx', `export function Hero() {\n${body}}\n`)
    expect(written).toContain('function Hero(')
  })

  it('derives a name from the path only when the source has none', async () => {
    const written = await roundTrip('app/page.tsx', `export default function () {\n${body}}\n`)
    expect(written).toContain('function Page(')
  })

  it('derives a legal identifier from a dynamic route segment', async () => {
    // `app/blog/[slug]/page.tsx` must not emit brackets into an identifier.
    const written = await roundTrip('app/blog/[slug]/page.tsx', `export default function () {\n${body}}\n`)
    expect(written).toContain('function BlogSlugPage(')
  })

  it('is stable across repeated writes', async () => {
    // A name that drifts on each save would rename the component gradually.
    const workspace = new ModuleWorkspace(createMemoryModuleStore())
    await workspace.write('components/Hero.tsx', `export function Hero() {\n${body}}\n`)
    for (let pass = 0; pass < 3; pass += 1) {
      const loaded = await loadModule(workspace, 'components/Hero.tsx')
      if ('problems' in loaded) throw new Error('refused')
      await commitEdit(workspace, 'components/Hero.tsx', loaded.hash, (module) => ({
        ok: true, problems: [], module,
      }))
    }
    expect((await workspace.read('components/Hero.tsx'))?.source).toContain('function Hero(')
  })
})
