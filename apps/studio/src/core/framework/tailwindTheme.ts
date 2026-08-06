/**
 * Core Framework → Tailwind v4 theme namespaces.
 *
 * Core Framework stays the source of truth for token *values*: it computes
 * colour families from one authored colour and fluid `clamp()` ramps from scale
 * ratios, neither of which Tailwind derives. What Tailwind needs is for those
 * values to appear under the namespaces its utility generator recognises —
 * `--color-*`, `--text-*`, `--spacing-*` — so `bg-primary`, `text-l` and `p-m`
 * exist without anyone hand-writing a config.
 *
 * This emits an `@theme inline` block that *aliases* rather than copies:
 *
 *   @theme inline {
 *     --color-primary: var(--primary);
 *   }
 *
 * `inline` matters. Tailwind substitutes the value straight into the utility, so
 * `.bg-primary` becomes `background-color: var(--primary)`. Custom property
 * substitution happens at the point of use, which means Core Framework's theme
 * inversion scopes keep working: overriding `--primary` inside a `.theme-alt`
 * subtree changes what `.bg-primary` paints there. Copying the resolved value
 * instead would freeze the light-mode colour into the utility and silently break
 * dark and inverted themes.
 *
 * Names are not fixed, which is why aliasing needs care. Colour variables are
 * `--<slug>` plus derived suffixes; scale variables come from a user-editable
 * naming convention (`getVariableName`), so a site may already emit `--text-l`
 * (Tailwind's own namespace, which must pass through untouched) or something
 * arbitrary (which must be aliased).
 */

import {
  generateFrameworkColorVariableSets,
  type FrameworkColorVariableSets,
} from './colors'
import { generateFrameworkTypographyVariables } from './typography'
import { generateFrameworkSpacingVariables } from './spacing'
import { resolveFrameworkPreferences } from './preferences'
import type { FrameworkScaleVariable } from './scaleModule'
import type { FrameworkGenerationSettings } from './generate'

/** Tailwind namespaces this generator targets. */
const COLOR_NAMESPACE = '--color-'
const TEXT_NAMESPACE = '--text-'
const SPACING_NAMESPACE = '--spacing-'

/**
 * Namespaces Tailwind already owns. A source variable sitting in one of these is
 * left alone: aliasing `--text-l` would produce `--text-text-l`, which generates
 * a `text-text-l` utility nobody asked for.
 */
const TAILWIND_OWNED = [
  COLOR_NAMESPACE,
  TEXT_NAMESPACE,
  SPACING_NAMESPACE,
  '--font-',
  '--breakpoint-',
  '--container-',
  '--radius-',
  '--shadow-',
  '--leading-',
  '--tracking-',
] as const

export type TailwindThemeAlias = Readonly<{
  /** Tailwind-namespaced custom property, e.g. `--color-primary`. */
  name: string
  /** The Core Framework variable it resolves through, e.g. `--primary`. */
  source: string
  /** Which namespace it landed in, for reporting. */
  namespace: 'color' | 'text' | 'spacing'
}>

export type TailwindThemeCollision = Readonly<{
  name: string
  /** Every source variable that wanted this Tailwind name. */
  sources: readonly string[]
}>

export type TailwindThemePlan = Readonly<{
  aliases: readonly TailwindThemeAlias[]
  /**
   * Two tokens whose names reduce to the same Tailwind name. Reported rather
   * than silently resolved, because picking a winner would make one token
   * quietly unstylable and the author would have no way to see why.
   */
  collisions: readonly TailwindThemeCollision[]
  /** Source variables already inside a Tailwind namespace, passed through. */
  passthrough: readonly string[]
}>

/** True when a variable already lives in a namespace Tailwind reads. */
function inTailwindNamespace(name: string): boolean {
  return TAILWIND_OWNED.some((prefix) => name.startsWith(prefix))
}

/**
 * Naming-convention prefixes that mean the same thing as a Tailwind namespace.
 *
 * Core Framework's default spacing convention is `space`, so its variables are
 * `--space-m`. Prefixing that with the namespace would produce
 * `--spacing-space-m` and a `p-space-m` utility, when the author plainly wants
 * `p-m`. A convention that means something else — `gutter`, say — is kept as a
 * qualifier, which is what distinguishes two spacing groups from each other.
 */
