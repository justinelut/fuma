import {
  PublicAcquisitionEventSchema,
  type PublicAcquisitionEvent,
} from '@fuma/public-contracts'
import {
  PublicMarketingAuthorityEventSchema,
  PublicMarketingCollectionContextSchema,
  PublicMarketingCollectionResultSchema,
  PublicMarketingRangeSchema,
  PublicMarketingReportSchema,
  PublicMarketingRetentionResultSchema,
  PublicMarketingStoredEventSchema,
  type PublicMarketingCollectionContext,
  type PublicMarketingCollectionResult,
  type PublicMarketingRange,
  type PublicMarketingReport,
  type PublicMarketingRetentionResult,
  type PublicMarketingStoredEvent,
} from '@core/fuma/publicAnalytics/contracts'
import { safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'

export const PUBLIC_MARKETING_RETENTION = Object.freeze({ rawEventDays: 30 as const, aggregateDays: 400 as const })
const DAY_MS = 86_400_000
const MAX_PUBLIC_EVENT_SKEW_MS = 7 * DAY_MS
const MAX_REPORT_DAYS = 30

export interface PublicMarketingAnalyticsRepository {
  append(event: PublicMarketingStoredEvent): Promise<'created' | 'duplicate'>
  summarize(range: PublicMarketingRange): Promise<PublicMarketingReport>
  purge(rawBefore: string, aggregatesBefore: string): Promise<Readonly<{ rawEventsDeleted: number; aggregatesDeleted: number }>>
}

export class PublicMarketingAnalyticsError extends Error {
  readonly code: 'invalid-event' | 'invalid-context' | 'invalid-range' | 'storage-unavailable'
  constructor(code: PublicMarketingAnalyticsError['code'], message = 'Public marketing analytics request is invalid.') {
    super(message)
    this.name = 'PublicMarketingAnalyticsError'
    this.code = code
  }
}

function strict<T extends TSchema>(schema: T, value: unknown, code: PublicMarketingAnalyticsError['code']): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new PublicMarketingAnalyticsError(code)
  return parsed.value
}

function timestamp(value: string, code: PublicMarketingAnalyticsError['code']): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new PublicMarketingAnalyticsError(code)
  return parsed
}

function date(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new PublicMarketingAnalyticsError('invalid-range')
  }
  return parsed
}

export function validatePublicMarketingRange(raw: unknown): PublicMarketingRange {
  const range = strict(PublicMarketingRangeSchema, raw, 'invalid-range')
  const days = (date(range.to) - date(range.from)) / DAY_MS
  if (!Number.isInteger(days) || days < 1 || days > MAX_REPORT_DAYS) {
    throw new PublicMarketingAnalyticsError('invalid-range', 'Marketing funnel reports are limited to 1–30 UTC days while opaque joins exist.')
  }
  return Object.freeze(range)
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function decision(reason: PublicMarketingCollectionResult['reason'], replayed = false): PublicMarketingCollectionResult {
  return Object.freeze(strict(PublicMarketingCollectionResultSchema, {
    accepted: reason === 'accepted',
    replayed,
    reason,
  }, 'storage-unavailable'))
}

function privacyDecision(event: PublicAcquisitionEvent, context: PublicMarketingCollectionContext): PublicMarketingCollectionResult['reason'] {
  if (context.globalPrivacyControl) return 'global-privacy-control'
  if (context.doNotTrack) return 'do-not-track'
  if (context.traffic !== 'human') return 'traffic-filtered'
  if (event.kind !== 'page_view' && event.consent !== 'granted') return 'consent-required'
  return 'accepted'
}

function validClock(now: () => Date): Date {
  const value = now()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new PublicMarketingAnalyticsError('storage-unavailable')
  return value
}

export class PublicMarketingAnalyticsService {
  readonly #repository: PublicMarketingAnalyticsRepository
  readonly #now: () => Date

  constructor(input: Readonly<{ repository: PublicMarketingAnalyticsRepository; now?: () => Date }>) {
    this.#repository = input.repository
    this.#now = input.now ?? (() => new Date())
  }

  async collectPublic(raw: unknown, rawContext: unknown): Promise<PublicMarketingCollectionResult> {
    const event = strict(PublicAcquisitionEventSchema, raw, 'invalid-event') as PublicAcquisitionEvent
    const context = strict(PublicMarketingCollectionContextSchema, rawContext, 'invalid-context')
    const reason = privacyDecision(event, context)
    if (reason !== 'accepted') return decision(reason)
    if (Math.abs(timestamp(event.timestamp, 'invalid-event') - timestamp(context.receivedAt, 'invalid-context')) > MAX_PUBLIC_EVENT_SKEW_MS) {
      throw new PublicMarketingAnalyticsError('invalid-event', 'Public marketing event timestamp is outside the bounded reorder window.')
    }
    const correlation = event.kind === 'handoff_started' ? event.handoffCorrelation : null
    const stored = strict(PublicMarketingStoredEventSchema, {
      eventIdSha256: await sha256(canonical(event)),
      kind: event.kind === 'page_view' ? 'page-view' : event.kind === 'cta_selected' ? 'cta-selected' : 'handoff',
      routeClass: event.routeClass,
      campaignSource: event.campaignSource ?? null,
      correlationSha256: correlation === null ? null : await sha256(correlation),
      collectionBasis: event.kind === 'page_view' ? 'cookieless-baseline' : 'explicit-consent',
      occurredAt: event.timestamp,
      receivedAt: context.receivedAt,
      day: event.timestamp.slice(0, 10),
    }, 'invalid-event')
    const outcome = await this.#repository.append(Object.freeze(stored))
    return decision('accepted', outcome === 'duplicate')
  }

  /** Existing signup/site/publish/payment authorities inject this sink after their own transaction commits. */
  async recordAuthorityStage(raw: unknown): Promise<PublicMarketingCollectionResult> {
    const event = strict(PublicMarketingAuthorityEventSchema, raw, 'invalid-event')
    const occurredAt = timestamp(event.occurredAt, 'invalid-event')
    const receivedAt = validClock(this.#now).toISOString()
    const stored = strict(PublicMarketingStoredEventSchema, {
      eventIdSha256: await sha256(canonical(event)),
      kind: event.stage,
      routeClass: null,
      campaignSource: null,
      correlationSha256: await sha256(event.handoffCorrelation),
      collectionBasis: 'product-authority',
      occurredAt: event.occurredAt,
      receivedAt,
      day: new Date(occurredAt).toISOString().slice(0, 10),
    }, 'invalid-event')
    const outcome = await this.#repository.append(Object.freeze(stored))
    return decision('accepted', outcome === 'duplicate')
  }

  async report(rawRange: unknown): Promise<PublicMarketingReport> {
    const range = validatePublicMarketingRange(rawRange)
    return Object.freeze(strict(PublicMarketingReportSchema, await this.#repository.summarize(range), 'storage-unavailable'))
  }

  async enforceRetention(): Promise<PublicMarketingRetentionResult> {
    const now = validClock(this.#now)
    const rawBefore = new Date(now.getTime() - PUBLIC_MARKETING_RETENTION.rawEventDays * DAY_MS).toISOString()
    const aggregatesBefore = new Date(now.getTime() - PUBLIC_MARKETING_RETENTION.aggregateDays * DAY_MS).toISOString().slice(0, 10)
    const deleted = await this.#repository.purge(rawBefore, aggregatesBefore)
    return Object.freeze(strict(PublicMarketingRetentionResultSchema, {
      ...deleted,
      rawBefore,
      aggregatesBefore,
    }, 'storage-unavailable'))
  }
}
