import { describe, it, expect } from 'bun:test'
import { checkPresence, checkPropagation, planStagger } from '@core/react-ir/propagation'
import type { ReactIrModule } from '@core/react-ir/nodes'

function tree(nodes: Record<string, unknown>): ReactIrModule {
  return {
    version: 1, id: 'm1', path: 'app/page.tsx', symbol: 'Page', kind: 'page',
    boundary: 'client', rootNodeId: 'root', nodes,
  } as unknown as ReactIrModule
}

const element = (id: string, children: string[] = [], animation?: unknown) => ({
  kind: 'element', id, tag: 'div', classTokens: [], children,
  ...(animation ? { animation } : {}),
})

describe('stagger orchestration', () => {
  it('reports a parent staggering children that declare no variants', () => {
    // The stagger has nothing to stagger. Motion logs nothing and the sequence
    // renders static.
    const module = tree({
      root: element('root', ['a', 'b'], {
        animate: 'visible',
        variants: { visible: { target: { opacity: 1 }, transition: { staggerChildren: 0.1 } } },
      }),
      a: element('a'),
      b: element('b'),
    })
    const codes = checkPropagation(module).map((issue) => issue.code)
    expect(codes).toContain('stagger-without-variant-children')
  })

  it('accepts a parent whose children declare matching variants', () => {
    const module = tree({
      root: element('root', ['a'], {
        animate: 'visible',
        variants: { visible: { target: { opacity: 1 }, transition: { staggerChildren: 0.1 } } },
      }),
      a: element('a', [], { variants: { visible: { target: { opacity: 1 } } } }),
    })
    expect(checkPropagation(module)).toEqual([])
  })

  it('reports a name mismatch between parent and children', () => {
    // The child declares `show`, the parent drives `visible`. The child never
    // animates and nothing says so.
    const module = tree({
      root: element('root', ['a'], {
        animate: 'visible',
        variants: { visible: { target: { opacity: 1 }, transition: { staggerChildren: 0.1 } } },
      }),
      a: element('a', [], { variants: { show: { target: { opacity: 1 } } } }),
    })
    const issue = checkPropagation(module).find((each) => each.code === 'variant-name-mismatch')
    expect(issue).toBeDefined()
    expect(issue?.message).toMatch(/"visible"/)
  })

  it('reaches a descendant at any depth, as Motion does', () => {
    const module = tree({
      root: element('root', ['wrap'], {
        animate: 'visible',
        variants: { visible: { target: { opacity: 1 }, transition: { staggerChildren: 0.1 } } },
      }),
      wrap: element('wrap', ['deep']),
      deep: element('deep', [], { variants: { visible: { target: { opacity: 1 } } } }),
    })
    expect(checkPropagation(module)).toEqual([])
  })
})

describe('undeclared variants', () => {
  it('reports a name referenced but not declared on the node', () => {
    const module = tree({
      root: element('root', [], {
        animate: 'visible',
        variants: { hidden: { target: { opacity: 0 } } },
      }),
    })
    const issue = checkPropagation(module).find((each) => each.code === 'undeclared-variant')
    expect(issue?.message).toMatch(/animates nothing/)
  })

  it('says none when the node declares no variants at all', () => {
    const module = tree({
      root: element('root', [], { animate: 'visible', variants: {} }),
    })
    const issue = checkPropagation(module).find((each) => each.code === 'undeclared-variant')
    expect(issue?.message).toMatch(/declares none/)
  })
})

describe('blocked propagation', () => {
  it('reports a child whose explicit target opts it out of the sequence', () => {
    // An explicit animate target overrides the inherited variant, which silently
    // removes the child from its parent's sequence.
    const module = tree({
      root: element('root', ['a'], {
        animate: 'visible',
        variants: { visible: { target: { opacity: 1 } } },
      }),
      a: element('a', [], { animate: { opacity: 1 } }),
    })
    const issue = checkPropagation(module).find((each) => each.code === 'propagation-blocked')
    expect(issue?.nodeId).toBe('a')
    expect(issue?.message).toMatch(/will not take part/)
  })

  it('does not complain when the child uses a variant name', () => {
    const module = tree({
      root: element('root', ['a'], {
        animate: 'visible',
        variants: { visible: { target: { opacity: 1 } } },
      }),
      a: element('a', [], { animate: 'visible', variants: { visible: { target: { opacity: 1 } } } }),
    })
    expect(checkPropagation(module).filter((each) => each.code === 'propagation-blocked'))
      .toEqual([])
  })
})

describe('presence', () => {
  it('flags a nested exit animation as needing AnimatePresence', () => {
    const module = tree({
      root: element('root', ['a']),
      a: element('a', [], { exit: { opacity: 0 } }),
    })
    expect(checkPresence(module).map((issue) => issue.nodeId)).toEqual(['a'])
  })

  it('stays quiet about the root, whose ancestor is outside this module', () => {
    // Reporting it would be a guess, and a warning that may be wrong trains people
    // to ignore warnings.
    const module = tree({ root: element('root', [], { exit: { opacity: 0 } }) })
    expect(checkPresence(module)).toEqual([])
  })
})

describe('stagger plan', () => {
  it('spaces participating children by the stagger interval', () => {
    const module = tree({
      root: element('root', ['a', 'b', 'c'], {
        animate: 'visible',
        variants: { visible: { target: { opacity: 1 }, transition: { staggerChildren: 0.1 } } },
      }),
      a: element('a', [], { variants: { visible: { target: { opacity: 1 } } } }),
      b: element('b', [], { variants: { visible: { target: { opacity: 1 } } } }),
      c: element('c', [], { variants: { visible: { target: { opacity: 1 } } } }),
    })
    expect(planStagger(module, 'root')).toEqual([
      { nodeId: 'a', delay: 0 },
      { nodeId: 'b', delay: 0.1 },
      { nodeId: 'c', delay: 0.2 },
    ])
  })

  it('adds the initial child delay', () => {
    const module = tree({
      root: element('root', ['a'], {
        variants: {
          visible: { target: { opacity: 1 }, transition: { staggerChildren: 0.1, delayChildren: 0.5 } },
        },
      }),
      a: element('a', [], { variants: { visible: { target: { opacity: 1 } } } }),
    })
    expect(planStagger(module, 'root')).toEqual([{ nodeId: 'a', delay: 0.5 }])
  })

  it('counts only children that take part', () => {
    // Numbering every child would show a timeline that does not match what runs.
    const module = tree({
      root: element('root', ['a', 'plain', 'b'], {
        variants: { visible: { target: { opacity: 1 }, transition: { staggerChildren: 0.1 } } },
      }),
      a: element('a', [], { variants: { visible: { target: { opacity: 1 } } } }),
      plain: element('plain'),
      b: element('b', [], { variants: { visible: { target: { opacity: 1 } } } }),
    })
    expect(planStagger(module, 'root')).toEqual([
      { nodeId: 'a', delay: 0 },
      { nodeId: 'b', delay: 0.1 },
    ])
  })

  it('returns nothing for a node that does not animate', () => {
    expect(planStagger(tree({ root: element('root') }), 'root')).toEqual([])
  })
})
