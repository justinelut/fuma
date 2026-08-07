import { describe, it, expect } from 'bun:test'
import {
  findCost,
  priceRegistration,
  priceRenewal,
  quoteStillProfitable,
  recordSaleMargin,
  tldOf,
  totalMargin,
  type MarkupRule,
  type WholesaleCost,
} from '../../../server/fuma/registrar/margin'

const cost = (
  tld: string,
  registrationCostMinor: number,
  renewalCostMinor = registrationCostMinor,
  periodYears = 1,
): WholesaleCost => ({
  tld,
  periodYears,
  currency: 'KES',
  registrationCostMinor,
  renewalCostMinor,
  observedAt: '2026-01-01T00:00:00.000Z',
})

const rule = (
  markupBasisPoints: number,
  minimumMarginMinor = 0,
  roundUpToMinor?: number,
): MarkupRule => ({
  markupBasisPoints,
  minimumMarginMinor,
  ...(roundUpToMinor === undefined ? {} : { roundUpToMinor }),
})

describe('extracting the TLD', () => {
  it('takes the last label for an ordinary domain', () => {
    expect(tldOf('example.com')).toBe('com')
    expect(tldOf('shop.example.com')).toBe('com')
  })

  it('keeps a two-level public suffix whole', () => {
    // Treating co.ke as ke would price it against a cost line that does not exist.
    expect(tldOf('example.co.ke')).toBe('co.ke')
    expect(tldOf('shop.example.co.ke')).toBe('co.ke')
    expect(tldOf('school.ac.uk')).toBe('ac.uk')
  })

  it('does not treat the suffix itself as a domain', () => {
    // `co.ke` alone is a suffix, not something anyone registers.
    expect(tldOf('co.ke')).toBe('ke')
  })

  it('returns nothing for a bare label', () => {
    expect(tldOf('localhost')).toBe('')
    expect(tldOf('')).toBe('')
  })

  it('is case- and trailing-dot-insensitive', () => {
    expect(tldOf('Example.COM.')).toBe('com')
  })
})

describe('pricing a registration', () => {
  it('adds the markup percentage over cost', () => {
    // 1000 cents cost + 25% = 1250.
    const result = priceRegistration(cost('com', 1000), rule(2500))
    expect('price' in result).toBe(true)
    if (!('price' in result)) return
    expect(result.price.priceMinor).toBe(1250)
    expect(result.price.costMinor).toBe(1000)
    expect(result.price.marginMinor).toBe(250)
  })

  it('uses the minimum margin when the percentage yields less', () => {
    // A percentage of a very cheap TLD is a rounding error, but the work of
    // registering and supporting it costs the same.
    const result = priceRegistration(cost('xyz', 100), rule(1000, 500))
    if (!('price' in result)) throw new Error('expected a price')
    // 10% of 100 is 10; the floor of 500 wins.
    expect(result.price.priceMinor).toBe(600)
    expect(result.price.marginMinor).toBe(500)
  })

  it('takes whichever rule gives more margin, not both', () => {
    // Adding them would double-charge; the floor is a minimum, not a surcharge.
    const result = priceRegistration(cost('com', 10_000), rule(2500, 500))
    if (!('price' in result)) throw new Error('expected a price')
    expect(result.price.priceMinor).toBe(12_500)
  })

  it('rounds up to a clean price', () => {
    const result = priceRegistration(cost('com', 1234), rule(2500, 0, 100))
    if (!('price' in result)) throw new Error('expected a price')
    // 1234 + 309 = 1543, rounded up to 1600.
    expect(result.price.priceMinor).toBe(1600)
    expect(result.price.priceMinor % 100).toBe(0)
  })

  it('only ever rounds up, so rounding cannot cross below cost', () => {
    const result = priceRegistration(cost('com', 1000), rule(0, 0, 100))
    if (!('price' in result)) throw new Error('expected a price')
    expect(result.price.priceMinor).toBeGreaterThanOrEqual(1000)
  })

  it('never returns a price below cost', () => {
    // A zero markup is legal — selling at cost is a decision — but below cost is not
    // reachable through any rule.
    for (const basisPoints of [0, 1, 100, 10_000]) {
      const result = priceRegistration(cost('com', 5000), rule(basisPoints))
      if (!('price' in result)) continue
      expect(result.price.priceMinor).toBeGreaterThanOrEqual(result.price.costMinor)
      expect(result.price.marginMinor).toBeGreaterThanOrEqual(0)
    }
  })

  it('keeps every amount an integer', () => {
    // Money in floating point accumulates error, and a price a cent out fails
    // reconciliation.
    const result = priceRegistration(cost('com', 999), rule(3333))
    if (!('price' in result)) throw new Error('expected a price')
    expect(Number.isInteger(result.price.priceMinor)).toBe(true)
    expect(Number.isInteger(result.price.marginMinor)).toBe(true)
  })
})

