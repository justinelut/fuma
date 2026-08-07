import { describe, it, expect } from 'bun:test'
import {
  absoluteHost,
  detectRegression,
  nextCheckDelaySeconds,
  recordVerification,
  verifyConnection,
  type MailDnsResolver,
} from '../../../server/fuma/email/verification'
import { findProvider, planRecords } from '../../../server/fuma/email/providerCatalogue'

const DOMAIN = 'example.co.ke'

/** A resolver double answering from fixed maps. Empty means nothing resolves. */
function resolver(answers: {
  mx?: Record<string, readonly Readonly<{ exchange: string, priority: number }>[]>
  txt?: Record<string, readonly string[]>
  cname?: Record<string, readonly string[]>
  failOn?: readonly string[]
}): MailDnsResolver {
  const fail = new Set(answers.failOn ?? [])
  return {
    async resolveMx(name) {
      if (fail.has(name)) throw new Error('lookup failed')
      return answers.mx?.[name] ?? []
    },
    async resolveTxt(name) {
      if (fail.has(name)) throw new Error('lookup failed')
      return answers.txt?.[name] ?? []
    },
    async resolveCname(name) {
      if (fail.has(name)) throw new Error('lookup failed')
      return answers.cname?.[name] ?? []
    },
  }
}

const zoho = findProvider('zoho-mail')!

describe('resolving a relative host', () => {
  it('treats @ as the domain itself', () => {
    expect(absoluteHost('@', DOMAIN)).toBe(DOMAIN)
  })

  it('qualifies a subdomain', () => {
    expect(absoluteHost('zoho._domainkey', DOMAIN)).toBe(`zoho._domainkey.${DOMAIN}`)
  })

  it('leaves an already-qualified host alone', () => {
    expect(absoluteHost(`send.${DOMAIN}`, DOMAIN)).toBe(`send.${DOMAIN}`)
  })
})

describe('the distinction that makes verification useful', () => {
  const records = planRecords(zoho, null)

  it('calls a name that resolves nothing "absent" and advises waiting', async () => {
    // Almost always propagation. Telling someone to re-check their typing while DNS is
    // still propagating wastes their afternoon.
    const result = await verifyConnection(resolver({}), records, DOMAIN)
    const mx = result.verdicts.find((verdict) => verdict.type === 'MX')
    expect(mx?.state).toBe('absent')
    expect(mx?.advice).toMatch(/propagating|Waiting is the right thing/)
  })

  it('calls a wrong value "mismatched" and says waiting will not help', async () => {
    // Waiting will never fix this, so the advice must differ.
    const result = await verifyConnection(
      resolver({ mx: { [DOMAIN]: [{ exchange: 'mail.someoneelse.com', priority: 10 }] } }),
      records, DOMAIN,
    )
    const mx = result.verdicts.find((verdict) => verdict.type === 'MX')
    expect(mx?.state).toBe('mismatched')
    expect(mx?.advice).toMatch(/will not\s+fix it/)
    expect(mx?.observed).toContain('10 mail.someoneelse.com')
  })

  it('distinguishes a failed lookup from an absent record', async () => {
    // Reporting a failed lookup as absent would advise waiting for something that may
    // already be correct.
    const result = await verifyConnection(
      resolver({ failOn: [DOMAIN] }), records, DOMAIN,
    )
    const mx = result.verdicts.find((verdict) => verdict.type === 'MX')
    expect(mx?.state).toBe('unknown')
    expect(mx?.advice).toMatch(/not been confirmed either way/)
  })

  it('does not call it propagating when anything is actively wrong', async () => {
    // One mismatch makes waiting the wrong advice regardless of how many others are
    // merely absent.
    const result = await verifyConnection(
      resolver({ mx: { [DOMAIN]: [{ exchange: 'wrong.example.com', priority: 10 }] } }),
      records, DOMAIN,
    )
    expect(result.likelyPropagating).toBe(false)
    expect(result.misconfigured.length).toBeGreaterThan(0)
  })

  it('calls it propagating when everything missing is merely absent', async () => {
    const result = await verifyConnection(resolver({}), records, DOMAIN)
    expect(result.likelyPropagating).toBe(true)
    expect(result.misconfigured).toEqual([])
  })
})

describe('matching MX records', () => {
  const records = planRecords(zoho, null)

  it('accepts our host among several', async () => {
    const result = await verifyConnection(resolver({
      mx: { [DOMAIN]: [
        { exchange: 'mx.zoho.com', priority: 10 },
        { exchange: 'mx2.zoho.com', priority: 20 },
        { exchange: 'mx3.zoho.com', priority: 50 },
      ] },
      txt: { [DOMAIN]: ['v=spf1 include:zoho.com ~all'] },
    }), records, DOMAIN)

    const mxVerdicts = result.verdicts.filter((verdict) => verdict.type === 'MX')
    expect(mxVerdicts.every((verdict) => verdict.state === 'present')).toBe(true)
  })

  it('ignores a trailing dot and casing', async () => {
    const result = await verifyConnection(resolver({
      mx: { [DOMAIN]: [{ exchange: 'MX.Zoho.com.', priority: 10 }] },
    }), records.filter((record) => record.value === 'mx.zoho.com'), DOMAIN)
    expect(result.verdicts[0]?.state).toBe('present')
  })
})

