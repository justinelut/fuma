import {
  PublicMarketingDailyRowSchema,
  PublicMarketingReportSchema,
  type PublicMarketingDailyRow,
  type PublicMarketingRange,
  type PublicMarketingReport,
  type PublicMarketingStoredEvent,
} from '@core/fuma/publicAnalytics/contracts'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { PublicMarketingAnalyticsRepository } from './service'

function inRange(day: string, range: PublicMarketingRange): boolean {
  return day >= range.from && day < range.to
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.min(10_000, Math.floor(numerator * 10_000 / denominator))
}

function dailyKey(event: PublicMarketingStoredEvent): string {
  return JSON.stringify([event.day, event.kind, event.routeClass, event.campaignSource, event.collectionBasis])
}

export function buildPublicMarketingReport(
  range: PublicMarketingRange,
  dailyRows: readonly PublicMarketingDailyRow[],
  rawEvents: readonly PublicMarketingStoredEvent[],
): PublicMarketingReport {
  const rows = dailyRows.filter((row) => inRange(row.day, range))
  const count = (kind: PublicMarketingStoredEvent['kind']) => rows
    .filter((row) => row.kind === kind)
    .reduce((sum, row) => sum + row.count, 0)
  const routeMap = new Map<string, { pageViews: number; handoffs: number }>()
  const campaignMap = new Map<string, { pageViews: number; handoffs: number }>()
  for (const row of rows) {
    if (row.routeClass !== null && (row.kind === 'page-view' || row.kind === 'handoff')) {
      const value = routeMap.get(row.routeClass) ?? { pageViews: 0, handoffs: 0 }
      if (row.kind === 'page-view') value.pageViews += row.count
      else value.handoffs += row.count
      routeMap.set(row.routeClass, value)
    }
    if (row.campaignSource !== null && (row.kind === 'page-view' || row.kind === 'handoff')) {
      const value = campaignMap.get(row.campaignSource) ?? { pageViews: 0, handoffs: 0 }
      if (row.kind === 'page-view') value.pageViews += row.count
      else value.handoffs += row.count
      campaignMap.set(row.campaignSource, value)
    }
  }

  const correlated = new Map<string, PublicMarketingStoredEvent[]>()
  for (const event of rawEvents) {
    if (event.correlationSha256 === null) continue
    const stages = correlated.get(event.correlationSha256) ?? []
    stages.push(event)
    correlated.set(event.correlationSha256, stages)
  }
  const funnel = { visits: 0, signups: 0, sites: 0, publishes: 0, paid: 0 }
  for (const stages of correlated.values()) {
    const ordered = stages
      .map((event) => ({ event, at: Date.parse(event.occurredAt) }))
      .sort((left, right) => left.at - right.at)
    if (ordered.some(({ at }) => !Number.isFinite(at))) throw new Error('Stored marketing timestamp is invalid.')
    const firstAtOrAfter = (kind: PublicMarketingStoredEvent['kind'], after: number) => ordered
      .find(({ event, at }) => event.kind === kind && at >= after)?.at
    let reachedSignup = false
    let reachedSite = false
    let reachedPublish = false
    let reachedPaid = false
    const handoffs = ordered.filter(({ event }) => event.kind === 'handoff' && inRange(event.day, range))
    if (handoffs.length === 0) continue
    funnel.visits += 1
    for (const handoff of handoffs) {
      const signup = firstAtOrAfter('signup', handoff.at)
      if (signup === undefined) continue
      reachedSignup = true
      const site = firstAtOrAfter('site', signup)
      if (site === undefined) continue
      reachedSite = true
      const publish = firstAtOrAfter('publish', site)
      if (publish === undefined) continue
      reachedPublish = true
      const paid = firstAtOrAfter('paid', publish)
      if (paid !== undefined) reachedPaid = true
    }
    if (reachedSignup) funnel.signups += 1
    if (reachedSite) funnel.sites += 1
    if (reachedPublish) funnel.publishes += 1
    if (reachedPaid) funnel.paid += 1
  }

  const candidate = {
    range,
    retention: { rawEventDays: 30, aggregateDays: 400 },
    totals: {
      pageViews: count('page-view'),
      ctaSelections: count('cta-selected'),
      handoffs: count('handoff'),
      signups: count('signup'),
      sites: count('site'),
      publishes: count('publish'),
      paid: count('paid'),
    },
    funnel,
    conversionBasisPoints: {
      visitToSignup: ratio(funnel.signups, funnel.visits),
      signupToSite: ratio(funnel.sites, funnel.signups),
      siteToPublish: ratio(funnel.publishes, funnel.sites),
      publishToPaid: ratio(funnel.paid, funnel.publishes),
    },
    routes: [...routeMap.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([routeClass, values]) => ({ routeClass, ...values })),
    campaigns: [...campaignMap.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([campaignSource, values]) => ({ campaignSource, ...values })),
  }
  const parsed = safeParseValue(PublicMarketingReportSchema, candidate)
  if (!parsed.ok) throw new Error('Public marketing report failed strict validation.')
  return Object.freeze(parsed.value)
}

export class MemoryPublicMarketingAnalyticsRepository implements PublicMarketingAnalyticsRepository {
  readonly events = new Map<string, PublicMarketingStoredEvent>()
  readonly daily = new Map<string, PublicMarketingDailyRow>()
  failWrites = false

  async append(event: PublicMarketingStoredEvent): Promise<'created' | 'duplicate'> {
    if (this.failWrites) throw new Error('analytics storage unavailable')
    if (this.events.has(event.eventIdSha256)) return 'duplicate'
    this.events.set(event.eventIdSha256, structuredClone(event))
    const key = dailyKey(event)
    const current = this.daily.get(key)
    const candidate = {
      day: event.day,
      kind: event.kind,
      routeClass: event.routeClass,
      campaignSource: event.campaignSource,
      collectionBasis: event.collectionBasis,
      count: (current?.count ?? 0) + 1,
    }
    const parsed = safeParseValue(PublicMarketingDailyRowSchema, candidate)
    if (!parsed.ok) throw new Error('Public marketing daily aggregate failed validation.')
    this.daily.set(key, Object.freeze(parsed.value))
    return 'created'
  }

  async summarize(range: PublicMarketingRange): Promise<PublicMarketingReport> {
    return buildPublicMarketingReport(range, [...this.daily.values()], [...this.events.values()])
  }

  async purge(rawBefore: string, aggregatesBefore: string): Promise<Readonly<{ rawEventsDeleted: number; aggregatesDeleted: number }>> {
    let rawEventsDeleted = 0
    let aggregatesDeleted = 0
    for (const [key, event] of this.events) {
      if (event.occurredAt < rawBefore) {
        this.events.delete(key)
        rawEventsDeleted += 1
      }
    }
    for (const [key, row] of this.daily) {
      if (row.day < aggregatesBefore) {
        this.daily.delete(key)
        aggregatesDeleted += 1
      }
    }
    return Object.freeze({ rawEventsDeleted, aggregatesDeleted })
  }
}
