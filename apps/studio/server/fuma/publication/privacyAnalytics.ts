import {
  PublicationAnalyticsCollectRequestSchema,
  PublicationAnalyticsCollectionContextSchema,
  PublicationAnalyticsCollectionResultSchema,
  PublicationAnalyticsRangeSchema,
  PublicationAnalyticsRetentionResultSchema,
  PublicationPrivacyAnalyticsEventSchema,
  PublicationPrivacyAnalyticsExportSchema,
  PublicationPrivacyAnalyticsReportSchema,
  type PublicationAnalyticsCollectionContext,
  type PublicationAnalyticsCollectionResult,
  type PublicationAnalyticsRange,
  type PublicationAnalyticsRetentionResult,
  type PublicationPrivacyAnalyticsEvent,
  type PublicationPrivacyAnalyticsExport,
  type PublicationPrivacyAnalyticsReport,
} from '@core/fuma/publication/analyticsContracts'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { PublicationRepositoryScope } from './scope'
import type { PublicationIdAuthority } from './servicePorts'

export const PUBLICATION_ANALYTICS_RETENTION = Object.freeze({ rawEventDays: 30 as const, aggregateDays: 400 as const })
const DAY_MS = 86_400_000
const MAX_RANGE_DAYS = 366

export interface PublicationPrivacyAnalyticsRepository {
  append(scope: PublicationRepositoryScope, event: PublicationPrivacyAnalyticsEvent): Promise<boolean>
  summarize(scope: PublicationRepositoryScope, range: PublicationAnalyticsRange): Promise<PublicationPrivacyAnalyticsReport>
  purge(scope: PublicationRepositoryScope, rawBefore: string, aggregatesBefore: string): Promise<Readonly<{ rawEventsDeleted: number; aggregatesDeleted: number }>>
}

export class PublicationPrivacyAnalyticsError extends Error {
  readonly code: 'invalid-event' | 'invalid-range' | 'storage-conflict'
  constructor(code: PublicationPrivacyAnalyticsError['code'], message = 'Publication analytics request is invalid.') {
    super(message)
    this.name = 'PublicationPrivacyAnalyticsError'
    this.code = code
  }
}

function invalid(code: PublicationPrivacyAnalyticsError['code']): never {
  throw new PublicationPrivacyAnalyticsError(code)
}

function strict<TSchema extends import('@core/utils/typeboxHelpers').TSchema>(schema: TSchema, value: unknown, code: PublicationPrivacyAnalyticsError['code']): import('@core/utils/typeboxHelpers').Static<TSchema> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) return invalid(code)
  return parsed.value
}

function dateMs(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new PublicationPrivacyAnalyticsError('invalid-range')
  return parsed
}

export function validatePublicationAnalyticsRange(raw: unknown): PublicationAnalyticsRange {
  const range = strict(PublicationAnalyticsRangeSchema, raw, 'invalid-range')
  const days = (dateMs(range.to) - dateMs(range.from)) / DAY_MS
  if (!Number.isInteger(days) || days < 1 || days > MAX_RANGE_DAYS) throw new PublicationPrivacyAnalyticsError('invalid-range', 'Analytics range must be 1–366 UTC days and end-exclusive.')
  return Object.freeze(range)
}

function assertDimensions(value: import('@core/fuma/publication/analyticsContracts').PublicationAnalyticsCollectRequest): void {
  const read = value.kind === 'site-read' || value.kind === 'post-read'
  const newsletter = value.kind.startsWith('newsletter-')
  if (value.kind === 'site-read' && value.contentId !== null) throw new PublicationPrivacyAnalyticsError('invalid-event')
  if (value.kind === 'post-read' && value.contentId === null) throw new PublicationPrivacyAnalyticsError('invalid-event')
  if (!read && value.contentId !== null) throw new PublicationPrivacyAnalyticsError('invalid-event')
  if (newsletter !== (value.newsletterId !== null)) throw new PublicationPrivacyAnalyticsError('invalid-event')
  if (!newsletter && value.newsletterId !== null) throw new PublicationPrivacyAnalyticsError('invalid-event')
  if ((value.audience === 'public') !== (value.memberSource === 'none')) throw new PublicationPrivacyAnalyticsError('invalid-event')
}

