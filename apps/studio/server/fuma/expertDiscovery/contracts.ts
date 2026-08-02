import { PublicExpertSchema, PublicProfileSchema } from '@fuma/public-contracts'
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Timestamp = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$' })
const Sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' })
const PublicRevision = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
export const ExpertIdSchema = Id

export const ExpertSiteScopeSchema = Type.Object({
  platformId: Id,
  organizationId: Id,
  workspaceId: Id,
  siteId: Id,
  ownerKey: Id,
  ownerGeneration: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
export type ExpertSiteScope = Static<typeof ExpertSiteScopeSchema>

export const ExpertAvailabilitySchema = Type.Union([
  Type.Literal('available'),
  Type.Literal('limited'),
  Type.Literal('unavailable'),
])
export type ExpertAvailability = Static<typeof ExpertAvailabilitySchema>

export const ExpertProfileRecordSchema = Type.Object({
  expertId: Id,
  organizationId: Id,
  sourceScope: ExpertSiteScopeSchema,
  supportedProfiles: Type.Array(PublicProfileSchema, { minItems: 1, maxItems: 2, uniqueItems: true }),
  public: PublicExpertSchema,
  availability: ExpertAvailabilitySchema,
  approvedReleaseId: Id,
  optedIn: Type.Boolean(),
  consentVersion: PublicRevision,
  publicRevision: PublicRevision,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}, { additionalProperties: false })
export type ExpertProfileRecord = Static<typeof ExpertProfileRecordSchema>

export const ApproveExpertReleaseCommandSchema = Type.Object({
  expertId: Id,
  releaseId: Id,
  submitterId: Id,
  supportedProfiles: Type.Array(PublicProfileSchema, { minItems: 1, maxItems: 2, uniqueItems: true }),
  public: Type.Omit(PublicExpertSchema, ['approvedAt']),
  availability: ExpertAvailabilitySchema,
  artifactObjectKey: Type.String({ minLength: 12, maxLength: 512, pattern: '^experts/releases/[A-Za-z0-9._/-]+$' }),
  artifactHashSha256: Sha256,
  expertConsent: Type.Object({ partyId: Id, version: Type.Integer({ minimum: 1 }), consentedAt: Timestamp }, { additionalProperties: false }),
  siteOwnerConsent: Type.Object({ partyId: Id, version: Type.Integer({ minimum: 1 }), consentedAt: Timestamp }, { additionalProperties: false }),
}, { additionalProperties: false })
export type ApproveExpertReleaseCommand = Static<typeof ApproveExpertReleaseCommandSchema>

export const SetExpertVisibilityCommandSchema = Type.Object({
  expertId: Id,
  optedIn: Type.Boolean(),
  availability: ExpertAvailabilitySchema,
  expectedPublicRevision: PublicRevision,
}, { additionalProperties: false })
export type SetExpertVisibilityCommand = Static<typeof SetExpertVisibilityCommandSchema>

export const ExpertPluginLinkSchema = Type.Object({
  expertId: Id,
  pluginId: Id,
  publisherOrganizationId: Id,
  verificationHashSha256: Sha256,
  verifiedAt: Timestamp,
  revokedAt: Type.Union([Timestamp, Type.Null()]),
}, { additionalProperties: false })
export type ExpertPluginLink = Static<typeof ExpertPluginLinkSchema>

export const LinkExpertPluginCommandSchema = Type.Object({
  expertId: Id,
  pluginId: Id,
  expectedPublicRevision: PublicRevision,
}, { additionalProperties: false })
export type LinkExpertPluginCommand = Static<typeof LinkExpertPluginCommandSchema>

export const TransferExpertCommandSchema = Type.Object({
  expertId: Id,
  transferId: Id,
  expectedPublicRevision: PublicRevision,
}, { additionalProperties: false })
export type TransferExpertCommand = Static<typeof TransferExpertCommandSchema>

export const ExpertSearchQuerySchema = Type.Object({
  profile: Type.Optional(PublicProfileSchema),
  expertType: Type.Optional(PublicExpertSchema.properties.expertType),
  skill: Type.Optional(Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' })),
  location: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  limit: Type.Integer({ minimum: 1, maximum: 50 }),
}, { additionalProperties: false })
export type ExpertSearchQuery = Static<typeof ExpertSearchQuerySchema>

export const ExpertSearchResultSchema = Type.Object({
  items: Type.Array(PublicExpertSchema, { maxItems: 50 }),
  datasetVersion: Type.String({ minLength: 10, maxLength: 100, pattern: '^experts:sha256:[a-f0-9]{64}$' }),
}, { additionalProperties: false })
export type ExpertSearchResult = Static<typeof ExpertSearchResultSchema>

export const SubmitExpertInquiryCommandSchema = Type.Object({
  inquiryId: Id,
  expertId: Id,
  message: Type.String({ minLength: 20, maxLength: 8_000 }),
}, { additionalProperties: false })
export type SubmitExpertInquiryCommand = Static<typeof SubmitExpertInquiryCommandSchema>

export const ExpertInquiryReceiptSchema = Type.Object({
  inquiryId: Id,
  expertId: Id,
  sourceProfile: PublicProfileSchema,
  state: Type.Literal('queued'),
  messageBytes: Type.Integer({ minimum: 1, maximum: 16_384 }),
  encryptedObjectKey: Type.String({ minLength: 12, maxLength: 512, pattern: '^experts/inquiries/[A-Za-z0-9._/-]+$' }),
  consentVersion: Type.Integer({ minimum: 1 }),
  createdAt: Timestamp,
  expiresAt: Timestamp,
}, { additionalProperties: false })
export type ExpertInquiryReceipt = Static<typeof ExpertInquiryReceiptSchema>

export const ExpertManagementProjectionSchema = Type.Object({
  profile: Type.Union([ExpertProfileRecordSchema, Type.Null()]),
  pluginLinks: Type.Array(ExpertPluginLinkSchema, { maxItems: 100 }),
  inquiryCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  integration: Type.Object({
    ownerTicket: Type.Literal('FUMA-073'),
    mounted: Type.Literal(true),
    schemaAuthority: Type.Literal('000037_operations_experts_transfer'),
  }, { additionalProperties: false }),
}, { additionalProperties: false })
export type ExpertManagementProjection = Static<typeof ExpertManagementProjectionSchema>

export const EXPERT_DISCOVERY_INTEGRATION = Object.freeze({
  ownerTicket: 'FUMA-073' as const,
  mounted: true as const,
  schemaAuthority: '000037_operations_experts_transfer' as const,
})

export class ExpertDiscoveryError extends Error {
  readonly code: 'invalid-contract' | 'authority-denied' | 'not-found' | 'conflict' | 'hidden' | 'moderated' | 'inquiry-denied' | 'storage-denied'
  constructor(
    code: ExpertDiscoveryError['code'],
    message: string,
  ) { super(message); this.name = 'ExpertDiscoveryError'; this.code = code }
}

export function parseExpertContract<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (parsed.ok) return structuredClone(parsed.value)
  const first = parsed.errors[0]
  throw new ExpertDiscoveryError('invalid-contract', `${label} failed strict TypeBox validation${first ? ` at ${first.path || '/'}: ${first.message}` : ''}.`)
}
