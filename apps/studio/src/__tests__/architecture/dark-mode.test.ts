/**
 * Dark mode for generated sites.
 *
 * Every check here is against a failure that is silent. A missing `@custom-variant` makes
 * every `dark:` utility compile to nothing; a token declared in one mode only paints an
 * unset custom property; a toggle that reads the theme before mount produces a hydration
 * error on every page load for a control that then works fine.
 *
 * The review is tested in BOTH directions, because a checker that never reports anything
 * passes just as quietly as the bugs it is supposed to catch.
 */

import { describe, it, expect } from 'bun:test'
import {
  THEME_MODES,
  reviewThemeSetup,
  themeToggleSource,
} from '@core/generatedSite/darkMode'
import { starterFiles } from '@core/generatedSite/starterTemplate'

const starter = starterFiles('Acme Studio')
const starterLayout = starter.find((file) => file.path === 'app/layout.tsx')?.content ?? ''
const starterCss = starter.find((file) => file.path === 'app/globals.css')?.content ?? ''

const cycle = themeToggleSource('cycle')
const select = themeToggleSource('select')

describe('the toggle survives hydration', () => {
  it('waits for mount before reading the theme', () => {
    // useTheme has no answer during server rendering: the theme comes from localStorage and
    // the system preference.
    expect(cycle).toContain('const [mounted, setMounted] = useState(false)')
    expect(cycle).toContain('useEffect(() => setMounted(true), [])')
  })

  it('renders a placeholder rather than an icon before mount', () => {
    expect(cycle).toContain('if (!mounted) {')
    expect(cycle).toMatch(/aria-hidden="true"/)
  })

  it('reserves the same space as the real control', () => {
    // A control that appears after hydration shifts the header and moves whatever the
    // visitor was about to click.
    expect(cycle).toContain('size-9')
  })

  it('explains why the guard is there', () => {
    // Otherwise a later tidy-up removes it and the hydration error returns.
    expect(cycle).toMatch(/hydration error on every page/)
  })

  it('applies the same guard to the select variant', () => {
    expect(select).toContain('const [mounted, setMounted] = useState(false)')
  })
})

describe('the toggle is a client component', () => {
  it('declares use client, or the hooks cannot run', () => {
    expect(cycle.startsWith("'use client'")).toBe(true)
    expect(select.startsWith("'use client'")).toBe(true)
  })

  it('imports useTheme from next-themes', () => {
    expect(cycle).toContain("import { useTheme } from 'next-themes'")
  })

  it('uses Lucide icons, the pinned set', () => {
    expect(cycle).toContain("from 'lucide-react'")
  })
})

describe('the toggle is usable', () => {
  it('cycles through all three modes', () => {
    expect(cycle).toContain("const MODES = ['light', 'dark', 'system'] as const")
    expect(THEME_MODES).toEqual(['light', 'dark', 'system'])
  })

  it('states the current mode and the action in its label', () => {
    // An icon alone does not say whether it shows the present state or what a click does.
    expect(cycle).toMatch(/Theme: \$\{current\}\. Switch to \$\{next\}\./)
  })

  it('offers system explicitly in the select', () => {
    // So a visitor can choose to follow their device rather than being stuck on whatever
    // they last picked.
    expect(select).toContain('<option value="system">System</option>')
  })

  it('carries a visible focus ring in both variants', () => {
    // A control reachable by keyboard with no visible focus is unusable without a mouse.
    expect(cycle).toContain('focus-visible:ring-2')
    expect(select).toContain('focus-visible:ring-2')
  })

  it('falls back to system when the theme is not yet known', () => {
    expect(cycle).toContain("theme ?? 'system'")
  })

  it('ends with a newline', () => {
    expect(cycle.endsWith('\n')).toBe(true)
  })
})

describe('reviewing the starter finds nothing wrong', () => {
  it('accepts the shipped starter', () => {
    expect(reviewThemeSetup(starterLayout, starterCss)).toEqual([])
  })
})

describe('the review catches each silent failure', () => {
  it('reports a layout with no provider', () => {
    // Nothing sets the theme class, so every dark: utility stays inert.
    const problems = reviewThemeSetup('export default function L() { return <html /> }', starterCss)
    expect(problems.map((problem) => problem.code)).toContain('missing-provider')
  })

  it('reports a missing suppressHydrationWarning', () => {
    const layout = starterLayout.replace(' suppressHydrationWarning', '')
    const problems = reviewThemeSetup(layout, starterCss)
    expect(problems.map((problem) => problem.code)).toContain('missing-suppress-hydration')
  })

  it('reports a stylesheet that never registers the dark variant', () => {
    // Tailwind then generates no CSS for any dark: utility, and nothing errors.
    const css = starterCss.replace('@custom-variant dark (&:is(.dark *));', '')
    const problems = reviewThemeSetup(starterLayout, css)
    expect(problems.map((problem) => problem.code)).toContain('missing-dark-variant')
  })

  it('reports a stylesheet with no dark block', () => {
    const problems = reviewThemeSetup(
      starterLayout,
      '@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root { --background: white; }',
    )
    expect(problems.map((problem) => problem.code)).toContain('missing-dark-block')
  })

  it('reports a token declared for light but not dark', () => {
    // A component using it renders an unset custom property, which paints nothing rather
    // than falling back.
    const css = `@import "tailwindcss";
@custom-variant dark (&:is(.dark *));
:root { --background: white; --brand: hotpink; }
.dark { --background: black; }
`
    const problems = reviewThemeSetup(starterLayout, css)
    const tokenProblem = problems.find((problem) => problem.code === 'token-only-in-one-mode')
    expect(tokenProblem?.message).toContain('--brand')
  })

  it('does not report an alias inside @theme inline as mode-dependent', () => {
    // An alias points at another token and is not itself mode-dependent, so demanding it in
    // both blocks would report a problem that is not one.
    expect(reviewThemeSetup(starterLayout, starterCss)
      .filter((problem) => problem.code === 'token-only-in-one-mode')).toEqual([])
  })

  it('does not report radius tokens, which are geometry not colour', () => {
    const css = `@import "tailwindcss";
@custom-variant dark (&:is(.dark *));
:root { --radius: 0.5rem; --background: white; }
.dark { --background: black; }
`
    expect(reviewThemeSetup(starterLayout, css)).toEqual([])
  })

  it('stops after reporting a missing dark block rather than listing every token', () => {
    // Every token would be reported as one-mode-only, which buries the actual problem.
    const problems = reviewThemeSetup(
      starterLayout,
      '@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root { --a: 1; --b: 2; --c: 3; }',
    )
    expect(problems.filter((problem) => problem.code === 'token-only-in-one-mode')).toEqual([])
  })
})

describe('determinism', () => {
  it('produces identical source each time', () => {
    expect(themeToggleSource('cycle')).toBe(cycle)
    expect(themeToggleSource('select')).toBe(select)
  })

  it('defaults to the cycle variant', () => {
    expect(themeToggleSource()).toBe(cycle)
  })
})
