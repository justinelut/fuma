import { describe, it, expect } from 'bun:test'
import {
  collectModuleCandidates,
  collectWorkspaceCandidates,
} from '@core/react-ir/candidates'
import type { ReactIrModule, ReactIrNode } from '@core/react-ir/nodes'

const element = (id: string, classTokens: string[], children: string[] = []): ReactIrNode => ({
  kind: 'element', id, tag: 'div', classTokens, children,
} as unknown as ReactIrNode)

function moduleOf(nodes: Record<string, ReactIrNode>, path = 'app/page.tsx'): ReactIrModule {
  return {
    version: 1, id: path, path, symbol: 'Page', kind: 'page',
    rootNodeId: 'root', nodes,
  } as unknown as ReactIrModule
}

describe('collecting from one module', () => {
  it('gathers every class in the tree', () => {
    const result = collectModuleCandidates(moduleOf({
      root: element('root', ['grid', 'gap-4'], ['title']),
      title: element('title', ['text-5xl']),
    }))
    expect(result.candidates).toEqual(['gap-4', 'grid', 'text-5xl'])
  })

  it('deduplicates a class used twice', () => {
    const result = collectModuleCandidates(moduleOf({
      root: element('root', ['p-4'], ['a']),
      a: element('a', ['p-4']),
    }))
    expect(result.candidates).toEqual(['p-4'])
  })

  it('sorts so an unchanged tree yields an identical list', () => {
    // The canvas compares the list instead of diffing compiled CSS.
    const forward = collectModuleCandidates(moduleOf({
      root: element('root', ['z-10', 'absolute', 'grid']),
    }))
    expect([...forward.candidates]).toEqual([...forward.candidates].sort())
  })

  it('keeps variants and modifiers, which need compiling too', () => {
    const result = collectModuleCandidates(moduleOf({
      root: element('root', ['md:p-8', 'hover:underline', 'bg-primary/20']),
    }))
    expect(result.candidates).toEqual(['bg-primary/20', 'hover:underline', 'md:p-8'])
  })

  it('ignores a node that cannot carry classes', () => {
    const result = collectModuleCandidates(moduleOf({
      root: element('root', ['grid'], ['t']),
      t: { kind: 'text', id: 't', value: 'hi', children: [] } as unknown as ReactIrNode,
    }))
    expect(result.candidates).toEqual(['grid'])
  })

  it('finds nothing in an unstyled tree without failing', () => {
    expect(collectModuleCandidates(moduleOf({ root: element('root', []) })).candidates)
      .toEqual([])
  })
})

describe('reporting what cannot be compiled', () => {
  it('names the node carrying an unscannable token', () => {
    // So the message points at the element rather than the page.
    const result = collectModuleCandidates(moduleOf({
      root: element('root', ['grid'], ['bad']),
      bad: element('bad', ['bg-${color}']),
    }))
    expect(result.unscannable).toEqual([{ nodeId: 'bad', token: 'bg-${color}' }])
  })

  it('keeps the scannable classes alongside it', () => {
    // One bad token must not cost the page its other styling.
    const result = collectModuleCandidates(moduleOf({
      root: element('root', ['grid', 'bg-${color}']),
    }))
    expect(result.candidates).toEqual(['grid'])
  })

  it('reports nothing when every token is a literal', () => {
    expect(collectModuleCandidates(moduleOf({ root: element('root', ['grid']) })).unscannable)
      .toEqual([])
  })
})

describe('collecting across a workspace', () => {
  it('merges a page and the components it renders', () => {
    // Compiling per module would leave a nested component's class without CSS.
    const result = collectWorkspaceCandidates([
      moduleOf({ root: element('root', ['grid']) }, 'app/page.tsx'),
      moduleOf({ root: element('root', ['text-5xl']) }, 'components/Hero.tsx'),
    ])
    expect(result.candidates).toEqual(['grid', 'text-5xl'])
  })

  it('deduplicates across modules', () => {
    const result = collectWorkspaceCandidates([
      moduleOf({ root: element('root', ['p-4']) }, 'app/page.tsx'),
      moduleOf({ root: element('root', ['p-4']) }, 'components/Hero.tsx'),
    ])
    expect(result.candidates).toEqual(['p-4'])
  })

  it('handles an empty workspace', () => {
    expect(collectWorkspaceCandidates([]).candidates).toEqual([])
  })
})

describe('the collected list actually compiles', () => {
  it('produces CSS for every class the tree carries', async () => {
    // The point of collecting: hand the result straight to the compiler and get real CSS.
    const { compileCanvasCss, resetCanvasCssCache } =
      await import('../../../server/fuma/canvas/tailwindCompile')
    resetCanvasCssCache()

    const collected = collectWorkspaceCandidates([
      moduleOf({
        root: element('root', ['grid', 'gap-4', 'bg-primary'], ['title']),
        title: element('title', ['text-5xl', 'md:text-6xl']),
      }),
    ])
    const compiled = await compileCanvasCss(
      '@theme inline {\n  --color-primary: #3f6bff;\n}',
      collected.candidates,
    )

    expect(compiled.unknownCandidates).toEqual([])
    expect(compiled.css).toContain('.bg-primary')
    expect(compiled.css).toContain('.md\\:text-6xl')
  })
})
