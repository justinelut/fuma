import { describe, it, expect } from 'bun:test'
import { generateModule } from '@core/react-ir/generate'
import { readModuleSource } from '@core/react-ir/read'
import { REACT_IR_VERSION, type ReactIrModule, type ReactIrNode } from '@core/react-ir/nodes'

function read(source: string) {
  return readModuleSource('Page.tsx', source)
}

function wrap(body: string, imports = ''): string {
  return `${imports}export default function Page(props: { title: string }) {\n  return (\n${body}\n  )\n}\n`
}

function moduleWith(nodes: ReactIrNode[], rootNodeId: string): ReactIrModule {
  return {
    version: REACT_IR_VERSION,
    id: 'm1',
    path: 'Page.tsx',
    symbol: 'Page',
    kind: 'page',
    boundary: 'server',
    propsInterface: [{ name: 'title', type: 'string', required: true }],
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeId,
  }
}

describe('TSX reader — accepted subset', () => {
  it('reads an element with literal classes and text', () => {
    const result = read(wrap('    <section className="mx-auto px-6">Hello</section>'))
    expect(result.diagnostics).toHaveLength(0)
    const root = result.nodes[result.rootNodeId ?? '']
    expect(root?.kind).toBe('element')
    expect(root && 'tag' in root ? root.tag : null).toBe('section')
    expect(root && 'classTokens' in root ? root.classTokens : null).toEqual(['mx-auto', 'px-6'])
  })

  it('reads a member expression and its fallback', () => {
    const result = read(wrap('    <p>{props.title ?? "Untitled"}</p>'))
    expect(result.diagnostics).toHaveLength(0)
    const expression = Object.values(result.nodes).find((node) => node.kind === 'expression')
    expect(expression && 'expression' in expression ? expression.expression : null).toEqual({
      kind: 'member',
      scope: 'prop',
      path: ['title'],
      format: 'text',
      fallback: 'Untitled',
    })
  })

  it('reads children as the outlet position', () => {
    const result = read(wrap('    <main>{children}</main>'))
    expect(result.diagnostics).toHaveLength(0)
    expect(Object.values(result.nodes).some((node) => node.kind === 'outlet')).toBe(true)
  })

  it('resolves a component through its import', () => {
    const result = read(wrap(
      '    <Button variant="ghost" />',
      "import { Button } from '@/components/ui/button'\n\n",
    ))
    expect(result.diagnostics).toHaveLength(0)
    const component = Object.values(result.nodes).find((node) => node.kind === 'component')
    expect(component && 'component' in component ? component.component.source : null)
      .toBe('@/components/ui/button')
  })

  it('reads a conditional as a finite choice', () => {
    const result = read(wrap('    <p>{props.title === "live" ? "on" : "off"}</p>'))
    expect(result.diagnostics).toHaveLength(0)
    const expression = Object.values(result.nodes).find((node) => node.kind === 'expression')
    const value = expression && 'expression' in expression ? expression.expression : null
    expect(value).toMatchObject({
      kind: 'conditional',
      test: { scope: 'prop', path: ['title'], operator: 'equals', value: 'live' },
    })
  })
})

