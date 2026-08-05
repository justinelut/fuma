import { Type, type Static } from '@core/utils/typeboxHelpers'
import {
  AllowanceAdjustmentSchema,
  CustomOfferDraftSchema,
  GrandfatheredAssignmentSchema,
  InternalGrantSchema,
  PriceBookDraftSchema,
  QuotaClassSchema,
  QuotaEnvelopeSchema,
} from './contracts'

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const RequestIdSchema = Type.String({ minLength: 8, maxLength: 96, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const TimestampSchema = Type.String({ format: 'date-time' })

export const EntitlementAdminAuthoritySchema = Type.Object({
  actorId: IdSchema,
  sessionId: IdSchema,
  protectedOwner: Type.Boolean(),
  fresh: Type.Boolean(),
}, { additionalProperties: false })
export type EntitlementAdminAuthority = Readonly<Static<typeof EntitlementAdminAuthoritySchema>>

export const EntitlementAdminAuthorityEnvelopeSchema = Type.Object({
  result: EntitlementAdminAuthoritySchema,
}, { additionalProperties: false })

export const EntitlementAdminEventSchema = Type.Object({
  eventId: IdSchema,
  action: Type.Union([
    Type.Literal('entitlement.price-book.published'),
    Type.Literal('entitlement.offer.issued'),
    Type.Literal('entitlement.offer.withdrawn'),
    Type.Literal('entitlement.offer.expired'),
    Type.Literal('entitlement.internal-grant.created'),
    Type.Literal('entitlement.adjustment.saved'),
    Type.Literal('entitlement.grandfathered.assigned'),
  ]),
  targetId: IdSchema,
  actorId: IdSchema,
  requestId: RequestIdSchema,
  occurredAt: TimestampSchema,
}, { additionalProperties: false })
export type EntitlementAdminEvent = Readonly<Static<typeof EntitlementAdminEventSchema>>

export const EntitlementAdminPlanSchema = Type.Object({
  planId: IdSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  profile: Type.Union([Type.Literal('website'), Type.Literal('publication')]),
  cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
  amountMinor: Type.Integer({ minimum: 1 }),
  quotas: QuotaEnvelopeSchema,
  expectedCostMinor: Type.Integer({ minimum: 0 }),
  marginBasisPoints: Type.Integer(),
  variableCogsBasisPoints: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false })
export const EntitlementAdminPriceBookSchema = Type.Object({
  version: IdSchema,
  effectiveAt: TimestampSchema,
  publishedAt: TimestampSchema,
  costModelVersion: Type.String({ minLength: 1, maxLength: 100 }),
  plans: Type.Array(EntitlementAdminPlanSchema, { minItems: 2, maxItems: 100 }),
}, { additionalProperties: false })
export const EntitlementAdminOfferSchema = Type.Object({
  offerId: IdSchema,
  version: Type.Integer({ minimum: 1 }),
  destinationOrganizationId: IdSchema,
  destinationWorkspaceId: IdSchema,
  siteId: IdSchema,
  cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
  recurringAmountMinor: Type.Integer({ minimum: 1 }),
  setupFeeMinor: Type.Integer({ minimum: 0 }),
  quotas: QuotaEnvelopeSchema,
  recurringExpectedCostMinor: Type.Integer({ minimum: 0 }),
  setupExpectedCostMinor: Type.Integer({ minimum: 0 }),
  marginBasisPoints: Type.Integer(),
  state: Type.Union([Type.Literal('issued'), Type.Literal('accepted'), Type.Literal('withdrawn'), Type.Literal('expired')]),
  issuedAt: TimestampSchema,
  acceptedAt: Type.Union([TimestampSchema, Type.Null()]),
  expiresAt: TimestampSchema,
}, { additionalProperties: false })

export const EntitlementAdminWorkspaceSchema = Type.Object({
  generatedAt: TimestampSchema,
  priceBooks: Type.Array(EntitlementAdminPriceBookSchema, { maxItems: 50 }),
  offers: Type.Array(EntitlementAdminOfferSchema, { maxItems: 100 }),
  internalGrant: Type.Union([InternalGrantSchema, Type.Null()]),
  adjustments: Type.Array(AllowanceAdjustmentSchema, { maxItems: 100 }),
  recentEvents: Type.Array(EntitlementAdminEventSchema, { maxItems: 50 }),
}, { additionalProperties: false })
export type EntitlementAdminWorkspace = Readonly<Static<typeof EntitlementAdminWorkspaceSchema>>

const AdjustmentInputSchema = Type.Object({
  adjustmentId: IdSchema,
  organizationId: IdSchema,
  quotaClass: QuotaClassSchema,
  units: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  kind: Type.Union([
    Type.Literal('top-up'), Type.Literal('overage'), Type.Literal('grant'),
    Type.Literal('promotion'), Type.Literal('grace'),
  ]),
  effectiveAt: TimestampSchema,
  expiresAt: TimestampSchema,
  state: Type.Union([Type.Literal('active'), Type.Literal('expired'), Type.Literal('revoked')]),
}, { additionalProperties: false })

export const EntitlementAdminCommandSchema = Type.Union([
  Type.Object({ kind: Type.Literal('publish-price-book'), requestId: RequestIdSchema, draft: PriceBookDraftSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('issue-offer'), requestId: RequestIdSchema, draft: CustomOfferDraftSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('ensure-internal-grant'), requestId: RequestIdSchema, quotas: QuotaEnvelopeSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('save-adjustment'), requestId: RequestIdSchema, adjustment: AdjustmentInputSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('withdraw-offer'), requestId: RequestIdSchema, offerId: IdSchema, version: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('expire-offer'), requestId: RequestIdSchema, offerId: IdSchema, version: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('assign-grandfathered'), requestId: RequestIdSchema, assignment: GrandfatheredAssignmentSchema }, { additionalProperties: false }),
], { discriminator: 'kind' })
export type EntitlementAdminCommand = Readonly<Static<typeof EntitlementAdminCommandSchema>>

export const EntitlementAdminMutationReceiptSchema = Type.Object({
  requestId: RequestIdSchema,
  operation: Type.Union([
    Type.Literal('publish-price-book'), Type.Literal('issue-offer'), Type.Literal('ensure-internal-grant'),
    Type.Literal('save-adjustment'), Type.Literal('withdraw-offer'), Type.Literal('expire-offer'),
    Type.Literal('assign-grandfathered'),
  ]),
  resourceId: IdSchema,
  resourceVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  state: Type.String({ minLength: 1, maxLength: 40, pattern: '^[a-z][a-z-]*$' }),
}, { additionalProperties: false })
export type EntitlementAdminMutationReceipt = Readonly<Static<typeof EntitlementAdminMutationReceiptSchema>>
