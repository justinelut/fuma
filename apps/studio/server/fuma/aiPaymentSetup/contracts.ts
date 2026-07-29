import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import { SiteAiScopeSchema } from '../siteAi/contracts'

const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Timestamp = Type.String({ format: 'date-time' })
const Sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' })
const Token = Type.String({ minLength: 43, maxLength: 43, pattern: '^[A-Za-z0-9_-]{43}$' })
const Permission = Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z][a-z0-9.:-]+$' })

export const AI_PAYMENT_PLUGIN_PACKAGE_ID = 'fuma.customer-payments'
export const AI_PAYMENT_PLUGIN_EXACT_VERSION = '1.0.0'
export const AI_PAYMENT_FEE_DISCLOSURE_VERSION = 'fuma-customer-payments-fees-v1'
export const AI_PAYMENT_PREVIEW_AMOUNT_MINOR = 100
export const AI_PAYMENT_PLUGIN_PERMISSIONS = Object.freeze([
  'cms.routes',
  'modules.register',
  'payments.customer.create',
  'payments.customer.refund',
] as const)

export const AiPaymentPurposeSchema = Type.Union([
  Type.Literal('deposit'),
  Type.Literal('donation'),
  Type.Literal('checkout'),
])
export type AiPaymentPurpose = Static<typeof AiPaymentPurposeSchema>

export const AiPaymentBlockIdSchema = Type.Union([
  Type.Literal('fuma.customer-payments.deposit'),
  Type.Literal('fuma.customer-payments.donation'),
  Type.Literal('fuma.customer-payments.checkout'),
])
export type AiPaymentBlockId = Static<typeof AiPaymentBlockIdSchema>

export const ProposeAiPaymentSetupInputSchema = Type.Object({
  purpose: AiPaymentPurposeSchema,
}, { additionalProperties: false })
export type ProposeAiPaymentSetupInput = Static<typeof ProposeAiPaymentSetupInputSchema>

export const AiPaymentReviewEvidenceSchema = Type.Object({
  submissionId: Id,
  decisionId: Id,
  signatureKeyId: Id,
  artifactId: Id,
  packageId: Type.Literal(AI_PAYMENT_PLUGIN_PACKAGE_ID),
  exactVersion: Type.Literal(AI_PAYMENT_PLUGIN_EXACT_VERSION),
  contentHashSha256: Sha256,
  permissions: Type.Array(Permission, { minItems: 1, maxItems: 16, uniqueItems: true }),
}, { additionalProperties: false })
export type AiPaymentReviewEvidence = Static<typeof AiPaymentReviewEvidenceSchema>

export const AiPaymentFeeDisclosureSchema = Type.Object({
  version: Type.Literal(AI_PAYMENT_FEE_DISCLOSURE_VERSION),
  currency: Type.Literal('KES'),
  fumaPlatformFeeMinor: Type.Literal(0),
  providerFeeNotice: Type.Literal('Paystack fees are charged under the merchant account and are not controlled by AI.'),
  customerChargeNotice: Type.Literal('Confirmation and credential storage do not charge a customer. A separate explicit checkout sets the amount.'),
  previewAmountMinor: Type.Literal(AI_PAYMENT_PREVIEW_AMOUNT_MINOR),
}, { additionalProperties: false })
export type AiPaymentFeeDisclosure = Static<typeof AiPaymentFeeDisclosureSchema>

export const AiPaymentSetupStateSchema = Type.Union([
  Type.Literal('proposed'),
  Type.Literal('confirmed'),
  Type.Literal('credential-stored'),
  Type.Literal('tested'),
])
export type AiPaymentSetupState = Static<typeof AiPaymentSetupStateSchema>

export const AiPaymentConfirmationChallengeSchema = Type.Object({
  challengeId: Id,
  nonceHashSha256: Sha256,
  expiresAt: Timestamp,
}, { additionalProperties: false })
export type AiPaymentConfirmationChallenge = Static<typeof AiPaymentConfirmationChallengeSchema>

export const AiPaymentSetupProposalSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  proposalId: Id,
  conversationId: Id,
  toolCallId: Id,
  scope: SiteAiScopeSchema,
  actorId: Id,
  review: AiPaymentReviewEvidenceSchema,
  purpose: AiPaymentPurposeSchema,
  blockId: AiPaymentBlockIdSchema,
  amountAuthority: Type.Literal('customer-or-merchant-explicit-input'),
  feeDisclosure: AiPaymentFeeDisclosureSchema,
  state: AiPaymentSetupStateSchema,
  challenge: Type.Union([AiPaymentConfirmationChallengeSchema, Type.Null()]),
  confirmationId: Type.Union([Id, Type.Null()]),
  installationId: Type.Union([Id, Type.Null()]),
  credentialId: Type.Union([Id, Type.Null()]),
  preview: Type.Union([
    Type.Object({
      state: Type.Literal('settled'),
      purpose: AiPaymentPurposeSchema,
      amountMinor: Type.Literal(AI_PAYMENT_PREVIEW_AMOUNT_MINOR),
      currency: Type.Literal('KES'),
      receiptFingerprintSha256: Sha256,
    }, { additionalProperties: false }),
    Type.Null(),
  ]),
  createdAt: Timestamp,
  expiresAt: Timestamp,
  confirmedAt: Type.Union([Timestamp, Type.Null()]),
  credentialStoredAt: Type.Union([Timestamp, Type.Null()]),
  testedAt: Type.Union([Timestamp, Type.Null()]),
}, { additionalProperties: false })
export type AiPaymentSetupProposal = Readonly<Static<typeof AiPaymentSetupProposalSchema>>