describe('pricing a renewal', () => {
  it('prices from the renewal cost, not the registration cost', () => {
    // Registrars commonly sell a first year cheaply and charge more to renew. Pricing
    // a renewal off the registration cost would lose money on every one.
    const result = priceRenewal(cost('com', 500, 2000), rule(2500))
    if (!('price' in result)) throw new Error('expected a price')
    expect(result.price.costMinor).toBe(2000)
    expect(result.price.priceMinor).toBe(2500)
  })

  it('still refuses to go below the renewal cost', () => {
    const result = priceRenewal(cost('com', 500, 2000), rule(0))
    if (!('price' in result)) throw new Error('expected a price')
    expect(result.price.priceMinor).toBeGreaterThanOrEqual(2000)
  })
})

describe('finding the cost line', () => {
  const sheet = [cost('com', 1000, 1200, 1), cost('com', 1900, 2300, 2), cost('co.ke', 800, 900, 1)]

  it('matches the TLD and the exact term', () => {
    const result = findCost(sheet, 'example.com', 2)
    if (!('cost' in result)) throw new Error('expected a cost')
    expect(result.cost.registrationCostMinor).toBe(1900)
  })

  it('resolves a two-level suffix to its own line', () => {
    const result = findCost(sheet, 'example.co.ke', 1)
    if (!('cost' in result)) throw new Error('expected a cost')
    expect(result.cost.registrationCostMinor).toBe(800)
  })

  it('refuses a TLD with no cost recorded rather than guessing', () => {
    const result = findCost(sheet, 'example.io', 1)
    if (!('refusal' in result)) throw new Error('expected a refusal')
    expect(result.refusal.code).toBe('unknown-tld')
    expect(result.refusal.message).toMatch(/cannot be offered for sale/)
  })

  it('refuses a term it has no cost for, and lists the terms it has', () => {
    // Multiplying a one-year cost would under-charge by a year.
    const result = findCost(sheet, 'example.com', 5)
    if (!('refusal' in result)) throw new Error('expected a refusal')
    expect(result.refusal.code).toBe('no-cost-for-term')
    expect(result.refusal.message).toMatch(/1, 2/)
    expect(result.refusal.message).toMatch(/misprice/)
  })

  it('refuses a hostname with no TLD', () => {
    const result = findCost(sheet, 'localhost', 1)
    if (!('refusal' in result)) throw new Error('expected a refusal')
    expect(result.refusal.code).toBe('unknown-tld')
  })
})

describe('recording margin on a sale', () => {
  it('captures both figures at the moment of sale', () => {
    // Storing only the price would make every historical margin move whenever the
    // cost sheet changed.
    const priced = priceRegistration(cost('com', 1000), rule(2500))
    if (!('price' in priced)) throw new Error('expected a price')
    const record = recordSaleMargin(
      'example.com', 'registration', priced.price, '2026-02-01T00:00:00.000Z')

    expect(record.costMinor).toBe(1000)
    expect(record.priceMinor).toBe(1250)
    expect(record.marginMinor).toBe(250)
    expect(record.hostname).toBe('example.com')
    expect(record.kind).toBe('registration')
  })
})

describe('totalling margin', () => {
  it('sums records in one currency', () => {
    const priced = priceRegistration(cost('com', 1000), rule(2500))
    if (!('price' in priced)) throw new Error('expected a price')
    const records = [
      recordSaleMargin('a.com', 'registration', priced.price, '2026-02-01T00:00:00.000Z'),
      recordSaleMargin('b.com', 'registration', priced.price, '2026-02-02T00:00:00.000Z'),
    ]
    const total = totalMargin(records)
    if ('refusal' in total) throw new Error('expected a total')
    expect(total.marginMinor).toBe(500)
  })

  it('returns zero for no sales', () => {
    const total = totalMargin([])
    if ('refusal' in total) throw new Error('expected a total')
    expect(total.marginMinor).toBe(0)
  })
})

describe('a quote outliving its cost', () => {
  it('accepts a quote that still covers current cost', () => {
    expect(quoteStillProfitable(1250, 1000)).toBe(true)
    expect(quoteStillProfitable(1000, 1000)).toBe(true)
  })

  it('rejects a quote overtaken by a wholesale increase', () => {
    // A quote outlives the cost sheet it was priced from; checking before purchase is
    // what stops an increase turning an outstanding quote into a loss.
    expect(quoteStillProfitable(1250, 1400)).toBe(false)
  })
})
