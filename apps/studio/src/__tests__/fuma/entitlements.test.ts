import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import { PLATFORM_ORGANIZATION_ID } from '../../../server/fuma/organizations/contracts'
import {
  HOSTED_COST_BASELINE_V1,
  METER_CLASSES,
  VersionedCostCatalog,
  type MeterClass,
  type ProviderCostInput,
} from '../../../server/fuma/metering'
import {
  EntitlementError,
  EntitlementService,
  MemoryEntitlementRepository,
  PriceBookDraftSchema,
  type CustomOfferDraft,
  type OfferDestinationAuthority,
  type PriceBookDraft,
  type QuotaEnvelope,
  type WorkloadAssumptions,
} from '../../../server/fuma/entitlements'
import { PublicPricingPlanSchema } from '@fuma/public-contracts'

const NOW = new Date('2026-07-27T10:00:00.000Z')
const SHA = 'a'.repeat(64)
const quotas: QuotaEnvelope = Object.freeze({
  sites: 1, pages: 100, cmsItems: 1_000, members: 500, storageBytes: 10_000,
  bandwidthBytes: 20_000, emailRecipientsDay: 100, emailRecipientsMonth: 3_000,
  buildPublishMinutes: 500, pluginComputeMinutes: 100, aiCredits: 100,
  releaseRetentionBytes: 20_000, collaborators: 3, customDomains: 1,
})
const workload = Object.freeze(Object.fromEntries(METER_CLASSES.map((meter) => [meter, 1]))) as WorkloadAssumptions
const emptyWorkload = Object.freeze(Object.fromEntries(METER_CLASSES.map((meter) => [meter, 0]))) as WorkloadAssumptions

class Destinations implements OfferDestinationAuthority {
  calls = 0
  allowed = Object.freeze({ organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'site-a' })
  async assertProvisional(value: Readonly<{ organizationId: string; workspaceId: string; siteId: string }>): Promise<void> {
    this.calls += 1
    if (JSON.stringify(value) !== JSON.stringify(this.allowed)) throw new EntitlementError('destination', 'substitution denied')
  }
}

function plan(planId: string, cadence: 'monthly' | 'annual', amountMinor: number) {
  return Object.freeze({
    planId, slug: 'starter', name: 'Starter', summary: 'A finite starter plan.', profile: 'website' as const,
    cadence, amountMinor, offeringClass: 'fuma-funded-starter' as const, quotas, workloadAssumptions: workload,
    featureKeys: Object.freeze(['finite-allowances']), promotion: null, checkoutAvailable: true, expiresAt: null,
  })
}
function priceBook(version = 'ke-2026-07-v1'): PriceBookDraft {
  return Object.freeze({
    version, currency: 'KES', effectiveAt: '2026-07-27T00:00:00.000Z',
    plans: Object.freeze([plan('starter', 'monthly', 100_000), plan('starter', 'annual', 1_000_000)]),
  })
}
function offer(overrides: Partial<CustomOfferDraft> = {}): CustomOfferDraft {
  return Object.freeze({
    offerId: 'offer-a', version: 1, destinationOrganizationId: 'org-a', destinationWorkspaceId: 'workspace-a', siteId: 'site-a',
    currency: 'KES', recurringAmountMinor: 100_000, cadence: 'monthly', setupFeeMinor: 1_000,
    quotas, workloadAssumptions: workload, setupWorkloadAssumptions: emptyWorkload,
    termsHash: SHA, effectiveAt: '2026-07-27T00:00:00.000Z', expiresAt: '2026-08-27T00:00:00.000Z',
    renewalAt: '2026-09-27T00:00:00.000Z', renewalPolicy: 'same-terms', discount: null, replaces: null,
    ...overrides,
  })
}
function harness(now: () => Date = () => NOW, inputs: readonly ProviderCostInput[] = HOSTED_COST_BASELINE_V1) {
  const repository = new MemoryEntitlementRepository()
  const destinations = new Destinations()
  const service = new EntitlementService({
    repository, destinations, catalog: new VersionedCostCatalog(inputs, now),
    usdMicrosToKesMinor: (value) => Number(value / 100n), now,
  })
  return { repository, destinations, service }
}

async function issued(service: EntitlementService, draft: CustomOfferDraft = offer()) {
  return await service.issue(await service.propose(draft))
}

