import { describe, it, expect } from 'bun:test'
import {
  DEFAULT_REGISTRY_WINDOW,
  attentionQueue,
  daysUntil,
  escalateFailure,
  quoteRenewal,
  renewalNotice,
  renewalStage,
  type RenewalAttempt,
} from '../../../server/fuma/domains/renewal'

const NOW = '2026-08-07T00:00:00.000Z'

/** A date `days` from NOW, for readable fixtures. */
function offset(days: number): string {
  return new Date(Date.parse(NOW) + days * 86_400_000).toISOString()
}

describe('counting days', () => {
  it('counts forward', () => {
    expect(daysUntil(offset(10), NOW)).toBe(10)
  })

  it('goes negative once the date has passed', () => {
    expect(daysUntil(offset(-5), NOW)).toBe(-5)
  })

  it('refuses an unparseable date rather than returning NaN', () => {
    expect(() => daysUntil('not a date', NOW)).toThrow(/valid timestamps/)
  })
})

describe('renewal stages', () => {
  it('is active well before expiry', () => {
    expect(renewalStage(offset(200), NOW)).toBe('active')
  })

  it('becomes due inside the notice window', () => {
    expect(renewalStage(offset(20), NOW)).toBe('renewal-due')
    expect(renewalStage(offset(0), NOW)).toBe('renewal-due')
  })

  it('enters grace just past expiry, where the price is unchanged', () => {
    expect(renewalStage(offset(-1), NOW)).toBe('grace')
    expect(renewalStage(offset(-30), NOW)).toBe('grace')
  })

  it('enters redemption past grace, where the price jumps', () => {
    // Treating expiry as a single cliff would tell somebody it is fine here, when the
    // cost has already changed substantially.
    expect(renewalStage(offset(-31), NOW)).toBe('redemption')
    expect(renewalStage(offset(-60), NOW)).toBe('redemption')
  })

  it('is lost once redemption has passed', () => {
    expect(renewalStage(offset(-61), NOW)).toBe('lost')
  })

  it('respects a registry with different windows', () => {
    const shortWindow = { graceDays: 5, redemptionDays: 5, noticeDays: 10 }
    expect(renewalStage(offset(-6), NOW, shortWindow)).toBe('redemption')
    expect(renewalStage(offset(-11), NOW, shortWindow)).toBe('lost')
  })
})

describe('what the customer is told', () => {
  it('says nothing urgent while auto-renew is on and expiry is distant', () => {
    const notice = renewalNotice('example.co.ke', offset(200), NOW, true)
    expect(notice.urgency).toBe('none')
    expect(notice.message).toMatch(/Renews automatically/)
  })

  it('warns when renewal is due and auto-renew is off', () => {
    // Nothing will happen unless somebody acts, so this is a warning not a note.
    const notice = renewalNotice('example.co.ke', offset(10), NOW, false)
    expect(notice.urgency).toBe('warning')
    expect(notice.message).toMatch(/site and any email on it go down/)
  })

  it('stays informational when auto-renew will handle it', () => {
    const notice = renewalNotice('example.co.ke', offset(10), NOW, true)
    expect(notice.urgency).toBe('informational')
  })

  it('names the consequence rather than only the date', () => {
    // "Expires in 3 days" does not convey that the site goes down.
    const notice = renewalNotice('example.co.ke', offset(3), NOW, false)
    expect(notice.message).toMatch(/stop resolving|go down/)
  })

  it('is critical in grace and says the price is still normal', () => {
    const notice = renewalNotice('example.co.ke', offset(-5), NOW, false)
    expect(notice.urgency).toBe('critical')
    expect(notice.renewable).toBe(true)
    expect(notice.premiumApplies).toBe(false)
    expect(notice.message).toMatch(/normal price/)
  })

  it('flags the redemption premium, because the quote must change', () => {
    const notice = renewalNotice('example.co.ke', offset(-40), NOW, false)
    expect(notice.premiumApplies).toBe(true)
    expect(notice.message).toMatch(/redemption fee/)
  })

  it('says plainly when the name is gone', () => {
    const notice = renewalNotice('example.co.ke', offset(-100), NOW, false)
    expect(notice.renewable).toBe(false)
    expect(notice.message).toMatch(/no longer be renewed/)
  })
})

