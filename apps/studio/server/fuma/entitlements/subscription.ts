/**
 * The subscription lifecycle for OUR plans, and the assignment a signup produces.
 *
 * WHAT THIS IS NOT: server/fuma/customerPayments/ is the tenant charging THEIR OWN readers
 * (merchant credentials, mobile money, membership offers). That is the tenant's revenue. This
 * file is the opposite direction - what the tenant owes US - and nothing modelled it.
 *
 * THE SPLIT, and it follows task 66's reasoning rather than repeating it. Two halves:
 *  - ASSIGNING the funded starter at signup needs NO PAYMENT, so it is deliverable today and is
 *    what the allowance surface and the builder page limit are both waiting on.
 *  - CHARGING for a paid plan cannot happen while `checkoutAvailable` is false on every seeded
 *    plan, which task 66 set deliberately because a price that cannot be justified against
 *    measured cost should not be chargeable.
 * So the lifecycle is modelled and tested in full, and the transition that actually runs today is
 * the funded one. That is a stated boundary rather than a silent gap - `reviewChargingReadiness`
 * reports it as data.
 */
import { SEEDED_PLANS } from './planSeed'
import type { PlanDefinition, QuotaEnvelope } from './contracts'

/**
 * The states a subscription can be in, each with a DIFFERENT entitlement consequence.
 *
 * `funded` is its own state rather than a flavour of active: we pay for it, so there is no
 * payment to fail and no dunning to run. Collapsing it into `active` would put a starter account
 * into a past-due path the moment a billing job looked for a payment that never existed.
 */
export type SubscriptionState =
  | 'funded'
  | 'active'
  | 'past-due'
  | 'canceled-at-period-end'
  | 'expired'

export type Subscription = Readonly<{
  organizationId: string
  planId: string
  cadence: 'monthly' | 'annual'
  state: SubscriptionState
  /** When the current paid period ends. Null for a funded plan, which has no period to end. */
  periodEndsAt: string | null
  /** When the first payment failed, so a grace window can be measured from it. */
  pastDueSince: string | null
}>

/**
 * Entitlements SURVIVE past-due for a grace window, and this is the central safety decision.
 *
 * Revoking on the first failed payment takes a customer's site off the internet over a card their
 * bank declined for reasons neither of us controls. A payment problem is recoverable in an
 * afternoon; a site that was down for a day is not - the visitors who bounced do not come back
 * and the customer is right to blame us. So the site keeps serving while we ask again.
 *
 * It must END, though, or non-payment is simply free service and the grace window becomes the
 * product. Fourteen days is long enough to survive a replaced card and a weekend, and short
 * enough that it cannot be used as a plan.
 */
export const PAST_DUE_GRACE_DAYS = 14

export type EntitlementEffect = Readonly<{
  /** Whether the published site keeps serving visitors. */
  siteServes: boolean
  /** Whether the builder accepts new work. */
  editingAllowed: boolean
  /** Which plan's quotas apply right now. Null means no entitlement could be resolved. */
  quotas: QuotaEnvelope | null
  reason: string
}>

export function effectOf(subscription: Subscription, nowIso: string): EntitlementEffect {
  const quotas = quotasForPlan(subscription.planId, subscription.cadence)
  if (subscription.state === 'funded') {
    return effect(true, true, quotas, 'A funded starter has no payment to fail.')
  }
  if (subscription.state === 'active') {
    return effect(true, true, quotas, 'The subscription is paid and current.')
  }
  if (subscription.state === 'canceled-at-period-end') {
    // Still paid for. Cutting service the moment somebody cancels charges them for time they
    // cannot use, which is the sort of thing customers tell other people about.
    return effect(true, true, quotas, 'Cancelled but paid through the end of the period.')
  }
  if (subscription.state === 'past-due') {
    const withinGrace = daysBetween(subscription.pastDueSince, nowIso) < PAST_DUE_GRACE_DAYS
    if (withinGrace) {
      // EDITING CONTINUES TOO, deliberately. A read-only builder during grace means somebody
      // who has already fixed their card returns to work they could not save, and the block
      // achieved nothing except losing that work.
      return effect(true, true, quotas, 'Payment failed; the site keeps serving during the grace period.')
    }
    return effect(false, false, quotas, 'Payment failed and the grace period has passed.')
  }
  // expired
  return effect(false, false, quotas, 'The subscription has ended.')
}

