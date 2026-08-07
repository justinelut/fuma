import { describe, it, expect } from 'bun:test'
import { analyseBoundaries, requiredBoundary } from '@core/react-ir/boundary'
import type { ReactIrModule } from '@core/react-ir/nodes'

type NodeSpec = Record<string, unknown>

function moduleOf(
  path: string,
  nodes: Record<string, NodeSpec>,
  rootNodeId = 'root',
  boundary?: 'server' | 'client',
): ReactIrModule {
  return {
    version: 1,
    id: path,
    path,
    symbol: 'Component',
    kind: 'component',
    rootNodeId,
    ...(boundary ? { boundary } : {}),
    nodes,
  } as unknown as ReactIrModule
}

const plainRoot = { kind: 'element', id: 'root', tag: 'div', classTokens: [], children: [] }

describe('direct boundary causes', () => {
  it('marks a module with an animated node as client', () => {
    const module = moduleOf('./Hero.tsx', {
      root: { ...plainRoot, animation: { animate: { opacity: 1 } } },
    })
    expect(requiredBoundary(module)).toBe('client')
  })

  it('leaves a module with no animation on the server', () => {
    expect(requiredBoundary(moduleOf('./Static.tsx', { root: plainRoot }))).toBe('server')
  })

  it('does not clientize for a transition that animates nothing', () => {
    const module = moduleOf('./Static.tsx', {
      root: { ...plainRoot, animation: { transition: { duration: 0.2 } } },
    })
    expect(requiredBoundary(module)).toBe('server')
  })

  it('respects an opaque region that declares the directive', () => {
    // The directive is invisible once the region is opaque, so a boundary nobody can
    // see would otherwise go unaccounted for.
    const module = moduleOf('./Wrapper.tsx', {
      root: {
        kind: 'opaque', id: 'root', symbol: 'Legacy', source: './legacy',
        sourceHash: 'a'.repeat(64), clientOnly: true, children: [],
      },
    })
    expect(requiredBoundary(module)).toBe('client')
  })

  it('reports the node that caused it', () => {
    const analysis = analyseBoundaries([
      moduleOf('./Hero.tsx', { root: { ...plainRoot, animation: { animate: { opacity: 1 } } } }),
    ])
    expect(analysis.boundaries[0]?.reasons).toEqual([{ kind: 'animation', nodeId: 'root' }])
  })
})

describe('propagation through imports', () => {
  it('clientizes a module that imports a client module', () => {
    // This is the rule that makes one animated button expensive: the importer
    // becomes client code, and so does everything it imports.
    const analysis = analyseBoundaries([
      moduleOf('./page.tsx', {
        root: {
          kind: 'component', id: 'root', component: { id: 'x', symbol: 'Hero', source: './Hero' },
          props: {}, slots: {}, classTokens: [], children: [],
        },
      }),
      moduleOf('./Hero.tsx', { root: { ...plainRoot, animation: { animate: { opacity: 1 } } } }),
    ])
    const page = analysis.boundaries.find((boundary) => boundary.path === './page.tsx')
    expect(page?.client).toBe(true)
    expect(page?.reasons).toEqual([{ kind: 'imports-client', modulePath: './Hero.tsx' }])
  })

  it('propagates through a chain', () => {
    const analysis = analyseBoundaries([
      moduleOf('./a.tsx', {
        root: {
          kind: 'component', id: 'root', component: { id: 'x', symbol: 'B', source: './b' },
          props: {}, slots: {}, classTokens: [], children: [],
        },
      }),
      moduleOf('./b.tsx', {
        root: {
          kind: 'component', id: 'root', component: { id: 'y', symbol: 'C', source: './c' },
          props: {}, slots: {}, classTokens: [], children: [],
        },
      }),
      moduleOf('./c.tsx', { root: { ...plainRoot, animation: { animate: { opacity: 1 } } } }),
    ])
    for (const path of ['./a.tsx', './b.tsx', './c.tsx']) {
      expect(analysis.boundaries.find((boundary) => boundary.path === path)?.client).toBe(true)
    }
  })

  it('leaves a server module importing only server modules alone', () => {
    const analysis = analyseBoundaries([
      moduleOf('./page.tsx', {
        root: {
          kind: 'component', id: 'root', component: { id: 'x', symbol: 'Card', source: './Card' },
          props: {}, slots: {}, classTokens: [], children: [],
        },
      }),
      moduleOf('./Card.tsx', { root: plainRoot }),
    ])
    expect(analysis.boundaries.every((boundary) => !boundary.client)).toBe(true)
  })

  it('terminates on a cycle', () => {
    // A component graph can contain a cycle, and a fixed-point loop must not spin.
    const analysis = analyseBoundaries([
      moduleOf('./a.tsx', {
        root: {
          kind: 'component', id: 'root', component: { id: 'x', symbol: 'B', source: './b' },
          props: {}, slots: {}, classTokens: [], children: [],
        },
      }),
      moduleOf('./b.tsx', {
        root: {
          kind: 'component', id: 'root', component: { id: 'y', symbol: 'A', source: './a' },
          props: {}, slots: {}, classTokens: [], children: [],
        },
      }),
    ])
    expect(analysis.boundaries).toHaveLength(2)
  })

  it('ignores a package import, which decides its own boundary', () => {
    const analysis = analyseBoundaries([
      moduleOf('./page.tsx', {
        root: {
          kind: 'component', id: 'root',
          component: { id: 'x', symbol: 'Button', source: '@/ui/button' },
          props: {}, slots: {}, classTokens: [], children: [],
        },
      }),
    ])
    expect(analysis.boundaries[0]?.client).toBe(false)
  })
})

