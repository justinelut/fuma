import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import { METER_CLASSES, METER_MAPPINGS, type VersionedCostCatalog } from '../metering/service'

export const QUOTA_CLASSES = ['sites', 'pages', 'cmsItems', 'members', 'storageBytes', 'bandwidthBytes', 'emailRecipientsDay', 'emailRecipientsMonth', 'buildPublishMinutes', 'pluginComputeMinutes', 'aiCredits', 'releaseRetentionBytes', 'collaborators', 'customDomains'] as const
const QuotaClassSchema = Type.Union(QUOTA_CLASSES.map((quotaClass) => Type.Literal(quotaClass)))
export const QuotaEnvelopeSchema = Type.Record(QuotaClassSchema, Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }))
export type QuotaEnvelope = Readonly<Record<(typeof QUOTA_CLASSES)[number], number>>
const PlanSchema = Type.Object({
  planId: Type.String({ minLength: 1, maxLength: 100 }),
  cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
  amountMinor: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  quotas: QuotaEnvelopeSchema,
  public: Type.Boolean(),
}, { additionalProperties: false })
export const PriceBookSchema = Type.Object({
  version: Type.String({ minLength: 1, maxLength: 100 }),
  currency: Type.Literal('KES'),
  effectiveAt: Type.String({ format: 'date-time' }),
  plans: Type.Array(PlanSchema, { minItems: 2, maxItems: 100 }),
}, { additionalProperties: false })
export type PriceBook = Static<typeof PriceBookSchema>
export const CustomOfferSchema = Type.Object({
  offerId: Type.String({ minLength: 1, maxLength: 255 }), version: Type.Integer({ minimum: 1 }),
  destinationOrganizationId: Type.String({ minLength: 1 }), destinationWorkspaceId: Type.String({ minLength: 1 }), siteId: Type.String({ minLength: 1 }),
  currency: Type.Literal('KES'), recurringAmountMinor: Type.Integer({ minimum: 1 }), cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]), setupFeeMinor: Type.Integer({ minimum: 0 }),
  quotas: QuotaEnvelopeSchema, workloadAssumptions: Type.Record(Type.String({ minLength: 1 }), Type.Integer({ minimum: 0 })),
  termsHash: Type.String({ pattern: '^[a-f0-9]{64}$' }), costModelVersion: Type.String({ minLength: 1 }), expectedCostMinor: Type.Integer({ minimum: 0 }), marginBasisPoints: Type.Integer({ minimum: 0, maximum: 10_000 }),
  state: Type.Union([Type.Literal('draft'), Type.Literal('issued'), Type.Literal('accepted'), Type.Literal('withdrawn'), Type.Literal('expired')]),
  effectiveAt: Type.String({ format: 'date-time' }), expiresAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false })
export type CustomOffer = Static<typeof CustomOfferSchema>
export type InternalGrant = Readonly<{ grantId: 'platform-internal'; organizationId: string; quotas: QuotaEnvelope; nonTransferable: true; providerCustomerId: null; shadowCostRequired: true }>
export type ContractCandidate = Readonly<{
  candidateId: string; offerId: string; offerVersion: number; destinationOrganizationId: string; destinationWorkspaceId: string; siteId: string
  state: 'awaiting-payment'; setupFeeSettled: false; recurringSettled: false; activatedAt: null; paidTransferPending: false
}>
export const AllowanceAdjustmentSchema = Type.Object({
  adjustmentId: Type.String({ minLength: 1 }), organizationId: Type.String({ minLength: 1 }), quotaClass: QuotaClassSchema, units: Type.Integer({ minimum: 1 }),
  kind: Type.Union([Type.Literal('top-up'), Type.Literal('overage'), Type.Literal('grant'), Type.Literal('promotion'), Type.Literal('grace')]),
  effectiveAt: Type.String({ format: 'date-time' }), expiresAt: Type.String({ format: 'date-time' }), approvedBy: Type.String({ minLength: 1 }),
  state: Type.Union([Type.Literal('active'), Type.Literal('expired'), Type.Literal('revoked')]),
}, { additionalProperties: false })
export type AllowanceAdjustment = Static<typeof AllowanceAdjustmentSchema>
export interface EntitlementRepository {
  createInternalGrant(grant: InternalGrant): Promise<InternalGrant>
  savePriceBook(book: PriceBook): Promise<void>
  saveAdjustment(adjustment: AllowanceAdjustment): Promise<AllowanceAdjustment>
  saveOffer(offer: CustomOffer): Promise<void>
  exactOffer(id: string, version: number): Promise<CustomOffer | null>
  createCandidate(candidate: ContractCandidate): Promise<ContractCandidate>
}
export class EntitlementError extends Error {
  readonly code: 'invalid' | 'incomplete-cost' | 'margin' | 'immutable' | 'expired' | 'destination' | 'internal-only';
  constructor(code: 'invalid' | 'incomplete-cost' | 'margin' | 'immutable' | 'expired' | 'destination' | 'internal-only', message: string) { super(message); this.code = code; this.name = 'EntitlementError' }
}

