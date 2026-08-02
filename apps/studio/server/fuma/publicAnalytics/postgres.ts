import {
  PublicMarketingDailyRowSchema,
  PublicMarketingStoredEventSchema,
  type PublicMarketingDailyRow,
  type PublicMarketingRange,
  type PublicMarketingReport,
  type PublicMarketingStoredEvent,
} from '@core/fuma/publicAnalytics/contracts'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import { buildPublicMarketingReport } from './memory'
import type { PublicMarketingAnalyticsRepository } from './service'

type DailyRow = Readonly<{
  metric_day: string | Date
  event_kind: string
  route_class: string
  campaign_source: string
  collection_basis: string
  event_count: string | number | bigint
}>
type EventRow = Readonly<{
  event_id_sha256: string
  event_kind: string
  route_class: string | null
  campaign_source: string | null
  correlation_sha256: string | null
  collection_basis: string
  occurred_at: string | Date
  received_at: string | Date
  occurred_day: string | Date
}>

function day(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error('Stored marketing date is invalid.')
  return parsed.toISOString().slice(0, 10)
}
function instant(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error('Stored marketing timestamp is invalid.')
  return parsed.toISOString()
}
function count(value: string | number | bigint): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Stored marketing count is invalid.')
  return parsed
}
function daily(row: DailyRow): PublicMarketingDailyRow {
  const parsed = safeParseValue(PublicMarketingDailyRowSchema, {
    day: day(row.metric_day),
    kind: row.event_kind,
    routeClass: row.route_class || null,
    campaignSource: row.campaign_source || null,
    collectionBasis: row.collection_basis,
    count: count(row.event_count),
  })
  if (!parsed.ok) throw new Error('Stored marketing aggregate is invalid.')
  return parsed.value
}
function event(row: EventRow): PublicMarketingStoredEvent {
  const parsed = safeParseValue(PublicMarketingStoredEventSchema, {
    eventIdSha256: row.event_id_sha256,
    kind: row.event_kind,
    routeClass: row.route_class,
    campaignSource: row.campaign_source,
    correlationSha256: row.correlation_sha256,
    collectionBasis: row.collection_basis,
    occurredAt: instant(row.occurred_at),
    receivedAt: instant(row.received_at),
    day: day(row.occurred_day),
  })
  if (!parsed.ok) throw new Error('Stored marketing event is invalid.')
  return parsed.value
}

export class PostgresPublicMarketingAnalyticsRepository implements PublicMarketingAnalyticsRepository {
  readonly #db: DbClient
  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new Error('Public marketing analytics requires PostgreSQL.')
    this.#db = db
  }

  async append(value: PublicMarketingStoredEvent): Promise<'created' | 'duplicate'> {
    const parsed = safeParseValue(PublicMarketingStoredEventSchema, value)
    if (!parsed.ok) throw new TypeError('Public marketing event failed strict validation.')
    const item = parsed.value
    return await this.#db.transaction(async (db) => {
      const inserted = await db`
        insert into fuma_public_marketing_events_v1(
          event_id_sha256,event_kind,route_class,campaign_source,correlation_sha256,collection_basis,occurred_at,received_at,occurred_day
        ) values(
          ${item.eventIdSha256},${item.kind},${item.routeClass},${item.campaignSource},${item.correlationSha256},${item.collectionBasis},${item.occurredAt},${item.receivedAt},${item.day}
        ) on conflict do nothing
      `
      if (inserted.rowCount !== 1) return 'duplicate'
      await db`
        insert into fuma_public_marketing_daily_v1(metric_day,event_kind,route_class,campaign_source,collection_basis,event_count)
        values(${item.day},${item.kind},${item.routeClass ?? ''},${item.campaignSource ?? ''},${item.collectionBasis},1)
        on conflict(metric_day,event_kind,route_class,campaign_source,collection_basis)
        do update set event_count=fuma_public_marketing_daily_v1.event_count+1
      `
      return 'created'
    })
  }

  async summarize(range: PublicMarketingRange): Promise<PublicMarketingReport> {
    const dailyRows = await this.#db<DailyRow>`
      select metric_day,event_kind,route_class,campaign_source,collection_basis,event_count
      from fuma_public_marketing_daily_v1 where metric_day>=${range.from} and metric_day<${range.to}
      order by metric_day,event_kind,route_class,campaign_source,collection_basis
    `
    const rawRows = await this.#db<EventRow>`
      select event_id_sha256,event_kind,route_class,campaign_source,correlation_sha256,collection_basis,occurred_at,received_at,occurred_day
      from fuma_public_marketing_events_v1
      where correlation_sha256 is not null
        and correlation_sha256 in (
          select correlation_sha256 from fuma_public_marketing_events_v1
          where event_kind='handoff' and occurred_day>=${range.from} and occurred_day<${range.to}
        )
      order by occurred_at,event_id_sha256
    `
    return buildPublicMarketingReport(range, dailyRows.rows.map(daily), rawRows.rows.map(event))
  }

  async purge(rawBefore: string, aggregatesBefore: string): Promise<Readonly<{ rawEventsDeleted: number; aggregatesDeleted: number }>> {
    return await this.#db.transaction(async (db) => {
      const raw = await db`delete from fuma_public_marketing_events_v1 where occurred_at<${rawBefore}`
      const aggregates = await db`delete from fuma_public_marketing_daily_v1 where metric_day<${aggregatesBefore}`
      return Object.freeze({ rawEventsDeleted: raw.rowCount, aggregatesDeleted: aggregates.rowCount })
    })
  }
}
