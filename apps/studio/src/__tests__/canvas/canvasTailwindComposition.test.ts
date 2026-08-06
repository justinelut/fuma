import { describe, it, expect } from 'bun:test'
import {
  createCanvasClassCssMemo,
  generateCanvasClassCSS,
} from '@admin/pages/site/canvas/canvasClassCss'
import type { StyleRule } from '@core/page-tree'

const COMPILED_TAILWIND = '.bg-primary {\n  background-color: var(--primary);\n}'

function rule(name: string, styles: Record<string, unknown>): StyleRule {
  return {
    id: name,
    name,
    kind: 'class',
    selector: `.${name}`,
    styles,
    contextStyles: {},
    order: 0,
  } as unknown as StyleRule
}

describe('canvas Tailwind composition', () => {
  it('injects compiled Tailwind rather than a theme directive', () => {
    const css = generateCanvasClassCSS({}, [], [], null, null, null, null, null, {
      tailwindCss: COMPILED_TAILWIND,
    })
    expect(css).toContain('.bg-primary')
    // A raw @theme block would be silently ignored by the browser, leaving every
    // utility unstyled with nothing to explain why. The canvas takes compiler
    // output, so no directive should ever reach it.
    expect(css).not.toContain('@theme')
  })

  it('places utilities after the framework variables they read', () => {
    const css = generateCanvasClassCSS(
      {},
      [],
      [],
      {
        tokens: [{
          id: 't1',
          category: '',
          slug: 'primary',
          lightValue: '#3f6bff',
          darkValue: '',
          darkModeEnabled: false,
          generateUtilities: { text: true, background: true, border: true, fill: true },
          generateTransparent: false,
          generateShades: { enabled: false, count: 0 },
          generateTints: { enabled: false, count: 0 },
          order: 0,
          createdAt: 0,
          updatedAt: 0,
        }],
      },
      null,
      null,
      null,
      null,
      { tailwindCss: COMPILED_TAILWIND },
    )
    const framework = css.indexOf('--primary')
    const utilities = css.indexOf('.bg-primary')
    expect(framework).toBeGreaterThan(-1)
    expect(utilities).toBeGreaterThan(framework)
  })

  it('lets an explicit style rule still win over a utility during migration', () => {
    const css = generateCanvasClassCSS(
      { notice: rule('notice', { color: 'red' }) },
      [],
      [],
      null,
      null,
      null,
      null,
      null,
      { tailwindCss: COMPILED_TAILWIND },
    )
    const utilities = css.indexOf('.bg-primary')
    const registry = css.indexOf('.notice')
    expect(utilities).toBeGreaterThan(-1)
    expect(registry).toBeGreaterThan(utilities)
  })

  it('omits the block entirely when nothing was compiled', () => {
    const css = generateCanvasClassCSS({}, [])
    expect(css).not.toContain('.bg-primary')
  })

  it('recompiles when the compiled CSS changes and reuses it when it does not', () => {
    let calls = 0
    const memo = createCanvasClassCssMemo((...args) => {
      calls += 1
      return `css-${calls}-${args[8]?.tailwindCss ?? 'none'}`
    })
    const classes = {}
    const breakpoints: never[] = []

    const first = memo(classes, breakpoints, [], null, null, null, null, null, {
      tailwindCss: COMPILED_TAILWIND,
    })
    expect(calls).toBe(1)

    // Same inputs including the same compiled string: served from cache, so
    // frames 2..N of a multi-breakpoint canvas do not redo the work.
    const options = { tailwindCss: COMPILED_TAILWIND }
    memo(classes, breakpoints, [], null, null, null, null, null, options)
    memo(classes, breakpoints, [], null, null, null, null, null, options)
    const cachedCalls = calls

    // A recompile must invalidate, or the canvas would keep painting stale
    // utilities after someone edits a class token.
    const second = memo(classes, breakpoints, [], null, null, null, null, null, {
      tailwindCss: '.bg-accent { background-color: var(--accent); }',
    })
    expect(calls).toBeGreaterThan(cachedCalls)
    expect(second).not.toBe(first)
  })
})
