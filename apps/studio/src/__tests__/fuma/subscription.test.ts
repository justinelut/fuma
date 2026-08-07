/**
 * Task 67: the payment lifecycle against the seeded plans.
 *
 * The two halves are tested separately because only one is deliverable today: assigning the
 * funded starter needs no payment, while charging waits on task 66's deliberate
 * checkoutAvailable: false.
 */
import { describe, expect, it } from 'bun:test'
import {
  PAST_DUE_GRACE_DAYS,
  changePlan,
  downgradeExcess,
  effectOf,
  quotasForPlan,
  recordPaymentFailure,
  recordPaymentSuccess,
  reviewChargingReadiness,
  subscriptionForSignup,
  type Subscription,
} from '../../../server/fuma/entitlements/subscription'
import { SEEDED_PLANS } from '../../../server/fuma/entitlements/planSeed'

const NOW = '2026-03-01T00:00:00.000Z'

function paid(overrides: Partial<Subscription> = {}): Subscription {
  const studio = SEEDED_PLANS.find((plan) => plan.slug === 'studio' && plan.cadence === 'monthly')!
  return Object.freeze({
    organizationId: 'org-1',
    planId: studio.planId,
    cadence: 'monthly' as const,
    state: 'active' as const,
    periodEndsAt: '2026-04-01T00:00:00.000Z',
    pastDueSince: null,
    ...overrides,
  })
}

describe('a signup is assigned the funded starter', () => {
  it('produces a funded subscription', () => {
    const subscription = subscriptionForSignup('org-new')
    expect(subscription.state).toBe('funded')
    expect(subscription.organizationId).toBe('org-new')
  })

  it('resolves to the seeded starter quotas, so the free tier is one page', () => {
    // This is the thread the allowance surface and the builder limit were both waiting on.
    const subscription = subscriptionForSignup('org-new')
    const effect = effectOf(subscription, NOW)
    expect(effect.quotas?.pages).toBe(1)
    expect(effect.quotas?.sites).toBe(1)
  })

  it('carries NO period end, so nothing expires a working funded account', () => {
    // Inventing an end date would create a renewal obligation nobody owes and a job that
    // eventually switches off an account that never had anything to pay.
    expect(subscriptionForSignup('org-new').periodEndsAt).toBeNull()
  })

  it('is NOT recorded as grandfathered', () => {
    // GrandfatheredAssignmentSchema's source is a closed union of legacy-customer|the-lawyer, so
    // it deliberately cannot express a fresh account. Widening it would blur a record that marks
    // exceptions into the ordinary signup path.
    const state: string = subscriptionForSignup('org-new').state
    expect(state).not.toBe('grandfathered')
    expect(state).toBe('funded')
  })

  it('serves and is editable immediately', () => {
    const effect = effectOf(subscriptionForSignup('org-new'), NOW)
    expect(effect.siteServes).toBe(true)
    expect(effect.editingAllowed).toBe(true)
  })
})

describe('a funded plan has no payment to fail', () => {
  it('a recorded failure leaves it untouched', () => {
    // A billing job looking for a payment that never existed must not push a starter account
    // into a dunning path.
    const funded = subscriptionForSignup('org-new')
    expect(recordPaymentFailure(funded, NOW).state).toBe('funded')
  })

  it('a recorded success leaves it untouched', () => {
    const funded = subscriptionForSignup('org-new')
    expect(recordPaymentSuccess(funded, '2026-04-01T00:00:00.000Z').state).toBe('funded')
  })
})

describe('past-due keeps the site serving for a grace window', () => {
  it('serves on the first day of failure', () => {
    // Revoking on the first failed payment takes a site off the internet over a card the bank
    // declined. A payment problem is recoverable; a day of downtime is not.
    const subscription = paid({ state: 'past-due', pastDueSince: NOW })
    const effect = effectOf(subscription, '2026-03-01T06:00:00.000Z')
    expect(effect.siteServes).toBe(true)
  })

  it('still allows EDITING during grace', () => {
    // A read-only builder during grace means somebody who already fixed their card returns to
    // work they could not save, and the block achieved nothing except losing it.
    const subscription = paid({ state: 'past-due', pastDueSince: NOW })
    expect(effectOf(subscription, '2026-03-05T00:00:00.000Z').editingAllowed).toBe(true)
  })

  it('stops serving once the window passes', () => {
    // It has to end, or non-payment is free service and the grace window becomes the product.
    const subscription = paid({ state: 'past-due', pastDueSince: NOW })
    const effect = effectOf(subscription, '2026-03-20T00:00:00.000Z')
    expect(effect.siteServes).toBe(false)
    expect(effect.editingAllowed).toBe(false)
  })

  it('the window is bounded to something defensible', () => {
    // Long enough to survive a replaced card and a weekend, short enough not to be a plan.
    expect(PAST_DUE_GRACE_DAYS).toBeGreaterThanOrEqual(7)
    expect(PAST_DUE_GRACE_DAYS).toBeLessThanOrEqual(30)
  })

  it('measures from the FIRST failure, not the latest retry', () => {
    // Resetting on every retry makes the grace period unbounded for exactly the account whose
    // card keeps failing - the case it exists to bound.
    const first = recordPaymentFailure(paid(), NOW)
    const second = recordPaymentFailure(first, '2026-03-10T00:00:00.000Z')
    expect(second.pastDueSince).toBe(NOW)
  })

  it('a malformed timestamp keeps the customer INSIDE grace', () => {
    // The opposite default would cut off a working site because a date failed to parse.
    const subscription = paid({ state: 'past-due', pastDueSince: 'not-a-date' })
    expect(effectOf(subscription, NOW).siteServes).toBe(true)
  })

  it('a successful payment clears the window', () => {
    const recovered = recordPaymentSuccess(paid({ state: 'past-due', pastDueSince: NOW }), '2026-04-01T00:00:00.000Z')
    expect(recovered.state).toBe('active')
    expect(recovered.pastDueSince).toBeNull()
  })
})

