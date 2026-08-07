/**
 * The canvas Tailwind compiler, tested against the real Tailwind compiler.
 *
 * Mocking it would defeat the point: the reason to compile rather than approximate is
 * that only Tailwind knows what a class means, so a test that stubs Tailwind proves
 * nothing about whether the canvas matches production.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import {
  canvasThemeCss,
  compileCanvasCss,
  escapeSelector,
  resetCanvasCssCache,
} from '../../../server/fuma/canvas/tailwindCompile'

const theme = `@theme inline {
  --color-primary: #3f6bff;
  --color-never-used: #abcdef;
  --spacing-gutter-m: 1.5rem;
}`

beforeEach(() => {
  resetCanvasCssCache()
})

describe('preparing the theme for the canvas', () => {
  it('adds static so unused tokens survive', () => {
    // Escape-hatch CSS may reference a token no utility uses; without static it resolves
    // to nothing and the element renders wrong with no explanation.
    expect(canvasThemeCss(theme)).toContain('@theme static inline {')
  })

  it('keeps inline, because that is what makes aliasing work', () => {
    // static and inline are orthogonal: inline decides value-vs-var, static decides
    // emission. The canvas needs both.
    expect(canvasThemeCss(theme)).toContain('inline')
  })

  it('leaves a theme that is already static alone', () => {
    const already = '@theme static {\n  --color-primary: #000;\n}'
    expect(canvasThemeCss(already)).toBe(already)
  })

  it('handles a bare @theme block', () => {
    expect(canvasThemeCss('@theme {\n  --color-primary: #000;\n}'))
      .toContain('@theme static {')
  })
})

describe('escaping selectors', () => {
  it('escapes a variant colon', () => {
    expect(escapeSelector('md:p-8')).toBe('md\\:p-8')
  })

  it('escapes an opacity slash', () => {
    expect(escapeSelector('bg-primary/20')).toBe('bg-primary\\/20')
  })

  it('escapes theme-function parentheses', () => {
    expect(escapeSelector('p-(--spacing-gutter-m)')).toBe('p-\\(--spacing-gutter-m\\)')
  })

  it('leaves a plain class untouched', () => {
    expect(escapeSelector('grid')).toBe('grid')
  })
})

describe('compiling utilities', () => {
  it('emits a rule for a plain utility', async () => {
    const result = await compileCanvasCss(theme, ['p-4'])
    expect(result.css).toContain('.p-4')
  })

  it('resolves a theme colour', async () => {
    const result = await compileCanvasCss(theme, ['bg-primary'])
    expect(result.css).toContain('.bg-primary')
    expect(result.css).toContain('--color-primary')
  })

  it('emits a responsive variant inside a media query', async () => {
    const result = await compileCanvasCss(theme, ['md:p-8'])
    expect(result.css).toContain('.md\\:p-8')
    expect(result.css).toContain('@media')
  })

  it('emits a state variant', async () => {
    const result = await compileCanvasCss(theme, ['hover:underline'])
    expect(result.css).toContain('.hover\\:underline')
  })

  it('emits an opacity modifier', async () => {
    const result = await compileCanvasCss(theme, ['bg-primary/20'])
    expect(result.css).toContain('.bg-primary\\/20')
  })

  it('resolves a custom spacing token through the theme function', async () => {
    const result = await compileCanvasCss(theme, ['p-(--spacing-gutter-m)'])
    expect(result.css).toContain('--spacing-gutter-m')
  })

  it('retains a token no utility used', async () => {
    // The whole reason for static: escape-hatch CSS references it directly.
    const result = await compileCanvasCss(theme, ['p-4'])
    expect(result.css).toContain('--color-never-used')
  })
})

describe('reporting what compiled to nothing', () => {
  it('names a candidate that produced no CSS', async () => {
    // Tailwind emits nothing and says nothing for an unknown class, so the element
    // renders unstyled with no clue why.
    const result = await compileCanvasCss(theme, ['notaclass-xyz'])
    expect(result.unknownCandidates).toEqual(['notaclass-xyz'])
  })

  it('reports nothing unknown when every class is real', async () => {
    const result = await compileCanvasCss(theme, ['p-4', 'grid', 'gap-4', 'text-5xl'])
    expect(result.unknownCandidates).toEqual([])
  })

  it('does not mistake an escaped variant for a missing class', async () => {
    // Searching for the unescaped form reports every variant and modifier as missing.
    const result = await compileCanvasCss(theme, ['md:p-8', 'bg-primary/20', 'hover:underline'])
    expect(result.unknownCandidates).toEqual([])
  })

  it('separates the real classes from the typo in one pass', async () => {
    const result = await compileCanvasCss(theme, ['p-4', 'paddin-4', 'grid'])
    expect(result.unknownCandidates).toEqual(['paddin-4'])
  })
})

describe('caching', () => {
  it('reports the first compile as uncached', async () => {
    const result = await compileCanvasCss(theme, ['p-4'])
    expect(result.cached).toBe(false)
  })

  it('reuses the compiler for the same theme', async () => {
    // Rebuilding re-parses Tailwind's whole stylesheet on every keystroke.
    await compileCanvasCss(theme, ['p-4'])
    const second = await compileCanvasCss(theme, ['grid'])
    expect(second.cached).toBe(true)
  })

  it('builds a fresh compiler for a different theme', async () => {
    await compileCanvasCss(theme, ['p-4'])
    const other = await compileCanvasCss('@theme inline {\n  --color-primary: #ff0000;\n}', ['bg-primary'])
    expect(other.cached).toBe(false)
  })

  it('serves changed candidates from a reused compiler', async () => {
    await compileCanvasCss(theme, ['p-4'])
    const second = await compileCanvasCss(theme, ['text-5xl'])
    expect(second.css).toContain('.text-5xl')
  })

  it('produces identical CSS regardless of candidate order', async () => {
    // So the canvas can compare cheaply instead of diffing rules.
    const forward = await compileCanvasCss(theme, ['p-4', 'grid', 'gap-4'])
    const backward = await compileCanvasCss(theme, ['gap-4', 'grid', 'p-4'])
    expect(backward.css).toBe(forward.css)
  })

  it('is unaffected by duplicates', async () => {
    const once = await compileCanvasCss(theme, ['p-4'])
    const twice = await compileCanvasCss(theme, ['p-4', 'p-4'])
    expect(twice.css).toBe(once.css)
  })

  it('drops cached compilers on reset', async () => {
    await compileCanvasCss(theme, ['p-4'])
    resetCanvasCssCache()
    expect((await compileCanvasCss(theme, ['p-4'])).cached).toBe(false)
  })
})
