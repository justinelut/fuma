import { describe, it, expect } from 'bun:test'
import { generateModule } from '@core/react-ir/generate'
import type { ReactIrModule } from '@core/react-ir/nodes'

function build(overrides: Record<string, unknown>, nodes: Record<string, unknown>): ReactIrModule {
  return {
    version: 1, id: 'm1', path: 'app/page.tsx', symbol: 'Page', kind: 'page',
    boundary: 'client', rootNodeId: 'root',
    ...overrides,
    nodes,
  } as unknown as ReactIrModule
}

const element = (id: string, children: string[] = [], extra: Record<string, unknown> = {}) => ({
  kind: 'element', id, tag: 'div', classTokens: [], children, ...extra,
})

describe('MotionConfig', () => {
  it('wraps the tree and defaults to respecting the OS preference', () => {
    // Defaulted rather than omitted: making one setting reach every animation is the
    // whole point of having it at module level.
    const { code } = generateModule(build(
      { motionConfig: {} },
      { root: element('root') },
    ))
    expect(code).toContain('<MotionConfig reducedMotion="user">')
    expect(code).toContain('</MotionConfig>')
    expect(code).toContain("import { MotionConfig } from 'motion/react'")
  })

  it('carries an explicit policy and a default transition', () => {
    const { code } = generateModule(build(
      { motionConfig: { reducedMotion: 'always', transition: { duration: 0.2 } } },
      { root: element('root') },
    ))
    expect(code).toContain('reducedMotion="always"')
    expect(code).toContain('transition={{"duration":0.2}}')
  })

  it('emits a nonce for a strict CSP', () => {
    const { code } = generateModule(build(
      { motionConfig: { nonce: 'abc123' } },
      { root: element('root') },
    ))
    expect(code).toContain('nonce="abc123"')
  })

  it('is absent when not configured', () => {
    const { code } = generateModule(build({}, { root: element('root') }))
    expect(code).not.toContain('MotionConfig')
  })
})

describe('AnimatePresence', () => {
  it('wraps the children of the node that declares presence', () => {
    // Declared on the parent because React unmounts an exiting child immediately
    // unless something that outlives it keeps it mounted.
    const { code } = generateModule(build({}, {
      root: element('root', ['a'], { presence: {} }),
      a: element('a'),
    }))
    expect(code).toContain('<AnimatePresence>')
    expect(code).toContain('</AnimatePresence>')
    expect(code).toContain("import { AnimatePresence } from 'motion/react'")
  })

  it('emits the mode when one is chosen', () => {
    // `wait` holds the new element until the old has gone; `popLayout` takes the
    // exiting one out of layout flow so siblings do not jump.
    for (const mode of ['wait', 'popLayout', 'sync']) {
      const { code } = generateModule(build({}, {
        root: element('root', ['a'], { presence: { mode } }),
        a: element('a'),
      }))
      expect(code).toContain(`<AnimatePresence mode="${mode}">`)
    }
  })

  it('skips the enter animation when initial is false', () => {
    const { code } = generateModule(build({}, {
      root: element('root', ['a'], { presence: { initial: false } }),
      a: element('a'),
    }))
    expect(code).toContain('initial={false}')
  })

  it('places the child inside the presence region, not beside it', () => {
    const { code } = generateModule(build({}, {
      root: element('root', ['a'], { presence: {} }),
      a: element('a', [], { animation: { exit: { opacity: 0 } } }),
    }))
    const presenceOpen = code.indexOf('<AnimatePresence>')
    const child = code.indexOf('<motion.div')
    const presenceClose = code.indexOf('</AnimatePresence>')
    expect(presenceOpen).toBeGreaterThan(-1)
    expect(child).toBeGreaterThan(presenceOpen)
    expect(child).toBeLessThan(presenceClose)
  })
})

