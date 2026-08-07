/**
 * Wholesale cost versus retail price for domain registration.
 *
 * Reselling domains only makes money if the difference between what the registrar
 * charges us and what we charge the customer is decided deliberately and recorded.
 * Before this, quotes carried a retail amount and nothing else — so there was no way
 * to answer "did we make money on that sale?" after the fact, and no way to stop a
 * price being set below cost.
 *
 * Three rules the model enforces, each because getting it wrong costs real money:
 *
 *   - **Integer minor units only.** Money in floating point accumulates error, and a
 *     price that is a cent out is a price that fails reconciliation. Every amount here
 *     is an integer number of cents.
 *   - **Retail is never below cost.** A markup rule that would price under wholesale
 *     is refused rather than clamped silently, because silently selling at a loss on
 *     one TLD is exactly the kind of thing nobody notices for months.
 *   - **Both figures are recorded on the sale.** Wholesale cost moves; if only the
 *     retail price were stored, a later cost change would rewrite the apparent margin
 *     on every historical sale.
 *
 * Deliberately vendor-neutral: this file sits inside the registrar core, where the
 * architecture gate forbids naming a registrar. Cost comes in as data from whichever
 * adapter fetched it.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'

/** Minor units — cents. Integer to keep money exact. */
const MoneySchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })

/** A positive amount, for prices that cannot be free. */
const PositiveMoneySchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })

export const CurrencySchema = Type.Literal('KES')

/**
 * What the registrar charges us, per TLD and term.
 *
 * Stored per term rather than derived by multiplication: registrars price a two-year
 * registration differently from twice a one-year one, and assuming otherwise would
 * misprice every multi-year sale.
 */
export const WholesaleCostSchema = Type.Object({
  /** TLD without the dot, lowercased: `com`, `co.ke`. */
  tld: Type.String({ minLength: 2, maxLength: 32, pattern: '^[a-z0-9.-]+$' }),
  periodYears: Type.Integer({ minimum: 1, maximum: 10 }),
  currency: CurrencySchema,
  /** Cost to register for this term. */
  registrationCostMinor: PositiveMoneySchema,
  /** Cost to renew for this term. Often higher than registration. */
  renewalCostMinor: PositiveMoneySchema,
  /** When this cost was observed, so a stale sheet is visible. */
  observedAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false })
export type WholesaleCost = Readonly<Static<typeof WholesaleCostSchema>>

/**
 * How retail is derived from cost.
 *
 * Percentage plus a floor. The floor matters because a percentage of a very cheap TLD
 * is a rounding error — the work of registering and supporting a domain costs the same
 * regardless of what the registrar charged for it.
 */
export const MarkupRuleSchema = Type.Object({
  /** Basis points over cost. 2500 = 25%. Integer, so the rule itself is exact. */
  markupBasisPoints: Type.Integer({ minimum: 0, maximum: 100_000 }),
  /** Minimum margin per sale, whatever the percentage produces. */
  minimumMarginMinor: MoneySchema,
  /**
   * Round the final price up to a multiple of this, for prices that read as prices.
   * 100 gives whole currency units. Rounding is always up, so it can only ever
   * increase margin — rounding down could cross below cost.
   */
  roundUpToMinor: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
}, { additionalProperties: false })
export type MarkupRule = Readonly<Static<typeof MarkupRuleSchema>>

/** A priced offer, carrying both sides so margin is never inferred. */
export const RetailPriceSchema = Type.Object({
  tld: Type.String({ minLength: 2, maxLength: 32 }),
  periodYears: Type.Integer({ minimum: 1, maximum: 10 }),
  currency: CurrencySchema,
  /** What we pay. Never shown to a customer. */
  costMinor: PositiveMoneySchema,
  /** What the customer pays. */
  priceMinor: PositiveMoneySchema,
  /** priceMinor - costMinor, stored rather than computed on read. */
  marginMinor: MoneySchema,
}, { additionalProperties: false })
export type RetailPrice = Readonly<Static<typeof RetailPriceSchema>>

