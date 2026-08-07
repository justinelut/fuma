/**
 * Retail pricing for metered resources.
 *
 * `costBaseline.ts` records what each meter costs us — storage, egress, email,
 * build minutes — in USD minor-micros per unit. It contains no pricing at all
 * (grep for margin, markup or retail there returns nothing). This is the layer
 * above it: what we charge, and whether that charge both earns something and
 * beats the alternative.
 *
 * The reason it is a *band* rather than a markup
 * ---------------------------------------------
 *
 * A markup alone answers "are we profitable?" and nothing else. It will happily
 * price a plan above every competitor, which is profitable right up to the point
 * where nobody buys it. So each price is bounded on both sides:
 *
 *   floor   = unit cost + minimum margin        — below this we lose money
 *   ceiling = the competitor benchmark          — above this we lose the customer
 *
 * When the floor exceeds the ceiling the band is **empty**, and that is the most
 * valuable thing this module produces. It means we cannot beat that competitor at
 * that margin, and the choice — thinner margin, higher price, or don't offer it —
 * is a decision to take deliberately rather than discover from churn. So an empty
 * band is reported with both numbers, never silently resolved to one side.
 *
 * Egress deserves specific mention: the infrastructure charges for it, it scales
 * with traffic rather than with what a customer stores, and it is consequently the
 * easiest cost to under-recover. A bandwidth allowance set generously "to be
 * competitive" is how a hosting business quietly loses money on its best customers.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'
import { MeterClassSchema, type MeterClass } from './contracts'

/** USD minor-micros, matching the cost baseline so no conversion is needed. */
const MicrosSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })

/**
 * What a customer may consume before overage applies.
 *
 * Held per meter rather than per plan tier so a plan is assembled from allowances
 * rather than each tier restating every meter.
 */
