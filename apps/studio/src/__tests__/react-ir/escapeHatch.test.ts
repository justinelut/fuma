import { describe, it, expect } from 'bun:test'
import {
  hasUtility,
  isDisciplined,
  leakedDeclarations,
  reviewEscapeHatch,
} from '@core/react-ir/escapeHatch'
import { generateModule } from '@core/react-ir/generate'
import { readModuleSource } from '@core/react-ir/read'
import type { ReactIrModule } from '@core/react-ir/nodes'

describe('reviewing the escape hatch', () => {
  it('accepts a property with no utility', () => {
    // Real needs the model must not block: no utility can express these.
    for (const property of ['clipPath', 'offsetPath', 'maskImage', 'mixBlendMode']) {
      const findings = reviewEscapeHatch({ [property]: 'something' })
      expect(findings[0]?.justified).toBe(true)
    }
  })

  it('accepts a custom property', () => {
    // How a script or a nested rule is fed a value; no utility can declare one.
    const findings = reviewEscapeHatch({ '--scroll-offset': '12px' })
    expect(findings[0]?.justified).toBe(true)
    expect(findings[0]?.message).toMatch(/custom property/)
  })

  it('flags a declaration that has a utility, and names it', () => {
    // Without this rule the hatch quietly becomes the styling system again and the
    // tokens stop governing anything.
    const findings = reviewEscapeHatch({ padding: '1rem' })
    expect(findings[0]?.justified).toBe(false)
    expect(findings[0]?.suggestion).toBe('p-<size>')
    expect(findings[0]?.message).toMatch(/theme change will not reach it/)
  })

  it('flags colour and spacing, which is where drift usually starts', () => {
    const leaked = leakedDeclarations({
      color: '#333',
      backgroundColor: '#fff',
      gap: '8px',
      clipPath: 'circle(50%)',
    })
    expect(leaked.map((finding) => finding.property).sort())
      .toEqual(['backgroundColor', 'color', 'gap'])
  })

  it('reports findings in a stable order', () => {
    const findings = reviewEscapeHatch({ zIndex: '2', clipPath: 'circle(50%)', color: 'red' })
    expect(findings.map((finding) => finding.property)).toEqual(['clipPath', 'color', 'zIndex'])
  })

  it('calls a hatch disciplined only when nothing leaked', () => {
    expect(isDisciplined({ clipPath: 'circle(50%)' })).toBe(true)
    expect(isDisciplined({ clipPath: 'circle(50%)', padding: '1rem' })).toBe(false)
    expect(isDisciplined({})).toBe(true)
  })

  it('knows which properties have utilities', () => {
    expect(hasUtility('padding')).toBe(true)
    expect(hasUtility('display')).toBe(true)
    expect(hasUtility('clipPath')).toBe(false)
    // No Tailwind utility exists for this, so an arbitrary value is the honest answer.
    expect(hasUtility('gridTemplateAreas')).toBe(false)
  })
})

describe('the escape hatch through generate and read', () => {
  const moduleWith = (style: Record<string, string>): ReactIrModule => ({
    version: 1, id: 'm1', path: 'app/page.tsx', symbol: 'Page', kind: 'page',
    rootNodeId: 'root',
    nodes: {
      root: {
        kind: 'element', id: 'root', tag: 'div',
        classTokens: ['grid'], style, children: [],
      },
    },
  } as unknown as ReactIrModule)

  it('emits the style attribute', () => {
    const { code } = generateModule(moduleWith({ clipPath: 'circle(50%)' }))
    expect(code).toContain('style={{ clipPath: "circle(50%)" }}')
  })

  it('recovers it on read, so a hand edit is not lost', () => {
    // Before the reader handled this, a hand-written style attribute was dropped on
    // the next generate, silently changing the page.
    const generated = generateModule(moduleWith({ clipPath: 'circle(50%)' }), {
      anchorComments: true,
    })
    const result = readModuleSource('app/page.tsx', generated.code)
    expect(result.diagnostics).toEqual([])
    expect((result.nodes['root'] as { style?: Record<string, string> }).style)
      .toEqual({ clipPath: 'circle(50%)' })
  })

  it('survives a full round trip unchanged', () => {
    const module = moduleWith({ clipPath: 'circle(50%)', '--offset': '12px' })
    const first = generateModule(module, { anchorComments: true })
    const read = readModuleSource('app/page.tsx', first.code)
    const rebuilt = {
      ...module, nodes: read.nodes, rootNodeId: read.rootNodeId,
    } as unknown as ReactIrModule
    expect(generateModule(rebuilt, { anchorComments: true }).code).toBe(first.code)
  })

  it('refuses a computed style object', () => {
    // The panel has to be able to show and edit each declaration.
    const result = readModuleSource('app/page.tsx',
      `export default function Page(props: { offset: number }) {
  return <div style={{ top: props.offset }} />
}
`)
    expect(result.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain('dynamic-expression-denied')
  })

  it('leaves a node without a hatch alone', () => {
    const { code } = generateModule(moduleWith({}))
    expect(code).not.toContain('style=')
  })
})
