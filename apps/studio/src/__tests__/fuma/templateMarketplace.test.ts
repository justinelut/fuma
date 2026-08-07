/**
 * Template marketplace: listing gate, purchase, licensing and payouts.
 *
 * The sharpest rule under test is that a licence outlives its listing: delisting must stop new sales
 * and never revoke what somebody already paid for.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Value } from '@sinclair/typebox/value'
import {
  MARKETPLACE_CONTRACT,
  MAX_TEMPLATE_PRICE_MINOR,
  PAYOUT_HOLD_DAYS,
  PLATFORM_FEE_BASIS_POINTS,
  REVIEW_PIPELINE_GAP,
  TemplateLicenceSchema,
  TemplateListingSchema,
  decidePayout,
  holdElapsedDays,
  isPurchasable,
  licenceSurvives,
  mayInstall,
  payableTotal,
  platformFeeFor,
  purchaseLicence,
  reviewListing,
  splitSale,
  type ListingState,
  type TemplateLicence,
  type TemplateListing,
} from '../../core/fuma/templateMarketplace'

const STUDIO = join(import.meta.dir, '..', '..', '..')

function listing(over: Partial<TemplateListing> = {}): TemplateListing {
  return {
    listingId: 'listing-1',
    sellerOrganizationId: 'seller-org',
    templateName: 'Studio Portfolio',
    state: 'listed',
    currency: 'KES',
    priceMinor: 250_000,
    roundTripVerified: true,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...over,
  }
}

function licence(over: Partial<TemplateLicence> = {}): TemplateLicence {
  return {
    licenceId: 'lic-1',
    listingId: 'listing-1',
    buyerOrganizationId: 'buyer-org',
    currency: 'KES',
    paidMinor: 250_000,
    purchasedAt: '2026-03-01T00:00:00.000Z',
    refundedAt: null,
    ...over,
  }
}

describe('the shapes validate against their own schemas', () => {
  it('a listing and a licence both check', () => {
    expect(Value.Check(TemplateListingSchema, listing())).toBe(true)
    expect(Value.Check(TemplateLicenceSchema, licence())).toBe(true)
  })

  it('and a free template is a legitimate listing', () => {
    expect(Value.Check(TemplateListingSchema, listing({ priceMinor: 0 }))).toBe(true)
  })
})

describe('the listing gate', () => {
  it('accepts a round-trippable, reviewed listing', () => {
    expect(reviewListing(listing(), true)).toEqual([])
    expect(isPurchasable(listing(), true)).toBe(true)
  })

  it('refuses one that does not round-trip, naming the consequence', () => {
    const problems = reviewListing(listing({ roundTripVerified: false }), true)
    expect(problems.map((problem) => problem.code)).toEqual(['not-round-trippable'])
    // Task 85's finding: the buyer discovers it after paying.
    expect(problems[0]!.message).toContain('empty canvas')
  })

  it('refuses an unreviewed listing, because nothing scanned it for secrets', () => {
    const problems = reviewListing(listing(), false)
    expect(problems.map((problem) => problem.code)).toEqual(['not-reviewed'])
    expect(problems[0]!.message).toContain('credentials')
  })

  it('refuses a price above the ceiling', () => {
    const problems = reviewListing(listing({ priceMinor: MAX_TEMPLATE_PRICE_MINOR + 1 }), true)
    expect(problems.map((problem) => problem.code)).toEqual(['price-exceeds-ceiling'])
  })

  it('reports every problem rather than stopping at the first', () => {
    const problems = reviewListing(
      listing({ roundTripVerified: false, priceMinor: MAX_TEMPLATE_PRICE_MINOR + 1 }),
      false,
    )
    expect(problems).toHaveLength(3)
  })

  it('and a draft is not purchasable however sound it is', () => {
    expect(isPurchasable(listing({ state: 'draft' }), true)).toBe(false)
  })
})

describe('purchase', () => {
  const base = {
    reviewed: true,
    buyerOrganizationId: 'buyer-org',
    licenceId: 'lic-new',
    now: '2026-03-02T00:00:00.000Z',
  }

  it('issues a licence at the quoted price', () => {
    const result = purchaseLicence({
      ...base, listing: listing(), expectedPriceMinor: 250_000, existingLicences: [],
    })
    expect(result.ok).toBe(true)
    expect(result.licence?.paidMinor).toBe(250_000)
    expect(result.licence?.refundedAt).toBeNull()
  })

  it('REFUSES when the price changed under the buyer', () => {
    // Charging more than the amount somebody agreed to is indefensible however briefly the old price
    // was shown.
    const result = purchaseLicence({
      ...base, listing: listing({ priceMinor: 400_000 }), expectedPriceMinor: 250_000, existingLicences: [],
    })
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('price-changed')
    expect(result.licence).toBeNull()
  })

  it('refuses a second charge for a template the organization already holds', () => {
    const result = purchaseLicence({
      ...base, listing: listing(), expectedPriceMinor: 250_000, existingLicences: [licence()],
    })
    expect(result.refusal).toBe('already-licensed')
  })

  it('but allows re-buying after a refund', () => {
    const result = purchaseLicence({
      ...base,
      listing: listing(),
      expectedPriceMinor: 250_000,
      existingLicences: [licence({ refundedAt: '2026-03-05T00:00:00.000Z' })],
    })
    expect(result.ok).toBe(true)
  })

  it('and another organization holding a licence does not block this buyer', () => {
    const result = purchaseLicence({
      ...base,
      listing: listing(),
      expectedPriceMinor: 250_000,
      existingLicences: [licence({ buyerOrganizationId: 'someone-else' })],
    })
    expect(result.ok).toBe(true)
  })

  it('refuses when the listing is not purchasable', () => {
    const result = purchaseLicence({
      ...base, listing: listing({ state: 'delisted' }), expectedPriceMinor: 250_000, existingLicences: [],
    })
    expect(result.refusal).toBe('not-purchasable')
  })
})

describe('A LICENCE OUTLIVES ITS LISTING', () => {
  it('cannot consult listing state at all, which is the structural guarantee', () => {
    // If delisting revoked a licence, a seller could take back what somebody paid for at will, and
    // the template would simply stop installing - which reads as a broken product rather than as a
    // revoked entitlement. So the decision does not ACCEPT a listing state: the revocation is
    // unreachable rather than merely not implemented.
    const source = readFileSync(
      join(STUDIO, 'src/core/fuma/templateMarketplace.ts'), 'utf8',
    )
    const decision = source.slice(
      source.indexOf('export function licenceSurvives'),
      source.indexOf('export function mayInstall'),
    )
    expect(decision).not.toContain('listingState:')
    expect(licenceSurvives(licence())).toBe(true)

    const install = source.slice(
      source.indexOf('export function mayInstall'),
      source.indexOf('// ---', source.indexOf('export function mayInstall')),
    )
    expect(install).not.toContain('state')
  })

  it('so a delisted listing still installs for somebody who bought it', () => {
    const states: readonly ListingState[] = ['draft', 'in-review', 'listed', 'rejected', 'delisted']
    // mayInstall takes no state, so every one of these resolves from the licence alone.
    expect(states).toHaveLength(5)
    expect(mayInstall([licence()], 'listing-1', 'buyer-org')).toBe(true)
  })

  it('and a refund is the one thing that ends it, because the money went back', () => {
    const refunded = licence({ refundedAt: '2026-03-10T00:00:00.000Z' })
    expect(licenceSurvives(refunded)).toBe(false)
    expect(mayInstall([refunded], 'listing-1', 'buyer-org')).toBe(false)
  })

  it('does not grant another organization access', () => {
    expect(mayInstall([licence()], 'listing-1', 'other-org')).toBe(false)
  })

  it('and does not grant access to a different template', () => {
    expect(mayInstall([licence()], 'listing-2', 'buyer-org')).toBe(false)
  })
})

describe('the platform fee', () => {
  it('is taken at the declared rate and rounded UP', () => {
    // Rounding down means paying out marginally more than was received across enough sales.
    expect(PLATFORM_FEE_BASIS_POINTS).toBe(1_500)
    expect(platformFeeFor(100_000)).toBe(15_000)
    expect(platformFeeFor(1)).toBe(1)
  })

  it('and the split always adds back to the gross', () => {
    for (const paidMinor of [1, 999, 250_000, 4_999_999]) {
      const line = splitSale(licence({ paidMinor }))
      expect(line.platformFeeMinor + line.sellerMinor).toBe(paidMinor)
      expect(line.sellerMinor).toBeGreaterThanOrEqual(0)
    }
  })

  it('takes nothing from a free template', () => {
    expect(platformFeeFor(0)).toBe(0)
  })
})

describe('payouts', () => {
  const paidOut: readonly string[] = []

  it('are held until the refund window closes', () => {
    const decision = decidePayout({
      licence: licence(), now: '2026-03-05T00:00:00.000Z', alreadyPaidLicenceIds: paidOut,
    })
    expect(decision.payable).toBe(false)
    expect(decision.refusal).toBe('inside-hold-window')
    expect(decision.message).toContain(String(PAYOUT_HOLD_DAYS))
  })

  it('become payable once it has', () => {
    const decision = decidePayout({
      licence: licence(), now: '2026-03-20T00:00:00.000Z', alreadyPaidLicenceIds: paidOut,
    })
    expect(decision.payable).toBe(true)
    expect(decision.line?.sellerMinor).toBe(250_000 - platformFeeFor(250_000))
  })

  it('are refused for a refunded sale', () => {
    const decision = decidePayout({
      licence: licence({ refundedAt: '2026-03-04T00:00:00.000Z' }),
      now: '2026-03-20T00:00:00.000Z',
      alreadyPaidLicenceIds: paidOut,
    })
    expect(decision.refusal).toBe('refunded')
  })

  it('CANNOT PAY THE SAME SALE TWICE', () => {
    const decision = decidePayout({
      licence: licence(), now: '2026-03-20T00:00:00.000Z', alreadyPaidLicenceIds: ['lic-1'],
    })
    expect(decision.refusal).toBe('already-paid')
    expect(decision.line).toBeNull()
  })

  it('report a free template as nothing to pay rather than as an error', () => {
    const decision = decidePayout({
      licence: licence({ paidMinor: 0 }), now: '2026-03-20T00:00:00.000Z', alreadyPaidLicenceIds: paidOut,
    })
    expect(decision.refusal).toBe('nothing-to-pay')
  })

  it('and an unreadable purchase date keeps the money held rather than releasing it', () => {
    const decision = decidePayout({
      licence: licence({ purchasedAt: 'not-a-date' }),
      now: '2026-03-20T00:00:00.000Z',
      alreadyPaidLicenceIds: paidOut,
    })
    expect(decision.refusal).toBe('inside-hold-window')
  })
})

describe('the hold window measurement', () => {
  it('counts whole days', () => {
    expect(holdElapsedDays('2026-03-01T00:00:00.000Z', '2026-03-15T00:00:00.000Z')).toBe(14)
  })

  it('returns null for an inverted or unreadable range', () => {
    expect(holdElapsedDays('2026-03-15T00:00:00.000Z', '2026-03-01T00:00:00.000Z')).toBeNull()
    expect(holdElapsedDays('nope', '2026-03-01T00:00:00.000Z')).toBeNull()
  })
})

describe('totals', () => {
  it('sum a seller\'s payable lines', () => {
    const total = payableTotal([splitSale(licence()), splitSale(licence({ licenceId: 'lic-2' }))])
    expect(total?.sellerMinor).toBe(2 * (250_000 - platformFeeFor(250_000)))
  })

  it('REFUSE to add across currencies rather than reporting a meaningless number', () => {
    const mixed = [
      splitSale(licence()),
      { ...splitSale(licence({ licenceId: 'lic-2' })), currency: 'USD' as never },
    ]
    expect(payableTotal(mixed)).toBeNull()
  })

  it('and report null for no lines rather than a zero that looks measured', () => {
    expect(payableTotal([])).toBeNull()
  })
})

describe('the review-pipeline gap is recorded against the real migration', () => {
  it('names the shipped constraint that excludes templates', () => {
    const migration = readFileSync(
      join(STUDIO, 'server/fuma/db/migrations/000071_artifact_review_marketplace.ts'), 'utf8',
    )
    // Evidence rather than assertion: the constraint really does exclude 'template'.
    expect(migration).toContain("artifact_kind in ('plugin','component-pack')")
    expect(migration).not.toContain("'template'")
    expect(REVIEW_PIPELINE_GAP.migration).toBe('000071_artifact_review_marketplace')
    expect(REVIEW_PIPELINE_GAP.blocking).toBe(true)
  })

  it('and states what would close it', () => {
    expect(REVIEW_PIPELINE_GAP.whatWouldCloseIt).toContain('000085')
  })
})

describe('the contract states its reasoning', () => {
  it('records the listing gate, the licence rule and the hold', () => {
    expect(MARKETPLACE_CONTRACT.licenceOutlivesListing).toContain('never revokes')
    expect(MARKETPLACE_CONTRACT.listingGate).toContain('round-trip')
    expect(MARKETPLACE_CONTRACT.feeBasisPoints).toBe(PLATFORM_FEE_BASIS_POINTS)
  })
})
