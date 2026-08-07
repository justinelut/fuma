/**
 * Renewal and expiry.
 *
 * A domain expiring takes the customer's site and email down at once. If we hold the
 * registration, that outage is ours to have prevented, so the failure mode this module
 * is built against is not "renewal failed" but "renewal failed and nobody noticed".
 *
 * Three things it gets right that are easy to get wrong:
 *
 *   - **Renewal is re-quoted at current retail, never the original price.** Wholesale
 *     cost moves. Charging what the customer paid a year ago can mean renewing at a
 *     loss, and quietly.
 *   - **Expiry is not one date.** After it passes there is a grace period where renewal
 *     still works normally, then a redemption period where it costs far more, then the
 *     name is gone. Treating expiry as a single cliff either panics people early or
 *     tells them it is fine when the price has already jumped.
 *   - **A failed renewal escalates.** Silence after a failure is indistinguishable from
 *     success, which is why an unnoticed lapse happens at all.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'
import { createsRenewalObligation, type DomainPath } from './acquisitionPath'

/**
 * Where a domain sits relative to its expiry.
 *
 * Named for what the customer can still do, not for how many days have passed, because
 * the action available is the only part they care about.
 */
export const RenewalStageSchema = Type.Union([
  /** Comfortably in term. Nothing to do. */
  Type.Literal('active'),
  /** Renewal is due soon. Ordinary renewal, ordinary price. */
  Type.Literal('renewal-due'),
  /** Past expiry but still renewable at the normal price. */
  Type.Literal('grace'),
  /**
   * Past grace. Registries charge a substantial redemption fee here, so the price
   * shown must change or the quote is wrong.
   */
  Type.Literal('redemption'),
  /** Gone. Renewal is no longer possible. */
  Type.Literal('lost'),
])
export type RenewalStage = Static<typeof RenewalStageSchema>

/**
 * Registry timing, in days after expiry.
 *
 * Approximate by necessity — registries differ — so they are configurable rather than
 * hard-coded, and the defaults are the common gTLD case.
 */
export const RegistryWindowSchema = Type.Object({
  /** Days after expiry during which renewal is still ordinary. */
  graceDays: Type.Integer({ minimum: 0, maximum: 90 }),
  /** Days after grace during which redemption is possible at a premium. */
  redemptionDays: Type.Integer({ minimum: 0, maximum: 90 }),
  /** How long before expiry to start telling the customer. */
  noticeDays: Type.Integer({ minimum: 1, maximum: 180 }),
}, { additionalProperties: false })
export type RegistryWindow = Readonly<Static<typeof RegistryWindowSchema>>

export const DEFAULT_REGISTRY_WINDOW: RegistryWindow = Object.freeze({
  graceDays: 30,
  redemptionDays: 30,
  noticeDays: 30,
})

const MS_PER_DAY = 86_400_000

/** Whole days from `from` to `to`, negative once `to` has passed. */
export function daysUntil(to: string, from: string): number {
  const target = Date.parse(to)
  const now = Date.parse(from)
  if (!Number.isFinite(target) || !Number.isFinite(now)) {
    throw new TypeError('Renewal dates must be valid timestamps.')
  }
  return Math.floor((target - now) / MS_PER_DAY)
}

/** Which stage a domain is in. */
export function renewalStage(
  expiresAt: string,
  now: string,
  window: RegistryWindow = DEFAULT_REGISTRY_WINDOW,
): RenewalStage {
  const remaining = daysUntil(expiresAt, now)

  if (remaining > window.noticeDays) return 'active'
  if (remaining >= 0) return 'renewal-due'

  const pastExpiry = -remaining
  if (pastExpiry <= window.graceDays) return 'grace'
  if (pastExpiry <= window.graceDays + window.redemptionDays) return 'redemption'
  return 'lost'
}

export const UrgencySchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('informational'),
  Type.Literal('warning'),
  /** The site is at risk or already affected. */
  Type.Literal('critical'),
])
export type Urgency = Static<typeof UrgencySchema>

export const RenewalNoticeSchema = Type.Object({
  hostname: Type.String({ minLength: 1, maxLength: 253 }),
  stage: RenewalStageSchema,
  urgency: UrgencySchema,
  daysRemaining: Type.Integer({ minimum: -1_000_000, maximum: 1_000_000 }),
  /** Whether renewing is still possible at all. */
  renewable: Type.Boolean(),
  /** Whether the redemption premium applies. */
  premiumApplies: Type.Boolean(),
  message: Type.String({ minLength: 1, maxLength: 500 }),
}, { additionalProperties: false })
export type RenewalNotice = Readonly<Static<typeof RenewalNoticeSchema>>

