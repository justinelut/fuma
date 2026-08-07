import { describe, it, expect } from 'bun:test'
import {
  billableUnits,
  chargeUsage,
  netAcrossMeters,
  priceBand,
  priceMeter,
  unrecoveredAllowances,
  type Benchmark,
  type MeterMarkup,
} from '../../../server/fuma/metering/retailPricing'
import type { MeterClass } from '../../../server/fuma/metering/contracts'

const markup = (
  meter: MeterClass,
  markupBasisPoints: number,
  minimumMarginMicros = 0,
): MeterMarkup => ({ meter, markupBasisPoints, minimumMarginMicros })

const benchmark = (
  meter: MeterClass,
  competitor: string,
  unitPriceMicros: number,
): Benchmark => ({
  meter, competitor, unitPriceMicros, observedAt: '2026-08-01T00:00:00.000Z',
})

const BANDWIDTH: MeterClass = 'origin_bandwidth_bytes'
const STORAGE: MeterClass = 'storage_source_bytes'
const EMAIL: MeterClass = 'email_recipients'

describe('the price band', () => {
  it('sets the floor at cost plus markup', () => {
    // 1000 micros cost + 20% = 1200.
    const band = priceBand(STORAGE, 1000, markup(STORAGE, 2000), [])
    expect(band.floorMicros).toBe(1200)
    expect(band.unitCostMicros).toBe(1000)
  })

  it('uses the minimum margin when the percentage yields less', () => {
    // A small percentage of a tiny unit cost rounds to nothing, but every billable
    // unit still carries handling cost.
    const band = priceBand(EMAIL, 10, markup(EMAIL, 500, 50), [])
    expect(band.floorMicros).toBe(60)
  })

  it('takes the cheapest competitor as the ceiling', () => {
    // Averaging would let an expensive outlier disguise somebody undercutting us.
    const band = priceBand(BANDWIDTH, 100, markup(BANDWIDTH, 1000), [
      benchmark(BANDWIDTH, 'Expensive Host', 900),
      benchmark(BANDWIDTH, 'Cheap Host', 300),
    ])
    expect(band.ceilingMicros).toBe(300)
    expect(band.ceilingSetBy).toBe('Cheap Host')
  })

  it('is viable when the floor sits under the ceiling', () => {
    const band = priceBand(STORAGE, 1000, markup(STORAGE, 1000), [
      benchmark(STORAGE, 'Rival', 2000),
    ])
    expect(band.viable).toBe(true)
  })

  it('is not viable when the floor exceeds the ceiling', () => {
    // The finding that matters: we cannot beat them at this margin.
    const band = priceBand(STORAGE, 1000, markup(STORAGE, 5000), [
      benchmark(STORAGE, 'Rival', 1200),
    ])
    expect(band.viable).toBe(false)
  })

  it('is viable by default with no benchmark, since we know nothing', () => {
    // Absence of market information is not evidence of competitiveness, but it is
    // not a reason to refuse either.
    const band = priceBand(STORAGE, 1000, markup(STORAGE, 9000), [])
    expect(band.viable).toBe(true)
    expect(band.ceilingMicros).toBeNull()
  })

  it('ignores benchmarks for other meters', () => {
    const band = priceBand(STORAGE, 1000, markup(STORAGE, 1000), [
      benchmark(BANDWIDTH, 'Rival', 5),
    ])
    expect(band.ceilingMicros).toBeNull()
  })
})

describe('pricing a meter', () => {
  it('prices at the floor, undercutting the competitor', () => {
    // In a price-sensitive market the cheapest sustainable price wins more than the
    // highest defensible one.
    const result = priceMeter(STORAGE, 1000, markup(STORAGE, 1000), [
      benchmark(STORAGE, 'Rival', 2000),
    ])
    if (!('price' in result)) throw new Error('expected a price')
    expect(result.price.unitPriceMicros).toBe(1100)
    expect(result.price.beatsBenchmark).toBe(true)
  })

  it('reports margin in basis points for comparison against policy', () => {
    const result = priceMeter(STORAGE, 1000, markup(STORAGE, 2500), [])
    if (!('price' in result)) throw new Error('expected a price')
    // 250 margin on a 1250 price is 20% of revenue.
    expect(result.price.marginMicros).toBe(250)
    expect(result.price.marginBasisPoints).toBe(2000)
  })

  it('refuses an empty band and names both numbers', () => {
    // Reported with the competitor and both figures so the decision can be made,
    // not silently resolved to one side.
    const result = priceMeter(BANDWIDTH, 1000, markup(BANDWIDTH, 5000), [
      benchmark(BANDWIDTH, 'Cheap Host', 1200),
    ])
    if (!('problem' in result)) throw new Error('expected a problem')
    expect(result.problem.code).toBe('empty-band')
    expect(result.problem.message).toMatch(/Cheap Host/)
    expect(result.problem.message).toMatch(/1200/)
    expect(result.problem.message).toMatch(/thinner margin/)
  })

  it('accepts a thin margin that still beats the market', () => {
    // The whole point: modest markup is viable when our costs are low.
    const result = priceMeter(BANDWIDTH, 1000, markup(BANDWIDTH, 500), [
      benchmark(BANDWIDTH, 'Rival', 3000),
    ])
    if (!('price' in result)) throw new Error('expected a price')
    expect(result.price.unitPriceMicros).toBe(1050)
    expect(result.price.beatsBenchmark).toBe(true)
    expect(result.price.marginMicros).toBeGreaterThan(0)
  })

  it('refuses a markup rule written for a different meter', () => {
    const result = priceMeter(STORAGE, 1000, markup(BANDWIDTH, 1000), [])
    if (!('problem' in result)) throw new Error('expected a problem')
    expect(result.problem.code).toBe('no-markup')
  })

  it('never prices below cost even at zero markup', () => {
    const result = priceMeter(STORAGE, 1000, markup(STORAGE, 0), [])
    if (!('price' in result)) throw new Error('expected a price')
    expect(result.price.unitPriceMicros).toBeGreaterThanOrEqual(1000)
  })
})