function effect(siteServes: boolean, editingAllowed: boolean, quotas: QuotaEnvelope | null, reason: string): EntitlementEffect {
  return Object.freeze({ siteServes, editingAllowed, quotas, reason })
}

/** The quotas of a seeded plan, or null when the plan cannot be resolved. */
export function quotasForPlan(planId: string, cadence: 'monthly' | 'annual'): QuotaEnvelope | null {
  const plan: PlanDefinition | undefined = SEEDED_PLANS.find(
    (entry) => entry.planId === planId && entry.cadence === cadence,
  )
  // Null rather than a fallback plan: serving one plan's quotas for another is wrong in a way
  // nobody can see, and the builder already treats an unresolved limit as "do not block".
  return plan?.quotas ?? null
}

/**
 * The assignment a signup produces.
 *
 * A NEW SIGNUP IS NOT GRANDFATHERED. GrandfatheredAssignmentSchema's `source` is a closed union
 * of 'legacy-customer' | 'the-lawyer', so it deliberately cannot express a fresh account - and
 * widening it would blur a record that exists to mark exceptions into the ordinary path. So a
 * signup produces a plain funded subscription instead, and grandfathering stays what it is.
 */
export function subscriptionForSignup(organizationId: string): Subscription {
  const starter = SEEDED_PLANS.find(
    (plan) => plan.offeringClass === 'fuma-funded-starter' && plan.cadence === 'monthly',
  )
  if (!starter) {
    // Refused rather than defaulted. A signup with no resolvable plan must be visible, because
    // the alternative is an account that silently has no limits at all.
    throw new Error('No funded starter plan is seeded; a signup cannot be assigned one.')
  }
  return Object.freeze({
    organizationId,
    planId: starter.planId,
    cadence: 'monthly' as const,
    state: 'funded' as const,
    // No period: a funded plan does not lapse, so inventing an end date would create a renewal
    // obligation nobody owes and a job that eventually expires a working account.
    periodEndsAt: null,
    pastDueSince: null,
  })
}

export type TransitionRefusal = Readonly<{ allowed: false, code: string, message: string }>
export type TransitionAllowed = Readonly<{
  allowed: true
  next: Subscription
  /**
   * How far the change leaves the site over its new allowance, carried in the RESULT rather than
   * offered as a separate call. The typechecker caught me accepting the page count and never
   * reading it, which was the honest signal that a caller could change plan without ever seeing
   * the consequence. Reporting it here means they cannot.
   */
  excess: Readonly<{ overBy: number, message: string | null }>
}>
export type TransitionResult = TransitionAllowed | TransitionRefusal

/**
 * Changing plan, with the case that actually needs care.
 *
 * A DOWNGRADE CAN LEAVE EXISTING WORK OVER THE NEW LIMIT - moving from a hundred pages to one
 * leaves ninety-nine pages that the new plan does not include. THE ANSWER IS NEVER TO DELETE
 * THEM: the customer has no copy, so it is unrecoverable, and doing it as a side effect of a
 * billing change is indefensible however clearly the terms were worded.
 *
 * So a downgrade is ALLOWED and the excess is reported as data. The page limit already refuses
 * only NEW pages, so an over-limit site keeps serving and keeps being editable while nothing new
 * is added - which is the outcome that loses nobody's work and still makes the plan mean
 * something.
 */
export function changePlan(
  subscription: Subscription,
  toPlanId: string,
  cadence: 'monthly' | 'annual',
  currentPageCount: number,
): TransitionResult {
  const target = quotasForPlan(toPlanId, cadence)
  if (target === null) {
    return Object.freeze({
      allowed: false as const,
      code: 'unknown-plan',
      message: 'That plan is not in the current price book, so its allowances cannot be applied.',
    })
  }
  if (subscription.state === 'past-due') {
    // Changing plan while a payment is outstanding either forgives the debt or carries it to a
    // plan that did not incur it. Both need a decision nobody has made.
    return Object.freeze({
      allowed: false as const,
      code: 'payment-outstanding',
      message: 'Settle the outstanding payment before changing plan.',
    })
  }
  return Object.freeze({
    allowed: true as const,
    next: Object.freeze({ ...subscription, planId: toPlanId, cadence }),
    excess: downgradeExcess(toPlanId, cadence, currentPageCount),
  })
}

