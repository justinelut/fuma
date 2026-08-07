/**
 * Layouts and Templates: one noun each.
 *
 * The assertions that earn their place are about the outlet. A layout that never renders its
 * children still renders its own chrome, so every route shows a header and footer with
 * nothing between them — and it reads as empty pages rather than as a broken layout. Nothing
 * errors, because rendering fewer children than you were given is legal React.
 */

import { describe, it, expect } from 'bun:test'
import {
  LEGACY_TEMPLATE_BECOMES,
  LEGACY_TEMPLATE_KIND,
  MODULE_KINDS,
  isLayout,
  isListable,
  nounFor,
  reviewLayout,
  reviewTemplate,
  type SiteTemplate,
} from '@core/react-ir/vocabulary'
import { generateModule } from '@core/react-ir/generate'
import { readModuleSource } from '@core/react-ir/read'
import { starterFiles } from '@core/generatedSite/starterTemplate'
import type { ReactIrModule } from '@core/react-ir/nodes'

const element = (id: string, tag: string, children: string[] = []) => ({
  kind: 'element', id, tag, classTokens: [], children,
} as never)

function layoutModule(nodes: Record<string, unknown>, rootNodeId = 'body'): ReactIrModule {
  return {
    version: 1, id: 'app/layout.tsx', path: 'app/layout.tsx', symbol: 'RootLayout',
    kind: 'layout', boundary: 'server', rootNodeId, nodes,
  } as unknown as ReactIrModule
}

const outlet = (id: string) => ({ kind: 'outlet', id, children: [] } as never)

describe('the vocabulary has one word for each thing', () => {
  it('names the page chrome a Layout', () => {
    expect(nounFor('page-chrome')).toBe('Layout')
  })

  it('names the sellable design a Template', () => {
    expect(nounFor('sellable-design')).toBe('Template')
  })

  it('has exactly three module kinds, none of them template', () => {
    expect([...MODULE_KINDS]).toEqual(['page', 'layout', 'component'])
    expect([...MODULE_KINDS]).not.toContain('template')
  })

  it('records what the legacy persisted kind becomes, without renaming it yet', () => {
    // Rows carry the literal string, so renaming in code without migrating them would orphan
    // every stored layout. The constant is where a future migration reads the mapping.
    expect(LEGACY_TEMPLATE_KIND).toBe('template')
    expect(LEGACY_TEMPLATE_BECOMES).toBe('layout')
  })
})

describe('a Layout must render its children', () => {
  it('accepts a layout with one outlet', () => {
    expect(reviewLayout(layoutModule({ body: element('body', 'body', ['out']), out: outlet('out') })))
      .toEqual([])
  })

  it('refuses a layout with no outlet', () => {
    const problems = reviewLayout(layoutModule({
      body: element('body', 'body', ['hdr']), hdr: element('hdr', 'header'),
    }))
    expect(problems[0]?.code).toBe('no-outlet')
    expect(problems[0]?.message).toContain('reads as empty pages')
  })

  it('refuses a layout with two outlets', () => {
    // React renders children once; a second outlet renders the same page again.
    const problems = reviewLayout(layoutModule({
      body: element('body', 'body', ['a', 'b']), a: outlet('a'), b: outlet('b'),
    }))
    expect(problems[0]?.code).toBe('multiple-outlets')
  })

  it('refuses a module that is not a layout at all', () => {
    const page = { ...layoutModule({ body: element('body', 'body') }), kind: 'page' } as ReactIrModule
    expect(reviewLayout(page)[0]?.code).toBe('not-a-layout')
  })

  it('stops after not-a-layout rather than also reporting a missing outlet', () => {
    // A page has no business having an outlet, so reporting one would be noise.
    const page = { ...layoutModule({ body: element('body', 'body') }), kind: 'page' } as ReactIrModule
    expect(reviewLayout(page)).toHaveLength(1)
  })

  it('answers isLayout for both directions', () => {
    expect(isLayout(layoutModule({ body: element('body', 'body', ['o']), o: outlet('o') }))).toBe(true)
    expect(isLayout(layoutModule({ body: element('body', 'body') }))).toBe(false)
  })
})

describe('the generated layout references the props it is given', () => {
  const module_ = layoutModule({ body: element('body', 'body', ['out']), out: outlet('out') })
  const code = generateModule(module_).code

  it('emits props.children, not a bare children', () => {
    // The signature takes `(props: XProps)`, so a bare identifier resolves to nothing —
    // TS2304 "Cannot find name 'children'", which made every generated layout fail to compile.
    expect(code).toContain('{props.children}')
    expect(code).not.toMatch(/\{\s*children\s*\}/)
  })

  it('declares children on the props interface', () => {
    expect(code).toContain('children?: ReactNode')
  })

  it('takes a props parameter, so the reference resolves', () => {
    expect(code).toContain('(props: RootLayoutProps)')
  })
})