function assertQuotas(value: unknown): asserts value is QuotaEnvelope {
  if (!Value.Check(QuotaEnvelopeSchema, value) || QUOTA_CLASSES.some((quotaClass) => !Object.prototype.hasOwnProperty.call(value, quotaClass))) {
    throw new EntitlementError('invalid', 'Every quota class must be explicit and finite.')
  }
  const quotas = value as QuotaEnvelope
  if (quotas.emailRecipientsDay > 100 || quotas.emailRecipientsMonth > 3_000) throw new EntitlementError('invalid', 'Starter and trial email caps exceed 100/day or 3,000/month.')
}
function marginBasisPoints(revenueMinor: number, costMinor: number): number { return Math.floor(((revenueMinor - costMinor) * 10_000) / revenueMinor) }
function assumptionMeters(assumption: string): readonly string[] {
  const mapped = (METER_MAPPINGS as Readonly<Record<string, readonly string[]>>)[assumption]
  if (mapped) return mapped
  if (METER_CLASSES.includes(assumption as typeof METER_CLASSES[number])) return [assumption]
  throw new EntitlementError('incomplete-cost', `Unknown workload assumption ${assumption}.`)
}

export class EntitlementService {
  private readonly repository: EntitlementRepository;
  private readonly catalog: VersionedCostCatalog;
  private readonly usdMicrosToKesMinor: (usdMicros: bigint) => number;
  private readonly protectedInternalOrganizationId: string;
  private readonly now: () => Date;
  constructor(
    repository: EntitlementRepository,
    catalog: VersionedCostCatalog,
    usdMicrosToKesMinor: (usdMicros: bigint) => number,
    protectedInternalOrganizationId: string,
    now: () => Date = () => new Date(),
  ) { this.repository = repository; this.catalog = catalog; this.usdMicrosToKesMinor = usdMicrosToKesMinor; this.protectedInternalOrganizationId = protectedInternalOrganizationId; this.now = now;}

  private expectedCost(workloads: Readonly<Record<string, number>>, requiredVersion?: string): number {
    this.catalog.assertComplete(METER_CLASSES)
    const entries = Object.entries(workloads)
    if (entries.length === 0) throw new EntitlementError('incomplete-cost', 'Workload assumptions cannot be empty.')
    let micros = 0n
    for (const [assumption, units] of entries) {
      if (!Number.isSafeInteger(units) || units < 0) throw new EntitlementError('incomplete-cost', 'Workload assumptions must be non-negative safe integers.')
      for (const meter of assumptionMeters(assumption)) {
        const cost = this.catalog.cost(meter, units)
        if (requiredVersion && cost.version !== requiredVersion) throw new EntitlementError('incomplete-cost', 'Offer cost model version does not match every required meter.')
        micros += cost.variable + cost.fixed
      }
    }
    const expected = this.usdMicrosToKesMinor(micros)
    if (!Number.isSafeInteger(expected) || expected < 0) throw new EntitlementError('incomplete-cost', 'Cost model FX conversion is unavailable.')
    return expected
  }