/** How far a downgrade would put an existing site over its new allowance. */
export function downgradeExcess(
  toPlanId: string,
  cadence: 'monthly' | 'annual',
  currentPageCount: number,
): Readonly<{ overBy: number, message: string | null }> {
  const target = quotasForPlan(toPlanId, cadence)
  if (target === null) return Object.freeze({ overBy: 0, message: null })
  const overBy = Math.max(0, currentPageCount - target.pages)
  if (overBy === 0) return Object.freeze({ overBy: 0, message: null })
  const pages = overBy === 1 ? '1 page' : `${overBy} pages`
  return Object.freeze({
    overBy,
    // States what happens rather than only that a limit is exceeded, because the fear the
    // sentence has to answer is "will you delete my work".
    message: `${pages} more than the new plan includes. Nothing is deleted, and the site keeps serving; you cannot add pages until you are within the allowance.`,
  })
}

/** Records a failed payment, starting the grace window at the first failure only. */
export function recordPaymentFailure(subscription: Subscription, atIso: string): Subscription {
  if (subscription.state === 'funded') {
    // There is nothing to charge, so a failure here is a bug in the caller rather than a state
    // this subscription can be in. Returned unchanged rather than corrupted.
    return subscription
  }
  // The window is measured from the FIRST failure. Resetting it on every retry would make the
  // grace period unbounded for anybody whose card fails repeatedly - the exact case it is
  // supposed to bound.
  const since = subscription.pastDueSince ?? atIso
  return Object.freeze({ ...subscription, state: 'past-due' as const, pastDueSince: since })
}

/** Records a successful payment, clearing the grace window. */
export function recordPaymentSuccess(subscription: Subscription, periodEndsAt: string): Subscription {
  if (subscription.state === 'funded') return subscription
  return Object.freeze({
    ...subscription,
    state: 'active' as const,
    periodEndsAt,
    pastDueSince: null,
  })
}

/** Why charging is not live yet, as data rather than a comment. */
export function reviewChargingReadiness(): Readonly<{ ready: boolean, reason: string }> {
  const chargeable = SEEDED_PLANS.filter((plan) => plan.checkoutAvailable)
  if (chargeable.length === 0) {
    return Object.freeze({
      ready: false,
      reason: 'No seeded plan sets checkoutAvailable, because task 66 left paid pricing unchargeable until measured costs justify it (tasks 104 and 106). The lifecycle is modelled and the funded starter assignment works; taking money does not.',
    })
  }
  return Object.freeze({ ready: true, reason: 'At least one seeded plan is chargeable.' })
}

function daysBetween(fromIso: string | null, toIso: string): number {
  if (fromIso === null) return 0
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  // An unparseable date reports ZERO days elapsed, which keeps the customer inside grace. The
  // opposite default would cut off a working site because a timestamp was malformed.
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0
  return Math.max(0, (to - from) / 86_400_000)
}

/**
 * The allowance a hosted tenant is entitled to, while no plan is yet chargeable.
 *
 * THIS IS DELIBERATELY SELF-LIMITING, and the reason is the risk it would otherwise carry. No
 * subscription is persisted yet, so there is no assignment to look up. Today that is harmless
 * because NOTHING IS CHARGEABLE - task 66 set checkoutAvailable false on every seeded plan - so
 * every hosted tenant genuinely is on the funded starter and returning its allowance is true.
 *
 * It stops being true the moment a paid plan can be bought, and a figure that quietly becomes
 * wrong is worse than one that is absent: the customer sees an allowance they did not buy. So the
 * assumption is GATED ON THE SAME FACT that makes it sound. Once a plan is chargeable this returns
 * null - unknown - which the surface already renders honestly, and the persisted-assignment
 * lookup becomes required rather than optional.
 */
export function assumedFundedStorageBytes(): number | null {
  if (reviewChargingReadiness().ready) {
    // A plan can now be bought, so the tenant's plan must be read rather than assumed.
    return null
  }
  const starter = SEEDED_PLANS.find(
    (plan) => plan.offeringClass === 'fuma-funded-starter' && plan.cadence === 'monthly',
  )
  return starter?.quotas.storageBytes ?? null
}