export type PricingRefusal = Readonly<{
  code: 'below-cost' | 'currency-mismatch' | 'unknown-tld' | 'no-cost-for-term'
  message: string
}>

/**
 * Apply a markup rule to a cost.
 *
 * Integer arithmetic throughout: the basis-point multiply is done before the divide so
 * no intermediate fraction is discarded.
 */
function applyMarkup(costMinor: number, rule: MarkupRule): number {
  const byPercentage = costMinor + Math.ceil((costMinor * rule.markupBasisPoints) / 10_000)
  // The floor and the percentage are alternatives, not additions: whichever gives the
  // larger margin wins, so a cheap TLD still covers its own handling cost.
  const byFloor = costMinor + rule.minimumMarginMinor
  const target = Math.max(byPercentage, byFloor)

  if (rule.roundUpToMinor === undefined) return target
  // Always up. Rounding down could land below cost, which is the one outcome that must
  // be impossible.
  return Math.ceil(target / rule.roundUpToMinor) * rule.roundUpToMinor
}

/**
 * Price a registration.
 *
 * Returns a refusal rather than a price when the inputs cannot produce a sound one, so
 * a misconfigured markup surfaces as a failed quote rather than a loss-making sale.
 */
export function priceRegistration(
  cost: WholesaleCost,
  rule: MarkupRule,
): { price: RetailPrice } | { refusal: PricingRefusal } {
  const priceMinor = applyMarkup(cost.registrationCostMinor, rule)

  if (priceMinor < cost.registrationCostMinor) {
    return {
      refusal: {
        code: 'below-cost',
        message:
          `Markup produced ${priceMinor} for .${cost.tld}, below the ${cost.registrationCostMinor} `
          + 'we pay. Refusing rather than selling at a loss.',
      },
    }
  }

  return {
    price: Object.freeze({
      tld: cost.tld,
      periodYears: cost.periodYears,
      currency: cost.currency,
      costMinor: cost.registrationCostMinor,
      priceMinor,
      marginMinor: priceMinor - cost.registrationCostMinor,
    }),
  }
}

/**
 * Price a renewal.
 *
 * Priced from the renewal cost, not the registration cost. Registrars commonly sell a
 * first year cheaply and charge more to renew; pricing a renewal off the registration
 * cost would lose money on every one.
 */
export function priceRenewal(
  cost: WholesaleCost,
  rule: MarkupRule,
): { price: RetailPrice } | { refusal: PricingRefusal } {
  const priceMinor = applyMarkup(cost.renewalCostMinor, rule)

  if (priceMinor < cost.renewalCostMinor) {
    return {
      refusal: {
        code: 'below-cost',
        message:
          `Renewal markup produced ${priceMinor} for .${cost.tld}, below the `
          + `${cost.renewalCostMinor} renewal cost.`,
      },
    }
  }

  return {
    price: Object.freeze({
      tld: cost.tld,
      periodYears: cost.periodYears,
      currency: cost.currency,
      costMinor: cost.renewalCostMinor,
      priceMinor,
      marginMinor: priceMinor - cost.renewalCostMinor,
    }),
  }
}

/**
 * The TLD of a hostname, for looking up cost.
 *
 * Two-level public suffixes are handled explicitly. In the markets this serves
 * `co.ke`, `ac.ke` and their siblings are the common case, and treating `co.ke` as
 * `ke` would price a domain against a cost line that does not exist.
 */
const TWO_LEVEL_SUFFIXES: ReadonlySet<string> = new Set([
  'co.ke', 'or.ke', 'ne.ke', 'go.ke', 'ac.ke', 'sc.ke', 'me.ke', 'mobi.ke', 'info.ke',
  'co.uk', 'org.uk', 'me.uk', 'ac.uk',
  'co.za', 'co.tz', 'co.ug',
  'com.au', 'net.au', 'org.au',
  'com.ng', 'com.gh',
])

