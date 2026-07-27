import { Type, type Static } from '@core/utils/typeboxHelpers'
import { PublicPricingPlanSchema } from '@fuma/public-contracts'
import { METER_CLASSES, type ProviderCostInput } from '../metering/contracts'

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const PublicIdSchema = Type.String({ minLength: 1, maxLength: 96, pattern: '^[a-z0-9](?:[a-z0-9._-]{0,94}[a-z0-9])?$' })
const SlugSchema = Type.String({ minLength: 1, maxLength: 96, pattern: '^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$' })
const TextSchema = Type.String({ minLength: 1, maxLength: 160, pattern: '^[^<>\\u0000-\\u001F\\u007F]+$' })
const SummarySchema = Type.String({ minLength: 1, maxLength: 600, pattern: '^[^\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]+$' })
const TimestampSchema = Type.String({ format: 'date-time' })
const HashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' })
const PositiveUnitsSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
const UnitsSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const MoneySchema = Type.Integer({ minimum: 0, maximum: 1_000_000_000 })
const CadenceSchema = Type.Union([Type.Literal('monthly'), Type.Literal('annual')])
const CostSourceSchema = Type.Union([
  Type.Literal('invoice'),
  Type.Literal('quote'),
  Type.Literal('published-baseline'),
])

export const QUOTA_CLASSES = [
  'sites', 'pages', 'cmsItems', 'members', 'storageBytes', 'bandwidthBytes',
  'emailRecipientsDay', 'emailRecipientsMonth', 'buildPublishMinutes',
  'pluginComputeMinutes', 'aiCredits', 'releaseRetentionBytes', 'collaborators', 'customDomains',
] as const
export type QuotaClass = (typeof QUOTA_CLASSES)[number]
export const QuotaClassSchema = Type.Union(QUOTA_CLASSES.map((value) => Type.Literal(value)))
export const QuotaEnvelopeSchema = Type.Object({
  sites: PositiveUnitsSchema,
  pages: PositiveUnitsSchema,
  cmsItems: PositiveUnitsSchema,
  members: PositiveUnitsSchema,
  storageBytes: PositiveUnitsSchema,
  bandwidthBytes: PositiveUnitsSchema,
  emailRecipientsDay: PositiveUnitsSchema,
  emailRecipientsMonth: PositiveUnitsSchema,
  buildPublishMinutes: PositiveUnitsSchema,
  pluginComputeMinutes: PositiveUnitsSchema,
  aiCredits: PositiveUnitsSchema,
  releaseRetentionBytes: PositiveUnitsSchema,
  collaborators: PositiveUnitsSchema,
  customDomains: PositiveUnitsSchema,
}, { additionalProperties: false })
export type QuotaEnvelope = Readonly<Static<typeof QuotaEnvelopeSchema>>

export const WorkloadAssumptionsSchema = Type.Object({
  sites: UnitsSchema,
  pages: UnitsSchema,
  cms_items: UnitsSchema,
  members: UnitsSchema,
  storage_source_bytes: UnitsSchema,
  storage_variant_bytes: UnitsSchema,
  storage_release_bytes: UnitsSchema,
  storage_local_backup_bytes: UnitsSchema,
  storage_offsite_bytes: UnitsSchema,
  origin_bandwidth_bytes: UnitsSchema,
  email_recipients: UnitsSchema,
  email_message_bytes: UnitsSchema,
  custom_hostnames: UnitsSchema,
  build_publish_milliseconds: UnitsSchema,
  plugin_compute_milliseconds: UnitsSchema,
  ai_credits: UnitsSchema,
  release_retention_bytes: UnitsSchema,
  weighted_queue_milliseconds: UnitsSchema,
}, { additionalProperties: false })
export type WorkloadAssumptions = Readonly<Static<typeof WorkloadAssumptionsSchema>>

export const CostInputEvidenceSchema = Type.Object({
  meter: Type.Union(METER_CLASSES.map((value) => Type.Literal(value))),
  version: Type.String({ minLength: 1, maxLength: 100 }),
  source: CostSourceSchema,
}, { additionalProperties: false })
export const EconomicsEvidenceSchema = Type.Object({
  costModelVersion: Type.String({ minLength: 82, maxLength: 82, pattern: '^cost-model:sha256:[a-f0-9]{64}$' }),
  conversionVersion: Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }),
  variableCostMinor: MoneySchema,
  fixedSharedCostMinor: MoneySchema,
  expectedCostMinor: MoneySchema,
  marginBasisPoints: Type.Integer({ minimum: -1_000_000, maximum: 10_000 }),
  variableCogsBasisPoints: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
  inputs: Type.Array(CostInputEvidenceSchema, { minItems: METER_CLASSES.length, maxItems: METER_CLASSES.length }),
}, { additionalProperties: false })
export type EconomicsEvidence = Readonly<Static<typeof EconomicsEvidenceSchema>>

export const PublicPromotionSchema = Type.Object({
  label: TextSchema,
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
}, { additionalProperties: false })
export const OfferDiscountSchema = Type.Object({
  label: TextSchema,
  basisPoints: Type.Integer({ minimum: 1, maximum: 9_000 }),
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
  renewalAmountMinor: Type.Union([MoneySchema, Type.Null()]),
}, { additionalProperties: false })

