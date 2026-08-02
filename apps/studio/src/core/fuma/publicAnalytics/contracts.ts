import {
  PublicCampaignSourceSchema,
  PublicRouteClassSchema,
  PublicTimestampSchema,
} from '@fuma/public-contracts'
import { Type, type Static } from '@core/utils/typeboxHelpers'

export type DeepReadonlyMarketing<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonlyMarketing<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonlyMarketing<T[Key]> }
    : T

const TimestampSchema = PublicTimestampSchema
const DateSchema = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' })
const Sha256Schema = Type.String({ pattern: '^[a-f0-9]{64}$' })
const CountSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const BasisPointsSchema = Type.Integer({ minimum: 0, maximum: 10_000 })
const NullableCampaignSchema = Type.Union([PublicCampaignSourceSchema, Type.Null()])

export const PublicMarketingTrafficClassSchema = Type.Union([
  Type.Literal('human'),
  Type.Literal('known-bot'),
  Type.Literal('internal'),
])
export const PublicMarketingCollectionContextSchema = Type.Object({
  receivedAt: TimestampSchema,
  globalPrivacyControl: Type.Boolean(),
  doNotTrack: Type.Boolean(),
  traffic: PublicMarketingTrafficClassSchema,
}, { additionalProperties: false })
export type PublicMarketingCollectionContext = DeepReadonlyMarketing<Static<typeof PublicMarketingCollectionContextSchema>>

export const PublicMarketingCollectionResultSchema = Type.Union([
  Type.Object({
    accepted: Type.Literal(true),
    replayed: Type.Boolean(),
    reason: Type.Literal('accepted'),
  }, { additionalProperties: false }),
  Type.Object({
    accepted: Type.Literal(false),
    replayed: Type.Literal(false),
    reason: Type.Union([
      Type.Literal('consent-required'),
      Type.Literal('global-privacy-control'),
      Type.Literal('do-not-track'),
      Type.Literal('traffic-filtered'),
    ]),
  }, { additionalProperties: false }),
])
export type PublicMarketingCollectionResult = DeepReadonlyMarketing<Static<typeof PublicMarketingCollectionResultSchema>>

export const PublicMarketingAuthorityStageSchema = Type.Union([
  Type.Literal('signup'),
  Type.Literal('site'),
  Type.Literal('publish'),
  Type.Literal('paid'),
])
export type PublicMarketingAuthorityStage = Static<typeof PublicMarketingAuthorityStageSchema>

/** Emitted only by existing product authorities. It deliberately has no subject or resource identifier. */
export const PublicMarketingAuthorityEventSchema = Type.Object({
  eventId: Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }),
  stage: PublicMarketingAuthorityStageSchema,
  handoffCorrelation: Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }),
  occurredAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicMarketingAuthorityEvent = DeepReadonlyMarketing<Static<typeof PublicMarketingAuthorityEventSchema>>

export const PublicMarketingStoredEventKindSchema = Type.Union([
  Type.Literal('page-view'),
  Type.Literal('cta-selected'),
  Type.Literal('handoff'),
  PublicMarketingAuthorityStageSchema,
])
export type PublicMarketingStoredEventKind = Static<typeof PublicMarketingStoredEventKindSchema>

const StoredEventTimingSchema = {
  eventIdSha256: Sha256Schema,
  occurredAt: TimestampSchema,
  receivedAt: TimestampSchema,
  day: DateSchema,
} as const
const PublicStoredDimensionsSchema = {
  routeClass: PublicRouteClassSchema,
  campaignSource: NullableCampaignSchema,
} as const
const AuthorityStoredDimensionsSchema = {
  routeClass: Type.Null(),
  campaignSource: Type.Null(),
  correlationSha256: Sha256Schema,
  collectionBasis: Type.Literal('product-authority'),
} as const

/** Semantic storage invariants are closed in TypeBox as well as PostgreSQL. */
export const PublicMarketingStoredEventSchema = Type.Union([
  Type.Object({
    ...StoredEventTimingSchema,
    ...PublicStoredDimensionsSchema,
    kind: Type.Literal('page-view'),
    correlationSha256: Type.Null(),
    collectionBasis: Type.Literal('cookieless-baseline'),
  }, { additionalProperties: false }),
  Type.Object({
    ...StoredEventTimingSchema,
    ...PublicStoredDimensionsSchema,
    kind: Type.Literal('cta-selected'),
    correlationSha256: Type.Null(),
    collectionBasis: Type.Literal('explicit-consent'),
  }, { additionalProperties: false }),
  Type.Object({
    ...StoredEventTimingSchema,
    ...PublicStoredDimensionsSchema,
    kind: Type.Literal('handoff'),
    correlationSha256: Sha256Schema,
    collectionBasis: Type.Literal('explicit-consent'),
  }, { additionalProperties: false }),
  Type.Object({ ...StoredEventTimingSchema, ...AuthorityStoredDimensionsSchema, kind: Type.Literal('signup') }, { additionalProperties: false }),
  Type.Object({ ...StoredEventTimingSchema, ...AuthorityStoredDimensionsSchema, kind: Type.Literal('site') }, { additionalProperties: false }),
  Type.Object({ ...StoredEventTimingSchema, ...AuthorityStoredDimensionsSchema, kind: Type.Literal('publish') }, { additionalProperties: false }),
  Type.Object({ ...StoredEventTimingSchema, ...AuthorityStoredDimensionsSchema, kind: Type.Literal('paid') }, { additionalProperties: false }),
])
export type PublicMarketingStoredEvent = DeepReadonlyMarketing<Static<typeof PublicMarketingStoredEventSchema>>

