/**
 * Registering a domain through us versus connecting one the customer already owns.
 *
 * The same commercial split as connected-versus-managed email, and it needs the same
 * discipline. Both paths end with the customer's domain pointing at their site, so
 * they look alike in the product and are entirely different underneath.
 *
 *   **Register.** We buy the domain from the registrar. We hold the registration, we
 *   earn the margin, we control the nameservers, and we are responsible for renewing
 *   it. Failure to renew takes the customer's site down, so this path carries an
 *   ongoing obligation, not just a sale.
 *
 *   **Connect.** The customer already owns the domain somewhere else. There is no
 *   sale, no margin, and no registrar relationship. We verify they control it and
 *   tell them which records to add. We cannot write those records and must not
 *   pretend we can.
 *
 * The mistake this module prevents is quoting a price for a domain the customer
 * already owns. It reads as either a scam or a bug, and both cost trust.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'

export const DomainPathSchema = Type.Union([
  Type.Literal('register'),
  Type.Literal('connect'),
])
export type DomainPath = Static<typeof DomainPathSchema>

/** What availability tells us about which path applies. */
export const AvailabilitySchema = Type.Union([
  /** Nobody owns it. Registering is possible; connecting is not. */
  Type.Literal('available'),
  /** Somebody owns it — possibly this customer, possibly a stranger. */
  Type.Literal('taken'),
  /**
   * The registry could not be reached.
   *
   * A distinct state on purpose: treating an unreachable registry as "taken" would
   * push customers into the connect path for domains they could have bought, and
   * treating it as "available" would take payment for a domain we cannot register.
   */
  Type.Literal('unknown'),
])
export type Availability = Static<typeof AvailabilitySchema>

export const PathDecisionSchema = Type.Object({
  hostname: Type.String({ minLength: 3, maxLength: 253 }),
  availability: AvailabilitySchema,
  path: Type.Union([DomainPathSchema, Type.Null()]),
  /** Whether we may quote a price. False whenever we are not selling. */
  quotable: Type.Boolean(),
  /** What to tell the customer. */
  message: Type.String({ minLength: 1, maxLength: 500 }),
}, { additionalProperties: false })
export type PathDecision = Readonly<Static<typeof PathDecisionSchema>>

/**
 * Decide the path from availability.
 *
 * Detected rather than asked, because a customer typing their existing domain into a
 * "find a domain" box should be recognised, not quoted at.
 */
export function decidePath(hostname: string, availability: Availability): PathDecision {
  if (availability === 'available') {
    return Object.freeze({
      hostname,
      availability,
      path: 'register',
      quotable: true,
      message: `${hostname} is available. We can register it for you.`,
    })
  }

  if (availability === 'taken') {
    return Object.freeze({
      hostname,
      availability,
      path: 'connect',
      // The single most important false here: never quote for a domain somebody owns.
      quotable: false,
      message:
        `${hostname} is already registered. If it is yours, connect it by adding the DNS `
        + 'records we provide. There is nothing to buy.',
    })
  }

  return Object.freeze({
    hostname,
    availability,
    path: null,
    quotable: false,
    message:
      `We could not reach the registry to check ${hostname}. Try again shortly — we will `
      + 'not take payment for a domain we cannot confirm we can register.',
  })
}

export type PathCapabilities = Readonly<{
  /** Whether we hold the registration and therefore earn margin. */
  weEarnMargin: boolean
  /** Whether we can write DNS records ourselves. */
  weControlDns: boolean
  /** Whether we are responsible for renewal. */
  weRenew: boolean
  /** Whether the customer must add records by hand. */
  customerAddsRecords: boolean
}>

/**
 * What each path lets us do.
 *
 * Stated as data so a feature can ask rather than assume. The email connection flow
 * needs exactly this: on the register path it writes MX records itself, on the connect
 * path it can only display them.
 */
export function capabilitiesOf(path: DomainPath): PathCapabilities {
  return path === 'register'
    ? Object.freeze({
      weEarnMargin: true,
      weControlDns: true,
      weRenew: true,
      customerAddsRecords: false,
    })
    : Object.freeze({
      weEarnMargin: false,
      weControlDns: false,
      weRenew: false,
      customerAddsRecords: true,
    })
}

export type QuoteRefusal = Readonly<{
  code: 'not-for-sale' | 'availability-unknown'
  message: string
}>

/**
 * Guard a quote request against the decision.
 *
 * A second gate on top of `quotable`, because a quote is where money starts and the
 * cost of getting it wrong is a customer being charged for something they own.
 */
export function assertQuotable(decision: PathDecision): QuoteRefusal | null {
  if (decision.quotable) return null

  if (decision.availability === 'unknown') {
    return {
      code: 'availability-unknown',
      message:
        `Cannot quote ${decision.hostname} until the registry confirms it is available.`,
    }
  }

  return {
    code: 'not-for-sale',
    message:
      `${decision.hostname} is already registered, so there is no registration to sell. `
      + 'Guide the customer through connecting it instead.',
  }
}

/**
 * Whether we can apply DNS records ourselves for this path.
 *
 * The question the email one-click flow asks. On the connect path the honest answer
 * is no, and the flow has to show records to paste rather than claim to have written
 * them.
 */
export function canWriteDnsRecords(path: DomainPath): boolean {
  return capabilitiesOf(path).weControlDns
}

/**
 * Renewal obligations we have taken on.
 *
 * Only the register path creates one. Listing them is how an expiry sweep knows which
 * domains are its responsibility — a connected domain expiring is the customer's
 * problem to fix, but a registered one expiring is ours to have prevented.
 */
export function createsRenewalObligation(path: DomainPath): boolean {
  return capabilitiesOf(path).weRenew
}
