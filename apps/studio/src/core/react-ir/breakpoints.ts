/**
 * Migrating max-width breakpoint contexts to mobile-first.
 *
 * The legacy model is desktop-first: unconditional styles apply everywhere, and each
 * `(max-width: N)` context overrides them below N. Tailwind is mobile-first: the
 * unprefixed class is the smallest screen and `sm:`/`md:`/`lg:` layer upward.
 *
 * Converting between them is not a rename. The cascade direction inverts, so which
 * declaration is "the base" changes, and getting it wrong produces a site that looks
 * right on a phone and wrong on everything else.
 *
 * Worked through with the shipped defaults — contexts at 375, 768 and 1440, all
 * max-width, emitted widest-first so the narrowest wins:
 *
 *     viewport ≤ 375        the 375 context
 *     376 – 768             the 768 context
 *     769 – 1440            the 1440 context
 *     above 1440            the unconditional base
 *
 * Read that last line again, because it is the part that catches people: in a
 * desktop-first model whose widest context is itself a max-width, the unconditional
 * base only applies *above* that width. So it does not become the mobile-first base —
 * it becomes the **largest** breakpoint. The mobile-first base is the narrowest
 * context's value.
 *
 * Getting this backwards is the single most likely way to break every existing site
 * during migration, which is why the inversion is implemented once, here, with the
 * boundaries derived rather than guessed.
 */

/** A viewport context in the legacy model. */
export type LegacyContext = Readonly<{
  id: string
  label: string
  width: number
  /** The published condition. Absent means the legacy max-width default. */
  mediaQuery?: string
}>

/** Where a declaration applied, expressed as an inclusive viewport range. */
export type ViewportRange = Readonly<{
  /** Inclusive lower bound in pixels. */
  from: number
  /** Inclusive upper bound, or null for unbounded. */
  to: number | null
  /** Which legacy context supplied the value, or null for the unconditional base. */
  sourceContextId: string | null
}>

export type MobileFirstStop = Readonly<{
  /** Tailwind variant prefix, or null for the unprefixed base. */
  variant: string | null
  /** min-width in pixels this stop begins at. 0 for the base. */
  minWidth: number
  /** Which legacy context's declarations belong here. */
  sourceContextId: string | null
}>

export type MigrationPlan = Readonly<{
  stops: readonly MobileFirstStop[]
  /** Contexts that could not be inverted, with the reason. */
  unsupported: readonly Readonly<{ contextId: string, reason: string }>[]
  /** Screens to declare in the Tailwind theme, by variant name. */
  screens: Readonly<Record<string, string>>
}>

const MAX_WIDTH_ONLY = /^\(?\s*max-width\s*:\s*(\d+(?:\.\d+)?)\s*px\s*\)?$/i
const MIN_WIDTH_ONLY = /^\(?\s*min-width\s*:\s*(\d+(?:\.\d+)?)\s*px\s*\)?$/i

/** The max-width a context represents, or null when it is not a pure max-width. */
export function maxWidthOf(context: LegacyContext): number | null {
  // A legacy row with no query defaulted to max-width at its own frame width.
  if (context.mediaQuery === undefined) return context.width
  const match = MAX_WIDTH_ONLY.exec(context.mediaQuery.trim())
  return match ? Number(match[1]) : null
}

/** Whether a context is already mobile-first. */
export function isMinWidth(context: LegacyContext): boolean {
  return context.mediaQuery !== undefined && MIN_WIDTH_ONLY.test(context.mediaQuery.trim())
}

/**
 * Tailwind's default screen names, so a migrated site lands on familiar variants
 * where its widths are close to the conventional ones.
 *
 * Matching by proximity rather than equality: a site with a 640 or a 768 context
 * should end up with `sm:` and `md:` rather than `min-[641px]:`, because the
 * generated classes are what people will read and edit afterwards.
 */
const TAILWIND_SCREENS: readonly Readonly<{ name: string, width: number }>[] = [
  { name: 'sm', width: 640 },
  { name: 'md', width: 768 },
  { name: 'lg', width: 1024 },
  { name: 'xl', width: 1280 },
  { name: '2xl', width: 1536 },
]

/** Tolerance for snapping a migrated width onto a conventional Tailwind screen. */
const SNAP_TOLERANCE = 16

