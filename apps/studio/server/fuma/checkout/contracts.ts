import {
  Type,
  type Static,
} from '@core/utils/typeboxHelpers'

const IdSchema = Type.String({
  minLength: 1,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
})
const VersionSchema = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
})
const TimestampSchema = Type.String({ format: 'date-time' })
const Sha256Schema = Type.String({ pattern: '^[a-f0-9]{64}$' })
const HttpsUrlSchema = Type.String({
  minLength: 1,
  maxLength: 2048,
  pattern: '^https://',
})
const MoneySchema = Type.Integer({ minimum: 1, maximum: 1_000_000_000 })

export const PlatformCheckoutChannelSchema = Type.Union([
  Type.Literal('card'),
  Type.Literal('mobile_money'),
  Type.Literal('bank'),
])
export type PlatformCheckoutChannel = Static<typeof PlatformCheckoutChannelSchema>

export const PlatformCheckoutDestinationSchema = Type.Object({
  organizationId: IdSchema,
  workspaceId: IdSchema,
  siteId: IdSchema,
  profileId: Type.String({
    minLength: 1,
    maxLength: 255,
    pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
  }),
}, { additionalProperties: false })
export type PlatformCheckoutDestination = Readonly<
  Static<typeof PlatformCheckoutDestinationSchema>
>

export const PublicPlanCheckoutIntentSchema = Type.Object({
  kind: Type.Literal('public-plan'),
  planId: IdSchema,
  priceBookVersion: VersionSchema,
  cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
}, { additionalProperties: false })
export const PrivateOfferCheckoutIntentSchema = Type.Object({
  kind: Type.Literal('private-offer'),
  offerId: IdSchema,
  offerVersion: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
export const PlatformCheckoutSourceIntentSchema = Type.Union([
  PublicPlanCheckoutIntentSchema,
  PrivateOfferCheckoutIntentSchema,
])
export type PlatformCheckoutSourceIntent = Readonly<
  Static<typeof PlatformCheckoutSourceIntentSchema>
>

/** Caller intent deliberately contains no destination, customer, money, channels, or redirect. */
export const PlatformCheckoutInitializeSchema = Type.Object({
  source: PlatformCheckoutSourceIntentSchema,
}, { additionalProperties: false })
export type PlatformCheckoutInitialize = Readonly<
  Static<typeof PlatformCheckoutInitializeSchema>
>

export const PlatformCheckoutCallbackSchema = Type.Object({
  reference: Type.String({
    minLength: 16,
    maxLength: 100,
    pattern: '^[A-Za-z0-9._-]+$',
  }),
}, { additionalProperties: false })
export type PlatformCheckoutCallback = Readonly<
  Static<typeof PlatformCheckoutCallbackSchema>
>

export const PlatformCheckoutObligationKindSchema = Type.Union([
  Type.Literal('setup'),
  Type.Literal('recurring'),
])
export type PlatformCheckoutObligationKind = Static<
  typeof PlatformCheckoutObligationKindSchema
>

export const PlatformCheckoutObligationStateSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('initializing'),
  Type.Literal('ready'),
  Type.Literal('callback-verified'),
  Type.Literal('failed'),
])
export type PlatformCheckoutObligationState = Static<
  typeof PlatformCheckoutObligationStateSchema
>

export const PlatformCheckoutObligationSchema = Type.Object({
  kind: PlatformCheckoutObligationKindSchema,
  amountMinor: MoneySchema,
  currency: Type.Literal('KES'),
  reference: Type.Union([
    Type.String({ minLength: 16, maxLength: 100, pattern: '^[A-Za-z0-9._-]+$' }),
    Type.Null(),
  ]),
  authorizationUrl: Type.Union([HttpsUrlSchema, Type.Null()]),
  state: PlatformCheckoutObligationStateSchema,
  callbackVerifiedAt: Type.Union([TimestampSchema, Type.Null()]),
}, { additionalProperties: false })
export type PlatformCheckoutObligation = Readonly<
  Static<typeof PlatformCheckoutObligationSchema>
>

export const PlatformCheckoutStateSchema = Type.Union([
  Type.Literal('awaiting-payment'),
  Type.Literal('cancelled'),
])
export type PlatformCheckoutState = Static<typeof PlatformCheckoutStateSchema>