describe('FUMA-054 plans, offers, and entitlement behavior', () => {
  it('accepts strict TypeBox drafts and emits a strictly public pricing projection with no private economics', async () => {
    const { service } = harness()
    expect(Value.Check(PriceBookDraftSchema, priceBook())).toBe(true)
    expect(Value.Check(PriceBookDraftSchema, { ...priceBook(), privateField: true })).toBe(false)
    const book = await service.publishPriceBook(priceBook())
    expect(Object.keys(book.publicJson)).toEqual(['items'])
    expect(book.publicJson.items.every((item) => Value.Check(PublicPricingPlanSchema, item))).toBe(true)
    expect(book.publicJson.items).toHaveLength(2)
    const publicText = JSON.stringify(book.publicJson)
    for (const forbidden of ['economics', 'workloadAssumptions', 'costModelVersion', 'provider', 'discount']) expect(publicText).not.toContain(forbidden)
    expect(book.publicJson.items[0]?.quotas.find(({ key }) => key === 'email-recipients-day')).toEqual({ key: 'email-recipients-day', label: 'Email recipients per day', limit: 100, unit: 'count' })
    expect(Object.isFrozen(book)).toBe(true)
  })

  it('requires exact monthly/annual pairs, finite starter email caps, immutable versions, and launch economics gates', async () => {
    const { service } = harness()
    await expect(service.publishPriceBook({ ...priceBook(), plans: [plan('starter', 'monthly', 100_000)] })).rejects.toMatchObject({ code: 'invalid' })
    const overEmail = { ...quotas, emailRecipientsDay: 101 }
    await expect(service.publishPriceBook({
      ...priceBook(), plans: [
        { ...plan('starter', 'monthly', 100_000), quotas: overEmail },
        { ...plan('starter', 'annual', 1_000_000), quotas: overEmail },
      ],
    })).rejects.toMatchObject({ code: 'invalid' })
    await service.publishPriceBook(priceBook())
    await expect(service.publishPriceBook({ ...priceBook(), plans: [plan('starter', 'monthly', 200_000), plan('starter', 'annual', 2_000_000)] })).rejects.toMatchObject({ code: 'immutable' })
    await expect(service.publishPriceBook({ ...priceBook('unprofitable'), plans: [plan('starter', 'monthly', 1), plan('starter', 'annual', 1)] })).rejects.toMatchObject({ code: 'margin' })
  })

  it('fails closed on missing/stale costs and prefers invoice then quote then baseline source evidence', async () => {
    const baseline = HOSTED_COST_BASELINE_V1.find(({ meter }) => meter === 'sites')!
    await expect(harness(() => NOW, [baseline]).service.publishPriceBook(priceBook())).rejects.toMatchObject({ code: 'incomplete-cost' })
    const stale = HOSTED_COST_BASELINE_V1.map((value) => ({ ...value, staleAfter: '2026-07-20T00:00:00.000Z' }))
    await expect(harness(() => NOW, stale).service.publishPriceBook(priceBook())).rejects.toMatchObject({ code: 'incomplete-cost' })
    const quote: ProviderCostInput = { ...baseline, version: 'quote-v2', source: 'quote', effectiveAt: '2026-07-25T00:00:00.000Z' }
    const invoice: ProviderCostInput = { ...baseline, version: 'invoice-v1', source: 'invoice', effectiveAt: '2026-07-10T00:00:00.000Z' }
    const catalog = new VersionedCostCatalog([baseline, quote, invoice], () => NOW)
    expect(catalog.cost('sites', 1)).toMatchObject({ version: 'invoice-v1', source: 'invoice' })
    const quoteOnly = new VersionedCostCatalog([baseline, quote], () => NOW)
    expect(quoteOnly.cost('sites', 1)).toMatchObject({ version: 'quote-v2', source: 'quote' })
  })

  it('creates exactly one protected internal grant with no provider or billing route and evaluates it first', async () => {
    const { repository, service } = harness()
    await expect(service.ensureInternalGrant('substitute', quotas)).rejects.toMatchObject({ code: 'internal-only' })
    const grants = await Promise.all(Array.from({ length: 12 }, () => service.ensureInternalGrant(PLATFORM_ORGANIZATION_ID, quotas)))
    expect(new Set(grants.map((value) => JSON.stringify(value)))).toHaveLength(1)
    expect(repository.grants.size).toBe(1)
    expect(grants[0]).toMatchObject({ nonTransferable: true, providerCustomerId: null, shadowCostRequired: true })
    expect(await service.evaluate(PLATFORM_ORGANIZATION_ID)).toMatchObject({ source: 'platform-internal', billingAllowed: false, providerAllowed: false, shadowCostRequired: true })
  })

  it('separates setup from recurring economics, freezes current evidence at issue, and revalidates destination', async () => {
    const { destinations, service } = harness()
    await expect(service.propose(offer({ setupFeeMinor: 0 }))).rejects.toMatchObject({ code: 'margin' })
    await expect(service.propose({ ...offer(), attacker: true })).rejects.toMatchObject({ code: 'invalid' })
    await expect(service.propose(offer({ discount: { label: 'Unsafe discount', basisPoints: 9_000, startsAt: '2026-07-27T00:00:00.000Z', endsAt: '2026-08-01T00:00:00.000Z', renewalAmountMinor: 0 } }))).rejects.toMatchObject({ code: 'margin' })
    const proposed = await service.propose(offer())
    expect(proposed.setupEconomics.expectedCostMinor).toBeGreaterThan(0)
    expect(proposed.recurringEconomics.expectedCostMinor).toBeGreaterThan(proposed.setupEconomics.expectedCostMinor)
    const frozen = await service.issue(proposed)
    expect(frozen).toMatchObject({ state: 'issued', acceptedAt: null })
    expect(destinations.calls).toBeGreaterThanOrEqual(2)
    destinations.allowed = Object.freeze({ organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'replacement-site' })
    await expect(service.accept({ offerId: frozen.offerId, version: frozen.version, destinationOrganizationId: 'org-a', destinationWorkspaceId: 'workspace-a', siteId: 'site-a' })).rejects.toMatchObject({ code: 'destination' })
  })

  it('atomically accepts an exact issued destination once and can never activate or enter paid-transfer-pending', async () => {
    const { repository, service } = harness()
    const snapshot = await issued(service)
    const command = { offerId: snapshot.offerId, version: snapshot.version, destinationOrganizationId: 'org-a', destinationWorkspaceId: 'workspace-a', siteId: 'site-a' }
    const results = await Promise.all(Array.from({ length: 16 }, () => service.accept(command)))
    expect(new Set(results.map(({ candidateId }) => candidateId))).toHaveLength(1)
    expect(repository.candidates.size).toBe(1)
    expect(results[0]).toMatchObject({ state: 'awaiting-payment', setupFeeSettled: false, recurringSettled: false, activatedAt: null, paidTransferPending: false })
    expect(await repository.exactOffer(snapshot.offerId, snapshot.version)).toMatchObject({ state: 'accepted' })
    await expect(service.accept({ ...command, siteId: 'substitute' })).rejects.toMatchObject({ code: 'destination' })
  })

  it('enforces immutable withdrawal, replacement, and expiry lifecycle', async () => {
    const { repository, service } = harness()
    const first = await issued(service)
    await expect(service.expire(first.offerId, first.version)).rejects.toMatchObject({ code: 'invalid' })
    expect(await service.withdraw(first.offerId, first.version)).toMatchObject({ state: 'withdrawn' })
    const replacementDraft = offer({ offerId: 'offer-b', replaces: { offerId: first.offerId, version: first.version } })
    expect(await issued(service, replacementDraft)).toMatchObject({ state: 'issued', replaces: { offerId: first.offerId, version: first.version } })
    await expect(repository.transitionOffer(first.offerId, first.version, 'expired', NOW.toISOString())).rejects.toMatchObject({ code: 'immutable' })
    const later = new Date('2026-09-01T00:00:00.000Z')
    const expiredHarness = harness(() => later)
    const seeded = await issued(service, offer({ offerId: 'offer-c' }))
    expiredHarness.repository.offers.set(`${seeded.offerId}:${seeded.version}`, seeded)
    expect(await expiredHarness.service.expire(seeded.offerId, seeded.version)).toMatchObject({ state: 'expired' })
  })

  it('keeps adjustment identity immutable and gates grandfathering on verifiable FUMA-076 inventory evidence', async () => {
    const { service } = harness()
    const adjustment = Object.freeze({ adjustmentId: 'adjustment-a', organizationId: 'org-a', quotaClass: 'sites' as const, units: 1, kind: 'grace' as const, effectiveAt: NOW.toISOString(), expiresAt: '2026-08-01T00:00:00.000Z', approvedBy: 'staff-a', state: 'active' as const })
    expect(await service.saveAdjustment(adjustment)).toEqual(adjustment)
    await expect(service.saveAdjustment({ ...adjustment, units: 2 })).rejects.toMatchObject({ code: 'immutable' })
    expect(await service.saveAdjustment({ ...adjustment, state: 'revoked' })).toMatchObject({ state: 'revoked' })
    await expect(service.saveAdjustment(adjustment)).rejects.toMatchObject({ code: 'immutable' })
    await service.publishPriceBook(priceBook('legacy-2026-v1'))
    const inventory = Object.freeze({ producedBy: 'FUMA-076' as const, complete: true as const, inventorySha256: SHA, routeCount: 12, memberCount: 20, storageBytes: 30_000, observedAt: NOW.toISOString() })
    const assignment = Object.freeze({ assignmentId: 'grandfathered-a', organizationId: 'org-a', priceBookVersion: 'legacy-2026-v1', planId: 'starter', cadence: 'annual' as const, quotas, termsHash: SHA, effectiveAt: NOW.toISOString(), renewalAt: '2027-07-27T10:00:00.000Z', source: 'the-lawyer' as const, lawyerInventory: inventory })
    expect(await service.assignGrandfathered(assignment)).toEqual(assignment)
    expect(await service.evaluate('org-a')).toMatchObject({ source: 'grandfathered', billingAllowed: true, providerAllowed: true })
    await expect(service.assignGrandfathered({ ...assignment, assignmentId: 'bad', lawyerInventory: { ...inventory, observedAt: '2026-07-28T00:00:00.000Z' } })).rejects.toMatchObject({ code: 'invalid' })
    await expect(service.assignGrandfathered({ ...assignment, assignmentId: 'missing', lawyerInventory: null })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('prints a deterministic platform-plan and private-offer demo', async () => {
    const { service } = harness()
    const book = await service.publishPriceBook(priceBook('demo-v1'))
    const privateOffer = await issued(service, offer({ offerId: 'demo-offer' }))
    process.stdout.write(`[FUMA-054 demo] plans=${book.publicJson.items.length} cost=${book.costModelVersion} offer=${privateOffer.state} setup=separate destination=provisional\n`)
  })
})
