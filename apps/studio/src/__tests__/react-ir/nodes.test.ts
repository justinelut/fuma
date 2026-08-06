import { describe, it, expect } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  ExpressionSchema,
  enumerateLiteralOutcomes,
  isStaticallyEnumerable,
  type Expression,
} from '@core/react-ir/expression'
import {
  REACT_IR_VERSION,
  ReactIrModuleSchema,
  ReactNodeSchema,
  canHaveChildren,
  childIdsOf,
  classTokensOf,
  hasClassTokens,
  isHidden,
  isLocked,
  walkNodeIds,
  type ReactIrModule,
  type ReactIrNode,
} from '@core/react-ir/nodes'

function element(id: string, children: string[] = [], tag = 'div'): ReactIrNode {
  return {
    kind: 'element',
    id,
    tag,
    children,
    attributes: {},
    classTokens: [],
  }
}

function text(id: string, value: string): ReactIrNode {
  return { kind: 'text', id, value, children: [] }
}

function moduleWith(nodes: ReactIrNode[], rootNodeId: string): ReactIrModule {
  return {
    version: REACT_IR_VERSION,
    id: 'mod-1',
    path: 'app/page.tsx',
    symbol: 'Page',
    kind: 'page',
    boundary: 'server',
    propsInterface: [],
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeId,
  }
}

describe('React IR expressions', () => {
  it('accepts each permitted form', () => {
    const forms: Expression[] = [
      { kind: 'literal', value: 'Hello' },
      { kind: 'member', scope: 'item', path: ['title'], format: 'text' },
      {
        kind: 'template',
        quasis: ['Hi ', '!'],
        parts: [{ kind: 'member', scope: 'item', path: ['name'], format: 'text' }],
      },
      {
        kind: 'conditional',
        test: { scope: 'item', path: ['featured'], operator: 'exists' },
        whenTrue: { kind: 'literal', value: 'bg-primary' },
        whenFalse: { kind: 'literal', value: 'bg-muted' },
      },
    ]
    for (const form of forms) {
      expect(Value.Check(ExpressionSchema, form)).toBe(true)
    }
  })

  it('rejects forms it deliberately cannot round-trip', () => {
    // A call has arguments that could be anything and a result that cannot be
    // previewed without running it. A spread hides which props exist, so the
    // property panel could not show a truthful surface.
    expect(Value.Check(ExpressionSchema, { kind: 'call', callee: 'formatDate' })).toBe(false)
    expect(Value.Check(ExpressionSchema, { kind: 'spread', from: 'props' })).toBe(false)
    expect(Value.Check(ExpressionSchema, { kind: 'member', scope: 'window', path: ['x'] }))
      .toBe(false)
  })

  it('bounds template size so dynamic class names stay impossible', () => {
    const tooMany = {
      kind: 'template',
      quasis: Array.from({ length: 12 }, () => 'x'),
      parts: Array.from({ length: 11 }, () => ({
        kind: 'member', scope: 'item', path: ['n'], format: 'text',
      })),
    }
    expect(Value.Check(ExpressionSchema, tooMany)).toBe(false)
  })

  it('enumerates a finite conditional and refuses to guess an open one', () => {
    const finite: Expression = {
      kind: 'conditional',
      test: { scope: 'item', path: ['featured'], operator: 'exists' },
      whenTrue: { kind: 'literal', value: 'bg-primary' },
      whenFalse: { kind: 'literal', value: 'bg-muted' },
    }
    expect(enumerateLiteralOutcomes(finite)).toEqual(['bg-primary', 'bg-muted'])
    expect(isStaticallyEnumerable(finite)).toBe(true)

    // A member read resolves at runtime, so its value set is open. Returning a
    // guess here is what would let an unscannable Tailwind class slip through.
    const open: Expression = { kind: 'member', scope: 'item', path: ['variant'], format: 'text' }
    expect(enumerateLiteralOutcomes(open)).toBeNull()
    expect(isStaticallyEnumerable(open)).toBe(false)
  })

  it('treats a conditional containing an open branch as open', () => {
    const mixed: Expression = {
      kind: 'conditional',
      test: { scope: 'item', path: ['featured'], operator: 'exists' },
      whenTrue: { kind: 'literal', value: 'bg-primary' },
      whenFalse: { kind: 'member', scope: 'item', path: ['fallbackClass'], format: 'text' },
    }
    expect(isStaticallyEnumerable(mixed)).toBe(false)
  })
})