  async ensureInternalGrant(organizationId: string, quotas: unknown): Promise<InternalGrant> {
    if (organizationId !== this.protectedInternalOrganizationId) throw new EntitlementError('internal-only', 'The platform-internal grant belongs only to the protected internal organization.')
    assertQuotas(quotas)
    return await this.repository.createInternalGrant(Object.freeze({ grantId: 'platform-internal', organizationId, quotas: structuredClone(quotas), nonTransferable: true, providerCustomerId: null, shadowCostRequired: true }))
  }

  async saveAdjustment(raw: unknown): Promise<AllowanceAdjustment> {
    if (!Value.Check(AllowanceAdjustmentSchema, raw)) throw new EntitlementError('invalid', 'Allowance adjustment failed strict validation.')
    const adjustment = Object.freeze(structuredClone(raw)) as AllowanceAdjustment
    if (Date.parse(adjustment.expiresAt) <= Date.parse(adjustment.effectiveAt)) throw new EntitlementError('invalid', 'Allowance adjustment expiry must follow its effective time.')
    return await this.repository.saveAdjustment(adjustment)
  }

  async publishPriceBook(raw: unknown, workloads: Readonly<Record<string, Readonly<Record<string, number>>>>): Promise<PriceBook> {
    if (!Value.Check(PriceBookSchema, raw)) throw new EntitlementError('invalid', 'Price book failed strict TypeBox validation.')
    const book = Object.freeze(structuredClone(raw)) as PriceBook
    const planKeys = new Set<string>()
    const cadences = new Map<string, Set<string>>()
    for (const plan of book.plans) {
      assertQuotas(plan.quotas)
      const key = `${plan.planId}:${plan.cadence}`
      if (planKeys.has(key)) throw new EntitlementError('invalid', 'Price book contains a duplicate plan cadence.')
      planKeys.add(key)
      const set = cadences.get(plan.planId) ?? new Set<string>()
      set.add(plan.cadence); cadences.set(plan.planId, set)
      const assumptions = workloads[plan.planId]
      if (!assumptions) throw new EntitlementError('incomplete-cost', 'Every plan requires workload assumptions.')
      const expected = this.expectedCost(assumptions)
      if (marginBasisPoints(plan.amountMinor, expected) < 7_000) throw new EntitlementError('margin', 'Public plan gross margin is below 70%.')
    }
    for (const set of cadences.values()) if (!set.has('monthly') || !set.has('annual')) throw new EntitlementError('invalid', 'Every plan requires exact monthly and annual KES prices.')
    await this.repository.savePriceBook(book)
    return book
  }

  propose(input: Readonly<Omit<CustomOffer, 'expectedCostMinor' | 'marginBasisPoints' | 'state'>>): CustomOffer {
    assertQuotas(input.quotas)
    const expectedCostMinor = this.expectedCost(input.workloadAssumptions, input.costModelVersion)
    const margin = marginBasisPoints(input.recurringAmountMinor, expectedCostMinor)
    if (margin < 7_000) throw new EntitlementError('margin', 'Expected gross margin is below 70%.')
    const offer = Object.freeze({ ...structuredClone(input), expectedCostMinor, marginBasisPoints: margin, state: 'draft' as const })
    if (!Value.Check(CustomOfferSchema, offer) || Date.parse(offer.expiresAt) <= Date.parse(offer.effectiveAt)) throw new EntitlementError('invalid', 'Offer failed its strict immutable contract.')
    return offer
  }

  async issue(offer: CustomOffer): Promise<CustomOffer> {
    if (!Value.Check(CustomOfferSchema, offer) || offer.state !== 'draft') throw new EntitlementError('immutable', 'Only an exact draft can be issued.')
    if (Date.parse(offer.expiresAt) <= this.now().getTime()) throw new EntitlementError('expired', 'Offer already expired.')
    const expectedCostMinor = this.expectedCost(offer.workloadAssumptions, offer.costModelVersion)
    const margin = marginBasisPoints(offer.recurringAmountMinor, expectedCostMinor)
    if (expectedCostMinor !== offer.expectedCostMinor || margin !== offer.marginBasisPoints || margin < 7_000) throw new EntitlementError('margin', 'Offer economics changed after proposal.')
    const issued = Object.freeze({ ...structuredClone(offer), state: 'issued' as const })
    await this.repository.saveOffer(issued)
    return issued
  }