const PlanDefinitionProperties = {
  planId: PublicIdSchema,
  slug: SlugSchema,
  name: TextSchema,
  summary: SummarySchema,
  profile: Type.Union([Type.Literal('website'), Type.Literal('publication')]),
  cadence: CadenceSchema,
  amountMinor: Type.Integer({ minimum: 1, maximum: 1_000_000_000 }),
  offeringClass: Type.Union([Type.Literal('fuma-funded-starter'), Type.Literal('fuma-funded-trial'), Type.Literal('paid')]),
  quotas: QuotaEnvelopeSchema,
  workloadAssumptions: WorkloadAssumptionsSchema,
  featureKeys: Type.Array(SlugSchema, { maxItems: 24, uniqueItems: true }),
  promotion: Type.Union([PublicPromotionSchema, Type.Null()]),
  checkoutAvailable: Type.Boolean(),
  expiresAt: Type.Union([TimestampSchema, Type.Null()]),
} as const

export const PlanDefinitionSchema = Type.Object(PlanDefinitionProperties, { additionalProperties: false })
export type PlanDefinition = Readonly<Static<typeof PlanDefinitionSchema>>
export const PricedPlanSchema = Type.Object({
  ...PlanDefinitionProperties,
  economics: EconomicsEvidenceSchema,
}, { additionalProperties: false })
export type PricedPlan = Readonly<Static<typeof PricedPlanSchema>>

export const PriceBookDraftSchema = Type.Object({
  version: Type.String({ minLength: 1, maxLength: 100 }),
  currency: Type.Literal('KES'),
  effectiveAt: TimestampSchema,
  plans: Type.Array(PlanDefinitionSchema, { minItems: 2, maxItems: 100 }),
}, { additionalProperties: false })
export type PriceBookDraft = Readonly<Static<typeof PriceBookDraftSchema>>
export const PriceBookSchema = Type.Object({
  version: Type.String({ minLength: 1, maxLength: 100 }),
  currency: Type.Literal('KES'),
  effectiveAt: TimestampSchema,
  publishedAt: TimestampSchema,
  costModelVersion: Type.String({ pattern: '^cost-model:sha256:[a-f0-9]{64}$' }),
  plans: Type.Array(PricedPlanSchema, { minItems: 2, maxItems: 100 }),
  publicJson: Type.Object({ items: Type.Array(PublicPricingPlanSchema, { minItems: 2, maxItems: 100 }) }, { additionalProperties: false }),
}, { additionalProperties: false })
export type PriceBook = Readonly<Static<typeof PriceBookSchema>>

const OfferBaseProperties = {
  offerId: IdSchema,
  version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  destinationOrganizationId: IdSchema,
  destinationWorkspaceId: IdSchema,
  siteId: IdSchema,
  currency: Type.Literal('KES'),
  recurringAmountMinor: Type.Integer({ minimum: 1, maximum: 1_000_000_000 }),
  cadence: CadenceSchema,
  setupFeeMinor: MoneySchema,
  quotas: QuotaEnvelopeSchema,
  workloadAssumptions: WorkloadAssumptionsSchema,
  setupWorkloadAssumptions: WorkloadAssumptionsSchema,
  termsHash: HashSchema,
  effectiveAt: TimestampSchema,
  expiresAt: TimestampSchema,
  renewalAt: TimestampSchema,
  renewalPolicy: Type.Union([Type.Literal('same-terms'), Type.Literal('reprice-at-renewal')]),
  discount: Type.Union([OfferDiscountSchema, Type.Null()]),
  replaces: Type.Union([Type.Object({ offerId: IdSchema, version: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }), Type.Null()]),
} as const

export const CustomOfferDraftSchema = Type.Object(OfferBaseProperties, { additionalProperties: false })
export type CustomOfferDraft = Readonly<Static<typeof CustomOfferDraftSchema>>
export const CustomOfferSchema = Type.Object({
  ...OfferBaseProperties,
  recurringEconomics: EconomicsEvidenceSchema,
  setupEconomics: EconomicsEvidenceSchema,
  state: Type.Union([Type.Literal('draft'), Type.Literal('issued'), Type.Literal('accepted'), Type.Literal('withdrawn'), Type.Literal('expired')]),
  issuedAt: Type.Union([TimestampSchema, Type.Null()]),
  acceptedAt: Type.Union([TimestampSchema, Type.Null()]),
}, { additionalProperties: false })
export type CustomOffer = Readonly<Static<typeof CustomOfferSchema>>

export const InternalGrantSchema = Type.Object({
  grantId: Type.Literal('platform-internal'),
  organizationId: IdSchema,
  quotas: QuotaEnvelopeSchema,
  nonTransferable: Type.Literal(true),
  providerCustomerId: Type.Null(),
  shadowCostRequired: Type.Literal(true),
}, { additionalProperties: false })
export type InternalGrant = Readonly<Static<typeof InternalGrantSchema>>