describe('React IR nodes', () => {
  it('validates every node kind', () => {
    const nodes: ReactIrNode[] = [
      element('n1'),
      text('n2', 'copy'),
      {
        kind: 'component',
        id: 'n3',
        component: { id: 'cmp-button', symbol: 'Button', source: '@/components/ui/button' },
        props: {},
        slots: {},
        classTokens: ['px-4'],
        children: [],
        locked: false,
        hidden: false,
      },
      {
        kind: 'expression',
        id: 'n4',
        expression: { kind: 'member', scope: 'page', path: ['title'], format: 'text' },
        children: [],
        locked: false,
        hidden: false,
      },
      {
        kind: 'repeat',
        id: 'n5',
        source: { id: 'posts', filters: [], direction: 'desc' },
        key: 'id',
        variants: ['n1'],
        children: [],
        locked: false,
        hidden: false,
      },
      {
        kind: 'slot',
        id: 'n6',
        slotId: 'slot-body',
        name: 'body',
        fallbackChildren: [],
        children: [],
        locked: false,
        hidden: false,
      },
      { kind: 'outlet', id: 'n7', children: [], locked: false, hidden: false },
      {
        kind: 'opaque',
        id: 'n8',
        symbol: 'PriceTable',
        source: '@/components/price-table',
        props: {},
        sourceHash: 'a'.repeat(64),
        reason: 'uses a hook the reader does not model',
        children: [],
        locked: false,
        hidden: false,
      },
    ]
    for (const node of nodes) {
      expect(Value.Check(ReactNodeSchema, node)).toBe(true)
    }
  })

  it('pins the document version so a migration can tell documents apart', () => {
    const mod = moduleWith([element('root')], 'root')
    expect(Value.Check(ReactIrModuleSchema, mod)).toBe(true)
    // The legacy Page contract has no version field at all, which is why both
    // parsers would otherwise have to guess which shape they were handed.
    expect(Value.Check(ReactIrModuleSchema, { ...mod, version: 999 })).toBe(false)
  })

  it('requires an opaque node to record why it is opaque and what it renders', () => {
    const base = {
      kind: 'opaque' as const,
      id: 'n1',
      symbol: 'Widget',
      source: '@/w',
      props: {},
      children: [],
      locked: false,
      hidden: false,
      reason: 'uses a hook the reader does not model',
    }
    // The hash is what lets a merge notice the region changed underneath the
    // document instead of silently overwriting a developer's edit.
    expect(Value.Check(ReactNodeSchema, { ...base, sourceHash: 'a'.repeat(64) })).toBe(true)
    expect(Value.Check(ReactNodeSchema, { ...base, sourceHash: 'not-a-hash' })).toBe(false)

    // Optional, not withFallback: TypeBox cannot apply a parser default inside a
    // union — branch resolution fails first — so a fallback here would promise
    // leniency it cannot deliver. Absent means absent, and accessors supply the
    // default instead.
    const withoutReason = { ...base, sourceHash: 'a'.repeat(64) }
    delete (withoutReason as { reason?: string }).reason
    expect(Value.Check(ReactNodeSchema, withoutReason)).toBe(true)
  })

  it('supplies editor-metadata defaults so callers never branch on absence', () => {
    const plain = element('n1')
    expect(isLocked(plain)).toBe(false)
    expect(isHidden(plain)).toBe(false)
    expect(classTokensOf(plain)).toEqual([])
    expect(classTokensOf(text('n2', 'x'))).toEqual([])
    expect(isLocked({ ...plain, locked: true })).toBe(true)
  })

  it('knows which kinds contain children and which carry classes', () => {
    expect(canHaveChildren(element('n1'))).toBe(true)
    expect(canHaveChildren(text('n2', 'x'))).toBe(false)
    expect(hasClassTokens(element('n1'))).toBe(true)
    expect(hasClassTokens(text('n2', 'x'))).toBe(false)
  })

  it('collects children from slots, attributes and repeat variants', () => {
    const component: ReactIrNode = {
      kind: 'component',
      id: 'c1',
      component: { id: 'cmp-card', symbol: 'Card', source: '@/card' },
      props: { footer: { kind: 'nodes', children: ['f1'] } },
      slots: { header: ['h1'] },
      classTokens: [],
      children: ['b1'],
      locked: false,
      hidden: false,
    }
    // Missing any of these would orphan a subtree: the canvas would not show it
    // and codegen would not emit it.
    expect([...childIdsOf(component)].sort()).toEqual(['b1', 'f1', 'h1'])
  })

  it('walks depth-first, left to right', () => {
    const mod = moduleWith([
      element('root', ['a', 'b']),
      element('a', ['a1']),
      text('a1', 'first'),
      element('b'),
    ], 'root')
    expect(walkNodeIds(mod)).toEqual(['root', 'a', 'a1', 'b'])
  })

  it('does not hang on a cyclic document', () => {
    // The editor cannot produce a cycle, but a hand-edited or migrated document
    // could, and an unguarded walk would freeze the canvas instead of reporting
    // a broken document.
    const mod = moduleWith([
      element('root', ['a']),
      element('a', ['root']),
    ], 'root')
    expect(walkNodeIds(mod)).toEqual(['root', 'a'])
  })

  it('skips ids with no node rather than throwing mid-walk', () => {
    const mod = moduleWith([element('root', ['missing', 'a']), element('a')], 'root')
    expect(walkNodeIds(mod)).toEqual(['root', 'a'])
  })
})
