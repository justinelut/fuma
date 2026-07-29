import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const Id = Type.String({
  minLength: 1,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
})
const Timestamp = Type.String({
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$',
})
const Email = Type.String({ minLength: 3, maxLength: 320, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' })

export const PublicationMerchantScopeSchema = Type.Object({
  platformId: Id,
  organizationId: Id,
  workspaceId: Id,
  siteId: Id,
  ownerKey: Id,
  ownerGeneration: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false })
export type PublicationMerchantScope = Readonly<Static<typeof PublicationMerchantScopeSchema>>

export const PublicationPayerAuthoritySchema = Type.Object({
  scope: PublicationMerchantScopeSchema,
  memberId: Id,
  memberSessionId: Id,
  email: Email,
}, { additionalProperties: false })
export type PublicationPayerAuthority = Readonly<Static<typeof PublicationPayerAuthoritySchema>>

export const MembershipChannelSchema = Type.Union([
  Type.Literal('card'),
  Type.Literal('mobile_money'),
])
export type MembershipChannel = Static<typeof MembershipChannelSchema>
export const MobileMoneyProviderSchema = Type.Union([
  Type.Literal('safaricom'),
  Type.Literal('airtel'),
])
export type MobileMoneyProvider = Static<typeof MobileMoneyProviderSchema>

export const MembershipPurchaseRequestSchema = Type.Object({
  requestId: Id,
  tierId: Id,
  channel: MembershipChannelSchema,
  mobileProvider: Type.Union([MobileMoneyProviderSchema, Type.Null()]),
  renewalOfMembershipId: Type.Union([Id, Type.Null()]),
  renewalConfirmationId: Type.Union([Id, Type.Null()]),
}, { additionalProperties: false })
export type MembershipPurchaseRequest = Readonly<Static<typeof MembershipPurchaseRequestSchema>>

export const MembershipOfferSchema = Type.Object({
  tierId: Id,
  amountMinor: Type.Integer({ minimum: 1, maximum: 1_000_000_000 }),
  currency: Type.Literal('KES'),
  periodDays: Type.Integer({ minimum: 1, maximum: 366 }),
  graceDays: Type.Integer({ minimum: 0, maximum: 31 }),
  active: Type.Literal(true),
}, { additionalProperties: false })
export type MembershipOffer = Readonly<Static<typeof MembershipOfferSchema>>

export const PublicationMembershipMetadataSchema = Type.Object({
  purchaseId: Id,
  platformId: Id,
  organizationId: Id,
  workspaceId: Id,
  siteId: Id,
  ownerKey: Id,
  ownerGeneration: Type.Integer({ minimum: 1 }),
  memberId: Id,
  tierId: Id,
  credentialId: Id,
  credentialVersion: Type.Integer({ minimum: 1 }),
  amountMinor: Type.Integer({ minimum: 1, maximum: 1_000_000_000 }),
  currency: Type.Literal('KES'),
  periodDays: Type.Integer({ minimum: 1, maximum: 366 }),
  graceDays: Type.Integer({ minimum: 0, maximum: 31 }),
  channel: MembershipChannelSchema,
  mobileProvider: Type.Union([MobileMoneyProviderSchema, Type.Null()]),
  renewalOfMembershipId: Type.Union([Id, Type.Null()]),
  renewalConfirmationId: Type.Union([Id, Type.Null()]),
}, { additionalProperties: false })
export type PublicationMembershipMetadata = Readonly<Static<typeof PublicationMembershipMetadataSchema>>

export const CustomerMerchantCredentialEnvelopeSchema = Type.Object({
  ciphertext: Type.String({ minLength: 16, maxLength: 16_384 }),
  keyId: Id,
}, { additionalProperties: false })
export type CustomerMerchantCredentialEnvelope = Readonly<Static<typeof CustomerMerchantCredentialEnvelopeSchema>>

export const CustomerMerchantCredentialSchema = Type.Object({
  credentialId: Id,
  scope: Type.Literal('customer_merchant'),
  merchantScope: PublicationMerchantScopeSchema,
  version: Type.Integer({ minimum: 1 }),
  envelope: CustomerMerchantCredentialEnvelopeSchema,
  state: Type.Union([
    Type.Literal('active'),
    Type.Literal('rekey-required'),
    Type.Literal('detached'),
  ]),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}, { additionalProperties: false })
export type CustomerMerchantCredential = Readonly<Static<typeof CustomerMerchantCredentialSchema>>

export const CustomerMerchantCredentialViewSchema = Type.Object({
  credentialId: Id,
  scope: Type.Literal('customer_merchant'),
  merchantScope: PublicationMerchantScopeSchema,
  version: Type.Integer({ minimum: 1 }),
  state: CustomerMerchantCredentialSchema.properties.state,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}, { additionalProperties: false })
export type CustomerMerchantCredentialView = Readonly<Static<typeof CustomerMerchantCredentialViewSchema>>

export const CustomerMerchantSecretSchema = Type.Object({
  scope: Type.Literal('customer_merchant'),
  publicKey: Type.String({ minLength: 1, maxLength: 512 }),
  secretKey: Type.String({ minLength: 1, maxLength: 512 }),
}, { additionalProperties: false })
export type CustomerMerchantSecret = Readonly<Static<typeof CustomerMerchantSecretSchema>>

export const MembershipPurchaseSchema = Type.Object({
  metadata: PublicationMembershipMetadataSchema,
  reference: Type.Union([Type.String({ minLength: 16, maxLength: 100 }), Type.Null()]),
  // Browser checkouts have an HTTPS URL; server-side card recurrence intentionally has none.
  authorizationUrl: Type.Union([Type.String({ minLength: 1, maxLength: 2_048 }), Type.Null()]),
  state: Type.Union([
    Type.Literal('prepared'),
    Type.Literal('initialized'),
    Type.Literal('settled'),
    Type.Literal('failed'),
  ]),
  createdAt: Timestamp,
  settledAt: Type.Union([Timestamp, Type.Null()]),
}, { additionalProperties: false })
export type MembershipPurchase = Readonly<Static<typeof MembershipPurchaseSchema>>

export const CardRenewalCommandSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  scope: PublicationMerchantScopeSchema,
  memberId: Id,
  membershipId: Id,
  expectedRevision: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false })
