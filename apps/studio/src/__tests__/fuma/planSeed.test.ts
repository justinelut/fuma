/**
 * Task 66: seed pricing plans and entitlements so limits apply from signup.
 *
 * The seed carries QUOTAS, which are a product decision, and stops short of publishing a price
 * book, which would compute economics from costBaseline.ts UNIT_COSTS - self-described launch
 * assumptions rather than measured costs.
 */
import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import { PriceBookDraftSchema, PlanDefinitionSchema, QUOTA_CLASSES } from '../../../server/fuma/entitlements/contracts'
import { assertFiniteQuotas, samePlanPair } from '../../../server/fuma/entitlements/economics'
import {
  SEEDED_PLANS,
  allowanceForSlug,
  reviewPublishReadiness,
  seededPriceBookDraft,
} from '../../../server/fuma/entitlements/planSeed'

describe('the seed validates against the real contracts', () => {
  it('every plan satisfies PlanDefinitionSchema', () => {
    // Validated against the SHIPPED schema rather than a copy, so a contract change surfaces here
    // rather than at whatever later moment first reads the seed.
    for (const plan of SEEDED_PLANS) {
      expect(Value.Check(PlanDefinitionSchema, plan)).toBe(true)
    }
  })

  it('the draft satisfies PriceBookDraftSchema', () => {
    expect(Value.Check(PriceBookDraftSchema, seededPriceBookDraft('2026-01-01T00:00:00.000Z'))).toBe(true)
  })

  it('has at least the two plans the schema demands', () => {
    // PriceBookDraftSchema sets minItems: 2, so a single-plan seed could never be published.
    expect(SEEDED_PLANS.length).toBeGreaterThanOrEqual(2)
  })
})

describe('every quota passes the entitlement layer own gate', () => {
  it('assertFiniteQuotas accepts each plan', () => {
    // This is the gate that refuses an infinite or missing quota, and it takes the offeringClass
    // because a Fuma-funded plan has tighter email caps.
    for (const plan of SEEDED_PLANS) {
      expect(() => assertFiniteQuotas(plan.quotas, plan.offeringClass)).not.toThrow()
    }
  })

  it('declares all fourteen quota classes with nothing omitted', () => {
    // assertFiniteQuotas compares the key set exactly, so a missing class is a refusal rather
    // than a default - there is deliberately no way to leave one unstated.
    for (const plan of SEEDED_PLANS) {
      expect(Object.keys(plan.quotas).sort()).toEqual([...QUOTA_CLASSES].sort())
    }
  })

  it('has NO way to express unlimited', () => {
    // The same rule the allowance surface follows: an unbounded promise is one somebody
    // discovers is false at the moment their upload is refused.
    for (const plan of SEEDED_PLANS) {
      for (const value of Object.values(plan.quotas)) {
        expect(Number.isSafeInteger(value)).toBe(true)
        expect(value).toBeGreaterThan(0)
      }
    }
  })

  it('respects the Fuma-funded email caps the gate enforces', () => {
    const starter = SEEDED_PLANS.find((plan) => plan.offeringClass === 'fuma-funded-starter')
    expect(starter).toBeDefined()
    expect(starter!.quotas.emailRecipientsDay).toBeLessThanOrEqual(100)
    expect(starter!.quotas.emailRecipientsMonth).toBeLessThanOrEqual(3_000)
  })
})

describe('the free tier is one page', () => {
  it('the starter includes exactly one page', () => {
    // A product decision, and the number lives here so the builder (task 68) and the billing
    // layer cannot disagree about what the free tier includes.
    const starter = SEEDED_PLANS.find((plan) => plan.slug === 'starter')
    expect(starter?.quotas.pages).toBe(1)
  })

  it('and exactly one site', () => {
    expect(SEEDED_PLANS.find((plan) => plan.slug === 'starter')?.quotas.sites).toBe(1)
  })

  it('the paid tier allows meaningfully more', () => {
    // Otherwise there is nothing to upgrade for, and the free tier's limit reads as arbitrary.
    const studio = SEEDED_PLANS.find((plan) => plan.slug === 'studio')
    expect(studio!.quotas.pages).toBeGreaterThan(10)
  })
})

describe('nothing is chargeable yet, deliberately', () => {
  it('no plan offers checkout', () => {
    // A price that cannot be justified against measured cost should not be chargeable, and the
    // funded plan has nothing to buy at all.
    for (const plan of SEEDED_PLANS) {
      expect(plan.checkoutAvailable).toBe(false)
    }
  })

  it('the funded plan is classed as funded rather than priced at zero', () => {
    // amountMinor has a minimum of 1, so "free" is expressed by offeringClass. Pricing it zero
    // would have meant loosening a constraint that is right.
    const starter = SEEDED_PLANS.find((plan) => plan.slug === 'starter')
    expect(starter?.offeringClass).toBe('fuma-funded-starter')
    expect(starter?.amountMinor).toBeGreaterThanOrEqual(1)
  })
})

