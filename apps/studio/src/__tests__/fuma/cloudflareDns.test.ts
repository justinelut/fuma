/**
 * Cloudflare DNS for bring-your-own domains.
 *
 * The point of forcing Cloudflare is one-click record writing. The point of these tests is the
 * hazard that comes with it: changing nameservers moves ALL DNS, so delegating before importing the
 * domain's existing records stops inbound mail while the website looks perfect.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  canAutoWriteRecords,
  decideOnboarding,
  delegationStatus,
  nextStep,
  recordsAtRisk,
  wouldBreakMail,
  type ObservedRecord,
  type OnboardingFacts,
} from '../../../server/fuma/domains/cloudflareDns'

const OURS = Object.freeze(['ns1.fuma.net', 'ns2.fuma.net'])

const mx = (host = 'mx.zoho.com', priority = 10): ObservedRecord =>
  Object.freeze({ type: 'MX', name: '@', value: host, priority })
const spf: ObservedRecord = Object.freeze({
  type: 'TXT', name: '@', value: 'v=spf1 include:zoho.com ~all',
})

const facts = (over: Partial<OnboardingFacts> = {}): OnboardingFacts => Object.freeze({
  mode: 'delegated',
  state: 'records-imported',
  existing: Object.freeze([]),
  imported: Object.freeze([]),
  observedNameservers: OURS,
  requiredNameservers: OURS,
  ...over,
})

describe('delegation cannot break inbound mail', () => {
  it('REFUSES delegation when MX records were not imported', () => {
    // The website would look perfect while email bounced, and the customer would be right to blame
    // us. This is the whole reason the import step exists.
    const decision = decideOnboarding(facts({
      existing: [mx(), spf],
      imported: [],
      state: 'records-imported',
    }))
    expect(decision.ok).toBe(false)
    expect(decision.ok === false && decision.reason).toBe('mail-would-break')
    expect(decision.ok === false && decision.message).toContain('INBOUND MAIL')
  })

  it('allows delegation once the MX records were carried over', () => {
    const decision = decideOnboarding(facts({
      existing: [mx(), spf],
      imported: [mx(), spf],
      state: 'delegated',
    }))
    expect(decision.ok).toBe(true)
    expect(decision.ok && decision.canWriteRecords).toBe(true)
  })

  it('names the records at risk rather than only that something is', () => {
    // So the interface can say what is about to stop working.
    const atRisk = recordsAtRisk([mx('mx.zoho.com'), mx('mx2.zoho.com', 20), spf], [mx('mx.zoho.com')])
    expect(atRisk.map((record) => record.value)).toEqual(['mx2.zoho.com', 'v=spf1 include:zoho.com ~all'])
  })

  it('does not treat a website record as silently critical', () => {
    // Losing an A or CNAME for the site IS visible immediately, so it is not the dangerous class.
    const atRisk = recordsAtRisk([{ type: 'A', name: '@', value: '1.2.3.4' }], [])
    expect(atRisk).toEqual([])
  })

  it('reports mail breakage only when MX is actually at risk', () => {
    expect(wouldBreakMail([spf])).toBe(false)
    expect(wouldBreakMail([mx()])).toBe(true)
  })

  it('refuses when nothing has been read yet', () => {
    // We cannot tell what delegation would break, so proceeding would be a guess.
    const decision = decideOnboarding(facts({ state: 'not-configured' }))
    expect(decision.ok === false && decision.reason).toBe('records-not-imported')
  })
})

describe('a partial nameserver change is refused, not accepted', () => {
  it('detects a partial delegation', () => {
    // Resolvers pick among the NS set, so the domain would resolve through us for some visitors and
    // the old provider for others - intermittent and very hard to diagnose.
    expect(delegationStatus(['ns1.fuma.net', 'ns1.oldhost.com'], OURS)).toBe('partial')
  })

  it('refuses to write records during a partial delegation', () => {
    const decision = decideOnboarding(facts({
      observedNameservers: ['ns1.fuma.net'],
      state: 'delegated',
    }))
    expect(decision.ok === false && decision.reason).toBe('partial-delegation')
  })

  it('detects a complete delegation', () => {
    expect(delegationStatus(['NS2.FUMA.NET.', 'ns1.fuma.net'], OURS)).toBe('live')
  })

  it('ignores case and a trailing dot', () => {
    // Resolvers report these inconsistently; a comparison that cared would report a correct
    // delegation as missing.
    expect(delegationStatus(['NS1.Fuma.Net.', 'ns2.fuma.net.'], OURS)).toBe('live')
  })

  it('detects an absent delegation', () => {
    expect(delegationStatus(['ns1.oldhost.com', 'ns2.oldhost.com'], OURS)).toBe('absent')
  })

  it('refuses to write into a zone nobody queries', () => {
    // Records written before the change takes effect would land in a zone no resolver consults, so
    // the flow would report success while nothing resolved.
    const decision = decideOnboarding(facts({
      observedNameservers: ['ns1.oldhost.com'],
      state: 'delegation-pending',
      existing: [],
      imported: [],
    }))
    expect(decision.ok).toBe(false)
  })
})

describe('the authorised mode moves none of their DNS', () => {
  it('writes records once the token is verified', () => {
    // Their zone stays theirs, so there is nothing to import and no delegation to wait for.
    const decision = decideOnboarding(facts({
      mode: 'authorised',
      state: 'authorised',
      existing: [mx()],
      imported: [],
    }))
    expect(decision.ok).toBe(true)
    expect(decision.ok && decision.mode).toBe('authorised')
  })

  it('does not demand an import in authorised mode', () => {
    // Nothing is being moved, so existing MX records are not at risk.
    expect(canAutoWriteRecords(facts({
      mode: 'authorised', state: 'authorised', existing: [mx()], imported: [],
    }))).toBe(true)
  })

  it('refuses before the token is verified', () => {
    // Otherwise writing fails at the API rather than at a point the customer can act on.
    const decision = decideOnboarding(facts({ mode: 'authorised', state: 'records-imported' }))
    expect(decision.ok === false && decision.reason).toBe('delegation-not-live')
  })
})

describe('a customer who declines Cloudflare is handled honestly', () => {
  it('refuses one-click and says why', () => {
    const decision = decideOnboarding(facts({ state: 'declined' }))
    expect(decision.ok === false && decision.reason).toBe('customer-declined')
    expect(decision.ok === false && decision.message).toContain('by hand')
  })
})

describe('the instruction cannot disagree with the gate', () => {
  it('tells an importer to import', () => {
    expect(nextStep(facts({ existing: [mx()], imported: [] })))
      .toContain('Import')
  })

  it('tells a partial delegation to finish at the registrar', () => {
    expect(nextStep(facts({ observedNameservers: ['ns1.fuma.net'], state: 'delegated' })))
      .toContain('registrar')
  })

  it('tells a pending delegation to wait, not to re-check typing', () => {
    // Telling somebody to re-check a value while DNS propagates wastes their afternoon.
    expect(nextStep(facts({ observedNameservers: [], state: 'delegation-pending' })))
      .toContain('propagation')
  })

  it('asks for a token in authorised mode rather than a nameserver change', () => {
    expect(nextStep(facts({ mode: 'authorised', state: 'records-imported' })))
      .toContain('token')
  })

  it('says there is nothing to do once we can write', () => {
    expect(nextStep(facts({ state: 'delegated' }))).toContain('Nothing to do')
  })
})

describe('the policy and its safety rule are held in place', () => {
  const source = readFileSync(
    join(import.meta.dir, '../../../server/fuma/domains/cloudflareDns.ts'), 'utf8',
  )
  const connection = readFileSync(
    join(import.meta.dir, '../../../server/fuma/email/connection.ts'), 'utf8',
  )

  it('states the forced-Cloudflare policy', () => {
    expect(source).toContain('must be on Cloudflare DNS')
  })

  it('states why delegation is refused before an import', () => {
    // The rule exists because the failure is invisible on the site being connected.
    expect(source).toContain('INBOUND MAIL BOUNCES')
  })

  it('makes the one-click flow consult Cloudflare state, not the path alone', () => {
    // On the connect path DNS control is no longer a property of how the domain was acquired.
    expect(connection).toContain('canAutoWriteRecords')
  })

  it('keeps the path check as well, so the register path is unaffected', () => {
    // A registered domain's DNS is ours outright and must not start depending on Cloudflare.
    expect(connection).toContain('canWriteDnsRecords(request.path)')
  })

  it('treats MX as the record class that breaks silently', () => {
    expect(source).toContain("'MX'")
  })
})