describe('the outlet survives a round trip', () => {
  it('recovers props.children as an outlet, not an expression', () => {
    // Recognising only the bare form would turn the outlet into an ordinary expression, and
    // the module would then look like a layout with no outlet — the exact defect reviewLayout
    // exists to catch.
    const module_ = layoutModule({ body: element('body', 'body', ['out']), out: outlet('out') })
    const code = generateModule(module_, { anchorComments: true }).code
    const reread = readModuleSource('app/layout.tsx', code)
    expect(reread.diagnostics).toEqual([])
    expect(Object.values(reread.nodes).some((node) => node.kind === 'outlet')).toBe(true)
  })

  it('also recovers the destructured form a developer writes by hand', () => {
    const source = `export default function L({ children }: { children?: unknown }) {
  return (<body /* @fuma body */>{children}</body>)
}
`
    const reread = readModuleSource('app/layout.tsx', source)
    expect(Object.values(reread.nodes).some((node) => node.kind === 'outlet')).toBe(true)
  })

  it('reviews as a sound layout after the round trip', () => {
    // The whole point: generate then read then review must still say the layout is fine.
    const module_ = layoutModule({ body: element('body', 'body', ['out']), out: outlet('out') })
    const code = generateModule(module_, { anchorComments: true }).code
    const reread = readModuleSource('app/layout.tsx', code)
    const rebuilt = layoutModule(reread.nodes as never, reread.rootNodeId ?? 'body')
    expect(reviewLayout(rebuilt)).toEqual([])
  })
})

describe('the shipped starter layout is a sound Layout', () => {
  it('renders its children', () => {
    const layout = starterFiles('Acme').find((file) => file.path === 'app/layout.tsx')
    expect(layout?.content).toContain('{children}')
  })

  it('reads with an outlet node', () => {
    const layout = starterFiles('Acme').find((file) => file.path === 'app/layout.tsx')
    const read = readModuleSource('app/layout.tsx', layout?.content ?? '')
    expect(Object.values(read.nodes).some((node) => node.kind === 'outlet')).toBe(true)
  })
})

describe('a Template is the sellable artifact', () => {
  const sound: SiteTemplate = {
    id: 'agency-one',
    name: 'Agency One',
    description: 'A studio site with a case-study index.',
    version: '1.0.0',
    modules: [
      { path: 'app/page.tsx', kind: 'page', source: 'export default function Page() { return <main /> }' },
      { path: 'app/layout.tsx', kind: 'layout', source: 'export default function L(p: {children?: unknown}) { return <body>{p.children}</body> }' },
    ],
    themeCss: '@theme inline { --color-primary: #000; }',
    dependencies: { next: '16.2.9', react: '19.2.5' },
  }

  it('accepts a sound template', () => {
    expect(reviewTemplate(sound)).toEqual([])
    expect(isListable(sound)).toBe(true)
  })

  it('refuses a template with no home page', () => {
    // A fresh install would have no home page, so the buyer's first look at what they paid
    // for is a 404.
    const problems = reviewTemplate({
      ...sound,
      modules: sound.modules.filter((module) => module.path !== 'app/page.tsx'),
    })
    expect(problems.some((problem) => problem.code === 'no-entry-page')).toBe(true)
  })

  it('refuses a layout that never renders children', () => {
    const problems = reviewTemplate({
      ...sound,
      modules: [
        sound.modules[0]!,
        { path: 'app/layout.tsx', kind: 'layout', source: 'export default function L() { return <body /> }' },
      ],
    })
    expect(problems.some((problem) => problem.code === 'layout-without-outlet')).toBe(true)
  })

  it('refuses an unpinned dependency', () => {
    // Two buyers installing a week apart would get different code, and only one would report
    // the bug.
    const problems = reviewTemplate({ ...sound, dependencies: { next: '^16.2.9' } })
    expect(problems.some((problem) => problem.code === 'unpinned-dependency')).toBe(true)
    expect(problems.find((problem) => problem.code === 'unpinned-dependency')?.message)
      .toContain('a range')
  })

  it('refuses a duplicate path', () => {
    // Which one wins would be decided by install order, so one template could install two
    // different ways.
    const problems = reviewTemplate({ ...sound, modules: [...sound.modules, sound.modules[0]!] })
    expect(problems.some((problem) => problem.code === 'duplicate-path')).toBe(true)
  })

  it('carries source rather than IR, so it survives an engine change', () => {
    // Source is what both the reader and a human can still open in a year; an IR snapshot is
    // only readable by the version that wrote it.
    for (const module of sound.modules) {
      expect(typeof module.source).toBe('string')
      expect(module.source.length).toBeGreaterThan(0)
    }
  })

  it('records exact dependency versions', () => {
    expect(Object.values(sound.dependencies).every((version) => /^\d+\.\d+\.\d+$/.test(version)))
      .toBe(true)
  })
})
