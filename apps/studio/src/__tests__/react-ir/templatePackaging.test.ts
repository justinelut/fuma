/**
 * Packaging a designed site as a sellable template.
 *
 * The governing rule is task 89's: export and import come before selling, because a template
 * that cannot round-trip is unsellable at any price. Every refusal here is something a buyer
 * would otherwise discover after paying.
 */

import { describe, it, expect } from 'bun:test'
import {
  exportSite,
  installTemplate,
  roundTripsCleanly,
  type SourceModule,
} from '@core/react-ir/templatePackaging'
import { starterModules } from '@core/generatedSite/starterTemplate'

/** The real shipped starter, which is the most honest sample available. */
function starterAsModules(): readonly SourceModule[] {
  return starterModules('Demo Site').map((file) => ({
    path: file.path,
    kind: file.path.endsWith('layout.tsx') ? 'layout' as const
      : file.path.endsWith('page.tsx') ? 'page' as const
        : 'component' as const,
    source: file.content,
  }))
}

function exportStarter() {
  return exportSite({
    id: 'starter', name: 'Starter', description: 'The shipped starter design.',
    version: '1.0.0', modules: starterAsModules(),
    themeCss: ':root { --background: white; }', seedContent: '{}',
  })
}

describe('the shipped starter packages and round-trips', () => {
  it('packages with no problems', () => {
    // If our own starter cannot be sold, the packaging rules are wrong rather than strict.
    const result = exportStarter()
    expect(result.problems).toEqual([])
    expect(result.template).not.toBeNull()
  })

  it('carries every module', () => {
    expect(exportStarter().template?.modules.map((module) => module.path))
      .toEqual(['app/layout.tsx', 'app/page.tsx', 'components/Hero.tsx'])
  })

  it('round-trips losslessly', () => {
    // The property that decides whether a template is sellable at all.
    const template = exportStarter().template
    expect(template).not.toBeNull()
    expect(roundTripsCleanly(template!)).toBe(true)
  })

  it('installs to exactly the files it declared', () => {
    const installed = installTemplate(exportStarter().template!, [])
    expect(Object.keys(installed.files).sort())
      .toEqual(['app/layout.tsx', 'app/page.tsx', 'components/Hero.tsx'])
    expect(installed.problems).toEqual([])
  })

  it('pins every dependency to an exact version', () => {
    // A range means two buyers installing a week apart get different code, and only one of
    // them reports the bug.
    const dependencies = exportStarter().template?.dependencies ?? {}
    expect(Object.keys(dependencies).length).toBeGreaterThan(0)
    for (const version of Object.values(dependencies)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+/)
    }
  })
})

describe('what must never be shipped inside a template', () => {
  const withSource = (source: string) => exportSite({
    id: 'x', name: 'X', description: 'd', version: '1.0.0',
    modules: [{ path: 'app/page.tsx', kind: 'page', source }],
    themeCss: '', seedContent: '{}',
  })

  it('refuses a localhost endpoint', () => {
    // On a buyer's site the request fails, and the failure reads as the template being broken
    // rather than as pointing at the author's own machine.
    const result = withSource(
      `export default function Page() { return <a href="http://localhost:3000/api">x</a> }`,
    )
    expect(result.template).toBeNull()
    expect(result.problems.some((problem) => problem.code === 'private-reference')).toBe(true)
  })

  it('refuses an internal hostname', () => {
    const result = withSource(
      `export default function Page() { return <a href="https://api.internal/v1">x</a> }`,
    )
    expect(result.problems.some((problem) => problem.code === 'private-reference')).toBe(true)
  })

  it('refuses an API key', () => {
    // A credential inside a template is copied to every buyer and is invisible in a preview.
    const result = withSource(
      `const key = 'sk_live_abcdef1234567890'\nexport default function Page() { return <p>{key}</p> }`,
    )
    expect(result.problems.some((problem) => problem.message.includes('API key'))).toBe(true)
  })

  it('refuses a bearer token', () => {
    const result = withSource(
      `const h = 'Bearer abcdefghijklmnopqrstuvwxyz012345'\nexport default function Page() { return <p>{h}</p> }`,
    )
    expect(result.problems.some((problem) => problem.code === 'private-reference')).toBe(true)
  })

  it('refuses a named credential', () => {
    const result = withSource(
      `const config = { password: 'hunter2hunter2' }\nexport default function Page() { return <p>{config.password}</p> }`,
    )
    expect(result.problems.some((problem) => problem.code === 'private-reference')).toBe(true)
  })

  it('does not cry wolf over ordinary source', () => {
    // A gate that fires on clean code gets switched off, and then it is not there when it
    // matters. The starter is the control case.
    expect(exportStarter().problems).toEqual([])
  })

  it('scans every module, not just the first', () => {
    // The regexes carry the global flag, so a shared lastIndex would make the second file's
    // scan start partway through and miss the match.
    const result = exportSite({
      id: 'x', name: 'X', description: 'd', version: '1.0.0',
      modules: [
        { path: 'app/page.tsx', kind: 'page', source: `export default function Page() { return <p>ok</p> }` },
        { path: 'components/A.tsx', kind: 'component', source: `export function A() { return <a href="http://localhost:9/x">y</a> }` },
      ],
      themeCss: '', seedContent: '{}',
    })
    expect(result.problems.some((problem) => problem.path === 'components/A.tsx')).toBe(true)
  })
})