export const AiPaymentSetupProposalViewSchema = Type.Object({
  proposalId: Id,
  review: AiPaymentReviewEvidenceSchema,
  purpose: AiPaymentPurposeSchema,
  blockId: AiPaymentBlockIdSchema,
  amountAuthority: Type.Literal('customer-or-merchant-explicit-input'),
  feeDisclosure: AiPaymentFeeDisclosureSchema,
  state: AiPaymentSetupStateSchema,
  installationId: Type.Union([Id, Type.Null()]),
  credentialStored: Type.Boolean(),
  preview: AiPaymentSetupProposalSchema.properties.preview,
  expiresAt: Timestamp,
  confirmationPath: Type.Literal('/secure-payment'),
}, { additionalProperties: false })
export type AiPaymentSetupProposalView = Readonly<Static<typeof AiPaymentSetupProposalViewSchema>>

export const RegisterAiPaymentChallengeCommandSchema = Type.Object({
  challengeId: Id,
  nonceHashSha256: Sha256,
}, { additionalProperties: false })
export type RegisterAiPaymentChallengeCommand = Static<typeof RegisterAiPaymentChallengeCommandSchema>

export const ConfirmAiPaymentSetupCommandSchema = Type.Object({
  confirmationId: Id,
  challengeId: Id,
  confirmationNonce: Token,
  acceptedArtifactId: Id,
  acceptedContentHashSha256: Sha256,
  acceptedExactVersion: Type.Literal(AI_PAYMENT_PLUGIN_EXACT_VERSION),
  acceptedPermissions: Type.Array(Permission, { minItems: 1, maxItems: 16, uniqueItems: true }),
  acceptedFeeDisclosureVersion: Type.Literal(AI_PAYMENT_FEE_DISCLOSURE_VERSION),
  acceptedPurpose: AiPaymentPurposeSchema,
  acceptedBlockId: AiPaymentBlockIdSchema,
}, { additionalProperties: false })
export type ConfirmAiPaymentSetupCommand = Static<typeof ConfirmAiPaymentSetupCommandSchema>

export const StoreAiPaymentCredentialCommandSchema = Type.Object({
  publicKey: Type.String({ minLength: 8, maxLength: 256, pattern: '^pk_(?:test|live)_[A-Za-z0-9_-]+$' }),
  secretKey: Type.String({ minLength: 16, maxLength: 512, pattern: '^sk_(?:test|live)_[A-Za-z0-9_-]+$' }),
  testMode: Type.Boolean(),
}, { additionalProperties: false })
export type StoreAiPaymentCredentialCommand = Static<typeof StoreAiPaymentCredentialCommandSchema>

export const AiPaymentSetupHandoffSchema = Type.Object({
  handoffId: Id,
  proposalId: Id,
  tokenHashSha256: Sha256,
  audience: Type.Literal('secure-payment-settings'),
  state: Type.Union([Type.Literal('issued'), Type.Literal('consuming'), Type.Literal('consumed')]),
  expiresAt: Timestamp,
  createdAt: Timestamp,
  consumedAt: Type.Union([Timestamp, Type.Null()]),
}, { additionalProperties: false })
export type AiPaymentSetupHandoff = Readonly<Static<typeof AiPaymentSetupHandoffSchema>>

export function parseAiPaymentSetupContract<T extends TSchema>(schema: T, value: unknown, boundary: string): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new AiPaymentSetupError('invalid-contract', `${boundary} failed strict TypeBox validation.`)
  return structuredClone(parsed.value)
}

export class AiPaymentSetupError extends Error {
  override readonly name = 'AiPaymentSetupError'
  readonly code: 'invalid-contract' | 'denied' | 'not-found' | 'conflict' | 'expired' | 'unavailable'
  constructor(
    code: 'invalid-contract' | 'denied' | 'not-found' | 'conflict' | 'expired' | 'unavailable',
    message: string,
  ) {
    super(message)
    this.code = code
  }
}

export function blockForPurpose(purpose: AiPaymentPurpose): AiPaymentBlockId {
  return `fuma.customer-payments.${purpose}` as AiPaymentBlockId
}

export function exactAiPaymentPermissions(value: readonly string[]): boolean {
  return value.length === AI_PAYMENT_PLUGIN_PERMISSIONS.length
    && AI_PAYMENT_PLUGIN_PERMISSIONS.every((permission) => value.includes(permission))
}

export function proposalView(value: AiPaymentSetupProposal): AiPaymentSetupProposalView {
  return parseAiPaymentSetupContract(AiPaymentSetupProposalViewSchema, {
    proposalId: value.proposalId,
    review: value.review,
    purpose: value.purpose,
    blockId: value.blockId,
    amountAuthority: value.amountAuthority,
    feeDisclosure: value.feeDisclosure,
    state: value.state,
    installationId: value.installationId,
    credentialStored: value.credentialId !== null,
    preview: value.preview,
    expiresAt: value.expiresAt,
    confirmationPath: '/secure-payment',
  }, 'AI payment setup proposal view') as AiPaymentSetupProposalView
}