/**
 * What to tell the customer.
 *
 * The message names the consequence rather than the date, because "expires in 3 days"
 * does not convey that the site goes down.
 */
export function renewalNotice(
  hostname: string,
  expiresAt: string,
  now: string,
  autoRenew: boolean,
  window: RegistryWindow = DEFAULT_REGISTRY_WINDOW,
): RenewalNotice {
  const stage = renewalStage(expiresAt, now, window)
  const daysRemaining = daysUntil(expiresAt, now)

  const base = {
    hostname,
    stage,
    daysRemaining,
  }

  switch (stage) {
    case 'active':
      return Object.freeze({
        ...base,
        urgency: 'none' as const,
        renewable: true,
        premiumApplies: false,
        message: autoRenew
          ? `Renews automatically in ${daysRemaining} days.`
          : `Expires in ${daysRemaining} days. Auto-renew is off.`,
      })

    case 'renewal-due':
      return Object.freeze({
        ...base,
        // Auto-renew off near expiry is a warning, not a note: nothing will happen
        // unless somebody acts.
        urgency: autoRenew ? ('informational' as const) : ('warning' as const),
        renewable: true,
        premiumApplies: false,
        message: autoRenew
          ? `Renews automatically in ${daysRemaining} days.`
          : `Expires in ${daysRemaining} days and auto-renew is off. `
            + `${hostname} will stop resolving — the site and any email on it go down.`,
      })

    case 'grace':
      return Object.freeze({
        ...base,
        urgency: 'critical' as const,
        renewable: true,
        premiumApplies: false,
        message:
          `${hostname} expired ${-daysRemaining} days ago and may already have stopped `
          + 'resolving. It can still be renewed at the normal price for a short while.',
      })

    case 'redemption':
      return Object.freeze({
        ...base,
        urgency: 'critical' as const,
        renewable: true,
        // The price genuinely changes here, so a quote that ignored it would be wrong.
        premiumApplies: true,
        message:
          `${hostname} is past its grace period. It can still be recovered, but the `
          + 'registry charges a redemption fee well above the normal renewal price.',
      })

    default:
      return Object.freeze({
        ...base,
        urgency: 'critical' as const,
        renewable: false,
        premiumApplies: false,
        message:
          `${hostname} has been released and can no longer be renewed. It may now be `
          + 'available to register by anyone.',
      })
  }
}

export type RenewalQuoteRefusal = Readonly<{
  code: 'not-our-obligation' | 'not-renewable' | 'no-current-price'
  message: string
}>

export type RenewalQuote = Readonly<{
  hostname: string
  /** Current retail, freshly computed. Never the price paid last time. */
  priceMinor: number
  currency: 'KES'
  premiumApplies: boolean
  periodYears: number
  /** Set when this quote costs more than the last renewal, so it can be explained. */
  increasedFromMinor?: number
}>

/**
 * Quote a renewal.
 *
 * Requires the *current* retail price as an argument rather than reading a stored one,
 * so there is no path that renews at a stale price. Wholesale cost moves, and charging
 * last year's price can mean renewing at a loss without anyone noticing.
 */
export function quoteRenewal(
  input: Readonly<{
    hostname: string
    path: DomainPath
    expiresAt: string
    now: string
    periodYears: number
    /** Current retail for this TLD and term, from the margin model. */
    currentRetailMinor: number
    /** What the customer paid last time, for explaining a change. */
    previousPaidMinor?: number
    window?: RegistryWindow
  }>,
): { quote: RenewalQuote } | { refusal: RenewalQuoteRefusal } {
  if (!createsRenewalObligation(input.path)) {
    return {
      refusal: {
        code: 'not-our-obligation',
        message:
          `${input.hostname} is connected, not registered through us, so we cannot renew `
          + 'it. The customer renews it with their own registrar.',
      },
    }
  }

  const notice = renewalNotice(
    input.hostname, input.expiresAt, input.now, false,
    input.window ?? DEFAULT_REGISTRY_WINDOW,
  )

  if (!notice.renewable) {
    return {
      refusal: {
        code: 'not-renewable',
        message: `${input.hostname} has been released and cannot be renewed.`,
      },
    }
  }

  if (input.currentRetailMinor <= 0) {
    return {
      refusal: {
        code: 'no-current-price',
        message:
          `No current price is available for ${input.hostname}. Refusing to quote rather `
          + 'than reusing a stale one, which could renew at a loss.',
      },
    }
  }

  const increased = input.previousPaidMinor !== undefined
    && input.currentRetailMinor > input.previousPaidMinor

  return {
    quote: Object.freeze({
      hostname: input.hostname,
      priceMinor: input.currentRetailMinor,
      currency: 'KES' as const,
      premiumApplies: notice.premiumApplies,
      periodYears: input.periodYears,
      ...(increased ? { increasedFromMinor: input.previousPaidMinor } : {}),
    }),
  }
}

