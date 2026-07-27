import { EmailDocumentSchema } from '../email'
import { Type, type Static } from '../../utils/typeboxHelpers'
import type { DeepReadonly } from './contracts'

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const SlugSchema = Type.String({ minLength: 1, maxLength: 160, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' })
const TimestampSchema = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?Z$' })
const NullableTimestampSchema = Type.Union([TimestampSchema, Type.Null()])
const VersionSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
const Sha256Schema = Type.String({ minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' })
const EmailSchema = Type.String({ minLength: 3, maxLength: 320, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' })

export const EmailSettingsValuesSchema = Type.Object({
  senderName: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  senderEmail: Type.Optional(EmailSchema),
  replyToEmail: Type.Optional(EmailSchema),
  physicalAddress: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  brandColor: Type.Optional(Type.String({ pattern: '^#[0-9a-fA-F]{6}$' })),
  footerText: Type.Optional(Type.String({ maxLength: 1000 })),
}, { additionalProperties: false })
export type EmailSettingsValues = DeepReadonly<Static<typeof EmailSettingsValuesSchema>>

export const EmailSettingsLayerSchema = Type.Object({
  scope: Type.Union([Type.Literal('platform'), Type.Literal('organization'), Type.Literal('workspace'), Type.Literal('site'), Type.Literal('newsletter')]),
  scopeId: IdSchema,
  values: EmailSettingsValuesSchema,
  version: VersionSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type EmailSettingsLayer = DeepReadonly<Static<typeof EmailSettingsLayerSchema>>

export const ResolvedEmailSettingsSchema = Type.Object({
  values: Type.Object({
    senderName: Type.String({ minLength: 1, maxLength: 160 }),
    senderEmail: EmailSchema,
    replyToEmail: EmailSchema,
    physicalAddress: Type.String({ minLength: 1, maxLength: 500 }),
    brandColor: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }),
    footerText: Type.String({ maxLength: 1000 }),
  }, { additionalProperties: false }),
  provenance: Type.Record(Type.String(), Type.Object({ scope: Type.String(), scopeId: IdSchema, version: VersionSchema }, { additionalProperties: false })),
}, { additionalProperties: false })
export type ResolvedEmailSettings = DeepReadonly<Static<typeof ResolvedEmailSettingsSchema>>

export const NewsletterSchema = Type.Object({
  newsletterId: IdSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  slug: SlugSchema,
  description: Type.String({ maxLength: 500 }),
  defaultSegmentId: Type.Union([IdSchema, Type.Null()]),
  status: Type.Union([Type.Literal('active'), Type.Literal('paused'), Type.Literal('archived')]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type Newsletter = DeepReadonly<Static<typeof NewsletterSchema>>

export const NewsletterVersionSchema = Type.Object({
  versionId: IdSchema,
  newsletterId: IdSchema,
  ordinal: VersionSchema,
  subject: Type.String({ minLength: 1, maxLength: 300 }),
  previewText: Type.String({ maxLength: 200 }),
  document: EmailDocumentSchema,
  createdBy: IdSchema,
  createdAt: TimestampSchema,
  lockedAt: NullableTimestampSchema,
}, { additionalProperties: false })
export type NewsletterVersion = DeepReadonly<Static<typeof NewsletterVersionSchema>>

export const NewsletterFixtureKindSchema = Type.Union([
  Type.Literal('public'),
  Type.Literal('free-member'),
  Type.Literal('paid-member'),
])
export type NewsletterFixtureKind = Static<typeof NewsletterFixtureKindSchema>

export const NewsletterPreviewSchema = Type.Object({
  versionId: IdSchema,
  fixture: NewsletterFixtureKindSchema,
  fixtureLabel: Type.String({ minLength: 1, maxLength: 80 }),
  resolvedSubject: Type.String({ minLength: 1, maxLength: 300 }),
  html: Type.String({ minLength: 1, maxLength: 524288 }),
  text: Type.String({ maxLength: 524288 }),
  settings: ResolvedEmailSettingsSchema,
}, { additionalProperties: false })
export type NewsletterPreview = DeepReadonly<Static<typeof NewsletterPreviewSchema>>

export const NewsletterVersionComparisonSchema = Type.Object({
  newsletterId: IdSchema,
  fromVersionId: IdSchema,
  toVersionId: IdSchema,
  fromOrdinal: VersionSchema,
  toOrdinal: VersionSchema,
  changed: Type.Array(Type.Union([Type.Literal('subject'), Type.Literal('previewText'), Type.Literal('document')]), { maxItems: 3, uniqueItems: true }),
}, { additionalProperties: false })
export type NewsletterVersionComparison = DeepReadonly<Static<typeof NewsletterVersionComparisonSchema>>

export const NewsletterTestSendCommandSchema = Type.Object({
  versionId: IdSchema,
  fixture: Type.Optional(NewsletterFixtureKindSchema),
  recipient: EmailSchema,
  idempotencyKey: IdSchema,
}, { additionalProperties: false })
export type NewsletterTestSendCommand = DeepReadonly<Static<typeof NewsletterTestSendCommandSchema>>

export const CampaignStatusSchema = Type.Union([Type.Literal('draft'), Type.Literal('scheduled'), Type.Literal('sending'), Type.Literal('sent'), Type.Literal('cancelled'), Type.Literal('failed')])
export const CampaignSnapshotSchema = Type.Object({
  campaignId: IdSchema,
  newsletterId: IdSchema,
  versionId: IdSchema,
  segmentId: IdSchema,
  status: CampaignStatusSchema,
  audienceMemberIds: Type.Array(IdSchema, { maxItems: 100000, uniqueItems: true }),
  subject: Type.String({ minLength: 1, maxLength: 300 }),
  html: Type.String({ minLength: 1, maxLength: 524288 }),
  text: Type.String({ maxLength: 524288 }),
  sender: ResolvedEmailSettingsSchema,
  snapshotSha256: Sha256Schema,
  scheduledAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
}, { additionalProperties: false })
export type CampaignSnapshot = DeepReadonly<Static<typeof CampaignSnapshotSchema>>

export const CampaignDeliverySchema = Type.Object({
  deliveryId: IdSchema,
  campaignId: IdSchema,
  memberId: IdSchema,
  recipientEmail: EmailSchema,
  status: Type.Union([Type.Literal('queued'), Type.Literal('submitted'), Type.Literal('delivered'), Type.Literal('deferred'), Type.Literal('bounced'), Type.Literal('complained'), Type.Literal('suppressed'), Type.Literal('failed')]),
  providerMessageId: Type.Union([IdSchema, Type.Null()]),
  attempt: Type.Integer({ minimum: 0, maximum: 20 }),
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type CampaignDelivery = DeepReadonly<Static<typeof CampaignDeliverySchema>>

export const SuppressionSchema = Type.Object({
  suppressionId: IdSchema,
  emailHashSha256: Sha256Schema,
  reason: Type.Union([Type.Literal('unsubscribe'), Type.Literal('hard-bounce'), Type.Literal('complaint'), Type.Literal('manual')]),
  sourceId: IdSchema,
  createdAt: TimestampSchema,
}, { additionalProperties: false })
export type Suppression = DeepReadonly<Static<typeof SuppressionSchema>>

export const UnsubscribeTokenClaimsSchema = Type.Object({
  tokenId: IdSchema,
  memberId: IdSchema,
  newsletterId: Type.Union([IdSchema, Type.Null()]),
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
}, { additionalProperties: false })
export type UnsubscribeTokenClaims = DeepReadonly<Static<typeof UnsubscribeTokenClaimsSchema>>

export const OciEmailProviderEventSchema = Type.Object({
  eventId: IdSchema,
  eventType: Type.Union([Type.Literal('accepted'), Type.Literal('delivered'), Type.Literal('deferred'), Type.Literal('bounced'), Type.Literal('complained')]),
  providerMessageId: IdSchema,
  occurredAt: TimestampSchema,
  recipientEmail: EmailSchema,
  diagnosticCode: Type.Union([Type.String({ maxLength: 160 }), Type.Null()]),
}, { additionalProperties: false })
export type OciEmailProviderEvent = DeepReadonly<Static<typeof OciEmailProviderEventSchema>>

export const DeliverabilitySummarySchema = Type.Object({
  from: TimestampSchema,
  to: TimestampSchema,
  submitted: Type.Integer({ minimum: 0 }),
  delivered: Type.Integer({ minimum: 0 }),
  deferred: Type.Integer({ minimum: 0 }),
  bounced: Type.Integer({ minimum: 0 }),
  complained: Type.Integer({ minimum: 0 }),
  suppressed: Type.Integer({ minimum: 0 }),
  deliveryRate: Type.Number({ minimum: 0, maximum: 1 }),
  bounceRate: Type.Number({ minimum: 0, maximum: 1 }),
  complaintRate: Type.Number({ minimum: 0, maximum: 1 }),
}, { additionalProperties: false })
export type DeliverabilitySummary = DeepReadonly<Static<typeof DeliverabilitySummarySchema>>