export function tldOf(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean)
  // A bare label is not a registrable domain, so there is no TLD to price.
  if (labels.length < 2) return ''

  const lastTwo = labels.slice(-2).join('.')
  // Needs at least three labels: `co.ke` on its own is the suffix, not a domain.
  if (labels.length >= 3 && TWO_LEVEL_SUFFIXES.has(lastTwo)) return lastTwo

  return labels[labels.length - 1] ?? ''
}

/**
 * Find the cost line for a hostname and term.
 *
 * Refuses rather than falling back to a different term, because quoting a one-year
 * cost for a two-year registration would under-charge by a year.
 */
export function findCost(
  costs: readonly WholesaleCost[],
  hostname: string,
  periodYears: number,
): { cost: WholesaleCost } | { refusal: PricingRefusal } {
  const tld = tldOf(hostname)
  if (tld === '') {
    return {
      refusal: { code: 'unknown-tld', message: `Cannot determine a TLD from "${hostname}".` },
    }
  }

  const forTld = costs.filter((candidate) => candidate.tld === tld)
  if (forTld.length === 0) {
    return {
      refusal: {
        code: 'unknown-tld',
        message: `No wholesale cost recorded for .${tld}, so it cannot be offered for sale.`,
      },
    }
  }

  const exact = forTld.find((candidate) => candidate.periodYears === periodYears)
  if (!exact) {
    return {
      refusal: {
        code: 'no-cost-for-term',
        message:
          `No ${periodYears}-year cost for .${tld}. Terms available: `
          + `${forTld.map((candidate) => candidate.periodYears).sort().join(', ')}. `
          + 'Multiplying a shorter term would misprice it.',
      },
    }
  }

  return { cost: exact }
}

/**
 * What a completed sale records.
 *
 * Both figures are captured at the moment of sale. Storing only the price and looking
 * cost up later would make every historical margin move whenever the cost sheet
 * changed, which is the difference between a ledger and a guess.
 */
export const SaleMarginRecordSchema = Type.Object({
  hostname: Type.String({ minLength: 1, maxLength: 253 }),
  kind: Type.Union([Type.Literal('registration'), Type.Literal('renewal')]),
  periodYears: Type.Integer({ minimum: 1, maximum: 10 }),
  currency: CurrencySchema,
  costMinor: PositiveMoneySchema,
  priceMinor: PositiveMoneySchema,
  marginMinor: MoneySchema,
  /** When the sale completed. */
  soldAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false })
export type SaleMarginRecord = Readonly<Static<typeof SaleMarginRecordSchema>>

/** Build the margin record for a completed sale. */
export function recordSaleMargin(
  hostname: string,
  kind: 'registration' | 'renewal',
  price: RetailPrice,
  soldAt: string,
): SaleMarginRecord {
  return Object.freeze({
    hostname,
    kind,
    periodYears: price.periodYears,
    currency: price.currency,
    costMinor: price.costMinor,
    priceMinor: price.priceMinor,
    marginMinor: price.marginMinor,
    soldAt,
  })
}

/**
 * Total margin across sales.
 *
 * Refuses to add across currencies rather than producing a meaningless number, which
 * is the kind of total that gets copied into a board deck.
 */
export function totalMargin(
  records: readonly SaleMarginRecord[],
): { currency: 'KES', marginMinor: number } | { refusal: PricingRefusal } {
  if (records.length === 0) return { currency: 'KES', marginMinor: 0 }

  const currencies = new Set(records.map((record) => record.currency))
  if (currencies.size > 1) {
    return {
      refusal: {
        code: 'currency-mismatch',
        message:
          `Cannot total margin across ${[...currencies].join(', ')}. `
          + 'Convert to one currency first, with the rate recorded.',
      },
    }
  }

  return {
    currency: 'KES',
    marginMinor: records.reduce((sum, record) => sum + record.marginMinor, 0),
  }
}

/**
 * Whether a quote's retail price still covers current cost.
 *
 * A quote outlives the cost sheet it was priced from. Checking before purchase is what
 * stops a wholesale increase turning an outstanding quote into a loss.
 */
export function quoteStillProfitable(
  quotedPriceMinor: number,
  currentCostMinor: number,
): boolean {
  return quotedPriceMinor >= currentCostMinor
}