describe('allowances', () => {
  it('bills only what exceeds the included units', () => {
    expect(billableUnits(150, { meter: STORAGE, includedUnits: 100 })).toBe(50)
  })

  it('bills nothing inside the allowance', () => {
    expect(billableUnits(80, { meter: STORAGE, includedUnits: 100 })).toBe(0)
  })

  it('bills everything when nothing is included', () => {
    expect(billableUnits(80, { meter: STORAGE, includedUnits: 0 })).toBe(80)
  })
})

describe('charging usage', () => {
  const priced = priceMeter(BANDWIDTH, 100, markup(BANDWIDTH, 1000), [])
  const price = 'price' in priced ? priced.price : null

  it('counts the cost of every unit, not only billable ones', () => {
    // Netting the allowance out would hide exactly the leak worth watching.
    if (!price) throw new Error('expected a price')
    const charge = chargeUsage(price, { meter: BANDWIDTH, includedUnits: 100 }, 150)
    expect(charge.totalCostMicros).toBe(150 * 100)
    expect(charge.billableUnits).toBe(50)
    expect(charge.revenueMicros).toBe(50 * 110)
  })

  it('shows a loss when the allowance swallows the revenue', () => {
    // 100 free units cost 10,000 micros; 50 billable units earn 5,500. Net negative,
    // and that is the honest number.
    if (!price) throw new Error('expected a price')
    const charge = chargeUsage(price, { meter: BANDWIDTH, includedUnits: 100 }, 150)
    expect(charge.netMicros).toBeLessThan(0)
  })

  it('shows a profit when consumption is mostly billable', () => {
    if (!price) throw new Error('expected a price')
    const charge = chargeUsage(price, { meter: BANDWIDTH, includedUnits: 0 }, 150)
    expect(charge.netMicros).toBeGreaterThan(0)
  })

  it('totals net across meters', () => {
    if (!price) throw new Error('expected a price')
    const charges = [
      chargeUsage(price, { meter: BANDWIDTH, includedUnits: 0 }, 100),
      chargeUsage(price, { meter: BANDWIDTH, includedUnits: 0 }, 100),
    ]
    expect(netAcrossMeters(charges)).toBe(charges[0]!.netMicros * 2)
  })
})

describe('unrecovered allowances', () => {
  const priced = priceMeter(BANDWIDTH, 100, markup(BANDWIDTH, 1000), [])
  const price = 'price' in priced ? priced.price : null

  it('flags one meter whose allowance exceeds the whole plan fee', () => {
    // A plan whose included usage costs more than the plan fee loses money on every
    // customer who uses what they were promised.
    if (!price) throw new Error('expected a price')
    const charge = chargeUsage(price, { meter: BANDWIDTH, includedUnits: 100 }, 100)
    const findings = unrecoveredAllowances([charge], 5_000)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toMatch(/exceeds the whole price/)
  })

  it('stays quiet when the plan fee covers the allowance', () => {
    if (!price) throw new Error('expected a price')
    const charge = chargeUsage(price, { meter: BANDWIDTH, includedUnits: 100 }, 100)
    expect(unrecoveredAllowances([charge], 50_000)).toEqual([])
  })

  it('flags the combination when no single meter is at fault', () => {
    // Three allowances each affordable alone can still exceed the fee together.
    if (!price) throw new Error('expected a price')
    const charge = chargeUsage(price, { meter: BANDWIDTH, includedUnits: 40 }, 40)
    const findings = unrecoveredAllowances([charge, charge, charge], 5_000)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toMatch(/the combination is/)
  })
})
