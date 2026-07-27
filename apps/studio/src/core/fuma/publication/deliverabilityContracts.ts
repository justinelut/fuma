import { Type, type Static } from '../../utils/typeboxHelpers'
import type { DeepReadonly } from './contracts'

const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Timestamp = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?Z$' })
const Sha256 = Type.String({ minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' })
const Email = Type.String({ minLength: 3, maxLength: 320, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' })
const Domain = Type.String({ minLength: 3, maxLength: 253, pattern: '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$' })

export const ScopedEmailSuppressionSchema = Type.Object({
  suppressionId: Id,
  level: Type.Union([Type.Literal('global'), Type.Literal('site'), Type.Literal('newsletter')]),
  newsletterId: Type.Union([Id, Type.Null()]),
  emailHashSha256: Sha256,
  reason: Type.Union([Type.Literal('unsubscribe'), Type.Literal('hard-bounce'), Type.Literal('complaint'), Type.Literal('manual')]),
  sourceId: Id,
  createdAt: Timestamp,
}, { additionalProperties: false })
export type ScopedEmailSuppression = DeepReadonly<Static<typeof ScopedEmailSuppressionSchema>>

const VerificationStatus = Type.Union([Type.Literal('pending'), Type.Literal('verified'), Type.Literal('failed')])
export const SenderDomainHealthSchema = Type.Object({
  domainId: Id,
  domain: Domain,
  approvedSenderEmails: Type.Array(Email, { uniqueItems: true, maxItems: 100 }),
  spf: VerificationStatus,
  dkim: VerificationStatus,
  dmarc: VerificationStatus,
  productionReady: Type.Boolean(),
  diagnostics: Type.Array(Type.String({ minLength: 1, maxLength: 240 }), { maxItems: 20 }),
  checkedAt: Timestamp,
}, { additionalProperties: false })
export type SenderDomainHealth = DeepReadonly<Static<typeof SenderDomainHealthSchema>>

export const PublicationEngagementConsentSchema = Type.Object({
  memberId: Id,
  state: Type.Union([Type.Literal('opted-in'), Type.Literal('opted-out')]),
  consentVersion: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  retentionDays: Type.Integer({ minimum: 1, maximum: 400 }),
  updatedAt: Timestamp,
}, { additionalProperties: false })
export type PublicationEngagementConsent = DeepReadonly<Static<typeof PublicationEngagementConsentSchema>>

export const PublicationEngagementEventSchema = Type.Object({
  eventId: Id,
  kind: Type.Union([Type.Literal('open'), Type.Literal('click')]),
  campaignId: Id,
  memberId: Id,
  targetUrlHashSha256: Type.Union([Sha256, Type.Null()]),
  occurredAt: Timestamp,
  expiresAt: Timestamp,
}, { additionalProperties: false })
export type PublicationEngagementEvent = DeepReadonly<Static<typeof PublicationEngagementEventSchema>>

export const PublicationEngagementSummarySchema = Type.Object({
  from: Timestamp,
  to: Timestamp,
  opens: Type.Integer({ minimum: 0 }),
  clicks: Type.Integer({ minimum: 0 }),
  uniqueMembers: Type.Integer({ minimum: 0 }),
  optedOutMembers: Type.Integer({ minimum: 0 }),
  expiredPurged: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false })
export type PublicationEngagementSummary = DeepReadonly<Static<typeof PublicationEngagementSummarySchema>>
