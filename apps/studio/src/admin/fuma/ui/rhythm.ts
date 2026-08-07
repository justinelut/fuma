/**
 * Vertical rhythm for the hosted dashboards.
 *
 * THE DEFECT THIS REPLACES: spacing was chosen per element. One surface carried mt-6, mt-3, mt-2.5,
 * mt-1.5, mt-0.5, pt-7, pb-3 and pb-0.5 — eight different gaps with nothing deciding which applied
 * where. The result reads as slightly wrong everywhere without any single value being identifiably
 * the mistake, which is why it never gets fixed by adjusting one number.
 *
 * The rule here is that a gap encodes a RELATIONSHIP, not a taste. Four relationships exist on these
 * surfaces, and each has exactly one gap:
 *
 *   TIGHT    a value and the label that names it. They are one thing read together.
 *   RELATED  sibling items in a list or group.
 *   GROUP    distinct groups inside one panel.
 *   SECTION  major regions of a page.
 *
 * Because there are four values rather than eight, "which gap?" is answered by asking what the
 * relationship is, and two authors reach the same answer. An architecture test asserts the dashboard
 * surfaces use these instead of arbitrary margins, so the scale cannot quietly erode back into
 * per-element choices.
 *
 * The steps are multiplicative (1.5 / 3 / 6 / 12 in Tailwind units) rather than adjacent, because
 * adjacent steps are not distinguishable — if GROUP were mt-4 and RELATED mt-3, the grouping would
 * not read as grouping and the scale would carry no information.
 */

/** Gap between a value and the label that names it. */
export const TIGHT = 'mt-1.5'

/** Gap between sibling items in a list or group. */
export const RELATED = 'mt-3'

/** Gap between distinct groups inside one panel. */
export const GROUP = 'mt-6'

/** Gap between major regions of a page. Larger on wide viewports, where the page is less cramped. */
export const SECTION = 'mt-10 sm:mt-12'

/** Flex/grid gap for sibling items, matching RELATED. */
export const RELATED_GAP = 'gap-3'

/** Flex/grid gap between groups, matching GROUP. */
export const GROUP_GAP = 'gap-6'

/**
 * Every rhythm value, for the architecture test to check against.
 *
 * Exported as data so the gate reads the same source the components do — a hard-coded list in the
 * test would drift the first time a value changed here.
 */
export const RHYTHM = Object.freeze({
  TIGHT,
  RELATED,
  GROUP,
  SECTION,
  RELATED_GAP,
  GROUP_GAP,
})