export const PublicMarketingRangeSchema = Type.Object({
  from: DateSchema,
  to: DateSchema,
}, { additionalProperties: false })
export type PublicMarketingRange = DeepReadonlyMarketing<Static<typeof PublicMarketingRangeSchema>>

const FunnelCountsSchema = Type.Object({
  visits: CountSchema,
  signups: CountSchema,
  sites: CountSchema,
  publishes: CountSchema,
  paid: CountSchema,
}, { additionalProperties: false })

export const PublicMarketingReportSchema = Type.Object({
  range: PublicMarketingRangeSchema,
  retention: Type.Object({
    rawEventDays: Type.Literal(30),
    aggregateDays: Type.Literal(400),
  }, { additionalProperties: false }),
  totals: Type.Object({
    pageViews: CountSchema,
    ctaSelections: CountSchema,
    handoffs: CountSchema,
    signups: CountSchema,
    sites: CountSchema,
    publishes: CountSchema,
    paid: CountSchema,
  }, { additionalProperties: false }),
  funnel: FunnelCountsSchema,
  conversionBasisPoints: Type.Object({
    visitToSignup: BasisPointsSchema,
    signupToSite: BasisPointsSchema,
    siteToPublish: BasisPointsSchema,
    publishToPaid: BasisPointsSchema,
  }, { additionalProperties: false }),
  routes: Type.Array(Type.Object({
    routeClass: PublicRouteClassSchema,
    pageViews: CountSchema,
    handoffs: CountSchema,
  }, { additionalProperties: false }), { maxItems: 11 }),
  campaigns: Type.Array(Type.Object({
    campaignSource: PublicCampaignSourceSchema,
    pageViews: CountSchema,
    handoffs: CountSchema,
  }, { additionalProperties: false }), { maxItems: 4 }),
}, { additionalProperties: false })
export type PublicMarketingReport = DeepReadonlyMarketing<Static<typeof PublicMarketingReportSchema>>

export const PublicMarketingRetentionResultSchema = Type.Object({
  rawEventsDeleted: CountSchema,
  aggregatesDeleted: CountSchema,
  rawBefore: TimestampSchema,
  aggregatesBefore: DateSchema,
}, { additionalProperties: false })
export type PublicMarketingRetentionResult = DeepReadonlyMarketing<Static<typeof PublicMarketingRetentionResultSchema>>

const DailyCountSchema = {
  day: DateSchema,
  count: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
} as const
const PublicDailyDimensionsSchema = {
  routeClass: PublicRouteClassSchema,
  campaignSource: NullableCampaignSchema,
} as const
const AuthorityDailyDimensionsSchema = {
  routeClass: Type.Null(),
  campaignSource: Type.Null(),
  collectionBasis: Type.Literal('product-authority'),
} as const

export const PublicMarketingDailyRowSchema = Type.Union([
  Type.Object({ ...DailyCountSchema, ...PublicDailyDimensionsSchema, kind: Type.Literal('page-view'), collectionBasis: Type.Literal('cookieless-baseline') }, { additionalProperties: false }),
  Type.Object({ ...DailyCountSchema, ...PublicDailyDimensionsSchema, kind: Type.Literal('cta-selected'), collectionBasis: Type.Literal('explicit-consent') }, { additionalProperties: false }),
  Type.Object({ ...DailyCountSchema, ...PublicDailyDimensionsSchema, kind: Type.Literal('handoff'), collectionBasis: Type.Literal('explicit-consent') }, { additionalProperties: false }),
  Type.Object({ ...DailyCountSchema, ...AuthorityDailyDimensionsSchema, kind: Type.Literal('signup') }, { additionalProperties: false }),
  Type.Object({ ...DailyCountSchema, ...AuthorityDailyDimensionsSchema, kind: Type.Literal('site') }, { additionalProperties: false }),
  Type.Object({ ...DailyCountSchema, ...AuthorityDailyDimensionsSchema, kind: Type.Literal('publish') }, { additionalProperties: false }),
  Type.Object({ ...DailyCountSchema, ...AuthorityDailyDimensionsSchema, kind: Type.Literal('paid') }, { additionalProperties: false }),
])
export type PublicMarketingDailyRow = DeepReadonlyMarketing<Static<typeof PublicMarketingDailyRowSchema>>