describe('workload assumptions are expectations, not caps', () => {
  it('every consumption assumption sits below its quota', () => {
    // Assuming saturation makes every margin look worse than it is and prices the product for a
    // customer who does not exist.
    for (const plan of SEEDED_PLANS) {
      expect(plan.workloadAssumptions.pages).toBeLessThan(plan.quotas.pages + 1)
      expect(plan.workloadAssumptions.origin_bandwidth_bytes).toBeLessThan(plan.quotas.bandwidthBytes)
      expect(plan.workloadAssumptions.ai_credits).toBeLessThan(plan.quotas.aiCredits)
    }
  })

  it('compute assumptions are in MILLISECONDS, matching the schema', () => {
    // I had these as minutes at first and the typechecker caught it against the real schema.
    // Mixing the units would understate compute by 60,000x - flattering exactly the meter most
    // likely to cost real money.
    const studio = SEEDED_PLANS.find((plan) => plan.slug === 'studio')!
    expect(studio.workloadAssumptions.build_publish_milliseconds).toBeGreaterThan(studio.quotas.buildPublishMinutes)
  })

  it('declares every workload field the schema requires', () => {
    for (const plan of SEEDED_PLANS) {
      // additionalProperties:false plus required fields means an omission is a refusal.
      expect(Value.Check(PlanDefinitionSchema, plan)).toBe(true)
      expect(plan.workloadAssumptions.weighted_queue_milliseconds).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('allowanceForSlug feeds the storage surface', () => {
  it('returns the seeded storage and bandwidth', () => {
    const allowance = allowanceForSlug('starter')
    expect(allowance).not.toBeNull()
    expect(allowance!.storageBytes).toBeGreaterThan(0)
    expect(allowance!.bandwidthBytes).toBeGreaterThan(0)
  })

  it('returns NULL for an unknown slug rather than a default', () => {
    // Showing one plan's allowance for another is worse than showing none, because it is wrong
    // in a way nobody can see. The surface already renders an absent limit honestly.
    expect(allowanceForSlug('enterprise-that-does-not-exist')).toBeNull()
  })
})

describe('publishing is reported as not ready, not silently skipped', () => {
  it('states why, naming the cost baseline', () => {
    const readiness = reviewPublishReadiness()
    expect(readiness.ready).toBe(false)
    expect(readiness.reason).toContain('costBaseline')
    expect(readiness.reason).toContain('assertLaunchEconomics')
  })

  it('says the quotas ARE usable, so the gap is not read as total', () => {
    expect(reviewPublishReadiness().reason).toContain('Quotas are seeded and enforceable')
  })
})

describe('the cadence pairing the publisher enforces', () => {
  it('every planId appears exactly twice, monthly and annual', () => {
    // service.ts refuses a book otherwise ("requires matching monthly and annual definitions").
    // My first draft had one cadence per plan and would have been refused - found by reading the
    // publisher rather than by guessing.
    const byId = new Map<string, string[]>()
    for (const plan of SEEDED_PLANS) {
      byId.set(plan.planId, [...(byId.get(plan.planId) ?? []), plan.cadence])
    }
    expect(byId.size).toBeGreaterThanOrEqual(2)
    for (const cadences of byId.values()) {
      expect([...cadences].sort()).toEqual(['annual', 'monthly'])
    }
  })

  it('each pair satisfies the real samePlanPair check', () => {
    // Asserted with the SHIPPED comparison rather than my own idea of sameness, so a change to
    // what must match surfaces here.
    const byId = new Map<string, typeof SEEDED_PLANS[number][]>()
    for (const plan of SEEDED_PLANS) {
      byId.set(plan.planId, [...(byId.get(plan.planId) ?? []), plan])
    }
    for (const pair of byId.values()) {
      expect(pair).toHaveLength(2)
      expect(samePlanPair(pair[0]!, pair[1]!)).toBe(true)
    }
  })

  it('no duplicate planId + cadence, which the publisher also refuses', () => {
    const keys = SEEDED_PLANS.map((plan) => `${plan.planId}:${plan.cadence}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('the annual amount differs from the monthly one for a PAID plan', () => {
    // If they matched, an annual purchase would charge a month's price for a year.
    const monthly = SEEDED_PLANS.find((plan) => plan.slug === 'studio' && plan.cadence === 'monthly')!
    const annual = SEEDED_PLANS.find((plan) => plan.slug === 'studio' && plan.cadence === 'annual')!
    expect(annual.amountMinor).toBeGreaterThan(monthly.amountMinor)
  })
})