describe('matching SPF', () => {
  const spfOnly = planRecords(zoho, null).filter((record) => record.purpose === 'spf')

  it('accepts a record carrying our include', async () => {
    const result = await verifyConnection(resolver({
      txt: { [DOMAIN]: ['v=spf1 include:zoho.com ~all'] },
    }), spfOnly, DOMAIN)
    expect(result.verdicts[0]?.state).toBe('present')
  })

  it('accepts a merged record with another sender added since', async () => {
    // Demanding an exact string would report a correctly-merged record as wrong.
    const result = await verifyConnection(resolver({
      txt: { [DOMAIN]: ['v=spf1 include:zoho.com include:amazonses.com -all'] },
    }), spfOnly, DOMAIN)
    expect(result.verdicts[0]?.state).toBe('present')
  })

  it('rejects a record missing our include', async () => {
    const result = await verifyConnection(resolver({
      txt: { [DOMAIN]: ['v=spf1 include:someoneelse.com ~all'] },
    }), spfOnly, DOMAIN)
    expect(result.verdicts[0]?.state).toBe('mismatched')
  })
})

describe('whether mail is delivering', () => {
  it('is true only when every required record resolves', async () => {
    const records = planRecords(zoho, null)
    const result = await verifyConnection(resolver({
      mx: { [DOMAIN]: [
        { exchange: 'mx.zoho.com', priority: 10 },
        { exchange: 'mx2.zoho.com', priority: 20 },
        { exchange: 'mx3.zoho.com', priority: 50 },
      ] },
      txt: {
        [DOMAIN]: ['v=spf1 include:zoho.com ~all', 'zoho-verification-token'],
      },
    }), records, DOMAIN)
    // Verification is required and its value is provider-issued, so it stays absent.
    expect(result.delivering).toBe(false)
  })

  it('does not require optional records', async () => {
    // DKIM missing is a deliverability warning, not a failed connection.
    const requiredOnly = planRecords(zoho, null).filter((record) => record.required)
    const withoutVerification = requiredOnly.filter((record) => record.purpose !== 'verification')
    const result = await verifyConnection(resolver({
      mx: { [DOMAIN]: [
        { exchange: 'mx.zoho.com', priority: 10 },
        { exchange: 'mx2.zoho.com', priority: 20 },
        { exchange: 'mx3.zoho.com', priority: 50 },
      ] },
      txt: { [DOMAIN]: ['v=spf1 include:zoho.com ~all'] },
    }), withoutVerification, DOMAIN)
    expect(result.delivering).toBe(true)
  })
})

describe('recording and comparing checks', () => {
  const failing = recordVerification(DOMAIN, 'zoho-mail', {
    delivering: false,
    verdicts: [{
      purpose: 'mail-routing', host: '@', type: 'MX', state: 'absent',
      expected: 'mx.zoho.com', observed: [], required: true, advice: 'x',
    }],
    likelyPropagating: true,
    misconfigured: [],
  }, '2026-08-02T00:00:00.000Z')

  const working = recordVerification(DOMAIN, 'zoho-mail', {
    delivering: true, verdicts: [], likelyPropagating: false, misconfigured: [],
  }, '2026-08-01T00:00:00.000Z')

  it('names which purposes are failing', () => {
    expect(failing.failingPurposes).toEqual(['mail-routing'])
    expect(failing.delivering).toBe(false)
  })

  it('detects a connection that stopped working', () => {
    // The reason verification repeats: a record deleted long after setup breaks mail
    // exactly as thoroughly as one never added.
    const regression = detectRegression(working, failing)
    expect(regression?.brokenPurposes).toEqual(['mail-routing'])
    expect(regression?.message).toMatch(/was delivering mail when last checked/)
  })

  it('reports no regression when it was already broken', () => {
    // Not news, and reporting it would bury the real regressions.
    expect(detectRegression(failing, failing)).toBeNull()
  })

  it('reports no regression when it now works', () => {
    expect(detectRegression(failing, working)).toBeNull()
  })
})

describe('when to check again', () => {
  const pending = { delivering: false, verdicts: [], likelyPropagating: true, misconfigured: [] }
  const broken = {
    delivering: false, verdicts: [], likelyPropagating: false,
    misconfigured: [{
      purpose: 'spf', host: '@', type: 'TXT', state: 'mismatched' as const,
      expected: 'x', observed: ['y'], required: true, advice: 'z',
    }],
  }
  const working = { delivering: true, verdicts: [], likelyPropagating: false, misconfigured: [] }

  it('checks a pending connection soon, easing off', () => {
    // Checking hourly means somebody waits an hour to learn they made a typo.
    expect(nextCheckDelaySeconds(pending, 1)).toBe(30)
    expect(nextCheckDelaySeconds(pending, 2)).toBe(120)
    expect(nextCheckDelaySeconds(pending, 10)).toBe(3_000)
  })

  it('caps the pending interval at an hour', () => {
    expect(nextCheckDelaySeconds(pending, 100)).toBe(3_600)
  })

  it('backs off for a misconfiguration, which needs a human', () => {
    expect(nextCheckDelaySeconds(broken, 1)).toBe(86_400)
  })

  it('watches a working connection sparsely', () => {
    // Polling every minute for months costs more than it detects.
    expect(nextCheckDelaySeconds(working, 1)).toBe(86_400)
  })
})