  async accept(input: Readonly<{ offerId: string; version: number; destinationOrganizationId: string; destinationWorkspaceId: string; siteId: string }>): Promise<ContractCandidate> {
    const offer = await this.repository.exactOffer(input.offerId, input.version)
    if (!offer || offer.state !== 'issued' || Date.parse(offer.expiresAt) <= this.now().getTime()) throw new EntitlementError('expired', 'Exact issued offer is unavailable.')
    if (offer.destinationOrganizationId !== input.destinationOrganizationId || offer.destinationWorkspaceId !== input.destinationWorkspaceId || offer.siteId !== input.siteId) throw new EntitlementError('destination', 'Offer destination substitution denied.')
    const candidate = await this.repository.createCandidate(Object.freeze({
      candidateId: `candidate:${offer.offerId}:${offer.version}`, offerId: offer.offerId, offerVersion: offer.version,
      destinationOrganizationId: offer.destinationOrganizationId, destinationWorkspaceId: offer.destinationWorkspaceId, siteId: offer.siteId,
      state: 'awaiting-payment', setupFeeSettled: false, recurringSettled: false, activatedAt: null, paidTransferPending: false,
    }))
    await this.repository.saveOffer(Object.freeze({ ...offer, state: 'accepted' }))
    return candidate
  }
}

export class MemoryEntitlementRepository implements EntitlementRepository {
  readonly grants = new Map<string, InternalGrant>()
  readonly priceBooks = new Map<string, PriceBook>()
  readonly adjustments = new Map<string, AllowanceAdjustment>()
  readonly offers = new Map<string, CustomOffer>()
  readonly candidates = new Map<string, ContractCandidate>()
  async createInternalGrant(grant: InternalGrant) {
    const existing = this.grants.get('platform-internal')
    if (existing && JSON.stringify(existing) !== JSON.stringify(grant)) throw new EntitlementError('immutable', 'The one platform-internal grant is immutable and non-transferable.')
    if (existing) return existing
    this.grants.set('platform-internal', structuredClone(grant)); return grant
  }
  async savePriceBook(book: PriceBook) {
    const old = this.priceBooks.get(book.version)
    if (old && JSON.stringify(old) !== JSON.stringify(book)) throw new EntitlementError('immutable', 'Published price-book versions are immutable.')
    this.priceBooks.set(book.version, structuredClone(book))
  }
  async saveAdjustment(adjustment: AllowanceAdjustment) {
    const old = this.adjustments.get(adjustment.adjustmentId)
    if (old && JSON.stringify({ ...old, state: undefined }) !== JSON.stringify({ ...adjustment, state: undefined })) throw new EntitlementError('immutable', 'Allowance adjustment evidence is immutable.')
    this.adjustments.set(adjustment.adjustmentId, structuredClone(adjustment)); return adjustment
  }
  async saveOffer(offer: CustomOffer) {
    const key = `${offer.offerId}:${offer.version}`
    const old = this.offers.get(key)
    if (old) {
      const permittedAcceptance = old.state === 'issued' && offer.state === 'accepted' && JSON.stringify({ ...old, state: undefined }) === JSON.stringify({ ...offer, state: undefined })
      if (!permittedAcceptance && JSON.stringify(old) !== JSON.stringify(offer)) throw new EntitlementError('immutable', 'Issued and accepted offers are immutable.')
    }
    this.offers.set(key, structuredClone(offer))
  }
  async exactOffer(id: string, version: number) { return structuredClone(this.offers.get(`${id}:${version}`) ?? null) }
  async createCandidate(candidate: ContractCandidate) {
    const existing = [...this.candidates.values()].find((value) => value.offerId === candidate.offerId && value.offerVersion === candidate.offerVersion)
    if (existing) return structuredClone(existing)
    this.candidates.set(candidate.candidateId, structuredClone(candidate)); return candidate
  }
}