describe('Reorder', () => {
  it('emits a Reorder.Item carrying its value and rendering the original tag', () => {
    const { code } = generateModule(build({}, {
      root: element('root', ['item']),
      item: {
        kind: 'element', id: 'item', tag: 'li', classTokens: [], children: [],
        reorderValue: {
          kind: 'member', scope: 'item', path: ['id'], format: 'text',
        },
      },
    }))
    expect(code).toContain('<Reorder.Item')
    expect(code).toContain('as="li"')
    expect(code).toContain("import { Reorder } from 'motion/react'")
  })

  it('does not also wrap it as a motion tag', () => {
    // Reorder.Item is a motion component already; using both would nest two.
    const { code } = generateModule(build({}, {
      root: element('root', ['item']),
      item: {
        kind: 'element', id: 'item', tag: 'li', classTokens: [], children: [],
        animation: { whileDrag: { target: { scale: 1.02 } } },
        reorderValue: { kind: 'member', scope: 'item', path: ['id'], format: 'text' },
      },
    }))
    expect(code).not.toContain('motion.li')
    expect(code).toContain('Reorder.Item')
  })
})

describe('determinism with the new primitives', () => {
  it('generates identical output twice', () => {
    const module = build(
      { motionConfig: { reducedMotion: 'user' } },
      {
        root: element('root', ['a'], { presence: { mode: 'wait' } }),
        a: element('a', [], { animation: { exit: { opacity: 0 } } }),
      },
    )
    expect(generateModule(module).code).toBe(generateModule(module).code)
  })
})

describe('reorder groups', () => {
  const listModule = (propsInterface: unknown[]) => build(
    { symbol: 'List', kind: 'component', propsInterface },
    {
      root: {
        kind: 'repeat', id: 'root', source: { id: 'items' }, key: 'id',
        reorder: { axis: 'y', as: 'ul' }, variants: ['row'], children: [],
      },
      row: {
        kind: 'element', id: 'row', tag: 'li', classTokens: [], children: [],
        reorderValue: { kind: 'member', scope: 'item', path: ['id'], format: 'text' },
      },
    },
  )

  it('emits a group owning the values and the handler', () => {
    const { code } = generateModule(listModule([
      { name: 'items', type: 'collection' },
      { name: 'onReorder', type: 'handler' },
    ]))
    expect(code).toContain('<Reorder.Group axis="y" as="ul"')
    expect(code).toContain('onReorder={props.onReorder}')
    expect(code).toContain('</Reorder.Group>')
  })

  it('copies the values because Motion mutates the order it is given', () => {
    const { code } = generateModule(listModule([
      { name: 'items', type: 'collection' },
      { name: 'onReorder', type: 'handler' },
    ]))
    expect(code).toContain('values={[...(props.items ?? [])]}')
  })

  it('makes a handler prop required, not optional', () => {
    // Optional would only move the failure to runtime: Reorder.Group cannot work
    // without a handler.
    const { code } = generateModule(listModule([
      { name: 'items', type: 'collection' },
      { name: 'onReorder', type: 'handler' },
    ]))
    expect(code).toContain('onReorder: (next: Record<string, unknown>[]) => void')
  })

  it('refuses to emit a group with no handler declared', () => {
    // Emitting a file that references an undefined name would fail at build time
    // with a far less useful message.
    expect(() => generateModule(listModule([{ name: 'items', type: 'collection' }])))
      .toThrow(/onReorder/)
  })
})

describe('root nodes that emit an expression container', () => {
  it('wraps a repeat root in a fragment so the return is valid JSX', () => {
    // `return ( {items.map(...)} )` is a syntax error: an expression container is
    // only valid inside JSX. Without the fragment the generated file will not parse.
    const { code } = generateModule(build(
      { symbol: 'List', kind: 'component', propsInterface: [{ name: 'items', type: 'collection' }] },
      {
        root: {
          kind: 'repeat', id: 'root', source: { id: 'items' }, key: 'id',
          variants: ['row'], children: [],
        },
        row: element('row'),
      },
    ))
    expect(code).toContain('return (\n    <>')
    expect(code).toContain('</>')
  })

  it('guards an optional collection so mapping it cannot throw', () => {
    const { code } = generateModule(build(
      { symbol: 'List', kind: 'component', propsInterface: [{ name: 'items', type: 'collection' }] },
      {
        root: {
          kind: 'repeat', id: 'root', source: { id: 'items' }, key: 'id',
          variants: ['row'], children: [],
        },
        row: element('row'),
      },
    ))
    expect(code).toContain('(props.items ?? []).map')
  })

  it('does not wrap an element root, which needs no fragment', () => {
    const { code } = generateModule(build({}, { root: element('root') }))
    expect(code).not.toContain('<>')
  })
})
