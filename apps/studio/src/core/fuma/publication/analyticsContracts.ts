import { Type, type Static } from '@core/utils/typeboxHelpers'

export type DeepReadonlyAnalytics<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonlyAnalytics<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonlyAnalytics<T[Key]> }
    : T

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const DateSchema = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' })
const TimestampSchema = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?Z$' })
const CountSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })

export const PublicationAnalyticsEventKindSchema = Type.Union([
  Type.Literal('site-read'),
  Type.Literal('post-read'),
  Type.Literal('newsletter-open'),
  Type.Literal('newsletter-click'),
  Type.Literal('newsletter-subscribe'),
  Type.Literal('newsletter-unsubscribe'),
])
export const PublicationAnalyticsReferrerClassSchema = Type.Union([
  Type.Literal('direct'), Type.Literal('internal'), Type.Literal('newsletter'),
  Type.Literal('search'), Type.Literal('social'), Type.Literal('other'),
])
export const PublicationAnalyticsAudienceSchema = Type.Union([Type.Literal('public'), Type.Literal('member')])
export const PublicationAnalyticsMemberSourceSchema = Type.Union([
  Type.Literal('none'), Type.Literal('registered'), Type.Literal('complimentary'),
  Type.Literal('manual'), Type.Literal('paid'),
])

/** Public input is a closed set of coarse dimensions. It has no identity or request metadata fields. */
export const PublicationAnalyticsCollectRequestSchema = Type.Object({
  kind: PublicationAnalyticsEventKindSchema,
  contentId: Type.Union([IdSchema, Type.Null()]),
  referrer: PublicationAnalyticsReferrerClassSchema,
  audience: PublicationAnalyticsAudienceSchema,
  memberSource: PublicationAnalyticsMemberSourceSchema,
  newsletterId: Type.Union([IdSchema, Type.Null()]),
}, { additionalProperties: false })
export type PublicationAnalyticsCollectRequest = DeepReadonlyAnalytics<Static<typeof PublicationAnalyticsCollectRequestSchema>>

/** Supplied by a trusted public adapter, never accepted from the event body. */
export const PublicationAnalyticsCollectionContextSchema = Type.Object({
  occurredAt: TimestampSchema,
  consent: Type.Union([Type.Literal('granted'), Type.Literal('denied'), Type.Literal('unknown')]),
  globalPrivacyControl: Type.Boolean(),
  doNotTrack: Type.Boolean(),
  bot: Type.Union([Type.Literal('human'), Type.Literal('known-bot'), Type.Literal('suspected-bot')]),
}, { additionalProperties: false })
export type PublicationAnalyticsCollectionContext = DeepReadonlyAnalytics<Static<typeof PublicationAnalyticsCollectionContextSchema>>

export const PublicationAnalyticsCollectionResultSchema = Type.Object({
  accepted: Type.Boolean(),
  reason: Type.Union([
    Type.Literal('accepted'), Type.Literal('consent-required'),
    Type.Literal('global-privacy-control'), Type.Literal('do-not-track'), Type.Literal('bot-filtered'),
  ]),
}, { additionalProperties: false })
export type PublicationAnalyticsCollectionResult = DeepReadonlyAnalytics<Static<typeof PublicationAnalyticsCollectionResultSchema>>

/** Server-authored retained event. eventId is write idempotency only and is never a visitor key. */
export const PublicationPrivacyAnalyticsEventSchema = Type.Object({
  eventId: IdSchema,
  occurredAt: TimestampSchema,
  day: DateSchema,
  kind: PublicationAnalyticsEventKindSchema,
  contentId: Type.Union([IdSchema, Type.Null()]),
  referrer: PublicationAnalyticsReferrerClassSchema,
  audience: PublicationAnalyticsAudienceSchema,
  memberSource: PublicationAnalyticsMemberSourceSchema,
  newsletterId: Type.Union([IdSchema, Type.Null()]),
  collectionBasis: Type.Literal('explicit-consent'),
}, { additionalProperties: false })
export type PublicationPrivacyAnalyticsEvent = DeepReadonlyAnalytics<Static<typeof PublicationPrivacyAnalyticsEventSchema>>

export const PublicationAnalyticsRangeSchema = Type.Object({
  from: DateSchema,
  to: DateSchema,
}, { additionalProperties: false })
export type PublicationAnalyticsRange = DeepReadonlyAnalytics<Static<typeof PublicationAnalyticsRangeSchema>>

const TotalsSchema = Type.Object({
  siteReads: CountSchema,
  postReads: CountSchema,
  publicReads: CountSchema,
  memberReads: CountSchema,
  newsletterOpens: CountSchema,
  newsletterClicks: CountSchema,
  subscriptions: CountSchema,
  unsubscriptions: CountSchema,
}, { additionalProperties: false })
const ContentMetricSchema = Type.Object({
  contentId: IdSchema,
  publicReads: CountSchema,
  memberReads: CountSchema,
  totalReads: CountSchema,
}, { additionalProperties: false })
const ReferrerMetricSchema = Type.Object({ referrer: PublicationAnalyticsReferrerClassSchema, reads: CountSchema }, { additionalProperties: false })
const ReportMemberSourceSchema = Type.Union([Type.Literal('registered'), Type.Literal('complimentary'), Type.Literal('manual'), Type.Literal('paid')])
const MemberSourceMetricSchema = Type.Object({ source: ReportMemberSourceSchema, reads: CountSchema }, { additionalProperties: false })
const NewsletterMetricSchema = Type.Object({
  newsletterId: IdSchema,
  opens: CountSchema,
  clicks: CountSchema,
  subscriptions: CountSchema,
  unsubscriptions: CountSchema,
}, { additionalProperties: false })

export const PublicationPrivacyAnalyticsReportSchema = Type.Object({
  range: PublicationAnalyticsRangeSchema,
  retention: Type.Object({ rawEventDays: Type.Literal(30), aggregateDays: Type.Literal(400) }, { additionalProperties: false }),
  totals: TotalsSchema,
  content: Type.Array(ContentMetricSchema, { maxItems: 100 }),
  referrers: Type.Array(ReferrerMetricSchema, { maxItems: 6 }),
  memberSources: Type.Array(MemberSourceMetricSchema, { maxItems: 4 }),
  newsletters: Type.Array(NewsletterMetricSchema, { maxItems: 100 }),
}, { additionalProperties: false })
export type PublicationPrivacyAnalyticsReport = DeepReadonlyAnalytics<Static<typeof PublicationPrivacyAnalyticsReportSchema>>

export const PublicationPrivacyAnalyticsExportSchema = Type.Object({
  fileName: Type.String({ minLength: 1, maxLength: 160, pattern: '^[a-z0-9._-]+\\.csv$' }),
  mediaType: Type.Literal('text/csv; charset=utf-8'),
  sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  bytes: Type.Integer({ minimum: 1, maximum: 262144 }),
  content: Type.String({ minLength: 1, maxLength: 262144 }),
}, { additionalProperties: false })
export type PublicationPrivacyAnalyticsExport = DeepReadonlyAnalytics<Static<typeof PublicationPrivacyAnalyticsExportSchema>>

export const PublicationAnalyticsRetentionResultSchema = Type.Object({
  rawEventsDeleted: CountSchema,
  aggregatesDeleted: CountSchema,
  rawBefore: TimestampSchema,
  aggregatesBefore: DateSchema,
}, { additionalProperties: false })
export type PublicationAnalyticsRetentionResult = DeepReadonlyAnalytics<Static<typeof PublicationAnalyticsRetentionResultSchema>>