export const ContractCandidateSchema = Type.Object({
  candidateId: IdSchema,
  offerId: IdSchema,
  offerVersion: Type.Integer({ minimum: 1 }),
  destinationOrganizationId: IdSchema,
  destinationWorkspaceId: IdSchema,
  siteId: IdSchema,
  state: Type.Literal('awaiting-payment'),
  setupFeeSettled: Type.Literal(false),
  recurringSettled: Type.Literal(false),
  activatedAt: Type.Null(),
  paidTransferPending: Type.Literal(false),
  snapshotSha256: HashSchema,
  createdAt: TimestampSchema,
}, { additionalProperties: false })
export type ContractCandidate = Readonly<Static<typeof ContractCandidateSchema>>

export const AllowanceAdjustmentSchema = Type.Object({
  adjustmentId: IdSchema,
  organizationId: IdSchema,
  quotaClass: QuotaClassSchema,
  units: PositiveUnitsSchema,
  kind: Type.Union([Type.Literal('top-up'), Type.Literal('overage'), Type.Literal('grant'), Type.Literal('promotion'), Type.Literal('grace')]),
  effectiveAt: TimestampSchema,
  expiresAt: TimestampSchema,
  approvedBy: IdSchema,
  state: Type.Union([Type.Literal('active'), Type.Literal('expired'), Type.Literal('revoked')]),
}, { additionalProperties: false })
export type AllowanceAdjustment = Readonly<Static<typeof AllowanceAdjustmentSchema>>

export const LawyerInventoryEvidenceSchema = Type.Object({
  producedBy: Type.Literal('FUMA-076'),
  complete: Type.Literal(true),
  inventorySha256: HashSchema,
  routeCount: PositiveUnitsSchema,
  memberCount: UnitsSchema,
  storageBytes: UnitsSchema,
  observedAt: TimestampSchema,
}, { additionalProperties: false })
export const GrandfatheredAssignmentSchema = Type.Object({
  assignmentId: IdSchema,
  organizationId: IdSchema,
  priceBookVersion: Type.String({ minLength: 1, maxLength: 100 }),
  planId: PublicIdSchema,
  cadence: CadenceSchema,
  quotas: QuotaEnvelopeSchema,
  termsHash: HashSchema,
  effectiveAt: TimestampSchema,
  renewalAt: TimestampSchema,
  source: Type.Union([Type.Literal('legacy-customer'), Type.Literal('the-lawyer')]),
  lawyerInventory: Type.Union([LawyerInventoryEvidenceSchema, Type.Null()]),
}, { additionalProperties: false })
export type GrandfatheredAssignment = Readonly<Static<typeof GrandfatheredAssignmentSchema>>

export const EntitlementSnapshotSchema = Type.Object({
  snapshotId: IdSchema,
  organizationId: IdSchema,
  source: Type.Union([Type.Literal('public-contract'), Type.Literal('private-contract'), Type.Literal('platform-internal'), Type.Literal('grandfathered')]),
  sourceId: IdSchema,
  quotas: QuotaEnvelopeSchema,
  effectiveAt: TimestampSchema,
  expiresAt: Type.Union([TimestampSchema, Type.Null()]),
  immutableSha256: HashSchema,
}, { additionalProperties: false })
export type EntitlementSnapshot = Readonly<Static<typeof EntitlementSnapshotSchema>>

export type CostQuoteWithSource = Readonly<{
  version: string
  source: ProviderCostInput['source']
  variable: bigint
  fixed: bigint
  allocationWeight: bigint
}>

export interface EntitlementCostCatalog {
  assertComplete(required?: readonly (typeof METER_CLASSES)[number][]): void | Promise<void>
  cost(meter: (typeof METER_CLASSES)[number], physicalUnits: number): CostQuoteWithSource | Promise<CostQuoteWithSource>
}

export interface OfferDestinationAuthority {
  assertProvisional(input: Readonly<{ organizationId: string; workspaceId: string; siteId: string }>): Promise<void>
}

export interface EntitlementRepository {
  createInternalGrant(grant: InternalGrant): Promise<InternalGrant>
  findInternalGrant(organizationId: string): Promise<InternalGrant | null>
  publishPriceBook(book: PriceBook): Promise<PriceBook>
  exactPriceBook(version: string): Promise<PriceBook | null>
  saveAdjustment(adjustment: AllowanceAdjustment): Promise<AllowanceAdjustment>
  issueOffer(offer: CustomOffer): Promise<CustomOffer>
  exactOffer(id: string, version: number): Promise<CustomOffer | null>
  transitionOffer(id: string, version: number, state: 'withdrawn' | 'expired', at: string): Promise<CustomOffer>
  acceptOffer(input: Readonly<{ offerId: string; version: number; organizationId: string; workspaceId: string; siteId: string; now: string }>): Promise<Readonly<{ offer: CustomOffer; candidate: ContractCandidate }>>
  saveGrandfathered(assignment: GrandfatheredAssignment): Promise<GrandfatheredAssignment>
  currentSnapshot(organizationId: string, at: string): Promise<EntitlementSnapshot | null>
}