export type CardRenewalCommand = Readonly<Static<typeof CardRenewalCommandSchema>>

export const AttachCustomerMerchantCredentialRequestSchema = Type.Object({
  credentialId: Id,
  secret: CustomerMerchantSecretSchema,
}, { additionalProperties: false })
export type AttachCustomerMerchantCredentialRequest = Readonly<
  Static<typeof AttachCustomerMerchantCredentialRequestSchema>
>

export const PaidMembershipSchema = Type.Object({
  membershipId: Id,
  scope: PublicationMerchantScopeSchema,
  memberId: Id,
  tierId: Id,
  accessFrom: Timestamp,
  accessUntil: Timestamp,
  graceUntil: Timestamp,
  renewal: Type.Union([
    Type.Literal('supported-card-recurring'),
    Type.Literal('manual-mobile-money'),
  ]),
  state: Type.Union([Type.Literal('active'), Type.Literal('grace'), Type.Literal('expired')]),
  providerReference: Type.String({ minLength: 16, maxLength: 100 }),
  providerTransactionId: Id,
  credentialId: Id,
  credentialVersion: Type.Integer({ minimum: 1 }),
  revision: Type.Integer({ minimum: 1 }),
  updatedAt: Timestamp,
}, { additionalProperties: false })
export type PaidMembership = Readonly<Static<typeof PaidMembershipSchema>>

export const MembershipInitializationSchema = Type.Object({
  purchaseId: Id,
  reference: Type.String({ minLength: 16, maxLength: 100 }),
  authorizationUrl: Type.String({ minLength: 1, maxLength: 2_048 }),
  channel: MembershipChannelSchema,
  renewalMode: Type.Union([
    Type.Literal('supported-card-recurring'),
    Type.Literal('manual-mobile-money'),
  ]),
}, { additionalProperties: false })
export type MembershipInitialization = Readonly<Static<typeof MembershipInitializationSchema>>

export const ReconcileRequestSchema = Type.Object({
  purchaseId: Id,
  reference: Type.String({ minLength: 16, maxLength: 100 }),
}, { additionalProperties: false })
export type ReconcileRequest = Readonly<Static<typeof ReconcileRequestSchema>>

export const CustomerPaymentLifecycleJobSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  limit: Type.Integer({ minimum: 1, maximum: 100 }),
  cursor: Type.Union([Id, Type.Null()]),
}, { additionalProperties: false })
export type CustomerPaymentLifecycleJob = Readonly<Static<typeof CustomerPaymentLifecycleJobSchema>>

export const CredentialTransferChoiceSchema = Type.Object({
  transferId: Id,
  source: PublicationMerchantScopeSchema,
  destination: PublicationMerchantScopeSchema,
  choice: Type.Union([Type.Literal('rekey'), Type.Literal('detach')]),
  recordedAt: Timestamp,
}, { additionalProperties: false })
export type CredentialTransferChoice = Readonly<Static<typeof CredentialTransferChoiceSchema>>

export function strictValue<T extends TSchema>(schema: T, candidate: unknown, label: string): Static<T> {
  const parsed = safeParseValue(schema, candidate)
  if (!parsed.ok) throw new TypeError(`${label} failed its strict TypeBox contract.`)
  return parsed.value
}

export function merchantScopeKey(scope: PublicationMerchantScope): string {
  return [scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.ownerGeneration].join(':')
}