function collectionDecision(context: PublicationAnalyticsCollectionContext): PublicationAnalyticsCollectionResult {
  const reason = context.globalPrivacyControl
    ? 'global-privacy-control'
    : context.doNotTrack
      ? 'do-not-track'
      : context.consent !== 'granted'
        ? 'consent-required'
        : context.bot !== 'human'
          ? 'bot-filtered'
          : 'accepted'
  return strict(PublicationAnalyticsCollectionResultSchema, { accepted: reason === 'accepted', reason }, 'invalid-event')
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function deterministicCsv(report: PublicationPrivacyAnalyticsReport): string {
  const rows: (readonly (string | number)[])[] = [
    ['section', 'dimension', 'site_reads', 'post_reads', 'public_reads', 'member_reads', 'opens', 'clicks', 'subscriptions', 'unsubscriptions', 'total_reads'],
    ['range', `${report.range.from}/${report.range.to}`, report.totals.siteReads, report.totals.postReads, report.totals.publicReads, report.totals.memberReads, report.totals.newsletterOpens, report.totals.newsletterClicks, report.totals.subscriptions, report.totals.unsubscriptions, report.totals.siteReads + report.totals.postReads],
    ...report.content.map((row) => ['content', row.contentId, 0, row.totalReads, row.publicReads, row.memberReads, 0, 0, 0, 0, row.totalReads] as const),
    ...report.referrers.map((row) => ['referrer', row.referrer, 0, 0, 0, 0, 0, 0, 0, 0, row.reads] as const),
    ...report.memberSources.map((row) => ['member-source', row.source, 0, 0, 0, row.reads, 0, 0, 0, 0, row.reads] as const),
    ...report.newsletters.map((row) => ['newsletter', row.newsletterId, 0, 0, 0, 0, row.opens, row.clicks, row.subscriptions, row.unsubscriptions, 0] as const),
  ]
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`
}

export class PublicationPrivacyAnalyticsService {
  readonly #repository: PublicationPrivacyAnalyticsRepository
  readonly #ids: PublicationIdAuthority
  readonly #now: () => Date

  constructor(input: Readonly<{ repository: PublicationPrivacyAnalyticsRepository; ids: PublicationIdAuthority; now?: () => Date }>) {
    this.#repository = input.repository
    this.#ids = input.ids
    this.#now = input.now ?? (() => new Date())
  }

  async collect(scope: PublicationRepositoryScope, raw: unknown, rawContext: unknown): Promise<PublicationAnalyticsCollectionResult> {
    const input = strict(PublicationAnalyticsCollectRequestSchema, raw, 'invalid-event')
    const context = strict(PublicationAnalyticsCollectionContextSchema, rawContext, 'invalid-event')
    assertDimensions(input)
    const decision = collectionDecision(context)
    if (!decision.accepted) return decision
    const event = strict(PublicationPrivacyAnalyticsEventSchema, {
      ...input,
      eventId: this.#ids.id('publication-analytics-event'),
      occurredAt: context.occurredAt,
      day: context.occurredAt.slice(0, 10),
      collectionBasis: 'explicit-consent',
    }, 'invalid-event')
    if (!await this.#repository.append(scope, event)) throw new PublicationPrivacyAnalyticsError('storage-conflict')
    return decision
  }

  async report(scope: PublicationRepositoryScope, rawRange: unknown): Promise<PublicationPrivacyAnalyticsReport> {
    const range = validatePublicationAnalyticsRange(rawRange)
    return strict(PublicationPrivacyAnalyticsReportSchema, await this.#repository.summarize(scope, range), 'storage-conflict')
  }

  async export(scope: PublicationRepositoryScope, rawRange: unknown): Promise<PublicationPrivacyAnalyticsExport> {
    const report = await this.report(scope, rawRange)
    const content = deterministicCsv(report)
    return strict(PublicationPrivacyAnalyticsExportSchema, {
      fileName: `publication-analytics-${report.range.from}-${report.range.to}.csv`,
      mediaType: 'text/csv; charset=utf-8',
      sha256: this.#ids.sha256(content),
      bytes: new TextEncoder().encode(content).byteLength,
      content,
    }, 'storage-conflict')
  }

  async enforceRetention(scope: PublicationRepositoryScope): Promise<PublicationAnalyticsRetentionResult> {
    const now = this.#now()
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new PublicationPrivacyAnalyticsError('storage-conflict')
    const rawBefore = new Date(now.getTime() - PUBLICATION_ANALYTICS_RETENTION.rawEventDays * DAY_MS).toISOString()
    const aggregatesBefore = new Date(now.getTime() - PUBLICATION_ANALYTICS_RETENTION.aggregateDays * DAY_MS).toISOString().slice(0, 10)
    const deleted = await this.#repository.purge(scope, rawBefore, aggregatesBefore)
    return strict(PublicationAnalyticsRetentionResultSchema, { ...deleted, rawBefore, aggregatesBefore }, 'storage-conflict')
  }
}
