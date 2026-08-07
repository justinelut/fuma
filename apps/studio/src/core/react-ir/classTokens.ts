/**
 * Tailwind class tokens as the node styling model.
 *
 * Storing styles as an ordered token list only works if the tokens can actually be
 * read and written, and Tailwind's grammar defeats the obvious approach.
 * `split(/\s+/)` is wrong because arbitrary values may contain spaces —
 * `bg-[url('a b.png')]` is one token, not two. Splitting variants on `:` is wrong
 * for the same reason: `supports-[display:grid]:grid` has a colon that belongs to
 * the value, not the variant separator.
 *
 * So both operations are bracket- and quote-aware. Everything else in the styling
 * model depends on this being exact: the properties panel edits one token, the
 * reader recovers tokens from `className`, and Tailwind's scanner needs to see
 * complete class names.
 *
 * What a token can carry:
 *
 *   variants        `md:`, `hover:`, `dark:`, `group-hover:`, `max-md:`
 *   arbitrary variant `data-[state=open]:`, `supports-[display:grid]:`, `[&>*]:`
 *   utility         `bg-primary`, `grid-cols-3`
 *   arbitrary value `top-[117px]`, `grid-cols-[1fr_500px]`
 *   arbitrary prop  `[mask-type:luminance]`
 *   modifier        `bg-primary/20`, `text-base/7`
 *   important       `bg-red-500!` (Tailwind v4 places it last)
 */

export type ClassToken = Readonly<{
  /** Ordered variant prefixes, without their trailing colons. */
  variants: readonly string[]
  /** The utility itself, including any arbitrary value or property. */
  base: string
  /** Slash modifier: opacity, or line-height on a text utility. */
  modifier?: string
  /** Whether the token carries the important marker. */
  important: boolean
}>

/**
 * Split a class attribute into tokens.
 *
 * Whitespace separates tokens only outside brackets and quotes, because an
 * arbitrary value may legitimately contain a space.
 */
export function splitClassString(input: string): readonly string[] {
  const tokens: string[] = []
  let current = ''
  let bracketDepth = 0
  let parenDepth = 0
  let quote: string | null = null

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index] ?? ''

    // A backslash escapes the next character wherever it appears — Tailwind uses
    // this for escaped underscores and dots inside arbitrary values.
    if (character === '\\') {
      current += character + (input[index + 1] ?? '')
      index += 1
      continue
    }

    if (quote) {
      current += character
      if (character === quote) quote = null
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      current += character
      continue
    }

    if (character === '[') bracketDepth += 1
    if (character === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    if (character === '(') parenDepth += 1
    if (character === ')') parenDepth = Math.max(0, parenDepth - 1)

    if (/\s/.test(character) && bracketDepth === 0 && parenDepth === 0) {
      if (current.length > 0) tokens.push(current)
      current = ''
      continue
    }

    current += character
  }

  if (current.length > 0) tokens.push(current)
  return tokens
}

