import { Type, Value } from '@core/utils/typeboxHelpers'
import { PLATFORM_ORGANIZATION_ID } from '../organizations/contracts'
import {
  AllowanceAdjustmentSchema,
  CustomOfferDraftSchema,
  CustomOfferSchema,
  GrandfatheredAssignmentSchema,
  PriceBookDraftSchema,
  PriceBookSchema,
  type AllowanceAdjustment,
  type ContractCandidate,
  type CustomOffer,
  type CustomOfferDraft,
  type EntitlementCostCatalog,
  type EntitlementRepository,
  type EntitlementSnapshot,
  type GrandfatheredAssignment,
  type InternalGrant,
  type OfferDestinationAuthority,
  type PlanDefinition,
  type PriceBook,
  type PriceBookDraft,
  type QuotaEnvelope,
} from './contracts'
import {
  EntitlementEconomicsError,
  assertFiniteQuotas,
  assertLaunchEconomics,
  calculateEconomics,
  evidenceSha256,
  samePlanPair,
  toPublicPricingPlan,
} from './economics'
import { EntitlementError } from './errors'

export * from './contracts'
export * from './economics'
export * from './errors'

const AcceptOfferSchema = Type.Object({
  offerId: Type.String({ minLength: 1, maxLength: 255 }),
  version: Type.Integer({ minimum: 1 }),
  destinationOrganizationId: Type.String({ minLength: 1, maxLength: 255 }),
  destinationWorkspaceId: Type.String({ minLength: 1, maxLength: 255 }),
  siteId: Type.String({ minLength: 1, maxLength: 255 }),
}, { additionalProperties: false })

function entitlementError(error: unknown): never {
  if (error instanceof EntitlementError) throw error
  if (error instanceof EntitlementEconomicsError) throw new EntitlementError(error.code, error.message)
  if (error instanceof Error && error.name === 'CostCompletenessError') {
    throw new EntitlementError('incomplete-cost', 'Cost model evidence is incomplete or stale.')
  }
  throw error
}

function instant(value: string, label: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new EntitlementError('invalid', `${label} is invalid.`)
  return parsed
}

function assertWindow(effectiveAt: string, expiresAt: string, renewalAt: string): void {
  const effective = instant(effectiveAt, 'Effective time')
  const expires = instant(expiresAt, 'Expiry time')
  const renewal = instant(renewalAt, 'Renewal time')
  if (expires <= effective) throw new EntitlementError('invalid', 'Offer expiry must follow its effective time.')
  if (renewal <= expires) throw new EntitlementError('invalid', 'Renewal must follow the offer acceptance window.')
}

function assertPromotion(plan: PlanDefinition, effectiveAt: string): void {
  const effective = instant(effectiveAt, 'Price-book effective time')
  const expiry = plan.expiresAt === null ? null : instant(plan.expiresAt, 'Plan expiry')
  if (expiry !== null && expiry <= effective) throw new EntitlementError('invalid', 'Plan expiry must follow the price-book effective time.')
  if (plan.promotion) {
    const starts = instant(plan.promotion.startsAt, 'Promotion start')
    const ends = instant(plan.promotion.endsAt, 'Promotion end')
    if (ends <= starts || ends <= effective || (expiry !== null && ends > expiry)) {
      throw new EntitlementError('invalid', 'Promotion must be current within the immutable plan window.')
    }
  }
}

function assertDiscount(offer: CustomOfferDraft): void {
  if (!offer.discount) return
  const starts = instant(offer.discount.startsAt, 'Discount start')
  const ends = instant(offer.discount.endsAt, 'Discount end')
  if (ends <= starts || ends <= instant(offer.effectiveAt, 'Offer effective time') || starts >= instant(offer.renewalAt, 'Offer renewal time')) {
    throw new EntitlementError('invalid', 'Discount must overlap the immutable offer term.')
  }
}

function minimumRecurringRevenue(offer: CustomOfferDraft): number {
  if (!offer.discount) return offer.recurringAmountMinor
  const discounted = Math.floor(offer.recurringAmountMinor * (10_000 - offer.discount.basisPoints) / 10_000)
  return offer.discount.renewalAmountMinor === null ? discounted : Math.min(discounted, offer.discount.renewalAmountMinor)
}

function exactEconomics(left: CustomOffer, right: CustomOffer): boolean {
  return evidenceSha256({ recurring: left.recurringEconomics, setup: left.setupEconomics })
    === evidenceSha256({ recurring: right.recurringEconomics, setup: right.setupEconomics })
}

