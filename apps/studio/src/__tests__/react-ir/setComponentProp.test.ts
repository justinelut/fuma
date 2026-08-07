/**
 * `setComponentProp` — the operation whose absence made task 72's cva controls unusable.
 *
 * Task 72 derived variant controls from a shadcn component's own source and NOTHING could consume
 * them, because no edit op existed to apply a chosen value: the ops were structural (insert/move/
 * delete) plus class tokens. A control that cannot write is a control nobody can use.
 */
import { describe, expect, it } from 'bun:test'
import { setComponentProp } from '@core/react-ir/edit'
import { generateModule } from '@core/react-ir/generate'
import { Value } from '@sinclair/typebox/value'
import { REACT_IR_VERSION, ReactIrModuleSchema, type ReactIrModule } from '@core/react-ir/nodes'

function moduleWithButton(props?: Record<string, unknown>): ReactIrModule {
  return {
    version: REACT_IR_VERSION,
    id: 'mod-1',
    kind: 'page',
    path: 'app/page.tsx',
    symbol: 'Page',
    rootNodeId: 'root',
    propsInterface: [],
    boundary: 'server',
    nodes: {
      root: { kind: 'element', id: 'root', tag: 'main', attributes: {}, children: ['cta'] },
      cta: {
        kind: 'component',
        id: 'cta',
        component: { id: 'button', symbol: 'Button', source: '@/components/ui/button' },
        ...(props === undefined ? {} : { props }),
        children: [],
      },
      text: { kind: 'text', id: 'text', value: 'Hi', children: [] },
    },
  } as ReactIrModule
}

describe('setting a variant', () => {
  it('writes the value in the shape the generator reads', () => {
    const result = setComponentProp(moduleWithButton(), 'cta', 'variant', 'destructive')
    expect(result.ok).toBe(true)
    const node = result.module.nodes['cta'] as { props?: Record<string, unknown> }
    // A bare string here crashes the generator reading `.kind` off it, so the panel must not be able
    // to produce one.
    expect(node.props?.['variant']).toEqual({
      kind: 'expression', expression: { kind: 'literal', value: 'destructive' },
    })
  })

  it('produces a module the shipped schema accepts', () => {
    const result = setComponentProp(moduleWithButton(), 'cta', 'size', 'lg')
    expect(Value.Check(ReactIrModuleSchema, result.module)).toBe(true)
  })

  it('reaches the generated source, so the panel and the file agree', () => {
    const result = setComponentProp(moduleWithButton(), 'cta', 'variant', 'outline')
    const code = generateModule(result.module).code
    // The whole point: a choice made in a panel becomes a prop in the tenant's own file.
    expect(code).toContain('variant="outline"')
  })

  it('replaces an existing value rather than adding a second entry', () => {
    const first = setComponentProp(moduleWithButton(), 'cta', 'variant', 'ghost')
    const second = setComponentProp(first.module, 'cta', 'variant', 'secondary')
    const code = generateModule(second.module).code
    expect(code).toContain('variant="secondary"')
    expect(code).not.toContain('ghost')
    expect(code.split('variant=').length - 1).toBe(1)
  })

  it('accepts a number and a boolean, not only strings', () => {
    const withNumber = setComponentProp(moduleWithButton(), 'cta', 'tabIndex', 0)
    expect(withNumber.ok).toBe(true)
    const withBoolean = setComponentProp(withNumber.module, 'cta', 'asChild', true)
    expect(withBoolean.ok).toBe(true)
    expect(Value.Check(ReactIrModuleSchema, withBoolean.module)).toBe(true)
  })

  it('leaves the ORIGINAL module untouched, so undo is keeping the previous value', () => {
    const before = moduleWithButton()
    setComponentProp(before, 'cta', 'variant', 'link')
    // Every op returns a new module; mutating in place would make undo impossible and a refusal
    // half-applied.
    expect((before.nodes['cta'] as { props?: unknown }).props).toBeUndefined()
  })
})

describe('clearing a prop', () => {
  it('REMOVES it rather than writing an empty value', () => {
    const set = setComponentProp(moduleWithButton(), 'cta', 'variant', 'destructive')
    const cleared = setComponentProp(set.module, 'cta', 'variant', null)
    expect(cleared.ok).toBe(true)
    // Absent and empty mean different things: an absent variant falls back to the cva default, while
    // an empty string matches no variant and silently styles nothing.
    const code = generateModule(cleared.module).code
    expect(code).not.toContain('variant=')
  })

  it('drops the props field entirely once the last prop goes', () => {
    const set = setComponentProp(moduleWithButton(), 'cta', 'variant', 'ghost')
    const cleared = setComponentProp(set.module, 'cta', 'variant', null)
    // Two spellings of "no props" would make two otherwise identical modules compare as different.
    expect((cleared.module.nodes['cta'] as { props?: unknown }).props).toBeUndefined()
    expect(Value.Check(ReactIrModuleSchema, cleared.module)).toBe(true)
  })

  it('keeps the other props when one is cleared', () => {
    const a = setComponentProp(moduleWithButton(), 'cta', 'variant', 'ghost')
    const b = setComponentProp(a.module, 'cta', 'size', 'sm')
    const cleared = setComponentProp(b.module, 'cta', 'variant', null)
    const code = generateModule(cleared.module).code
    expect(code).toContain('size="sm"')
    expect(code).not.toContain('variant=')
  })
})

describe('refusals', () => {
  it('refuses an unknown node', () => {
    const result = setComponentProp(moduleWithButton(), 'nope', 'variant', 'ghost')
    expect(result.ok).toBe(false)
    expect(result.problems[0]?.code).toBe('unknown-node')
  })

  it('refuses a node that is not a component, naming its kind', () => {
    // An element's attributes and a component's props are different fields; writing to the wrong one
    // produces a node the generator emits differently than the panel showed.
    const result = setComponentProp(moduleWithButton(), 'text', 'variant', 'ghost')
    expect(result.ok).toBe(false)
    expect(result.problems[0]?.message).toContain('text')
  })

  it('refuses an empty prop name', () => {
    expect(setComponentProp(moduleWithButton(), 'cta', '   ', 'ghost').ok).toBe(false)
  })

  it('refuses a locked node', () => {
    const module = moduleWithButton()
    const locked = {
      ...module,
      nodes: { ...module.nodes, // The field is `locked`, not `isLocked` - isLocked() is the ACCESSOR.
      cta: { ...module.nodes['cta'], locked: true } },
    } as ReactIrModule
    const result = setComponentProp(locked, 'cta', 'variant', 'ghost')
    expect(result.ok).toBe(false)
    expect(result.problems[0]?.code).toBe('locked-node')
  })
})
