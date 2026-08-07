import { describe, it, expect } from 'bun:test'
import {
  assertQuotable,
  canWriteDnsRecords,
  capabilitiesOf,
  createsRenewalObligation,
  decidePath,
} from '../../../server/fuma/domains/acquisitionPath'

describe('deciding the path', () => {
  it('offers registration for an available domain', () => {
    const decision = decidePath('newsite.co.ke', 'available')
    expect(decision.path).toBe('register')
    expect(decision.quotable).toBe(true)
  })

  it('offers connection for a domain somebody owns', () => {
    // Detected rather than asked: a customer typing their existing domain into a
    // "find a domain" box should be recognised, not quoted at.
    const decision = decidePath('example.com', 'taken')
    expect(decision.path).toBe('connect')
    expect(decision.quotable).toBe(false)
    expect(decision.message).toMatch(/nothing to buy/)
  })

  it('never quotes a domain that is already registered', () => {
    // The mistake that reads as either a scam or a bug.
    expect(decidePath('google.com', 'taken').quotable).toBe(false)
  })

  it('picks no path when the registry is unreachable', () => {
    // Treating unknown as taken pushes customers away from a domain they could buy;
    // treating it as available takes money for one we cannot register.
    const decision = decidePath('newsite.co.ke', 'unknown')
    expect(decision.path).toBeNull()
    expect(decision.quotable).toBe(false)
    expect(decision.message).toMatch(/will not take payment/)
  })
})

describe('what each path permits', () => {
  it('gives the register path margin, DNS control and renewal duty', () => {
    expect(capabilitiesOf('register')).toEqual({
      weEarnMargin: true,
      weControlDns: true,
      weRenew: true,
      customerAddsRecords: false,
    })
  })

  it('gives the connect path none of those', () => {
    // No sale, no margin, no registrar relationship.
    expect(capabilitiesOf('connect')).toEqual({
      weEarnMargin: false,
      weControlDns: false,
      weRenew: false,
      customerAddsRecords: true,
    })
  })

  it('lets us write DNS only on the register path', () => {
    // What the email one-click flow asks: on connect it must show records to paste
    // rather than claim to have written them.
    expect(canWriteDnsRecords('register')).toBe(true)
    expect(canWriteDnsRecords('connect')).toBe(false)
  })

  it('creates a renewal obligation only when we hold the registration', () => {
    // A connected domain expiring is the customer's problem; a registered one
    // expiring is ours to have prevented.
    expect(createsRenewalObligation('register')).toBe(true)
    expect(createsRenewalObligation('connect')).toBe(false)
  })
})

describe('guarding a quote', () => {
  it('allows a quote for an available domain', () => {
    expect(assertQuotable(decidePath('newsite.co.ke', 'available'))).toBeNull()
  })

  it('refuses a quote for a domain already registered', () => {
    const refusal = assertQuotable(decidePath('example.com', 'taken'))
    expect(refusal?.code).toBe('not-for-sale')
    expect(refusal?.message).toMatch(/no registration to sell/)
  })

  it('refuses a quote while availability is unknown', () => {
    const refusal = assertQuotable(decidePath('newsite.co.ke', 'unknown'))
    expect(refusal?.code).toBe('availability-unknown')
  })

  it('names the hostname in every refusal', () => {
    for (const availability of ['taken', 'unknown'] as const) {
      const refusal = assertQuotable(decidePath('mysite.co.ke', availability))
      expect(refusal?.message).toContain('mysite.co.ke')
    }
  })
})