export const PlatformCheckoutViewSchema = Type.Object({
  checkoutId: IdSchema,
  state: PlatformCheckoutStateSchema,
  source: PlatformCheckoutSourceIntentSchema,
  destination: PlatformCheckoutDestinationSchema,
  cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
  currency: Type.Literal('KES'),
  setup: Type.Union([PlatformCheckoutObligationSchema, Type.Null()]),
  recurring: PlatformCheckoutObligationSchema,
  createdAt: TimestampSchema,
  cancelledAt: Type.Union([TimestampSchema, Type.Null()]),
}, { additionalProperties: false })
export type PlatformCheckoutView = Readonly<Static<typeof PlatformCheckoutViewSchema>>

export const PlatformCheckoutMetadataSchema = Type.Object({
  checkoutId: IdSchema,
  candidateId: IdSchema,
  sourceKind: Type.Union([Type.Literal('public-plan'), Type.Literal('private-offer')]),
  sourceId: IdSchema,
  sourceVersion: VersionSchema,
  organizationId: IdSchema,
  workspaceId: IdSchema,
  siteId: IdSchema,
  customerActorId: IdSchema,
  payerEmailSha256: Sha256Schema,
  kind: PlatformCheckoutObligationKindSchema,
  amountMinor: MoneySchema,
  currency: Type.Literal('KES'),
  cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
  callbackUrl: HttpsUrlSchema,
  allowedChannels: Type.Array(PlatformCheckoutChannelSchema, {
    minItems: 1,
    maxItems: 3,
    uniqueItems: true,
  }),
  evidenceSha256: Sha256Schema,
}, { additionalProperties: false })
export type PlatformCheckoutMetadata = Readonly<
  Static<typeof PlatformCheckoutMetadataSchema>
>

export type PlatformCheckoutRecord = Readonly<{
  checkoutId: string
  candidateId: string
  entitlementCandidateId: string | null
  state: PlatformCheckoutState
  source: PlatformCheckoutSourceIntent
  destination: PlatformCheckoutDestination
  customerActorId: string
  payerEmailSha256: string
  cadence: 'monthly' | 'annual'
  currency: 'KES'
  callbackUrl: string
  allowedChannels: readonly PlatformCheckoutChannel[]
  evidenceSha256: string
  setup: PlatformCheckoutObligation | null
  recurring: PlatformCheckoutObligation
  createdAt: string
  cancelledAt: string | null
}>

export type PlatformCheckoutPrepareInput = Readonly<{
  source: PlatformCheckoutSourceIntent
  destination: PlatformCheckoutDestination
  customerActorId: string
  payerEmailSha256: string
  callbackUrlFor(checkoutId: string): string
  allowedChannels: readonly PlatformCheckoutChannel[]
}>

export type PlatformCheckoutInitializationClaim = Readonly<{
  claimId: string
  checkoutId: string
  kind: PlatformCheckoutObligationKind
  reference: string
}>

export type PlatformCheckoutClaimResult = Readonly<
  | { state: 'claimed'; claim: PlatformCheckoutInitializationClaim }
  | { state: 'ready'; record: PlatformCheckoutRecord }
  | { state: 'busy' }
>

export interface PlatformCheckoutRepository {
  prepare(input: PlatformCheckoutPrepareInput): Promise<PlatformCheckoutRecord>
  find(destination: PlatformCheckoutDestination, checkoutId: string): Promise<PlatformCheckoutRecord | null>
  claimInitialization(
    checkoutId: string,
    kind: PlatformCheckoutObligationKind,
    proposedReference: string,
  ): Promise<PlatformCheckoutClaimResult>
  completeInitialization(
    claim: PlatformCheckoutInitializationClaim,
    authorizationUrl: string,
  ): Promise<void>
  releaseInitialization(claim: PlatformCheckoutInitializationClaim): Promise<void>
  assertPurpose(metadata: PlatformCheckoutMetadata): Promise<void>
  markCallbackVerified(
    checkoutId: string,
    kind: PlatformCheckoutObligationKind,
    reference: string,
  ): Promise<void>
  cancel(destination: PlatformCheckoutDestination, checkoutId: string): Promise<void>
}

export interface PlatformCheckoutOfferAcceptanceAuthority {
  acceptExactIssuedOffer(input: Readonly<{
    offerId: string
    offerVersion: number
    destination: PlatformCheckoutDestination
  }>): Promise<void>
}

export type PlatformCheckoutErrorCode =
  | 'invalid'
  | 'scope'
  | 'not-found'
  | 'stale'
  | 'internal'
  | 'already-settled'
  | 'cancelled'
  | 'busy'
  | 'provider'
  | 'verification'
  | 'conflict'

export class PlatformCheckoutError extends Error {
  override readonly name = 'PlatformCheckoutError'
  readonly code: PlatformCheckoutErrorCode

  constructor(code: PlatformCheckoutErrorCode, message: string) {
    super(message)
    this.code = code
  }
}
