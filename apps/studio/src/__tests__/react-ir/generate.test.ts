import { describe, it, expect } from 'bun:test'
import {
  expressionToSource,
  generateModule,
  referencedNodeIds,
} from '@core/react-ir/generate'
import { REACT_IR_VERSION, type ReactIrModule, type ReactIrNode } from '@core/react-ir/nodes'
import type { Expression } from '@core/react-ir/expression'

function moduleWith(
  nodes: ReactIrNode[],
  rootNodeId: string,
  overrides: Partial<ReactIrModule> = {},
): ReactIrModule {
  return {
    version: REACT_IR_VERSION,
    id: 'm1',
    path: 'app/page.tsx',
    symbol: 'Page',
    kind: 'page',
    boundary: 'server',
    propsInterface: [],
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeId,
    ...overrides,
  }
}

const element = (
  id: string,
  children: string[] = [],
  tag = 'div',
  classTokens: string[] = [],
): ReactIrNode => ({ kind: 'element', id, tag, children, attributes: {}, classTokens })

const text = (id: string, value: string): ReactIrNode => ({
  kind: 'text', id, value, children: [],
})

describe('expression source', () => {
  it('renders each form as valid TSX', () => {
    expect(expressionToSource({ kind: 'literal', value: 'hi' })).toBe('"hi"')
    expect(expressionToSource({ kind: 'literal', value: 4 })).toBe('4')
    expect(expressionToSource({ kind: 'literal', value: null })).toBe('null')
    expect(expressionToSource({
      kind: 'member', scope: 'item', path: ['author', 'name'], format: 'text',
    })).toBe('item.author.name')
    expect(expressionToSource({
      kind: 'member', scope: 'prop', path: ['title'], format: 'text', fallback: 'Untitled',
    })).toBe('props.title ?? "Untitled"')
  })

  it('subscripts a segment that is not a valid identifier', () => {
    // A field named with a dash or space would be a syntax error as `.field`.
    expect(expressionToSource({
      kind: 'member', scope: 'item', path: ['og-title'], format: 'text',
    })).toBe('item["og-title"]')
  })

  it('escapes template interpolation so a value cannot inject syntax', () => {
    const expression: Expression = {
      kind: 'template',
      quasis: ['before ${evil} ', ' after'],
      parts: [{ kind: 'member', scope: 'item', path: ['name'], format: 'text' }],
    }
    const source = expressionToSource(expression)
    expect(source).toContain('\\${evil}')
    expect(source).toContain('${item.name}')
  })

  it('renders each conditional operator', () => {
    const base = { scope: 'item' as const, path: ['status'] }
    const branches = {
      whenTrue: { kind: 'literal' as const, value: 'on' },
      whenFalse: { kind: 'literal' as const, value: 'off' },
    }
    expect(expressionToSource({
      kind: 'conditional', test: { ...base, operator: 'equals', value: 'live' }, ...branches,
    })).toBe('item.status === "live" ? "on" : "off"')
    expect(expressionToSource({
      kind: 'conditional', test: { ...base, operator: 'empty' }, ...branches,
    })).toBe('!item.status ? "on" : "off"')
    expect(expressionToSource({
      kind: 'conditional', test: { ...base, operator: 'exists' }, ...branches,
    })).toBe('item.status ? "on" : "off"')
  })
})