export type EntitlementDecision = Readonly<{
  organizationId: string
  source: 'platform-internal' | 'public-contract' | 'private-contract' | 'grandfathered' | 'none'
  sourceId: string | null
  quotas: QuotaEnvelope | null
  billingAllowed: boolean
  providerAllowed: boolean
  shadowCostRequired: boolean
}>

export class EntitlementService {
  readonly #repository: EntitlementRepository
  readonly #catalog: EntitlementCostCatalog
  readonly #usdMicrosToKesMinor: (usdMicros: bigint) => number
  readonly #costConversionVersion: string
  readonly #destinations: OfferDestinationAuthority
  readonly #now: () => Date

  constructor(input: Readonly<{
    repository: EntitlementRepository
    catalog: EntitlementCostCatalog
    usdMicrosToKesMinor: (usdMicros: bigint) => number
    costConversionVersion: string
    destinations: OfferDestinationAuthority
    now?: () => Date
  }>) {
    this.#repository = input.repository
    this.#catalog = input.catalog
    this.#usdMicrosToKesMinor = input.usdMicrosToKesMinor
    this.#costConversionVersion = input.costConversionVersion
    this.#destinations = input.destinations
    this.#now = input.now ?? (() => new Date())
  }

  async ensureInternalGrant(organizationId: string, quotas: unknown): Promise<InternalGrant> {
    try {
      if (organizationId !== PLATFORM_ORGANIZATION_ID) {
        throw new EntitlementError('internal-only', 'The platform-internal grant belongs only to the protected platform organization.')
      }
      assertFiniteQuotas(quotas)
      return await this.#repository.createInternalGrant(Object.freeze({
        grantId: 'platform-internal', organizationId, quotas: structuredClone(quotas),
        nonTransferable: true, providerCustomerId: null, shadowCostRequired: true,
      }))
    } catch (error) { return entitlementError(error) }
  }

  async publishPriceBook(raw: unknown): Promise<PriceBook> {
    try {
      if (!Value.Check(PriceBookDraftSchema, raw)) throw new EntitlementError('invalid', 'Price book failed strict TypeBox validation.')
      const draft = Object.freeze(structuredClone(raw)) as PriceBookDraft
      const seen = new Set<string>()
      const pairs = new Map<string, PlanDefinition[]>()
      const priced = []
      for (const plan of draft.plans) {
        assertFiniteQuotas(plan.quotas, plan.offeringClass)
        assertPromotion(plan, draft.effectiveAt)
        const key = `${plan.planId}:${plan.cadence}`
        if (seen.has(key)) throw new EntitlementError('invalid', 'Price book contains a duplicate plan cadence.')
        seen.add(key)
        const group = pairs.get(plan.planId) ?? []
        group.push(plan); pairs.set(plan.planId, group)
        const economics = await calculateEconomics(this.#catalog, this.#usdMicrosToKesMinor, this.#costConversionVersion, plan.amountMinor, plan.workloadAssumptions)
        assertLaunchEconomics(economics, `Plan ${key}`)
        priced.push(Object.freeze({ ...structuredClone(plan), economics }))
      }
      for (const [planId, pair] of pairs) {
        if (pair.length !== 2 || new Set(pair.map((plan) => plan.cadence)).size !== 2 || !samePlanPair(pair[0]!, pair[1]!)) {
          throw new EntitlementError('invalid', `Plan ${planId} requires matching monthly and annual definitions.`)
        }
      }
      const versions = new Set(priced.map((plan) => plan.economics.costModelVersion))
      if (versions.size !== 1) throw new EntitlementError('incomplete-cost', 'Every published plan must use one complete cost-model snapshot.')
      const publicJson = Object.freeze({ items: Object.freeze(draft.plans.map((plan) => toPublicPricingPlan(plan, draft.effectiveAt))) })
      const book = Object.freeze({
        version: draft.version, currency: draft.currency, effectiveAt: draft.effectiveAt,
        publishedAt: this.#now().toISOString(), costModelVersion: [...versions][0]!,
        plans: Object.freeze(priced), publicJson,
      })
      if (!Value.Check(PriceBookSchema, book)) throw new EntitlementError('invalid', 'Price book snapshot failed strict validation.')
      return await this.#repository.publishPriceBook(book)
    } catch (error) { return entitlementError(error) }
  }

  async propose(raw: unknown): Promise<CustomOffer> {
    try {
      if (!Value.Check(CustomOfferDraftSchema, raw)) throw new EntitlementError('invalid', 'Custom offer draft failed strict TypeBox validation.')
      const input = Object.freeze(structuredClone(raw)) as CustomOfferDraft
      assertFiniteQuotas(input.quotas)
      assertWindow(input.effectiveAt, input.expiresAt, input.renewalAt)
      assertDiscount(input)
      await this.#destinations.assertProvisional({
        organizationId: input.destinationOrganizationId, workspaceId: input.destinationWorkspaceId, siteId: input.siteId,
      })
      if (input.replaces) {
        const replaced = await this.#repository.exactOffer(input.replaces.offerId, input.replaces.version)
        if (!replaced || replaced.state !== 'withdrawn') throw new EntitlementError('immutable', 'Replacement offers require an exact withdrawn predecessor.')
      }
      const recurringEconomics = await calculateEconomics(this.#catalog, this.#usdMicrosToKesMinor, this.#costConversionVersion, minimumRecurringRevenue(input), input.workloadAssumptions)
      assertLaunchEconomics(recurringEconomics, `Offer ${input.offerId}`)
      const setupEconomics = await calculateEconomics(this.#catalog, this.#usdMicrosToKesMinor, this.#costConversionVersion, input.setupFeeMinor, input.setupWorkloadAssumptions)
      if (input.setupFeeMinor < setupEconomics.expectedCostMinor) throw new EntitlementError('margin', 'One-time setup fee does not cover its complete forecast cost.')
      if (setupEconomics.costModelVersion !== recurringEconomics.costModelVersion) throw new EntitlementError('incomplete-cost', 'Setup and recurring economics must use one cost-model snapshot.')
      const offer = Object.freeze({
        ...structuredClone(input), recurringEconomics, setupEconomics,
        state: 'draft' as const, issuedAt: null, acceptedAt: null,
      })
      if (!Value.Check(CustomOfferSchema, offer)) throw new EntitlementError('invalid', 'Custom offer snapshot failed strict validation.')
      return offer
    } catch (error) { return entitlementError(error) }
  }

  async issue(raw: unknown): Promise<CustomOffer> {
    try {
      if (!Value.Check(CustomOfferSchema, raw)) throw new EntitlementError('invalid', 'Offer failed strict validation.')
      const offer = Object.freeze(structuredClone(raw)) as CustomOffer
      if (offer.state !== 'draft' || offer.issuedAt !== null || offer.acceptedAt !== null) throw new EntitlementError('immutable', 'Only an exact draft can be issued.')
      if (instant(offer.expiresAt, 'Offer expiry') <= this.#now().getTime()) throw new EntitlementError('expired', 'Offer already expired.')
      await this.#destinations.assertProvisional({ organizationId: offer.destinationOrganizationId, workspaceId: offer.destinationWorkspaceId, siteId: offer.siteId })
      const reproposed = await this.propose({
        offerId: offer.offerId, version: offer.version, destinationOrganizationId: offer.destinationOrganizationId,
        destinationWorkspaceId: offer.destinationWorkspaceId, siteId: offer.siteId, currency: offer.currency,
        recurringAmountMinor: offer.recurringAmountMinor, cadence: offer.cadence, setupFeeMinor: offer.setupFeeMinor,
        quotas: offer.quotas, workloadAssumptions: offer.workloadAssumptions, setupWorkloadAssumptions: offer.setupWorkloadAssumptions,
        termsHash: offer.termsHash, effectiveAt: offer.effectiveAt, expiresAt: offer.expiresAt, renewalAt: offer.renewalAt,
        renewalPolicy: offer.renewalPolicy, discount: offer.discount, replaces: offer.replaces,
      })
      if (!exactEconomics(offer, reproposed)) throw new EntitlementError('margin', 'Offer economics changed after proposal.')
      return await this.#repository.issueOffer(Object.freeze({ ...offer, state: 'issued', issuedAt: this.#now().toISOString() }))
    } catch (error) { return entitlementError(error) }
  }

  async withdraw(offerId: string, version: number): Promise<CustomOffer> {
    return await this.#repository.transitionOffer(offerId, version, 'withdrawn', this.#now().toISOString())
  }

  async expire(offerId: string, version: number): Promise<CustomOffer> {
    const offer = await this.#repository.exactOffer(offerId, version)
    if (!offer) throw new EntitlementError('not-found', 'Offer does not exist.')
    if (instant(offer.expiresAt, 'Offer expiry') > this.#now().getTime()) throw new EntitlementError('invalid', 'Offer cannot expire before its immutable expiry time.')
    return await this.#repository.transitionOffer(offerId, version, 'expired', this.#now().toISOString())
  }

  async accept(raw: unknown): Promise<ContractCandidate> {
    if (!Value.Check(AcceptOfferSchema, raw)) throw new EntitlementError('invalid', 'Offer acceptance failed strict validation.')
    const input = raw as { offerId: string; version: number; destinationOrganizationId: string; destinationWorkspaceId: string; siteId: string }
    await this.#destinations.assertProvisional({ organizationId: input.destinationOrganizationId, workspaceId: input.destinationWorkspaceId, siteId: input.siteId })
    const result = await this.#repository.acceptOffer({
      offerId: input.offerId, version: input.version, organizationId: input.destinationOrganizationId,
      workspaceId: input.destinationWorkspaceId, siteId: input.siteId, now: this.#now().toISOString(),
    })
    return result.candidate
  }

  async saveAdjustment(raw: unknown): Promise<AllowanceAdjustment> {
    if (!Value.Check(AllowanceAdjustmentSchema, raw)) throw new EntitlementError('invalid', 'Allowance adjustment failed strict validation.')
    const adjustment = Object.freeze(structuredClone(raw)) as AllowanceAdjustment
    if (instant(adjustment.expiresAt, 'Adjustment expiry') <= instant(adjustment.effectiveAt, 'Adjustment effective time')) {
      throw new EntitlementError('invalid', 'Allowance adjustment expiry must follow its effective time.')
    }
    return await this.#repository.saveAdjustment(adjustment)
  }

  async assignGrandfathered(raw: unknown): Promise<GrandfatheredAssignment> {
    if (!Value.Check(GrandfatheredAssignmentSchema, raw)) throw new EntitlementError('invalid', 'Grandfathered assignment failed strict validation.')
    const assignment = Object.freeze(structuredClone(raw)) as GrandfatheredAssignment
    assertFiniteQuotas(assignment.quotas)
    const priceBook = await this.#repository.exactPriceBook(assignment.priceBookVersion)
    const plan = priceBook?.plans.find((value) => value.planId === assignment.planId && value.cadence === assignment.cadence)
    if (!plan || evidenceSha256(plan.quotas) !== evidenceSha256(assignment.quotas)) {
      throw new EntitlementError('not-found', 'Grandfathered assignment requires an exact immutable published plan and quota snapshot.')
    }
    if ((assignment.source === 'the-lawyer') !== (assignment.lawyerInventory !== null)) {
      throw new EntitlementError('invalid', 'The Lawyer assignment requires complete FUMA-076 inventory evidence and no other assignment may carry it.')
    }
    if (assignment.lawyerInventory
      && instant(assignment.lawyerInventory.observedAt, 'FUMA-076 inventory observation') > instant(assignment.effectiveAt, 'Grandfathered effective time')) {
      throw new EntitlementError('invalid', 'FUMA-076 inventory evidence must be complete before grandfathering becomes effective.')
    }
    if (instant(assignment.renewalAt, 'Grandfathered renewal') <= instant(assignment.effectiveAt, 'Grandfathered effective time')) {
      throw new EntitlementError('invalid', 'Grandfathered renewal must follow its effective time.')
    }
    return await this.#repository.saveGrandfathered(assignment)
  }

  async evaluate(organizationId: string): Promise<EntitlementDecision> {
    const internal = await this.#repository.findInternalGrant(organizationId)
    if (internal) return Object.freeze({
      organizationId, source: 'platform-internal', sourceId: internal.grantId, quotas: internal.quotas,
      billingAllowed: false, providerAllowed: false, shadowCostRequired: true,
    })
    const snapshot: EntitlementSnapshot | null = await this.#repository.currentSnapshot(organizationId, this.#now().toISOString())
    if (!snapshot) return Object.freeze({ organizationId, source: 'none', sourceId: null, quotas: null, billingAllowed: false, providerAllowed: false, shadowCostRequired: false })
    return Object.freeze({
      organizationId, source: snapshot.source, sourceId: snapshot.sourceId, quotas: snapshot.quotas,
      billingAllowed: snapshot.source !== 'platform-internal', providerAllowed: snapshot.source !== 'platform-internal', shadowCostRequired: snapshot.source === 'platform-internal',
    })
  }
}

export { MemoryEntitlementRepository } from './memory'