export const RenewalAttemptSchema = Type.Object({
  hostname: Type.String({ minLength: 1, maxLength: 253 }),
  attemptedAt: Type.String({ format: 'date-time' }),
  succeeded: Type.Boolean(),
  /** Consecutive failures, for escalation. */
  consecutiveFailures: Type.Integer({ minimum: 0, maximum: 1000 }),
  failureReason: Type.Optional(Type.String({ maxLength: 400 })),
}, { additionalProperties: false })
export type RenewalAttempt = Readonly<Static<typeof RenewalAttemptSchema>>

export type Escalation = Readonly<{
  urgency: Urgency
  /** Whether a human must be told now, not merely logged. */
  notifyOperator: boolean
  notifyCustomer: boolean
  message: string
}>

/**
 * How loudly a failed renewal should be reported.
 *
 * A failure that only writes a log line is how a domain lapses: nothing distinguishes
 * it from success. So the first failure already notifies, and repeated failure while
 * the expiry window closes escalates to both the operator and the customer.
 */
export function escalateFailure(
  attempt: RenewalAttempt,
  expiresAt: string,
  now: string,
  window: RegistryWindow = DEFAULT_REGISTRY_WINDOW,
): Escalation | null {
  if (attempt.succeeded) return null

  const stage = renewalStage(expiresAt, now, window)
  const remaining = daysUntil(expiresAt, now)

  // Past expiry, any failure is an outage in progress.
  if (stage === 'grace' || stage === 'redemption' || stage === 'lost') {
    return {
      urgency: 'critical',
      notifyOperator: true,
      notifyCustomer: true,
      message:
        `Renewal of ${attempt.hostname} has failed ${attempt.consecutiveFailures} time(s) `
        + `and the domain is already past expiry. The site is down or about to be. `
        + `${attempt.failureReason ?? 'No reason was recorded.'}`,
    }
  }

  // Before expiry: the first failure is still worth a human seeing, because there is a
  // deadline and the window only narrows.
  return {
    urgency: attempt.consecutiveFailures >= 2 ? 'critical' : 'warning',
    notifyOperator: true,
    // The customer is told only once it is likely to need their action — usually a
    // payment method — rather than on a transient first failure.
    notifyCustomer: attempt.consecutiveFailures >= 2,
    message:
      `Renewal of ${attempt.hostname} failed (${attempt.consecutiveFailures} consecutive). `
      + `${remaining} days until expiry. `
      + `${attempt.failureReason ?? 'No reason was recorded.'}`,
  }
}

/**
 * Domains needing attention, most urgent first.
 *
 * Sorted by remaining days rather than alphabetically, because a list of expiring
 * domains is a work queue and the order is the whole point.
 */
export function attentionQueue(
  domains: readonly Readonly<{
    hostname: string
    path: DomainPath
    expiresAt: string
    autoRenew: boolean
  }>[],
  now: string,
  window: RegistryWindow = DEFAULT_REGISTRY_WINDOW,
): readonly RenewalNotice[] {
  return Object.freeze(
    domains
      // A connected domain's expiry is not ours to act on, so it does not belong in
      // our work queue even though we can see it.
      .filter((domain) => createsRenewalObligation(domain.path))
      .map((domain) => renewalNotice(
        domain.hostname, domain.expiresAt, now, domain.autoRenew, window,
      ))
      .filter((notice) => notice.urgency !== 'none')
      .sort((left, right) => left.daysRemaining - right.daysRemaining),
  )
}