describe('cost of a boundary', () => {
  it('counts the modules a boundary pulls to the client', () => {
    const analysis = analyseBoundaries([
      moduleOf('./page.tsx', {
        root: {
          kind: 'component', id: 'root', component: { id: 'x', symbol: 'Hero', source: './Hero' },
          props: {}, slots: {}, classTokens: [], children: ['c1'],
        },
        c1: {
          kind: 'component', id: 'c1', component: { id: 'y', symbol: 'Card', source: './Card' },
          props: {}, slots: {}, classTokens: [], children: [],
        },
      }),
      moduleOf('./Hero.tsx', { root: { ...plainRoot, animation: { animate: { opacity: 1 } } } }),
      moduleOf('./Card.tsx', { root: plainRoot }),
    ])
    const cost = analysis.costs.find((entry) => entry.path === './page.tsx')
    // Card is server-only on its own but follows the page across the boundary.
    expect(cost?.pulledIn).toEqual(['./Card.tsx', './Hero.tsx'])
  })
})

describe('avoidable boundaries', () => {
  it('flags a route clientized by animation alone and says what to do', () => {
    const analysis = analyseBoundaries([
      moduleOf('./page.tsx', {
        root: { ...plainRoot, animation: { animate: { opacity: 1 } }, children: ['c1'] },
        c1: {
          kind: 'component', id: 'c1', component: { id: 'y', symbol: 'Card', source: './Card' },
          props: {}, slots: {}, classTokens: [], children: [],
        },
      }),
      moduleOf('./Card.tsx', { root: plainRoot }),
    ], { routePaths: ['./page.tsx'] })

    expect(analysis.avoidable).toHaveLength(1)
    expect(analysis.avoidable[0]?.nodeIds).toEqual(['root'])
    expect(analysis.avoidable[0]?.pulledInCount).toBe(1)
    expect(analysis.avoidable[0]?.advice).toMatch(/Extract them into their own client component/)
  })

  it('does not call it avoidable when the module also imports a client module', () => {
    // Extracting the animation would not move the boundary, so the advice would be
    // wrong and following it would waste the author's time.
    const analysis = analyseBoundaries([
      moduleOf('./page.tsx', {
        root: { ...plainRoot, animation: { animate: { opacity: 1 } }, children: ['c1'] },
        c1: {
          kind: 'component', id: 'c1', component: { id: 'y', symbol: 'Widget', source: './Widget' },
          props: {}, slots: {}, classTokens: [], children: [],
        },
      }),
      moduleOf('./Widget.tsx', { root: { ...plainRoot, animation: { animate: { scale: 1 } } } }),
    ], { routePaths: ['./page.tsx'] })

    expect(analysis.avoidable).toHaveLength(0)
  })

  it('still flags it when the module declares the directive', () => {
    // Real source always carries 'use client' when it contains Motion — it has to,
    // or the animation will not run. Counting the declaration as its own independent
    // cause would make this check fire never.
    const analysis = analyseBoundaries([
      moduleOf('./page.tsx', {
        root: { ...plainRoot, animation: { animate: { opacity: 1 } } },
      }, 'root', 'client'),
    ], { routePaths: ['./page.tsx'] })
    expect(analysis.avoidable).toHaveLength(1)
  })

  it('does not flag a leaf component, where a boundary is the right answer', () => {
    // A small animated leaf is exactly where the boundary belongs.
    const analysis = analyseBoundaries([
      moduleOf('./Hero.tsx', { root: { ...plainRoot, animation: { animate: { opacity: 1 } } } }),
    ], { routePaths: ['./page.tsx'] })
    expect(analysis.avoidable).toHaveLength(0)
  })
})
