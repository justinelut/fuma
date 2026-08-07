/**
 * What the hosted admin shows about a domain.
 *
 * A presenter rather than a component, so the rule that matters is enforceable in one
 * place and testable without rendering anything.
 *
 * **The rule: wholesale cost never reaches this layer.** The margin model carries both
 * figures because margin has to be auditable, and that makes it exactly one careless
 * spread away from appearing in a customer-facing payload. So the row type has no cost
 * field at all — not an optional one, not a nullable one. A field that does not exist
 * cannot be leaked by accident, and adding one is a visible change somebody has to
 * justify.
 *
 * The second rule is that a connected domain and a registered one look different,
 * because what the customer can do about them differs. Showing a renew button for a
 * domain we do not hold is an offer we cannot honour.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'
import { capabilitiesOf, type DomainPath } from './acquisitionPath'
import {
  DEFAULT_REGISTRY_WINDOW,
  renewalNotice,
  type RegistryWindow,
  type RenewalNotice,
} from './renewal'

/**
 * One row in the domains list.
 *
 * Deliberately contains no cost field. See the note above.
 */
export const DomainRowSchema = Type.Object({
  hostname: Type.String({ minLength: 1, maxLength: 253 }),
  /** How we came to serve it, which decides what actions apply. */
  path: Type.Union([Type.Literal('register'), Type.Literal('connect')]),
  /** Formatted retail price, or null when there is nothing to sell. */
  renewalPrice: Type.Union([Type.String({ maxLength: 32 }), Type.Null()]),
  expiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  autoRenew: Type.Union([Type.Boolean(), Type.Null()]),
  /** Whether a renew action should be offered at all. */
  canRenew: Type.Boolean(),
  /** Whether we can change its DNS. */
  managedDns: Type.Boolean(),
  notice: Type.Union([
    Type.Object({
      urgency: Type.String({ maxLength: 16 }),
      message: Type.String({ maxLength: 500 }),
    }, { additionalProperties: false }),
    Type.Null(),
  ]),
}, { additionalProperties: false })
export type DomainRow = Readonly<Static<typeof DomainRowSchema>>

/** Format minor units as a displayable amount. */
export function formatPrice(minor: number, currency: 'KES' = 'KES'): string {
  const whole = Math.floor(minor / 100)
  const cents = minor % 100
  return `${currency} ${whole.toLocaleString('en-KE')}.${String(cents).padStart(2, '0')}`
}

export type DomainInput = Readonly<{
  hostname: string
  path: DomainPath
  expiresAt: string | null
  autoRenew: boolean | null
  /**
   * Current retail renewal price in minor units, already computed by the margin model.
   *
   * Retail only. The presenter has no way to receive cost, which is the point.
   */
  renewalRetailMinor: number | null
}>

/**
 * Build a row.
 *
 * A connected domain gets no price and no renew action: there is nothing to sell and no
 * renewal we could perform. Offering either would be a promise we cannot keep.
 */
export function domainRow(
  input: DomainInput,
  now: string,
  window: RegistryWindow = DEFAULT_REGISTRY_WINDOW,
): DomainRow {
  const capabilities = capabilitiesOf(input.path)

  let notice: RenewalNotice | null = null
  if (capabilities.weRenew && input.expiresAt !== null) {
    notice = renewalNotice(
      input.hostname, input.expiresAt, now, input.autoRenew ?? false, window,
    )
  }

  return Object.freeze({
    hostname: input.hostname,
    path: input.path,
    // No price for a domain we do not sell renewals for.
    renewalPrice: capabilities.weRenew && input.renewalRetailMinor !== null
      ? formatPrice(input.renewalRetailMinor)
      : null,
    expiresAt: input.expiresAt,
    // Auto-renew is meaningless for a domain we do not hold, so it reads as absent
    // rather than as off — off would imply we could turn it on.
    autoRenew: capabilities.weRenew ? input.autoRenew : null,
    canRenew: capabilities.weRenew && (notice?.renewable ?? false),
    managedDns: capabilities.weControlDns,
    notice: notice === null || notice.urgency === 'none'
      ? null
      : Object.freeze({ urgency: notice.urgency, message: notice.message }),
  })
}

/**
 * The list, ordered so what needs attention is at the top.
 *
 * Urgency first, then soonest expiry. A domains page sorted alphabetically buries the
 * one that is about to take a site down.
 */
export function domainList(
  domains: readonly DomainInput[],
  now: string,
  window: RegistryWindow = DEFAULT_REGISTRY_WINDOW,
): readonly DomainRow[] {
  const rank: Readonly<Record<string, number>> = Object.freeze({
    critical: 0, warning: 1, informational: 2,
  })

  return Object.freeze([...domains]
    .map((domain) => domainRow(domain, now, window))
    .sort((left, right) => {
      const leftRank = left.notice ? rank[left.notice.urgency] ?? 3 : 3
      const rightRank = right.notice ? rank[right.notice.urgency] ?? 3 : 3
      if (leftRank !== rightRank) return leftRank - rightRank
      const leftExpiry = left.expiresAt === null ? Infinity : Date.parse(left.expiresAt)
      const rightExpiry = right.expiresAt === null ? Infinity : Date.parse(right.expiresAt)
      if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry
      return left.hostname.localeCompare(right.hostname)
    }))
}

/**
 * A price shown before purchase.
 *
 * Separate from the row because a quote has an expiry of its own and the customer
 * should see it: a price with no stated validity invites arguing about it later.
 */
export const PurchaseOfferSchema = Type.Object({
  hostname: Type.String({ minLength: 1, maxLength: 253 }),
  price: Type.String({ minLength: 1, maxLength: 32 }),
  periodYears: Type.Integer({ minimum: 1, maximum: 10 }),
  /** What it will cost to renew, stated up front. */
  renewalPrice: Type.String({ minLength: 1, maxLength: 32 }),
  quoteExpiresAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false })
export type PurchaseOffer = Readonly<Static<typeof PurchaseOfferSchema>>

/**
 * Present an offer.
 *
 * Renewal price is shown alongside the first-year price on purpose. Registrars commonly
 * sell a cheap first year and renew at several times that, and a customer discovering
 * it at renewal has a legitimate grievance.
 */
export function purchaseOffer(
  input: Readonly<{
    hostname: string
    registrationRetailMinor: number
    renewalRetailMinor: number
    periodYears: number
    quoteExpiresAt: string
  }>,
): PurchaseOffer {
  return Object.freeze({
    hostname: input.hostname,
    price: formatPrice(input.registrationRetailMinor),
    periodYears: input.periodYears,
    renewalPrice: formatPrice(input.renewalRetailMinor),
    quoteExpiresAt: input.quoteExpiresAt,
  })
}

/**
 * Whether an offer discloses a renewal increase worth pointing out.
 *
 * A renewal materially above the first-year price should be called out rather than
 * merely listed, because "it was in the table" is not the same as having been told.
 */
export function renewalIsSubstantiallyHigher(
  registrationRetailMinor: number,
  renewalRetailMinor: number,
): boolean {
  if (registrationRetailMinor <= 0) return false
  // A fifth again is the threshold where somebody would feel misled by silence.
  return renewalRetailMinor >= registrationRetailMinor * 1.2
}