describe('module generation', () => {
  it('is deterministic across runs', () => {
    const mod = moduleWith([
      element('root', ['a'], 'section', ['p-4']),
      text('a', 'hello'),
    ], 'root')
    expect(generateModule(mod).code).toBe(generateModule(mod).code)
  })

  it('sorts attributes so output does not depend on key order', () => {
    const withOrderA: ReactIrNode = {
      kind: 'element', id: 'root', tag: 'a', children: [], classTokens: [],
      attributes: {
        href: { kind: 'expression', expression: { kind: 'literal', value: '/x' } },
        rel: { kind: 'expression', expression: { kind: 'literal', value: 'noreferrer' } },
        target: { kind: 'expression', expression: { kind: 'literal', value: '_blank' } },
      },
    }
    const withOrderB: ReactIrNode = {
      ...withOrderA,
      attributes: {
        target: { kind: 'expression', expression: { kind: 'literal', value: '_blank' } },
        href: { kind: 'expression', expression: { kind: 'literal', value: '/x' } },
        rel: { kind: 'expression', expression: { kind: 'literal', value: 'noreferrer' } },
      },
    }
    const a = generateModule(moduleWith([withOrderA], 'root')).code
    const b = generateModule(moduleWith([withOrderB], 'root')).code
    expect(a).toBe(b)
  })

  it('places use client only when the module needs it', () => {
    const nodes = [element('root')]
    expect(generateModule(moduleWith(nodes, 'root')).code.startsWith("'use client'")).toBe(false)
    const client = generateModule(moduleWith(nodes, 'root', { boundary: 'client' })).code
    expect(client.startsWith("'use client'")).toBe(true)
  })

  it('anchors every node to its exact line and column', () => {
    const mod = moduleWith([
      element('root', ['a'], 'section'),
      element('a', ['b'], 'h1'),
      text('b', 'Title'),
    ], 'root')
    const generated = generateModule(mod)
    const lines = generated.code.split('\n')

    for (const anchor of generated.anchors) {
      const line = lines[anchor.line - 1] ?? ''
      // The recorded column must be exactly where the node's output begins.
      expect(line.length).toBeGreaterThanOrEqual(anchor.column)
      expect(line.slice(0, anchor.column).trim()).toBe('')
    }
    expect(generated.anchors.map((anchor) => anchor.nodeId)).toEqual(['root', 'a', 'b'])
  })

  it('can additionally place anchors in the source for heavy hand-editing', () => {
    const mod = moduleWith([element('root')], 'root')
    expect(generateModule(mod).code).not.toContain('@fuma')
    // The anchor sits inside the opening tag. Placed before the element it would
    // be a sibling of it, which is a syntax error in a single-expression return.
    // Inside the tag it is valid everywhere and survives reformatting, which a
    // recorded span does not.
    expect(generateModule(mod, { anchorComments: true }).code)
      .toContain('<div /* @fuma root */ />')
  })

  it('wraps text containing JSX syntax so it stays literal', () => {
    const mod = moduleWith([element('root', ['t']), text('t', 'a < b && c > d')], 'root')
    const code = generateModule(mod).code
    // Emitting this raw would be parsed as markup rather than shown to a visitor.
    expect(code).toContain('{"a < b && c > d"}')
  })

  it('imports each component once with sorted symbols', () => {
    const mod = moduleWith([
      element('root', ['b1', 'b2']),
      {
        kind: 'component', id: 'b1', children: [], classTokens: [], props: {}, slots: {},
        component: { id: 'c1', symbol: 'Button', source: '@/components/ui/button' },
      },
      {
        kind: 'component', id: 'b2', children: [], classTokens: [], props: {}, slots: {},
        component: { id: 'c2', symbol: 'Alert', source: '@/components/ui/button' },
      },
    ], 'root')
    const code = generateModule(mod).code
    expect(code).toContain("import { Alert, Button } from '@/components/ui/button'")
    expect(code.match(/from '@\/components\/ui\/button'/g)).toHaveLength(1)
  })

  it('renders an outlet as props.children and declares it on the props interface', () => {
    const mod = moduleWith([
      element('root', ['o'], 'main'),
      { kind: 'outlet', id: 'o', children: [] },
    ], 'root', { kind: 'layout', symbol: 'SiteLayout' })
    const code = generateModule(mod).code
    // `props.children`, not a bare `children`. This test previously asserted the bare form,
    // which does not compile: the signature emitted is `(props: SiteLayoutProps)`, so a bare
    // identifier is TS2304 "Cannot find name 'children'" and EVERY generated layout failed.
    expect(code).toContain('{props.children}')
    expect(code).not.toMatch(/\{\s*children\s*\}/)
    expect(code).toContain('children?: ReactNode')
    expect(code).toContain("import type { ReactNode } from 'react'")
  })

  it('renders a slot with its fallback', () => {
    const mod = moduleWith([
      element('root', ['s']),
      {
        kind: 'slot', id: 's', slotId: 'slot-1', name: 'header',
        fallbackChildren: ['f'], children: [],
      },
      text('f', 'Default header'),
    ], 'root', { propsInterface: [{ name: 'header', type: 'node', required: false }] })
    const code = generateModule(mod).code
    expect(code).toContain('{props.header ?? (')
    expect(code).toContain('Default header')
  })

  it('emits a repeat as a map with a key that is always valid', () => {
    const mod = moduleWith([
      element('root', ['r']),
      {
        kind: 'repeat', id: 'r', children: [], key: 'slug', variants: ['card'],
        source: { id: 'posts', filters: [], direction: 'desc' },
      },
      element('card', [], 'article'),
    ], 'root', { propsInterface: [{ name: 'posts', type: 'collection', required: true }] })
    const code = generateModule(mod).code
    expect(code).toContain('props.posts.map((item, index) => (')
    // A row is loosely typed, so reading a field yields unknown. String() keeps
    // the key valid without over-constraining what a row may contain.
    expect(code).toContain('key={String(item["slug"])}')
    expect(code).toContain('readonly Record<string, unknown>[]')
  })

  it('cycles several repeat variants across rows', () => {
    const mod = moduleWith([
      element('root', ['r']),
      {
        kind: 'repeat', id: 'r', children: [], key: 'id', variants: ['a', 'b'],
        source: { id: 'posts', filters: [], direction: 'desc' },
      },
      element('a', [], 'article'),
      element('b', [], 'aside'),
    ], 'root', { propsInterface: [{ name: 'posts', type: 'collection', required: true }] })
    const code = generateModule(mod).code
    expect(code).toContain('index % 2 === 0 &&')
    expect(code).toContain('index % 2 === 1 &&')
  })

  it('renders opaque code as a call it never rewrites', () => {
    const mod = moduleWith([
      element('root', ['o']),
      {
        kind: 'opaque', id: 'o', symbol: 'PriceTable', source: '@/components/price-table',
        props: { plan: { kind: 'expression', expression: { kind: 'literal', value: 'pro' } } },
        sourceHash: 'a'.repeat(64),
        reason: 'uses a hook the reader does not model',
        children: [],
      },
    ], 'root')
    const code = generateModule(mod).code
    expect(code).toContain("import { PriceTable } from '@/components/price-table'")
    expect(code).toContain('<PriceTable plan="pro" />')
  })

  it('renders enum props as a literal union', () => {
    const mod = moduleWith([element('root')], 'root', {
      propsInterface: [{ name: 'tone', type: 'enum', required: true, options: ['calm', 'loud'] }],
    })
    expect(generateModule(mod).code).toContain('tone: "calm" | "loud"')
  })

  it('reports every referenced node id for completeness checks', () => {
    const mod = moduleWith([
      element('root', ['a']),
      element('a'),
    ], 'root')
    expect([...referencedNodeIds(mod)].sort()).toEqual(['a', 'root'])
  })
})