export const AllowanceSchema = Type.Object({
  meter: MeterClassSchema,
  /** Units included in the plan. Zero means every unit is billable. */
  includedUnits: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
export type Allowance = Readonly<Static<typeof AllowanceSchema>>

/**
 * How a meter's retail price is derived.
 *
 * Modest markup is a deliberate stance for a price-sensitive market, so the
 * percentage is expressed in basis points and can legitimately be small. The
 * minimum-margin floor still applies, because a percentage of a very small unit
 * cost rounds to nothing and every billable unit carries some handling cost.
 */
export const MeterMarkupSchema = Type.Object({
  meter: MeterClassSchema,
  markupBasisPoints: Type.Integer({ minimum: 0, maximum: 100_000 }),
  /** Absolute minimum margin per unit, in micros. */
  minimumMarginMicros: MicrosSchema,
}, { additionalProperties: false })
export type MeterMarkup = Readonly<Static<typeof MeterMarkupSchema>>

/** A competitor's published price for the same unit, for the ceiling. */
export const BenchmarkSchema = Type.Object({
  meter: MeterClassSchema,
  /** Who charges this. Recorded so a stale benchmark can be traced and re-checked. */
  competitor: Type.String({ minLength: 1, maxLength: 120 }),
  unitPriceMicros: MicrosSchema,
  observedAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false })
export type Benchmark = Readonly<Static<typeof BenchmarkSchema>>

export const PriceBandSchema = Type.Object({
  meter: MeterClassSchema,
  unitCostMicros: MicrosSchema,
  /** Cost plus the minimum acceptable margin. */
  floorMicros: MicrosSchema,
  /** Lowest competitor benchmark, or null when none is recorded. */
  ceilingMicros: Type.Union([MicrosSchema, Type.Null()]),
  /** The competitor setting the ceiling. */
  ceilingSetBy: Type.Union([Type.String({ maxLength: 120 }), Type.Null()]),
  /** Whether a price exists that both earns margin and undercuts the market. */
  viable: Type.Boolean(),
}, { additionalProperties: false })
export type PriceBand = Readonly<Static<typeof PriceBandSchema>>

export const RetailPriceSchema = Type.Object({
  meter: MeterClassSchema,
  unitCostMicros: MicrosSchema,
  unitPriceMicros: MicrosSchema,
  marginMicros: MicrosSchema,
  /** Margin as basis points of price, for comparing against a margin policy. */
  marginBasisPoints: Type.Integer({ minimum: -1_000_000, maximum: 10_000 }),
  /** Whether the price undercuts the lowest recorded benchmark. */
  beatsBenchmark: Type.Boolean(),
}, { additionalProperties: false })
export type RetailPrice = Readonly<Static<typeof RetailPriceSchema>>

export type PricingProblem = Readonly<{
  code: 'empty-band' | 'below-cost' | 'no-cost' | 'no-markup'
  meter: MeterClass
  message: string
}>

/** Cost plus the larger of the percentage markup and the absolute floor. */
function floorFor(unitCostMicros: number, markup: MeterMarkup): number {
  const byPercentage = unitCostMicros
    + Math.ceil((unitCostMicros * markup.markupBasisPoints) / 10_000)
  const byFloor = unitCostMicros + markup.minimumMarginMicros
  // Alternatives, not additive: the floor exists to cover handling on cheap units,
  // not to surcharge expensive ones.
  return Math.max(byPercentage, byFloor)
}

/** The lowest benchmark for a meter, which is the price to beat. */
function lowestBenchmark(
  benchmarks: readonly Benchmark[],
  meter: MeterClass,
): Benchmark | null {
  const forMeter = benchmarks.filter((benchmark) => benchmark.meter === meter)
  if (forMeter.length === 0) return null
  // The cheapest competitor sets the ceiling. Averaging them would let an expensive
  // outlier disguise the fact that somebody is cheaper than us.
  return forMeter.reduce((lowest, candidate) =>
    candidate.unitPriceMicros < lowest.unitPriceMicros ? candidate : lowest)
}

/**
 * Compute the band for one meter.
 *
 * Reports viability rather than deciding it. A band with no benchmark is viable by
 * default — we simply have no market information, which is different from knowing
 * we are competitive.
 */
export function priceBand(
  meter: MeterClass,
  unitCostMicros: number,
  markup: MeterMarkup,
  benchmarks: readonly Benchmark[],
): PriceBand {
  const floorMicros = floorFor(unitCostMicros, markup)
  const benchmark = lowestBenchmark(benchmarks, meter)

  return Object.freeze({
    meter,
    unitCostMicros,
    floorMicros,
    ceilingMicros: benchmark?.unitPriceMicros ?? null,
    ceilingSetBy: benchmark?.competitor ?? null,
    viable: benchmark === null || floorMicros <= benchmark.unitPriceMicros,
  })
}

/**
 * Price a meter inside its band.
 *
 * Prices at the floor rather than just under the ceiling. In a price-sensitive
 * market the cheapest sustainable price wins more than the highest defensible one,
 * and pricing at the ceiling would mean matching a competitor instead of beating
 * them.
 */
export function priceMeter(
  meter: MeterClass,
  unitCostMicros: number,
  markup: MeterMarkup,
  benchmarks: readonly Benchmark[],
): { price: RetailPrice } | { problem: PricingProblem } {
  if (markup.meter !== meter) {
    return {
      problem: {
        code: 'no-markup',
        meter,
        message: `Markup rule is for ${markup.meter}, not ${meter}.`,
      },
    }
  }

  const band = priceBand(meter, unitCostMicros, markup, benchmarks)

  if (!band.viable) {
    return {
      problem: {
        code: 'empty-band',
        meter,
        message:
          `${meter} cannot be priced competitively at this margin: the floor is `
          + `${band.floorMicros} micros but ${band.ceilingSetBy} charges `
          + `${band.ceilingMicros}. Either accept thinner margin, price above them, `
          + 'or do not offer this meter as a paid overage.',
      },
    }
  }

  const unitPriceMicros = band.floorMicros
  if (unitPriceMicros < unitCostMicros) {
    return {
      problem: {
        code: 'below-cost',
        meter,
        message: `${meter} priced at ${unitPriceMicros} below its ${unitCostMicros} cost.`,
      },
    }
  }

  const marginMicros = unitPriceMicros - unitCostMicros
  return {
    price: Object.freeze({
      meter,
      unitCostMicros,
      unitPriceMicros,
      marginMicros,
      // Zero-priced units would divide by zero; a free unit earns no margin.
      marginBasisPoints: unitPriceMicros === 0
        ? 0
        : Math.floor((marginMicros * 10_000) / unitPriceMicros),
      beatsBenchmark: band.ceilingMicros !== null && unitPriceMicros < band.ceilingMicros,
    }),
  }
}

/**
 * Billable units after the plan allowance.
 *
 * Separate from pricing because the allowance is what makes a plan feel generous
 * while the overage rate is what makes it sustainable, and the two are set by
 * different reasoning.
 */
export function billableUnits(consumedUnits: number, allowance: Allowance): number {
  return Math.max(0, consumedUnits - allowance.includedUnits)
}

/** What a period's consumption costs and earns. */
export const UsageChargeSchema = Type.Object({
  meter: MeterClassSchema,
  consumedUnits: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  includedUnits: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  billableUnits: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  /**
   * Cost of everything consumed, including what the allowance covered.
   *
   * Recorded in full because the allowance is not free to serve: an allowance that
   * looks generous is a real cost, and netting it out of the record would hide
   * exactly the leak worth watching.
   */
  totalCostMicros: MicrosSchema,
  revenueMicros: MicrosSchema,
  /** Revenue minus the cost of ALL units, so an over-generous allowance shows up. */
  netMicros: Type.Integer({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
export type UsageCharge = Readonly<Static<typeof UsageChargeSchema>>

/**
 * Charge a period's usage.
 *
 * Net is computed against the cost of *every* unit, not only billable ones. That is
 * the difference between a number that flatters the allowance and one that tells the
 * truth about it: a plan whose included units cost more than the plan fee is losing
 * money on every customer who uses what they were promised.
 */
export function chargeUsage(
  price: RetailPrice,
  allowance: Allowance,
  consumedUnits: number,
): UsageCharge {
  const billable = billableUnits(consumedUnits, allowance)
  const totalCostMicros = consumedUnits * price.unitCostMicros
  const revenueMicros = billable * price.unitPriceMicros

  return Object.freeze({
    meter: price.meter,
    consumedUnits,
    includedUnits: allowance.includedUnits,
    billableUnits: billable,
    totalCostMicros,
    revenueMicros,
    netMicros: revenueMicros - totalCostMicros,
  })
}

/**
 * Meters whose allowance costs more than it can ever recover.
 *
 * A meter where included units carry cost and nothing else covers them is a
 * structural loss, not a bad month. Surfacing it against the plan fee is the check
 * that catches an allowance set by optimism.
 */
export function unrecoveredAllowances(
  charges: readonly UsageCharge[],
  planFeeMicros: number,
): readonly Readonly<{ meter: MeterClass, allowanceCostMicros: number, message: string }>[] {
  const findings: { meter: MeterClass, allowanceCostMicros: number, message: string }[] = []
  let totalAllowanceCost = 0

  for (const charge of charges) {
    const coveredUnits = Math.min(charge.consumedUnits, charge.includedUnits)
    const unitCost = charge.consumedUnits === 0
      ? 0
      : Math.floor(charge.totalCostMicros / charge.consumedUnits)
    const allowanceCostMicros = coveredUnits * unitCost
    totalAllowanceCost += allowanceCostMicros

    if (allowanceCostMicros > planFeeMicros) {
      findings.push({
        meter: charge.meter,
        allowanceCostMicros,
        message:
          `${charge.meter} allowance alone costs ${allowanceCostMicros} micros against a `
          + `${planFeeMicros} plan fee. One meter's included usage exceeds the whole price `
          + 'of the plan.',
      })
    }
  }

  if (findings.length === 0 && totalAllowanceCost > planFeeMicros) {
    findings.push({
      meter: charges[0]?.meter ?? 'origin_bandwidth_bytes',
      allowanceCostMicros: totalAllowanceCost,
      message:
        `Included usage across all meters costs ${totalAllowanceCost} micros against a `
        + `${planFeeMicros} plan fee. No single meter is at fault; the combination is.`,
    })
  }

  return Object.freeze(findings.map((finding) => Object.freeze(finding)))
}

/** Total net across meters, for judging a plan rather than a line. */
export function netAcrossMeters(charges: readonly UsageCharge[]): number {
  return charges.reduce((sum, charge) => sum + charge.netMicros, 0)
}