describe('TSX reader — refusals', () => {
  it('refuses a spread because it hides which props exist', () => {
    const result = read(wrap('    <section {...props}>Hi</section>'))
    expect(result.diagnostics.map((d) => d.code)).toContain('spread-denied')
  })

  it('refuses an event handler as not editable here', () => {
    const result = read(wrap('    <button onClick={props.title}>Go</button>'))
    expect(result.diagnostics.map((d) => d.code)).toContain('handler-denied')
  })

  it('refuses raw HTML it cannot model', () => {
    const result = read(wrap('    <div dangerouslySetInnerHTML={props.title} />'))
    expect(result.diagnostics.map((d) => d.code)).toContain('inner-html-denied')
  })

  it('refuses a computed class list and says what to do instead', () => {
    const result = read(wrap('    <div className={props.title}>Hi</div>'))
    const denial = result.diagnostics.find((d) => d.code === 'dynamic-expression-denied')
    expect(denial).toBeDefined()
    // The message has to be actionable, not just a rejection.
    expect(denial?.message).toContain('complete literal string')
  })

  it('refuses a component with no traceable import', () => {
    const result = read(wrap('    <Mystery />'))
    expect(result.diagnostics.map((d) => d.code)).toContain('unresolved-component')
  })

  it('refuses a call because it cannot be previewed without running it', () => {
    const result = read(wrap('    <p>{formatDate(props.title)}</p>'))
    expect(result.diagnostics.map((d) => d.code)).toContain('handler-denied')
  })

  it('reports a missing component rather than throwing', () => {
    const result = read('const x = 1\n')
    expect(result.rootNodeId).toBeNull()
    expect(result.diagnostics.map((d) => d.code)).toContain('no-default-export')
  })

  it('locates every diagnostic so the author can find it', () => {
    const result = read(wrap('    <section {...props}>Hi</section>'))
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.line).toBeGreaterThan(0)
      expect(diagnostic.column).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('TSX round trip', () => {
  const source = moduleWith([
    {
      kind: 'element', id: 'root', tag: 'section',
      children: ['heading', 'lede', 'cta'],
      classTokens: ['mx-auto', 'max-w-2xl'], attributes: {},
    },
    {
      kind: 'element', id: 'heading', tag: 'h1', children: ['headingText'],
      classTokens: ['text-3xl'], attributes: {},
    },
    { kind: 'text', id: 'headingText', value: 'Welcome', children: [] },
    {
      kind: 'expression', id: 'lede', children: [],
      expression: { kind: 'member', scope: 'prop', path: ['title'], format: 'text', fallback: 'Untitled' },
    },
    {
      kind: 'component', id: 'cta', children: [], classTokens: ['w-full'], slots: {},
      component: { id: 'c1', symbol: 'Button', source: '@/components/ui/button' },
      props: { variant: { kind: 'expression', expression: { kind: 'literal', value: 'ghost' } } },
    },
  ], 'root')

  it('preserves element identity through anchors', () => {
    const generated = generateModule(source, { anchorComments: true })
    const result = read(generated.code)
    expect(result.diagnostics).toHaveLength(0)
    // Identity surviving is what lets a visual edit and a hand edit be merged
    // rather than one silently overwriting the other.
    expect(result.rootNodeId).toBe('root')
    expect([...result.anchoredNodeIds].sort()).toEqual(['cta', 'heading', 'root'])
  })

  it('recovers structure, classes, props and expressions', () => {
    const result = read(generateModule(source, { anchorComments: true }).code)
    const root = result.nodes['root']
    expect(root && 'classTokens' in root ? root.classTokens : null).toEqual(['mx-auto', 'max-w-2xl'])
    expect(root?.children).toHaveLength(3)

    const heading = result.nodes['heading']
    expect(heading && 'tag' in heading ? heading.tag : null).toBe('h1')

    const cta = result.nodes['cta']
    expect(cta && 'props' in cta ? cta.props?.variant : null).toEqual({
      kind: 'expression',
      expression: { kind: 'literal', value: 'ghost' },
    })
  })

  it('reports that identity is weaker without anchors', () => {
    // Text and expression nodes have no opening tag to carry an anchor, so a
    // document is never fully anchored — the flag has to tell the truth about
    // that rather than implying stronger guarantees than exist.
    const result = read(generateModule(source, { anchorComments: false }).code)
    expect(result.fullyAnchored).toBe(false)
    expect(result.anchoredNodeIds).toHaveLength(0)
  })

  it('survives reformatting, which is what spans would not', () => {
    const generated = generateModule(source, { anchorComments: true })
    // Collapse indentation the way a formatter with different settings would.
    const reformatted = generated.code
      .split('\n')
      .map((line) => line.replace(/^\s+/, ''))
      .join('\n')
    const result = read(reformatted)
    expect(result.rootNodeId).toBe('root')
    expect([...result.anchoredNodeIds].sort()).toEqual(['cta', 'heading', 'root'])
  })
})
