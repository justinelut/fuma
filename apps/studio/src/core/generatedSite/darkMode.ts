/**
 * Dark mode for generated sites.
 *
 * The provider and the token blocks already ship in the starter. What is easy to get wrong
 * is the toggle, for one specific reason: **`useTheme()` has no answer until the component
 * has mounted.** The theme is read from `localStorage` and the system preference, neither of
 * which exists during server rendering. A toggle that renders its icon from
 * `resolvedTheme` on the first pass therefore renders the wrong icon on the server, React
 * notices the markup differs, and the console fills with a hydration error on every page
 * load — for a control that then works fine, which is why the mistake survives review.
 *
 * So the generated toggle waits for mount and renders a stable placeholder until then. The
 * placeholder reserves the same space, because a control that appears after hydration
 * shifts the header and moves whatever the visitor was about to click.
 */

export type ThemeMode = 'light' | 'dark' | 'system'

/** The three modes, in the order a cycling toggle should visit them. */
export const THEME_MODES: readonly ThemeMode[] = Object.freeze(['light', 'dark', 'system'])

/**
 * The theme toggle component source.
 *
 * `variant` chooses between a button that cycles and a select that names each mode. A cycle
 * is fine in a header where space is tight; a select is better in settings, where a visitor
 * looking for "always dark" should not have to discover it by clicking twice.
 */
export function themeToggleSource(variant: 'cycle' | 'select' = 'cycle'): string {
  return variant === 'cycle' ? CYCLE_TOGGLE : SELECT_TOGGLE
}

const MOUNT_GUARD_COMMENT = `  // useTheme has no answer until this has mounted: the theme comes from localStorage and
  // the system preference, neither of which exists during server rendering. Rendering an
  // icon from resolvedTheme on the first pass produces a hydration error on every page
  // load, for a control that then works — which is exactly why the mistake survives review.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])`

const CYCLE_TOGGLE = `'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'

const MODES = ['light', 'dark', 'system'] as const

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
${MOUNT_GUARD_COMMENT}

  if (!mounted) {
    // Same size as the real control, so nothing shifts when it appears.
    return (
      <div
        aria-hidden="true"
        className="size-9 rounded-md border border-border"
      />
    )
  }

  const current = (theme ?? 'system') as (typeof MODES)[number]
  const next = MODES[(MODES.indexOf(current) + 1) % MODES.length] ?? 'system'
  const Icon = current === 'dark' ? Moon : current === 'light' ? Sun : Monitor

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      // The label states the CURRENT mode and what the click does, because an icon alone
      // does not say whether it shows the present state or the action.
      aria-label={\`Theme: \${current}. Switch to \${next}.\`}
      className="inline-flex size-9 items-center justify-center rounded-md border border-border text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  )
}
`

const SELECT_TOGGLE = `'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'

export function ThemeSelect() {
  const { theme, setTheme } = useTheme()
${MOUNT_GUARD_COMMENT}

  if (!mounted) {
    return <div aria-hidden="true" className="h-9 w-32 rounded-md border border-border" />
  }

  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground">
      <span>Theme</span>
      <select
        value={theme ?? 'system'}
        onChange={(event) => setTheme(event.target.value)}
        className="h-9 rounded-md border border-border bg-background px-2 text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {/* System is offered explicitly rather than implied, so a visitor can choose to
            follow their device instead of being stuck on whatever they last picked. */}
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </label>
  )
}
`

export type ThemeSetupProblem = Readonly<{
  code:
    | 'missing-provider'
    | 'missing-dark-variant'
    | 'missing-dark-block'
    | 'missing-suppress-hydration'
    | 'token-only-in-one-mode'
  message: string
}>

/**
 * Check a site's theme setup.
 *
 * Each of these fails quietly if wrong, which is why they are checked rather than trusted:
 * a missing `@custom-variant` makes every `dark:` utility compile to nothing, and a token
 * declared in only one block makes a component render an unset colour in the other.
 */
export function reviewThemeSetup(
  layoutSource: string,
  stylesheet: string,
): readonly ThemeSetupProblem[] {
  const problems: ThemeSetupProblem[] = []

  if (!/<ThemeProvider[\s>]/.test(layoutSource)) {
    problems.push(Object.freeze({
      code: 'missing-provider',
      message:
        'The layout does not render ThemeProvider, so nothing sets the theme class and every '
        + 'dark: utility stays inert.',
    }))
  }

  if (!/suppressHydrationWarning/.test(layoutSource)) {
    problems.push(Object.freeze({
      code: 'missing-suppress-hydration',
      message:
        'The html element needs suppressHydrationWarning. next-themes sets the class before '
        + 'React hydrates, so the markup differs by design and React reports it as an error '
        + 'on every page load.',
    }))
  }

  if (!/@custom-variant\s+dark/.test(stylesheet)) {
    problems.push(Object.freeze({
      code: 'missing-dark-variant',
      message:
        'The stylesheet does not register the dark variant, so Tailwind generates no CSS for '
        + 'any dark: utility. Nothing errors; the styles simply never appear.',
    }))
  }

  // Matched as a rule, not as a substring: `@custom-variant dark (&:is(.dark *))` contains
  // `.dark`, so indexOf would find the variant declaration and this check would never fire
  // on a real stylesheet.
  const darkMatch = /\.dark\s*\{/.exec(stylesheet)
  const darkIndex = darkMatch?.index ?? -1
  if (darkIndex === -1) {
    problems.push(Object.freeze({
      code: 'missing-dark-block',
      message: 'The stylesheet declares no .dark block, so dark mode has no values to use.',
    }))
    return Object.freeze(problems)
  }

  // A token present in one mode and absent from the other renders as an unset custom
  // property, which paints nothing rather than falling back.
  const rootBlock = stylesheet.slice(0, darkIndex)
  const darkBlock = stylesheet.slice(darkIndex)
  for (const token of tokensIn(rootBlock)) {
    if (!darkBlock.includes(`${token}:`)) {
      problems.push(Object.freeze({
        code: 'token-only-in-one-mode',
        message:
          `${token} is declared for light mode but not inside .dark, so a component using it `
          + 'renders an unset colour in dark mode.',
      }))
    }
  }

  return Object.freeze(problems)
}

/**
 * Semantic tokens declared in a block.
 *
 * Only tokens that carry a value are collected: an alias inside `@theme inline` points at
 * another token and is not itself mode-dependent, so requiring it in both blocks would
 * report a problem that is not one.
 */
function tokensIn(block: string): readonly string[] {
  const found = new Set<string>()
  const pattern = /(--[a-z0-9-]+)\s*:\s*(?!var\()/g
  let match = pattern.exec(block)
  while (match !== null) {
    const token = match[1]
    // --radius and its derivatives are geometry, not colour, and do not change with mode.
    if (token !== undefined && !token.startsWith('--radius')) found.add(token)
    match = pattern.exec(block)
  }
  return Object.freeze([...found])
}