const NAMESPACE_SYNONYMS: Readonly<Record<'color' | 'text' | 'spacing', readonly string[]>> = {
  color: ['color', 'colour'],
  text: ['text', 'font-size', 'fontsize'],
  spacing: ['spacing', 'space'],
}

/**
 * Reduce a Core Framework variable name to the identifier part Tailwind should
 * see, stripping the leading dashes and normalising to a valid custom-property
 * identifier. Core Framework already sanitises names, so this is a guard against
 * anything reaching us from an older stored document.
 */
function identifierOf(variableName: string): string {
  return variableName
    .replace(/^-+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase()
}

/** Drop a leading segment that restates the namespace, leaving the step. */
function withoutRedundantPrefix(
  identifier: string,
  namespace: 'color' | 'text' | 'spacing',
): string {
  for (const synonym of NAMESPACE_SYNONYMS[namespace]) {
    if (identifier === synonym) continue
    if (identifier.startsWith(`${synonym}-`)) {
      return identifier.slice(synonym.length + 1)
    }
  }
  return identifier
}

function alias(
  namespace: 'color' | 'text' | 'spacing',
  prefix: string,
  sourceName: string,
): TailwindThemeAlias {
  const identifier = withoutRedundantPrefix(identifierOf(sourceName), namespace)
  return Object.freeze({
    name: `${prefix}${identifier}`,
    source: sourceName,
    namespace,
  })
}

/**
 * Plan the alias set for a site's framework settings.
 *
 * Only the light colour set is walked: dark values reuse the same variable names
 * under a scope selector, so aliasing them again would emit duplicates that
 * differ in nothing but which block they came from.
 */
export function planTailwindTheme(
  settings: FrameworkGenerationSettings | null | undefined,
): TailwindThemePlan {
  const preferences = resolveFrameworkPreferences(settings?.preferences)
  const colors: FrameworkColorVariableSets = generateFrameworkColorVariableSets(settings?.colors)
  const typography: FrameworkScaleVariable[] = generateFrameworkTypographyVariables(
    settings?.typography,
    preferences,
  )
  const spacing: FrameworkScaleVariable[] = generateFrameworkSpacingVariables(
    settings?.spacing,
    preferences,
  )

  const aliases: TailwindThemeAlias[] = []
  const passthrough: string[] = []
  const wanted = new Map<string, string[]>()

  const consider = (
    namespace: 'color' | 'text' | 'spacing',
    prefix: string,
    sourceName: string,
  ): void => {
    if (inTailwindNamespace(sourceName)) {
      passthrough.push(sourceName)
      return
    }
    const entry = alias(namespace, prefix, sourceName)
    const claimants = wanted.get(entry.name)
    if (claimants) {
      claimants.push(sourceName)
      return
    }
    wanted.set(entry.name, [sourceName])
    aliases.push(entry)
  }

  for (const variable of colors.light) consider('color', COLOR_NAMESPACE, variable.name)
  for (const variable of typography) consider('text', TEXT_NAMESPACE, variable.name)
  for (const variable of spacing) consider('spacing', SPACING_NAMESPACE, variable.name)

  const collisions: TailwindThemeCollision[] = []
  for (const [name, sources] of wanted) {
    if (sources.length > 1) {
      collisions.push(Object.freeze({ name, sources: Object.freeze([...sources]) }))
    }
  }

  return Object.freeze({
    aliases: Object.freeze(aliases),
    collisions: Object.freeze(collisions),
    passthrough: Object.freeze(passthrough),
  })
}

/**
 * Emit the `@theme inline` block for a site.
 *
 * Returns an empty string when a site has no tokens, so a caller can concatenate
 * it without guarding: an empty `@theme` block is valid CSS but misleading in a
 * bundle, since it suggests a theme was configured when none was.
 */
export function generateTailwindThemeCss(
  settings: FrameworkGenerationSettings | null | undefined,
): string {
  const plan = planTailwindTheme(settings)
  if (plan.aliases.length === 0) return ''

  const declarations = plan.aliases
    .map((entry) => `  ${entry.name}: var(${entry.source});`)
    .join('\n')

  return `@theme inline {\n${declarations}\n}`
}
