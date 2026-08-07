/**
 * Publication dashboard figures.
 *
 * Everything here comes from a reader that already exists: member accounts,
 * the content list, newsletters, and the privacy analytics report. Nothing is
 * modelled or estimated.
 *
 * Where the Ghost reference shows a figure this product does not measure — most
 * obviously monthly recurring revenue, which lives with the billing provider and
 * not in publication analytics — the card keeps its position and reports the
 * figure as unavailable rather than showing an invented number.
 */
import { PublicationHttpClient } from './client'
import { PublicationPrivacyAnalyticsHttpClient } from './privacyAnalyticsClient'
import type { PublicationAnalyticsRange } from '@core/fuma/publication/analyticsContracts'

export type PublicationTarget = Readonly<{
  organizationId: string
  workspaceId: string
  siteId: string
  profileId: string
}>

export type PublicationFigures = Readonly<{
  /** Active member accounts, or null when the reader was unavailable. */
  members: number | null
  subscriptions: number | null
  unsubscriptions: number | null
  siteReads: number | null
  postReads: number | null
  memberReads: number | null
  newsletterOpens: number | null
  newsletterClicks: number | null
  /** Reads by member source, in report order. */
  memberSources: readonly Readonly<{ source: string, reads: number }>[]
  /** Per-newsletter opens, for the bar series. */
  newsletterSeries: readonly Readonly<{ label: string, value: number }>[]
  /**
   * Reads per day across the whole range, for the trend chart.
   *
   * EVERY day in the range is present, including days with no activity. The reader returns only days
   * that HAVE rows, so plotting its output directly would place a quiet Tuesday next to the following
   * Friday as if they were consecutive - the line would misreport both the shape of the trend and how
   * long it covers. Filling the gaps is what makes the x-axis mean elapsed time.
   */
  dailyReadSeries: readonly Readonly<{ label: string, value: number }>[]
  /** Published posts, most recent first, with engagement where measured. */
  posts: readonly Readonly<{
    id: string
    title: string
    publishedAt: string | null
    reads: number | null
    openRate: number | null
  }>[]
  range: PublicationAnalyticsRange
}>

/**
 * Every day from `from` up to and including `to`, in order.
 *
 * Built from the RANGE rather than from the returned rows, so a day with no events becomes a zero
 * rather than disappearing.
 */
export function daysInRange(range: PublicationAnalyticsRange): readonly string[] {
  const days: string[] = []
  const start = new Date(`${range.from}T00:00:00Z`)
  const end = new Date(`${range.to}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return Object.freeze([])
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    days.push(cursor.toISOString().slice(0, 10))
  }
  return Object.freeze(days)
}

/**
 * Reads per day, gap-filled across the range.
 *
 * The label is the day of the month, because thirty full dates on one axis is unreadable and the
 * range is already stated above the chart.
 */
export function dailyReadSeriesFrom(
  range: PublicationAnalyticsRange,
  daily: readonly Readonly<{ day: string, siteReads: number, postReads: number }>[],
): readonly Readonly<{ label: string, value: number }>[] {
  const byDay = new Map(daily.map((row) => [row.day, row.siteReads + row.postReads]))
  return Object.freeze(daysInRange(range).map((day) => Object.freeze({
    label: String(Number(day.slice(8, 10))),
    value: byDay.get(day) ?? 0,
  })))
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/** Trailing 30 days, matching the reference's default range control. */
export function trailing30Days(now: Date = new Date()): PublicationAnalyticsRange {
  const from = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000)
  return Object.freeze({ from: isoDate(from), to: isoDate(now) })
}

export function emptyPublicationFigures(
  range: PublicationAnalyticsRange = trailing30Days(),
): PublicationFigures {
  return Object.freeze({
    members: null,
    subscriptions: null,
    unsubscriptions: null,
    siteReads: null,
    postReads: null,
    memberReads: null,
    newsletterOpens: null,
    newsletterClicks: null,
    memberSources: Object.freeze([]),
    newsletterSeries: Object.freeze([]),
    dailyReadSeries: Object.freeze([]),
    posts: Object.freeze([]),
    range,
  })
}

function titleOf(metadata: unknown, fallback: string): string {
  if (typeof metadata === 'object' && metadata !== null) {
    const title = (metadata as { title?: unknown }).title
    if (typeof title === 'string' && title.trim()) return title
  }
  return fallback
}

export async function readPublicationFigures(
  target: PublicationTarget,
  range: PublicationAnalyticsRange = trailing30Days(),
): Promise<PublicationFigures> {
  const admin = new PublicationHttpClient(target)
  const analytics = new PublicationPrivacyAnalyticsHttpClient(target)

  const [accounts, content, newsletters, report] = await Promise.all([
    admin.memberAccounts().catch(() => null),
    admin.contentList().catch(() => null),
    admin.newsletters().catch(() => null),
    analytics.report(range).catch(() => null),
  ])

  const readsByContent = new Map<string, number>()
  for (const metric of report?.content ?? []) {
    readsByContent.set(metric.contentId, metric.totalReads)
  }

  const newsletterNames = new Map<string, string>()
  for (const [index, newsletter] of (newsletters ?? []).entries()) {
    const record = newsletter as { newsletterId?: unknown, name?: unknown }
    const id = typeof record.newsletterId === 'string' ? record.newsletterId : String(index)
    newsletterNames.set(id, typeof record.name === 'string' ? record.name : `Newsletter ${index + 1}`)
  }

  const posts = (content ?? [])
    .filter((entry) => entry.kind === 'post' && entry.status === 'published')
    .slice()
    .sort((left, right) => (right.publishedAt ?? '').localeCompare(left.publishedAt ?? ''))
    .slice(0, 6)
    .map((entry) => Object.freeze({
      id: entry.contentId,
      title: titleOf(entry.metadata, entry.contentId),
      publishedAt: entry.publishedAt ?? null,
      reads: readsByContent.get(entry.contentId) ?? null,
      openRate: null as number | null,
    }))

  return Object.freeze({
    members: accounts
      ? accounts.filter((account) => account.state === 'active').length
      : null,
    subscriptions: report?.totals.subscriptions ?? null,
    unsubscriptions: report?.totals.unsubscriptions ?? null,
    siteReads: report?.totals.siteReads ?? null,
    postReads: report?.totals.postReads ?? null,
    memberReads: report?.totals.memberReads ?? null,
    newsletterOpens: report?.totals.newsletterOpens ?? null,
    newsletterClicks: report?.totals.newsletterClicks ?? null,
    memberSources: Object.freeze((report?.memberSources ?? []).map((metric) => Object.freeze({
      source: metric.source,
      reads: metric.reads,
    }))),
    dailyReadSeries: dailyReadSeriesFrom(range, report?.daily ?? []),
    newsletterSeries: Object.freeze((report?.newsletters ?? []).slice(0, 24).map((metric) => Object.freeze({
      label: newsletterNames.get(metric.newsletterId) ?? metric.newsletterId,
      value: metric.opens,
    }))),
    posts: Object.freeze(posts),
    range,
  })
}
