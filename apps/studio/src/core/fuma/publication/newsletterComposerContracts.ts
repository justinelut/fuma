import { EmailDocumentSchema } from '../email'
import { ResolvedEmailSettingsV2Schema } from './emailSettingsContracts'
import { Type, safeParseValue, type Static, type TSchema } from '../../utils/typeboxHelpers'
import type { DeepReadonly } from './contracts'

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const SlugSchema = Type.String({ minLength: 1, maxLength: 160, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' })
const TimestampSchema = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?Z$' })
const EmailSchema = Type.String({ minLength: 3, maxLength: 320, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' })
const VersionSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
const SequenceSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })

export const NewsletterAudienceQuerySchema = Type.Object({
  segmentIds: Type.Array(IdSchema, { minItems: 1, maxItems: 8, uniqueItems: true }),
  match: Type.Union([Type.Literal('all'), Type.Literal('any')]),
  subscription: Type.Literal('subscribed'),
  scanLimit: Type.Integer({ minimum: 1, maximum: 500 }),
}, { additionalProperties: false })
export type NewsletterAudienceQuery = DeepReadonly<Static<typeof NewsletterAudienceQuerySchema>>

export const PublicationNewsletterProfileSchema = Type.Object({
  newsletterId: IdSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  slug: SlugSchema,
  description: Type.String({ maxLength: 500 }),
  status: Type.Union([Type.Literal('active'), Type.Literal('paused'), Type.Literal('archived')]),
  defaultSegmentId: Type.Union([IdSchema, Type.Null()]),
  webContentId: Type.Union([IdSchema, Type.Null()]),
  version: VersionSchema,
  createdBy: IdSchema,
  createdAt: TimestampSchema,
  updatedBy: IdSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type PublicationNewsletterProfile = DeepReadonly<Static<typeof PublicationNewsletterProfileSchema>>

export const NewsletterProfileCommandSchema = Type.Object({
  newsletterId: IdSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  slug: SlugSchema,
  description: Type.String({ maxLength: 500 }),
  status: Type.Union([Type.Literal('active'), Type.Literal('paused'), Type.Literal('archived')]),
  defaultSegmentId: Type.Union([IdSchema, Type.Null()]),
  webContentId: Type.Union([IdSchema, Type.Null()]),
  expectedVersion: Type.Union([VersionSchema, Type.Null()]),
}, { additionalProperties: false })
export type NewsletterProfileCommand = DeepReadonly<Static<typeof NewsletterProfileCommandSchema>>

export const NewsletterComposerDraftSchema = Type.Object({
  draftId: IdSchema,
  newsletterId: IdSchema,
  sequence: VersionSchema,
  subject: Type.String({ minLength: 1, maxLength: 300 }),
  previewText: Type.String({ maxLength: 200 }),
  document: EmailDocumentSchema,
  audience: NewsletterAudienceQuerySchema,
  updatedBy: IdSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type NewsletterComposerDraft = DeepReadonly<Static<typeof NewsletterComposerDraftSchema>>

export const NewsletterDraftAutosaveCommandSchema = Type.Object({
  newsletterId: IdSchema,
  draftId: Type.Union([IdSchema, Type.Null()]),
  mutationId: IdSchema,
  expectedSequence: SequenceSchema,
  subject: Type.String({ minLength: 1, maxLength: 300 }),
  previewText: Type.String({ maxLength: 200 }),
  document: EmailDocumentSchema,
  audience: NewsletterAudienceQuerySchema,
}, { additionalProperties: false })
export type NewsletterDraftAutosaveCommand = DeepReadonly<Static<typeof NewsletterDraftAutosaveCommandSchema>>

export const NewsletterAudienceEstimateSchema = Type.Object({
  newsletterId: IdSchema,
  audience: NewsletterAudienceQuerySchema,
  estimatedSubscribed: Type.Integer({ minimum: 0, maximum: 500 }),
  evaluatedMembers: Type.Integer({ minimum: 0, maximum: 500 }),
  candidateMembers: Type.Integer({ minimum: 0 }),
  countKind: Type.Union([Type.Literal('exact'), Type.Literal('lower-bound')]),
  segmentVersions: Type.Array(Type.Object({ segmentId: IdSchema, version: VersionSchema }, { additionalProperties: false }), { minItems: 1, maxItems: 8 }),
  estimatedAt: TimestampSchema,
}, { additionalProperties: false })
export type NewsletterAudienceEstimate = DeepReadonly<Static<typeof NewsletterAudienceEstimateSchema>>

export const NewsletterSenderVerificationSchema = Type.Union([
  Type.Object({
    senderEmail: EmailSchema,
    state: Type.Literal('verified'),
    providerIdentityId: IdSchema,
    verifiedAt: TimestampSchema,
    checkedAt: TimestampSchema,
  }, { additionalProperties: false }),
  Type.Object({
    senderEmail: EmailSchema,
    state: Type.Union([Type.Literal('pending'), Type.Literal('failed'), Type.Literal('revoked')]),
    providerIdentityId: IdSchema,
    verifiedAt: Type.Null(),
    checkedAt: TimestampSchema,
  }, { additionalProperties: false }),
])
export type NewsletterSenderVerification = DeepReadonly<Static<typeof NewsletterSenderVerificationSchema>>

export const NewsletterComposerPreviewSchema = Type.Object({
  newsletterId: IdSchema,
  draftId: IdSchema,
  sequence: VersionSchema,
  subject: Type.String({ minLength: 1, maxLength: 300 }),
  html: Type.String({ minLength: 1, maxLength: 524288 }),
  text: Type.String({ maxLength: 524288 }),
  settings: ResolvedEmailSettingsV2Schema,
}, { additionalProperties: false })
export type NewsletterComposerPreview = DeepReadonly<Static<typeof NewsletterComposerPreviewSchema>>

export const NewsletterSendReadinessSchema = Type.Object({
  newsletter: PublicationNewsletterProfileSchema,
  draft: NewsletterComposerDraftSchema,
  settings: ResolvedEmailSettingsV2Schema,
  senderVerification: Type.Union([NewsletterSenderVerificationSchema, Type.Null()]),
  audienceEstimate: NewsletterAudienceEstimateSchema,
  canSend: Type.Boolean(),
  reasons: Type.Array(Type.Union([
    Type.Literal('newsletter-not-active'),
    Type.Literal('sender-not-verified'),
    Type.Literal('audience-estimate-capped'),
    Type.Literal('audience-empty'),
    Type.Literal('linked-web-content-unpublished'),
  ]), { maxItems: 5, uniqueItems: true }),
}, { additionalProperties: false })
export type NewsletterSendReadiness = DeepReadonly<Static<typeof NewsletterSendReadinessSchema>>

export const NewsletterListResponseSchema = Type.Object({
  newsletters: Type.Array(PublicationNewsletterProfileSchema, { maxItems: 200 }),
}, { additionalProperties: false })
export const NewsletterDetailResponseSchema = Type.Object({
  newsletter: PublicationNewsletterProfileSchema,
  draft: Type.Union([NewsletterComposerDraftSchema, Type.Null()]),
  settings: ResolvedEmailSettingsV2Schema,
  senderVerification: Type.Union([NewsletterSenderVerificationSchema, Type.Null()]),
}, { additionalProperties: false })
export const NewsletterAudienceEstimateCommandSchema = Type.Object({
  newsletterId: IdSchema,
  audience: NewsletterAudienceQuerySchema,
}, { additionalProperties: false })
export const NewsletterIdCommandSchema = Type.Object({ newsletterId: IdSchema }, { additionalProperties: false })

export function parseNewsletterComposerContract<T extends TSchema>(boundary: string, schema: T, value: unknown): DeepReadonly<Static<T>> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new NewsletterComposerContractError(boundary)
  return deepFreeze(structuredClone(parsed.value)) as DeepReadonly<Static<T>>
}

export class NewsletterComposerContractError extends Error {
  readonly code = 'invalid-contract' as const
  constructor(boundary: string) {
    super(`${boundary} failed validation.`)
    this.name = 'NewsletterComposerContractError'
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
