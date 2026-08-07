import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Value } from '@core/utils/typeboxHelpers'
import {
  DomainRowSchema,
  domainList,
  domainRow,
  formatPrice,
  purchaseOffer,
  renewalIsSubstantiallyHigher,
} from '../../../server/fuma/domains/surfaces'

const NOW = '2026-08-07T00:00:00.000Z'
const offset = (days: number) =>
  new Date(Date.parse(NOW) + days * 86_400_000).toISOString()

const registered = {
  hostname: 'ours.co.ke',
  path: 'register' as const,
  expiresAt: offset(200),
  autoRenew: true,
  renewalRetailMinor: 150_000,
}

const connected = {
  hostname: 'theirs.com',
  path: 'connect' as const,
  expiresAt: offset(10),
  autoRenew: null,
  renewalRetailMinor: null,
}

describe('formatting money', () => {
  it('renders minor units as a readable amount', () => {
    expect(formatPrice(150_000)).toBe('KES 1,500.00')
    expect(formatPrice(99)).toBe('KES 0.99')
    expect(formatPrice(100)).toBe('KES 1.00')
  })
})

describe('wholesale cost cannot reach this layer', () => {
  it('has no cost field in the row schema', () => {
    // A field that does not exist cannot be leaked by accident, and adding one is a
    // visible change somebody has to justify.
    const properties = Object.keys(DomainRowSchema.properties)
    for (const forbidden of ['cost', 'costMinor', 'wholesale', 'margin']) {
      expect(properties).not.toContain(forbidden)
    }
  })

  it('refuses a row carrying a cost field', () => {
    // additionalProperties: false is what makes the absence enforceable.
    expect(Value.Check(DomainRowSchema, {
      ...domainRow(registered, NOW),
      costMinor: 100_000,
    })).toBe(false)
  })

  it('names no cost vocabulary in the module source', () => {
    // The presenter should have no way to receive cost in the first place.
    const source = readFileSync(
      new URL('../../../server/fuma/domains/surfaces.ts', import.meta.url), 'utf8')
    // Only the explanatory comments mention it; no identifier does.
    expect(source).not.toMatch(/\bcostMinor\b/)
    expect(source).not.toMatch(/\bwholesaleCost\b/)
  })
})

describe('a registered domain', () => {
  const row = domainRow(registered, NOW)

  it('shows the retail renewal price', () => {
    expect(row.renewalPrice).toBe('KES 1,500.00')
  })

  it('offers renewal and reports managed DNS', () => {
    expect(row.canRenew).toBe(true)
    expect(row.managedDns).toBe(true)
  })

  it('reports auto-renew state', () => {
    expect(row.autoRenew).toBe(true)
  })

  it('carries no notice while expiry is distant', () => {
    expect(row.notice).toBeNull()
  })

  it('carries a notice once renewal is due', () => {
    const due = domainRow({ ...registered, expiresAt: offset(5), autoRenew: false }, NOW)
    expect(due.notice?.urgency).toBe('warning')
    expect(due.notice?.message).toMatch(/go down/)
  })

  it('stops offering renewal once the name is released', () => {
    const lost = domainRow({ ...registered, expiresAt: offset(-100) }, NOW)
    expect(lost.canRenew).toBe(false)
    expect(lost.notice?.urgency).toBe('critical')
  })
})

describe('a connected domain', () => {
  const row = domainRow(connected, NOW)

  it('shows no price, because there is nothing to sell', () => {
    expect(row.renewalPrice).toBeNull()
  })

  it('offers no renewal, because we could not perform one', () => {
    // Showing a renew button for a domain we do not hold is an offer we cannot honour.
    expect(row.canRenew).toBe(false)
  })

  it('reports DNS as not managed by us', () => {
    expect(row.managedDns).toBe(false)
  })

  it('reports auto-renew as absent rather than off', () => {
    // Off would imply we could turn it on.
    expect(row.autoRenew).toBeNull()
  })

  it('carries no expiry notice, since acting on it is not ours', () => {
    expect(row.notice).toBeNull()
  })

  it('still shows the expiry date it knows', () => {
    expect(row.expiresAt).toBe(offset(10))
  })
})

describe('ordering the list', () => {
  const domains = [
    { ...registered, hostname: 'calm.co.ke', expiresAt: offset(300) },
    { ...registered, hostname: 'due.co.ke', expiresAt: offset(5), autoRenew: false },
    { ...registered, hostname: 'expired.co.ke', expiresAt: offset(-3), autoRenew: false },
    { ...registered, hostname: 'soon.co.ke', expiresAt: offset(20), autoRenew: false },
  ]

  it('puts what needs attention at the top', () => {
    // A page sorted alphabetically buries the domain about to take a site down.
    const list = domainList(domains, NOW)
    expect(list[0]?.hostname).toBe('expired.co.ke')
  })

  it('orders equal urgency by soonest expiry', () => {
    const list = domainList(domains, NOW)
    const warnings = list.filter((row) => row.notice?.urgency === 'warning')
    expect(warnings.map((row) => row.hostname)).toEqual(['due.co.ke', 'soon.co.ke'])
  })

  it('puts quiet domains last', () => {
    const list = domainList(domains, NOW)
    expect(list[list.length - 1]?.hostname).toBe('calm.co.ke')
  })

  it('breaks a full tie by hostname, so the order is stable', () => {
    const tied = [
      { ...registered, hostname: 'b.co.ke', expiresAt: offset(300) },
      { ...registered, hostname: 'a.co.ke', expiresAt: offset(300) },
    ]
    expect(domainList(tied, NOW).map((row) => row.hostname)).toEqual(['a.co.ke', 'b.co.ke'])
  })
})

describe('presenting an offer', () => {
  const offer = purchaseOffer({
    hostname: 'newsite.co.ke',
    registrationRetailMinor: 100_000,
    renewalRetailMinor: 180_000,
    periodYears: 1,
    quoteExpiresAt: offset(1),
  })

  it('states the renewal price alongside the first-year price', () => {
    // Registrars commonly sell a cheap first year and renew at several times that. A
    // customer discovering it at renewal has a legitimate grievance.
    expect(offer.price).toBe('KES 1,000.00')
    expect(offer.renewalPrice).toBe('KES 1,800.00')
  })

  it('states when the quote stops being valid', () => {
    // A price with no stated validity invites arguing about it later.
    expect(offer.quoteExpiresAt).toBe(offset(1))
  })

  it('flags a renewal materially above the first year', () => {
    // "It was in the table" is not the same as having been told.
    expect(renewalIsSubstantiallyHigher(100_000, 180_000)).toBe(true)
    expect(renewalIsSubstantiallyHigher(100_000, 120_000)).toBe(true)
  })

  it('does not flag a renewal close to the first year', () => {
    expect(renewalIsSubstantiallyHigher(100_000, 110_000)).toBe(false)
    expect(renewalIsSubstantiallyHigher(100_000, 100_000)).toBe(false)
  })

  it('does not divide by zero on a free first year', () => {
    expect(renewalIsSubstantiallyHigher(0, 180_000)).toBe(false)
  })
})

describe('every row satisfies its schema', () => {
  it('validates for both paths', () => {
    for (const input of [registered, connected]) {
      expect(Value.Check(DomainRowSchema, domainRow(input, NOW))).toBe(true)
    }
  })
})