describe('quoting a renewal', () => {
  const base = {
    hostname: 'example.co.ke',
    path: 'register' as const,
    expiresAt: offset(10),
    now: NOW,
    periodYears: 1,
    currentRetailMinor: 150_000,
  }

  it('prices at the current retail, not what was paid before', () => {
    // Wholesale cost moves; charging last year's price can renew at a loss quietly.
    const result = quoteRenewal({ ...base, previousPaidMinor: 120_000 })
    if (!('quote' in result)) throw new Error('expected a quote')
    expect(result.quote.priceMinor).toBe(150_000)
  })

  it('records that the price went up, so it can be explained', () => {
    const result = quoteRenewal({ ...base, previousPaidMinor: 120_000 })
    if (!('quote' in result)) throw new Error('expected a quote')
    expect(result.quote.increasedFromMinor).toBe(120_000)
  })

  it('does not claim an increase when the price held or fell', () => {
    const result = quoteRenewal({ ...base, previousPaidMinor: 200_000 })
    if (!('quote' in result)) throw new Error('expected a quote')
    expect(result.quote.increasedFromMinor).toBeUndefined()
  })

  it('marks the premium when in redemption', () => {
    const result = quoteRenewal({ ...base, expiresAt: offset(-40) })
    if (!('quote' in result)) throw new Error('expected a quote')
    expect(result.quote.premiumApplies).toBe(true)
  })

  it('refuses a connected domain, which is not ours to renew', () => {
    const result = quoteRenewal({ ...base, path: 'connect' })
    if (!('refusal' in result)) throw new Error('expected a refusal')
    expect(result.refusal.code).toBe('not-our-obligation')
    expect(result.refusal.message).toMatch(/their own registrar/)
  })

  it('refuses a domain that has been released', () => {
    const result = quoteRenewal({ ...base, expiresAt: offset(-100) })
    if (!('refusal' in result)) throw new Error('expected a refusal')
    expect(result.refusal.code).toBe('not-renewable')
  })

  it('refuses rather than reusing a stale price when none is available', () => {
    const result = quoteRenewal({ ...base, currentRetailMinor: 0 })
    if (!('refusal' in result)) throw new Error('expected a refusal')
    expect(result.refusal.code).toBe('no-current-price')
    expect(result.refusal.message).toMatch(/renew at a loss/)
  })
})

describe('escalating a failed renewal', () => {
  const attempt = (
    consecutiveFailures: number,
    succeeded = false,
  ): RenewalAttempt => ({
    hostname: 'example.co.ke',
    attemptedAt: NOW,
    succeeded,
    consecutiveFailures,
    failureReason: 'Card declined.',
  })

  it('reports nothing when renewal succeeded', () => {
    expect(escalateFailure(attempt(0, true), offset(10), NOW)).toBeNull()
  })

  it('notifies the operator on the very first failure', () => {
    // A failure that only writes a log line is indistinguishable from success, which is
    // how a domain lapses unnoticed.
    const escalation = escalateFailure(attempt(1), offset(10), NOW)
    expect(escalation?.notifyOperator).toBe(true)
    expect(escalation?.urgency).toBe('warning')
  })

  it('waits for a repeat before troubling the customer', () => {
    // A transient first failure does not need their attention.
    expect(escalateFailure(attempt(1), offset(10), NOW)?.notifyCustomer).toBe(false)
    expect(escalateFailure(attempt(2), offset(10), NOW)?.notifyCustomer).toBe(true)
  })

  it('escalates to critical after repeated failure', () => {
    expect(escalateFailure(attempt(3), offset(10), NOW)?.urgency).toBe('critical')
  })

  it('treats any failure past expiry as an outage in progress', () => {
    const escalation = escalateFailure(attempt(1), offset(-2), NOW)
    expect(escalation?.urgency).toBe('critical')
    expect(escalation?.notifyCustomer).toBe(true)
    expect(escalation?.message).toMatch(/site is down or about to be/)
  })

  it('carries the reason through, and says so when there is none', () => {
    expect(escalateFailure(attempt(1), offset(10), NOW)?.message).toMatch(/Card declined/)
    const noReason = { ...attempt(1) }
    delete (noReason as { failureReason?: string }).failureReason
    expect(escalateFailure(noReason, offset(10), NOW)?.message)
      .toMatch(/No reason was recorded/)
  })
})

describe('the attention queue', () => {
  const domains = [
    { hostname: 'far.co.ke', path: 'register' as const, expiresAt: offset(300), autoRenew: true },
    { hostname: 'soon.co.ke', path: 'register' as const, expiresAt: offset(5), autoRenew: false },
    { hostname: 'expired.co.ke', path: 'register' as const, expiresAt: offset(-3), autoRenew: false },
    { hostname: 'theirs.co.ke', path: 'connect' as const, expiresAt: offset(2), autoRenew: false },
  ]

  it('orders by urgency, most pressing first', () => {
    // The list is a work queue, so the order is the whole point.
    const queue = attentionQueue(domains, NOW)
    expect(queue.map((notice) => notice.hostname)).toEqual(['expired.co.ke', 'soon.co.ke'])
  })

  it('excludes a connected domain, which is not ours to act on', () => {
    const queue = attentionQueue(domains, NOW)
    expect(queue.some((notice) => notice.hostname === 'theirs.co.ke')).toBe(false)
  })

  it('excludes domains needing nothing', () => {
    const queue = attentionQueue(domains, NOW)
    expect(queue.some((notice) => notice.hostname === 'far.co.ke')).toBe(false)
  })

  it('returns nothing when every domain is comfortable', () => {
    expect(attentionQueue([domains[0]!], NOW)).toEqual([])
  })
})

describe('the default registry window', () => {
  it('matches the common gTLD case', () => {
    expect(DEFAULT_REGISTRY_WINDOW).toEqual({
      graceDays: 30, redemptionDays: 30, noticeDays: 30,
    })
  })
})