/** Indices of top-level colons — the variant separators. */
function variantSeparators(token: string): readonly number[] {
  const positions: number[] = []
  let bracketDepth = 0
  let parenDepth = 0
  let quote: string | null = null

  for (let index = 0; index < token.length; index += 1) {
    const character = token[index] ?? ''
    if (character === '\\') {
      index += 1
      continue
    }
    if (quote) {
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '[') bracketDepth += 1
    if (character === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    if (character === '(') parenDepth += 1
    if (character === ')') parenDepth = Math.max(0, parenDepth - 1)
    // A colon inside brackets belongs to an arbitrary value or selector, as in
    // `supports-[display:grid]:` or `[&:hover]:`, and is not a separator.
    if (character === ':' && bracketDepth === 0 && parenDepth === 0) positions.push(index)
  }

  return positions
}

/** Find a top-level slash, which introduces a modifier. */
function modifierSeparator(base: string): number {
  let bracketDepth = 0
  let quote: string | null = null
  for (let index = 0; index < base.length; index += 1) {
    const character = base[index] ?? ''
    if (character === '\\') {
      index += 1
      continue
    }
    if (quote) {
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '[') bracketDepth += 1
    if (character === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    // A slash inside brackets is part of a value — `bg-[url(/a/b.png)]`.
    if (character === '/' && bracketDepth === 0) return index
  }
  return -1
}

/** Parse one class token into its parts. */
export function parseClassToken(token: string): ClassToken {
  const separators = variantSeparators(token)
  const variants: string[] = []
  let cursor = 0
  for (const position of separators) {
    variants.push(token.slice(cursor, position))
    cursor = position + 1
  }
  let base = token.slice(cursor)

  // Tailwind v4 places the important marker last; v3 placed it first. Accept both
  // so a token pasted from older code is understood rather than mangled.
  let important = false
  if (base.endsWith('!')) {
    important = true
    base = base.slice(0, -1)
  } else if (base.startsWith('!')) {
    important = true
    base = base.slice(1)
  }

  const slash = modifierSeparator(base)
  const modifier = slash === -1 ? undefined : base.slice(slash + 1)
  if (slash !== -1) base = base.slice(0, slash)

  return Object.freeze({
    variants: Object.freeze(variants),
    base,
    ...(modifier === undefined ? {} : { modifier }),
    important,
  })
}

/** Serialise a parsed token back to its canonical string form. */
export function serializeClassToken(token: ClassToken): string {
  const prefix = token.variants.length > 0 ? `${token.variants.join(':')}:` : ''
  const modifier = token.modifier === undefined ? '' : `/${token.modifier}`
  // Important goes last, matching Tailwind v4, so output is canonical even when
  // the input used the older leading form.
  return `${prefix}${token.base}${modifier}${token.important ? '!' : ''}`
}

/** Parse a whole class attribute. */
export function parseClassString(input: string): readonly ClassToken[] {
  return splitClassString(input).map(parseClassToken)
}

/** Serialise tokens into a class attribute. */
export function serializeClassTokens(tokens: readonly ClassToken[]): string {
  return tokens.map(serializeClassToken).join(' ')
}

/**
 * The property a token sets, for detecting conflicts.
 *
 * Two tokens conflict when they target the same property under the same variants:
 * `p-4` and `p-8` cannot both apply, and whichever Tailwind emits last wins, which
 * is not something an author should have to reason about. Returning a key lets the
 * panel replace rather than append.
 *
 * This is a prefix comparison, not a full utility table. It catches the common
 * case — the same utility family with a different value — without pretending to
 * know every Tailwind plugin's output.
 */
export function conflictKeyOf(token: ClassToken): string {
  const scope = token.variants.join(':')

  // An arbitrary property names its own target: `[mask-type:luminance]`.
  if (token.base.startsWith('[') && token.base.endsWith(']')) {
    const inner = token.base.slice(1, -1)
    const colon = inner.indexOf(':')
    return `${scope}|${colon === -1 ? inner : inner.slice(0, colon)}`
  }

  // Strip an arbitrary value so `top-[10px]` and `top-4` compare equal.
  const withoutArbitrary = token.base.replace(/-\[[^\]]*\]$/, '')
  // Then strip a trailing scale step. Three shapes of step exist and all three have
  // to go, or two classes setting the same property will not be seen as conflicting
  // and whichever Tailwind emits last silently wins:
  //
  //   numeric      p-4, gap-2, z-10
  //   keyword      w-full, inset-auto, max-w-screen
  //   t-shirt      text-4xl, rounded-lg, text-base
  //
  // The t-shirt group is the one that is easy to miss, and it covers the whole type
  // scale, so missing it means font sizes never conflict with each other.
  const family = withoutArbitrary.replace(
    /-(?:\d+(?:\.\d+)?|px|full|auto|none|screen|xs|sm|base|md|lg|xl|[2-9]xl)$/,
    '',
  )
  return `${scope}|${family}`
}

/**
 * Merge tokens so later ones replace conflicting earlier ones.
 *
 * Order is preserved for everything that does not conflict, because Tailwind's own
 * output order matters and reordering tokens would change rendering. Exact
 * duplicates collapse.
 */
export function mergeClassTokens(
  existing: readonly string[],
  incoming: readonly string[],
): readonly string[] {
  const result: string[] = []
  const byConflict = new Map<string, number>()

  const place = (raw: string): void => {
    const token = parseClassToken(raw)
    const canonical = serializeClassToken(token)
    const key = conflictKeyOf(token)
    const at = byConflict.get(key)
    if (at === undefined) {
      byConflict.set(key, result.length)
      result.push(canonical)
      return
    }
    // A later token wins its slot, which is what makes an edit feel like setting
    // a property rather than appending another one that may or may not apply.
    result[at] = canonical
  }

  for (const raw of existing) place(raw)
  for (const raw of incoming) place(raw)
  return Object.freeze(result)
}

/** Remove tokens matching a conflict family, for clearing a property. */
export function removeClassFamily(
  tokens: readonly string[],
  family: string,
): readonly string[] {
  return Object.freeze(tokens.filter((raw) => conflictKeyOf(parseClassToken(raw)) !== family))
}

/**
 * Whether every token is a complete, statically visible class name.
 *
 * Tailwind's scanner only sees class names present in source as literals. A token
 * assembled at runtime produces no CSS, and the failure is silent — the element
 * simply renders unstyled. Checking here is what lets the caller refuse the edit
 * with an explanation instead.
 */
export function isScannable(token: string): boolean {
  // Interpolation markers mean the final class is decided at runtime.
  return !token.includes('${') && !token.includes('{') && !token.includes('}')
}
