import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import { PublicationRepositoryScopeSchema, type PublicationRepositoryScope } from '../publication/scope'

const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Email = Type.String({ minLength: 3, maxLength: 320, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' })
const Timestamp = Type.String({ format: 'date-time' })
const Sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' })
const Password = Type.String({ minLength: 12, maxLength: 1024 })

export const MemberConsentPurposeSchema = Type.Union([
  Type.Literal('terms'),
  Type.Literal('privacy'),
  Type.Literal('newsletter'),
  Type.Literal('analytics'),
])
export const MemberConsentActionSchema = Type.Union([Type.Literal('granted'), Type.Literal('withdrawn')])
export const MemberConsentInputSchema = Type.Object({
  purpose: MemberConsentPurposeSchema,
  action: MemberConsentActionSchema,
  noticeVersion: Type.String({ minLength: 1, maxLength: 100 }),
}, { additionalProperties: false })
export const MemberConsentEventSchema = Type.Object({
  eventId: Id,
  memberIdentityId: Id,
  purpose: MemberConsentPurposeSchema,
  action: MemberConsentActionSchema,
  noticeVersion: Type.String({ minLength: 1, maxLength: 100 }),
  source: Type.Union([Type.Literal('member-signup'), Type.Literal('member-profile'), Type.Literal('staff-import')]),
  sourceReceiptId: Type.Union([Id, Type.Null()]),
  occurredAt: Timestamp,
}, { additionalProperties: false })

export const MemberIdentitySchema = Type.Object({
  memberIdentityId: Id,
  email: Email,
  displayName: Type.String({ maxLength: 200 }),
  state: Type.Union([Type.Literal('active'), Type.Literal('disabled'), Type.Literal('activation-required')]),
  origin: Type.Union([Type.Literal('self-signup'), Type.Literal('staff-import')]),
  importReceiptId: Type.Union([Id, Type.Null()]),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}, { additionalProperties: false })

export const MemberCredentialRecordSchema = Type.Object({
  identity: MemberIdentitySchema,
  normalizedEmail: Email,
  passwordHash: Type.Union([Type.String({ minLength: 20, maxLength: 2048 }), Type.Null()]),
}, { additionalProperties: false })

export const MemberSessionRecordSchema = Type.Object({
  sessionId: Id,
  memberIdentityId: Id,
  tokenHashSha256: Sha256,
  createdAt: Timestamp,
  lastSeenAt: Timestamp,
  expiresAt: Timestamp,
  idleExpiresAt: Timestamp,
  reauthenticatedAt: Type.Union([Timestamp, Type.Null()]),
  revokedAt: Type.Union([Timestamp, Type.Null()]),
  userAgentHashSha256: Type.Union([Sha256, Type.Null()]),
  ipHashSha256: Type.Union([Sha256, Type.Null()]),
}, { additionalProperties: false })

export const MemberRegisterInputSchema = Type.Object({
  email: Email,
  password: Password,
  displayName: Type.String({ maxLength: 200 }),
  consents: Type.Array(MemberConsentInputSchema, { minItems: 1, maxItems: 8 }),
}, { additionalProperties: false })
export const MemberLoginInputSchema = Type.Object({ email: Email, password: Password }, { additionalProperties: false })
export const MemberReauthenticateInputSchema = Type.Object({ password: Password }, { additionalProperties: false })
export const EmptyMemberCommandSchema = Type.Object({}, { additionalProperties: false })

export const MemberPrincipalSchema = Type.Object({
  realm: Type.Literal('site-member'),
  memberIdentityId: Id,
  email: Email,
  displayName: Type.String({ maxLength: 200 }),
  sessionId: Id,
  permissions: Type.Array(Type.Union([Type.Literal('publication.member.read'), Type.Literal('publication.member.profile')])),
  staffRoles: Type.Tuple([]),
}, { additionalProperties: false })

export const MemberSessionEnvelopeSchema = Type.Object({
  authenticated: Type.Boolean(),
  principal: Type.Union([MemberPrincipalSchema, Type.Null()]),
  expiresAt: Type.Union([Timestamp, Type.Null()]),
}, { additionalProperties: false })

export const MemberImportEntrySchema = Type.Object({
  externalId: Type.String({ minLength: 1, maxLength: 255 }),
  email: Email,
  displayName: Type.String({ maxLength: 200 }),
  consents: Type.Array(MemberConsentInputSchema, { maxItems: 8 }),
}, { additionalProperties: false })
export const MemberImportCommandSchema = Type.Object({
  importId: Id,
  source: Type.Union([Type.Literal('ghost'), Type.Literal('csv'), Type.Literal('manual')]),
  sourceSha256: Sha256,
  entries: Type.Array(MemberImportEntrySchema, { maxItems: 10_000 }),
}, { additionalProperties: false })
export const StaffMemberImportReauthenticationSchema = Type.Object({
  realm: Type.Literal('staff'),
  purpose: Type.Literal('member-import'),
  staffUserId: Id,
  staffSessionId: Id,
  scope: PublicationRepositoryScopeSchema,
  authenticatedAt: Timestamp,
  expiresAt: Timestamp,
  proofId: Id,
}, { additionalProperties: false })
export const MemberImportReceiptSchema = Type.Object({
  importId: Id,
  source: Type.Union([Type.Literal('ghost'), Type.Literal('csv'), Type.Literal('manual')]),
  sourceSha256: Sha256,
  staffUserId: Id,
  staffSessionId: Id,
  reauthenticationProofId: Id,
  importedCount: Type.Integer({ minimum: 0, maximum: 10_000 }),
  skippedCount: Type.Integer({ minimum: 0, maximum: 10_000 }),
  createdAt: Timestamp,
}, { additionalProperties: false })

export type MemberIdentity = Readonly<Static<typeof MemberIdentitySchema>>
export type MemberCredentialRecord = Readonly<Static<typeof MemberCredentialRecordSchema>>
export type MemberSessionRecord = Readonly<Static<typeof MemberSessionRecordSchema>>
export type MemberConsentInput = Readonly<Static<typeof MemberConsentInputSchema>>
export type MemberConsentEvent = Readonly<Static<typeof MemberConsentEventSchema>>
export type MemberRegisterInput = Readonly<Static<typeof MemberRegisterInputSchema>>
export type MemberLoginInput = Readonly<Static<typeof MemberLoginInputSchema>>
export type MemberPrincipal = Readonly<Static<typeof MemberPrincipalSchema>>
export type MemberSessionEnvelope = Readonly<Static<typeof MemberSessionEnvelopeSchema>>
export type MemberImportCommand = Readonly<Static<typeof MemberImportCommandSchema>>
export type StaffMemberImportReauthentication = Readonly<Static<typeof StaffMemberImportReauthenticationSchema>>
export type MemberImportReceipt = Readonly<Static<typeof MemberImportReceiptSchema>>
export type MemberIdentityScope = PublicationRepositoryScope

export class MemberIdentityContractError extends Error {
  readonly contract: string
  constructor(contract: string) {
    super(`${contract} failed strict member identity validation.`)
    this.contract = contract
    this.name = 'MemberIdentityContractError'
  }
}

export function parseMemberIdentityContract<T extends TSchema>(contract: string, schema: T, value: unknown): Readonly<Static<T>> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new MemberIdentityContractError(contract)
  return Object.freeze(structuredClone(parsed.value))
}