describe('cancelling does not cut service early', () => {
  it('a cancelled-at-period-end subscription still serves', () => {
    // Cutting service the moment somebody cancels charges them for time they cannot use.
    const effect = effectOf(paid({ state: 'canceled-at-period-end' }), NOW)
    expect(effect.siteServes).toBe(true)
    expect(effect.editingAllowed).toBe(true)
  })

  it('an expired subscription does not serve', () => {
    expect(effectOf(paid({ state: 'expired' }), NOW).siteServes).toBe(false)
  })
})

describe('a downgrade never deletes work', () => {
  it('reports the excess rather than refusing', () => {
    // The customer has no copy of their pages, so deleting them is unrecoverable - and doing it
    // as a side effect of a billing change is indefensible however clearly the terms are worded.
    const starter = SEEDED_PLANS.find((plan) => plan.slug === 'starter' && plan.cadence === 'monthly')!
    const result = changePlan(paid(), starter.planId, 'monthly', 40)
    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    expect(result.excess.overBy).toBe(39)
  })

  it('the message says nothing is deleted, because that is the fear it must answer', () => {
    const excess = downgradeExcess(
      SEEDED_PLANS.find((plan) => plan.slug === 'starter')!.planId, 'monthly', 40,
    )
    expect(excess.message).toContain('Nothing is deleted')
    expect(excess.message).toContain('keeps serving')
  })

  it('carries the excess in the RESULT so a caller cannot miss it', () => {
    // The typechecker caught me accepting the page count and never reading it, which was the
    // signal that a caller could change plan without ever seeing the consequence.
    const starter = SEEDED_PLANS.find((plan) => plan.slug === 'starter')!
    const result = changePlan(paid(), starter.planId, 'monthly', 2)
    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    expect(result.excess).toBeDefined()
    expect(result.excess.overBy).toBe(1)
  })

  it('reports no excess when the site already fits', () => {
    const starter = SEEDED_PLANS.find((plan) => plan.slug === 'starter')!
    expect(downgradeExcess(starter.planId, 'monthly', 1).overBy).toBe(0)
    expect(downgradeExcess(starter.planId, 'monthly', 1).message).toBeNull()
  })

  it('singular wording for one page over', () => {
    const starter = SEEDED_PLANS.find((plan) => plan.slug === 'starter')!
    expect(downgradeExcess(starter.planId, 'monthly', 2).message).toContain('1 page ')
  })
})

describe('plan changes are refused when they would need a decision nobody made', () => {
  it('refuses an unknown plan rather than applying no allowance', () => {
    const result = changePlan(paid(), 'plan_does_not_exist', 'monthly', 1)
    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.code).toBe('unknown-plan')
  })

  it('refuses while a payment is outstanding', () => {
    // Changing plan mid-debt either forgives it or carries it to a plan that did not incur it.
    const result = changePlan(paid({ state: 'past-due', pastDueSince: NOW }), 'plan_starter_website', 'monthly', 1)
    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.code).toBe('payment-outstanding')
  })
})

describe('quota resolution', () => {
  it('resolves a seeded plan at both cadences', () => {
    const studio = SEEDED_PLANS.find((plan) => plan.slug === 'studio')!
    expect(quotasForPlan(studio.planId, 'monthly')).not.toBeNull()
    expect(quotasForPlan(studio.planId, 'annual')).not.toBeNull()
  })

  it('returns NULL for an unknown plan rather than a fallback', () => {
    // Serving one plan's quotas for another is wrong in a way nobody can see.
    expect(quotasForPlan('plan_nope', 'monthly')).toBeNull()
  })
})

describe('charging is reported as not live, not silently missing', () => {
  it('states why, naming the seeded flag', () => {
    const readiness = reviewChargingReadiness()
    expect(readiness.ready).toBe(false)
    expect(readiness.reason).toContain('checkoutAvailable')
  })

  it('says the funded assignment DOES work, so the gap is not read as total', () => {
    expect(reviewChargingReadiness().reason).toContain('funded starter assignment works')
  })
})
