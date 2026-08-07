/**
 * The CSS escape hatch.
 *
 * Tailwind cannot express everything. A computed gradient stop, a clip path, an
 * offset path, a custom property fed by a script — these are real needs, and a
 * styling model with no way out of it would force people to abandon the model
 * entirely the first time they hit one.
 *
 * So the hatch stays. The discipline is that it stays *narrow*: it holds what
 * utilities genuinely cannot say, and nothing that they can. Without that rule the
 * hatch quietly becomes the styling system again, and the design tokens stop
 * governing anything — which is exactly the state the engine conversion is meant to
 * get out of.
 *
 * This module enforces that by reporting, for each declaration, whether a utility
 * already covers it. Reported rather than refused: the caller decides whether to
 * block on it, because a migration pass legitimately carries declarations a new edit
 * should not.
 */

/**
 * CSS properties with a direct Tailwind utility.
 *
 * Kept to properties whose mapping is unambiguous. `display` is here because
 * `flex`/`grid`/`hidden` cover it; `grid-template-areas` is not, because Tailwind has
 * no utility for it and an arbitrary value is the honest answer.
 */
const COVERED_PROPERTIES: ReadonlyMap<string, string> = new Map([
  ['display', 'flex, grid, block, inline-flex, hidden'],
  ['position', 'relative, absolute, fixed, sticky'],
  ['color', 'text-<color>'],
  ['backgroundColor', 'bg-<color>'],
  ['borderColor', 'border-<color>'],
  ['borderRadius', 'rounded-<size>'],
  ['borderWidth', 'border-<width>'],
  ['opacity', 'opacity-<value>'],
  ['fontSize', 'text-<size>'],
  ['fontWeight', 'font-<weight>'],
  ['fontStyle', 'italic, not-italic'],
  ['lineHeight', 'leading-<value> or text-<size>/<leading>'],
  ['letterSpacing', 'tracking-<value>'],
  ['textAlign', 'text-left, text-center, text-right'],
  ['textTransform', 'uppercase, lowercase, capitalize'],
  ['textDecoration', 'underline, line-through, no-underline'],
  ['padding', 'p-<size>'],
  ['paddingTop', 'pt-<size>'],
  ['paddingRight', 'pr-<size>'],
  ['paddingBottom', 'pb-<size>'],
  ['paddingLeft', 'pl-<size>'],
  ['margin', 'm-<size>'],
  ['marginTop', 'mt-<size>'],
  ['marginRight', 'mr-<size>'],
  ['marginBottom', 'mb-<size>'],
  ['marginLeft', 'ml-<size>'],
  ['gap', 'gap-<size>'],
  ['rowGap', 'gap-y-<size>'],
  ['columnGap', 'gap-x-<size>'],
  ['width', 'w-<size>'],
  ['height', 'h-<size>'],
  ['minWidth', 'min-w-<size>'],
  ['minHeight', 'min-h-<size>'],
  ['maxWidth', 'max-w-<size>'],
  ['maxHeight', 'max-h-<size>'],
  ['flexDirection', 'flex-row, flex-col'],
  ['alignItems', 'items-<value>'],
  ['justifyContent', 'justify-<value>'],
  ['flexWrap', 'flex-wrap, flex-nowrap'],
  ['overflow', 'overflow-<value>'],
  ['zIndex', 'z-<value>'],
  ['cursor', 'cursor-<value>'],
  ['visibility', 'visible, invisible'],
  ['boxShadow', 'shadow-<size>'],
  ['objectFit', 'object-<value>'],
  ['textOverflow', 'truncate, text-ellipsis'],
  ['whiteSpace', 'whitespace-<value>'],
])

export type EscapeHatchFinding = Readonly<{
  property: string
  /** A utility that already covers it, when one does. */
  suggestion?: string
  /** Whether keeping it in the hatch is justified. */
  justified: boolean
  message: string
}>

/**
 * Review an escape-hatch style object.
 *
 * Every declaration is classified, so a reviewer sees both what belongs there and
 * what has leaked in.
 */
export function reviewEscapeHatch(
  style: Readonly<Record<string, string>>,
): readonly EscapeHatchFinding[] {
  const findings: EscapeHatchFinding[] = []

  for (const property of Object.keys(style).sort()) {
    const covered = COVERED_PROPERTIES.get(property)
    if (covered) {
      findings.push(Object.freeze({
        property,
        suggestion: covered,
        justified: false,
        message:
          `"${property}" has a utility (${covered}). Keeping it here takes it outside the `
          + 'design tokens, so a later theme change will not reach it.',
      }))
      continue
    }

    // A custom property is a legitimate use: it is how a script or a nested rule is
    // fed a value, and no utility can declare one.
    if (property.startsWith('--')) {
      findings.push(Object.freeze({
        property,
        justified: true,
        message: `"${property}" is a custom property, which no utility can declare.`,
      }))
      continue
    }

    findings.push(Object.freeze({
      property,
      justified: true,
      message: `"${property}" has no direct utility, so the escape hatch is the right place.`,
    }))
  }

  return Object.freeze(findings)
}

/** Declarations that should have been utilities. */
export function leakedDeclarations(
  style: Readonly<Record<string, string>>,
): readonly EscapeHatchFinding[] {
  return Object.freeze(reviewEscapeHatch(style).filter((finding) => !finding.justified))
}

/**
 * Whether an escape hatch is acceptable.
 *
 * Used by the write path so a new edit cannot introduce a leak, while an existing
 * one survives until it is migrated — blocking on old content would make the model
 * unadoptable for any site that already has some.
 */
export function isDisciplined(style: Readonly<Record<string, string>>): boolean {
  return leakedDeclarations(style).length === 0
}

/** Whether a property is known to have a utility. */
export function hasUtility(property: string): boolean {
  return COVERED_PROPERTIES.has(property)
}