describe('a module the builder cannot open is refused at packaging time', () => {
  it('refuses source the reader rejects', () => {
    // Otherwise the buyer installs it, opens the builder and sees an empty canvas — which
    // reads as the product being broken rather than as this template being unusual.
    const result = exportSite({
      id: 'x', name: 'X', description: 'd', version: '1.0.0',
      modules: [{
        path: 'app/page.tsx',
        kind: 'page',
        source: `export default function Page() { return <p>{greeting(9)}</p> }`,
      }],
      themeCss: '', seedContent: '{}',
    })
    expect(result.template).toBeNull()
    expect(result.problems.some((problem) => problem.code === 'unreadable-module')).toBe(true)
  })

  it('names the file and says what a buyer would see', () => {
    const result = exportSite({
      id: 'x', name: 'X', description: 'd', version: '1.0.0',
      modules: [{
        path: 'app/page.tsx', kind: 'page',
        source: `export default function Page() { return <p>{greeting(9)}</p> }`,
      }],
      themeCss: '', seedContent: '{}',
    })
    const problem = result.problems.find((candidate) => candidate.code === 'unreadable-module')
    expect(problem?.path).toBe('app/page.tsx')
    expect(problem?.message).toContain('empty canvas')
  })

  it('refuses a template with no modules', () => {
    const result = exportSite({
      id: 'x', name: 'X', description: 'd', version: '1.0.0',
      modules: [], themeCss: '', seedContent: '{}',
    })
    expect(result.problems[0]?.code).toBe('no-modules')
  })
})

describe('installing does not destroy the buyer own work', () => {
  it('refuses a colliding path', () => {
    // Overwriting is unrecoverable — the site owner has no copy — so the install stops rather
    // than choosing for them.
    const installed = installTemplate(exportStarter().template!, ['app/page.tsx'])
    expect(installed.problems.some((problem) => problem.code === 'would-overwrite')).toBe(true)
  })

  it('writes nothing at all when any path collides', () => {
    // A half-installed template leaves a site that is neither what it was nor what was bought.
    const installed = installTemplate(exportStarter().template!, ['app/page.tsx'])
    expect(installed.files).toEqual({})
  })

  it('names the colliding file', () => {
    const installed = installTemplate(exportStarter().template!, ['components/Hero.tsx'])
    expect(installed.problems[0]?.path).toBe('components/Hero.tsx')
  })

  it('installs when nothing collides', () => {
    const installed = installTemplate(exportStarter().template!, ['README.md'])
    expect(installed.problems).toEqual([])
    expect(Object.keys(installed.files).length).toBe(3)
  })
})

describe('seed content is a decision, not an oversight', () => {
  it('warns without refusing when seed content is absent', () => {
    // Shipping without it is legitimate for a fill-in-the-blanks template, but it is also the
    // commonest reason a bought theme is refunded.
    const result = exportSite({
      id: 'starter', name: 'Starter', description: 'd', version: '1.0.0',
      modules: starterAsModules(), themeCss: '',
    })
    expect(result.template).not.toBeNull()
    expect(result.warnings.some((warning) => warning.code === 'no-seed-content')).toBe(true)
  })

  it('does not warn when seed content is present', () => {
    expect(exportStarter().warnings.some((warning) => warning.code === 'no-seed-content'))
      .toBe(false)
  })
})
