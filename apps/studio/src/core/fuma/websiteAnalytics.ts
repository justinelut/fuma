/**
 * Website-profile analytics.
 *
 * THE FINDING THAT DECIDED THIS SURFACE, established by reading the readers rather than assuming
 * one existed: there is NO per-site visitor analytics reader for a website profile.
 *
 * - `server/fuma/publication/privacyAnalyticsPostgres.ts` is partitioned by `profile_id`, and its
 *   event kinds are publication concepts (post-read, newsletter-open, newsletter-subscribe).
 *   Nothing appends events for the `website` profile.
 * - `server/fuma/publicAnalytics/` is `PublicMarketingAnalytics` — the platform's OWN marketing
 *   site, not a tenant's.
 *
 * So the Website profile's navigation offers "Analytics" with nothing behind it. This module makes
 * that state expressible rather than papering over it, because the alternative is worse than a gap:
 * reading the publication table for a website site returns rows that were never written, so the
 * page would render A CHART OF ZEROS. Zero is a measurement. It says "nobody visited", which is a
 * different and much more discouraging claim than "we are not counting yet" — and it is the reading
 * somebody would take to a decision about whether their site is working.
 *
 * The same rule task 6 applied to a storage allowance: an unknown quantity is stated, never drawn.
 */

/** Reads for one day. Present only for days the platform actually measured. */
export interface DayReads {
  /** ISO date, `YYYY-MM-DD`. */
  readonly day: string
  readonly reads: number
}

export interface WebsiteAnalyticsRange {
  readonly from: string
  readonly to: string
  readonly label: string
}

/**
 * A website site's analytics.
 *
 * `dailyReads: null` and `dailyReads: []` ARE DELIBERATELY DIFFERENT and the surface must not
 * collapse them. `null` means no reader measured this site. `[]` means a reader ran and the site
 * genuinely had no traffic in the range. Rendering both as an empty chart tells somebody their
 * site has no visitors when the truth may be that nothing is counting.
 */
export interface WebsiteAnalyticsData {
  readonly range: WebsiteAnalyticsRange
  readonly dailyReads: readonly DayReads[] | null
  /** Bytes served in the range, or null when no per-site reading is exposed. */
  readonly bandwidthBytes: number | null
}

export type AvailabilityCode =
  | 'measured'
  | 'measured-empty'
  | 'not-collected'

export interface Availability {
  readonly code: AvailabilityCode
  /** What the reader can state as fact. Never a number the platform did not measure. */
  readonly message: string
}

/**
 * Resolve what may honestly be said about this site's traffic.
 *
 * Three outcomes rather than two, for the same reason task 93 needed three session states: with
 * only "has data" and "no data" the un-instrumented case borrows the wording of the empty case,
 * and the empty case is a claim about the site rather than about the platform.
 */
export function availabilityOf(data: WebsiteAnalyticsData): Availability {
  if (data.dailyReads === null) {
    return Object.freeze({
      code: 'not-collected' as const,
      // Names the platform as the cause. "No visits recorded" would read as a fact about the site.
      message: 'Visitor analytics are not being collected for this site yet, so there is nothing to report for this period.',
    })
  }
  if (totalReads(data) === 0) {
    return Object.freeze({
      code: 'measured-empty' as const,
      message: `No visits were recorded ${data.range.label.toLowerCase()}.`,
    })
  }
  return Object.freeze({ code: 'measured' as const, message: '' })
}

/** Total reads across the range, or 0 when nothing was measured. */
export function totalReads(data: WebsiteAnalyticsData): number {
  return (data.dailyReads ?? []).reduce((sum, day) => sum + day.reads, 0)
}

/**
 * True when a figure may be drawn as a proportion or a trend.
 *
 * A chart drawn from an unmeasured range is a picture of nothing presented as a measurement, so the
 * decision is taken here rather than left to each panel to remember.
 */
export function isPlottable(data: WebsiteAnalyticsData): boolean {
  return data.dailyReads !== null && data.dailyReads.length > 0
}

/**
 * Fill absent days with zero across the range.
 *
 * MISSING DAYS ARE NOT ZERO DAYS AT THE READER, BUT THEY ARE ON THE AXIS - the same correctness
 * point task 10 established for the publication chart. An aggregate query groups by day, so a day
 * with no events has NO ROW. Plotting the returned rows directly puts 1 March beside 5 March as
 * though they were consecutive, which misreports both the shape of the trend and how long a period
 * it covers - and it does so more the quieter the site is.
 *
 * Returns null when nothing was measured, so an un-instrumented site cannot acquire a flat line of
 * zeros by passing through this function.
 */
export function filledSeries(data: WebsiteAnalyticsData): readonly DayReads[] | null {
  if (data.dailyReads === null) return null
  const byDay = new Map(data.dailyReads.map((day) => [day.day, day.reads]))
  const days = daysInRange(data.range.from, data.range.to)
  return Object.freeze(days.map((day) => Object.freeze({ day, reads: byDay.get(day) ?? 0 })))
}

/** Every ISO day from `from` to `to` inclusive. Empty when the range is inverted or unparseable. */
export function daysInRange(from: string, to: string): readonly string[] {
  const start = Date.parse(`${from}T00:00:00.000Z`)
  const end = Date.parse(`${to}T00:00:00.000Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return Object.freeze([])
  const days: string[] = []
  for (let at = start; at <= end; at += 86_400_000) {
    days.push(new Date(at).toISOString().slice(0, 10))
  }
  return Object.freeze(days)
}

/**
 * Metrics that belong to the publication profile and must NEVER appear on a website site.
 *
 * Not a style rule. A website site has no posts and no newsletter, so each of these would render a
 * permanent zero - and a zero next to a label is read as a measurement, so the page would report
 * that the newsletter has no subscribers for a site that has no newsletter. Absent is correct.
 */
export const PUBLICATION_ONLY_METRICS: readonly string[] = Object.freeze([
  'post-read',
  'newsletter-open',
  'newsletter-click',
  'newsletter-subscribe',
  'newsletter-unsubscribe',
  'member-read',
])

/** The gap recorded as data, so it is reviewable rather than folded into a page that looks finished. */
export const MEASUREMENT_GAP = Object.freeze({
  route: 'route.website-analytics',
  blocking: false,
  reason: 'No per-site visitor analytics reader exists for the website profile. The publication '
    + 'reader is partitioned by profile_id and its event kinds are publication concepts, and '
    + 'publicAnalytics measures the platform\'s own marketing site.',
  whatWouldCloseIt: 'A profile-neutral read of site-read events scoped to the site, appended by the '
    + 'public request path. The surface already renders a measured series, so closing the gap is a '
    + 'reader rather than a redesign.',
})