function variantFor(minWidth: number, used: Set<string>): string {
  for (const screen of TAILWIND_SCREENS) {
    if (Math.abs(screen.width - minWidth) <= SNAP_TOLERANCE && !used.has(screen.name)) {
      used.add(screen.name)
      return screen.name
    }
  }
  // An arbitrary variant rather than a wrong conventional one. Being explicit is
  // better than implying a site uses standard breakpoints when it does not.
  return `min-[${minWidth}px]`
}

/**
 * Resolve which viewport range each legacy context actually governed.
 *
 * Derived from the widths rather than assumed, because the ranges are what the
 * inversion depends on and they are not obvious from the context list.
 */
export function resolveLegacyRanges(
  contexts: readonly LegacyContext[],
): readonly ViewportRange[] {
  const maxWidthContexts = contexts
    .map((context) => ({ context, maxWidth: maxWidthOf(context) }))
    .filter((entry): entry is { context: LegacyContext, maxWidth: number } =>
      entry.maxWidth !== null)
    .sort((left, right) => left.maxWidth - right.maxWidth)

  if (maxWidthContexts.length === 0) {
    return Object.freeze([Object.freeze({ from: 0, to: null, sourceContextId: null })])
  }

  const ranges: ViewportRange[] = []
  let lower = 0
  for (const entry of maxWidthContexts) {
    ranges.push(Object.freeze({
      from: lower,
      to: entry.maxWidth,
      sourceContextId: entry.context.id,
    }))
    lower = entry.maxWidth + 1
  }

  // Above the widest max-width context, nothing overrides, so the unconditional
  // base governs. This is the range people forget exists.
  ranges.push(Object.freeze({ from: lower, to: null, sourceContextId: null }))
  return Object.freeze(ranges)
}

/**
 * Build the mobile-first plan.
 *
 * The narrowest context becomes the unprefixed base, each subsequent range becomes a
 * min-width stop, and the original unconditional base becomes the widest stop.
 */
export function planMobileFirstMigration(
  contexts: readonly LegacyContext[],
): MigrationPlan {
  const unsupported: { contextId: string, reason: string }[] = []

  for (const context of contexts) {
    if (isMinWidth(context)) continue
    if (maxWidthOf(context) === null) {
      unsupported.push({
        contextId: context.id,
        reason:
          `"${context.mediaQuery}" is not a plain max-width or min-width query, so its `
          + 'range cannot be inverted automatically. Convert it by hand.',
      })
    }
  }

  const ranges = resolveLegacyRanges(contexts)
  const used = new Set<string>()
  const stops: MobileFirstStop[] = []
  const screens: Record<string, string> = {}

  ranges.forEach((range, index) => {
    if (index === 0) {
      // The narrowest range is the mobile-first base.
      stops.push(Object.freeze({
        variant: null,
        minWidth: 0,
        sourceContextId: range.sourceContextId,
      }))
      return
    }
    const variant = variantFor(range.from, used)
    stops.push(Object.freeze({
      variant,
      minWidth: range.from,
      sourceContextId: range.sourceContextId,
    }))
    // Only conventional names go in the theme; an arbitrary variant needs no screen.
    if (!variant.startsWith('min-[')) screens[variant] = `${range.from}px`
  })

  return Object.freeze({
    stops: Object.freeze(stops),
    unsupported: Object.freeze(unsupported.map((entry) => Object.freeze(entry))),
    screens: Object.freeze(screens),
  })
}

/**
 * The variant a legacy context's declarations move to.
 *
 * Returns null for the base. Throws for a context the plan could not place, because
 * silently dropping its styles would change the site's appearance without saying so.
 */
export function variantForContext(plan: MigrationPlan, contextId: string | null): string | null {
  const stop = plan.stops.find((candidate) => candidate.sourceContextId === contextId)
  if (!stop) {
    throw new Error(
      `No mobile-first stop covers ${contextId === null ? 'the unconditional base' : `context "${contextId}"`}. `
      + 'Migrating without it would silently drop its styles.',
    )
  }
  return stop.variant
}

/**
 * Rewrite a class token for its new stop.
 *
 * A token already carrying a variant keeps it, with the new breakpoint prefixed
 * ahead — Tailwind applies variants left to right, and `md:hover:` is the
 * conventional order.
 */
export function retargetClassToken(token: string, variant: string | null): string {
  if (variant === null) return token
  return `${variant}:${token}`
}
