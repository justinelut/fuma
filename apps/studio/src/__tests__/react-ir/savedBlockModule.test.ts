/**
 * Persisting a saved block as a real component module — where a saved block finally LIVES.
 *
 * The module store's resource kinds are a closed union (page | layout | component) and a block is none
 * of them, so a saved block had nowhere to go. Emitting it as source rather than storing opaque JSON
 * follows task 85's reasoning about templates: source is what our reader AND a human can still open in
 * a year, whereas an IR snapshot is readable only by the version that wrote it.
 */
import { describe, expect, it } from 'bun:test'
import {
  savedBlockModule,
  savedBlockSource,
  symbolForBlock,
  pathForSavedBlock,
  SAVED_BLOCK_DIRECTORY,
} from '@core/react-ir/savedBlockModule'
import { readModuleSource } from '@core/react-ir/read'
import { resourceKindForPath } from '../../../server/fuma/editor/moduleStore'
import { Value } from '@sinclair/typebox/value'
import { ReactIrModuleSchema, type ReactIrNode } from '@core/react-ir/nodes'
import type { BlockDefinition } from '@core/react-ir/blockLibrary'

function block(overrides: Partial<BlockDefinition> = {}): BlockDefinition {
  const subtree: Record<string, ReactIrNode> = {
    section: { kind: 'element', id: 'section', tag: 'section', attributes: {}, children: ['title', 'cta'] },
    title: { kind: 'element', id: 'title', tag: 'h1', attributes: {}, children: ['t'] },
    t: { kind: 'text', id: 't', value: 'Our story', children: [] },
    cta: {
      kind: 'component',
      id: 'cta',
      component: { id: 'button', symbol: 'Button', source: '@/components/ui/button' },
      children: [],
    },
  } as Record<string, ReactIrNode>
  return {
    id: 'saved.hero',
    name: 'My hero',
    category: 'hero',
    description: 'Saved from the home page.',
    variantOf: null,
    subtree,
    rootId: 'section',
    ...overrides,
  } as BlockDefinition
}

describe('the symbol and path', () => {
  it('derives a PascalCase identifier from the name', () => {
    expect(symbolForBlock('My hero')).toBe('MyHero')
    expect(symbolForBlock('two-column split')).toBe('TwoColumnSplit')
  })

  it('prefixes a leading digit rather than dropping it', () => {
    // A leading digit is legal in a filename and NOT in an identifier; dropping it would silently
    // merge "2 Column" and "Column".
    expect(symbolForBlock('2 column')).toBe('Block2Column')
  })

  it('falls back rather than producing an empty identifier', () => {
    // A file whose symbol is '' fails the tenant's own build with an error about syntax rather than
    // about the block's name.
    expect(symbolForBlock('!!!')).toBe('SavedBlock')
  })

  it('puts saved blocks in one directory so a tenant can see what they saved', () => {
    expect(pathForSavedBlock('My hero')).toBe(`${SAVED_BLOCK_DIRECTORY}/MyHero.tsx`)
  })

  it('stores under the COMPONENT resource kind, so no schema change is needed', () => {
    // This is what made a component file the workable answer: the store already keys this path as a
    // component.
    expect(resourceKindForPath(pathForSavedBlock('My hero'))).toBe('component')
  })
})

describe('the module it builds', () => {
  it('validates against the shipped schema', () => {
    expect(Value.Check(ReactIrModuleSchema, savedBlockModule(block()))).toBe(true)
  })

  it('is a component module rooted at the block root', () => {
    const module = savedBlockModule(block())
    expect(module.kind).toBe('component')
    expect(module.rootNodeId).toBe('section')
  })

  it('declares NO props', () => {
    // Inventing props would mean guessing which parts the author meant to vary, and a wrong guess
    // produces controls that change nothing anybody wanted.
    expect(savedBlockModule(block()).propsInterface).toEqual([])
  })

  it('declares the SERVER boundary when nothing animates', () => {
    expect(savedBlockModule(block()).boundary).toBe('server')
  })

  it('declares the CLIENT boundary when something animates', () => {
    // The generator REFUSES to emit Motion from a server module, so a saved animated section would
    // throw at generate time with an error about the boundary rather than about the block.
    const animated = block({
      subtree: {
        ...block().subtree,
        title: {
          kind: 'element', id: 'title', tag: 'h1', attributes: {}, children: ['t'],
          animation: { initial: { opacity: 0 }, animate: { opacity: 1 } },
        },
      } as Record<string, ReactIrNode>,
    })
    expect(savedBlockModule(animated).boundary).toBe('client')
  })
})

describe('the source it generates', () => {
  it('emits a named component the tenant can import', () => {
    const result = savedBlockSource(block())
    expect(result.ok, result.ok ? '' : result.reason).toBe(true)
    if (!result.ok) return
    expect(result.file.source).toContain('MyHero')
    expect(result.file.path).toBe('components/blocks/MyHero.tsx')
  })

  it('keeps the component the section composed, so the block is not flattened', () => {
    const result = savedBlockSource(block())
    if (!result.ok) throw new Error(result.reason)
    // The shadcn Button the author used must survive into their own component.
    expect(result.file.source).toContain('Button')
    expect(result.file.source).toContain('@/components/ui/button')
  })

  it('OUR OWN READER opens the generated component with no diagnostics', () => {
    const result = savedBlockSource(block())
    if (!result.ok) throw new Error(result.reason)
    // If it could not be reopened, an author would save a block and then find the builder unable to
    // edit it — the same "empty canvas" failure task 85 gates templates against.
    // readModuleSource takes (path, source) — PATH FIRST.
    const read = readModuleSource(result.file.path, result.file.source)
    expect(read.diagnostics.map((d) => d.code)).toEqual([])
  })

  it('reports a refusal rather than throwing at the caller', () => {
    // The caller is a button an author pressed; an exception crossing that boundary reads as the
    // product breaking rather than as this section not being saveable.
    const broken = block({ rootId: 'not-in-subtree' })
    const result = savedBlockSource(broken)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(5)
  })
})
