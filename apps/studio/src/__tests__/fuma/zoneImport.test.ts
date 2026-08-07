import { describe, expect, it } from 'bun:test'

import { decideOnboarding, nextStep, recordsAtRisk, wouldBreakMail } from '../../../server/fuma/domains/cloudflareDns'
import {
  COPYABLE,
  NEVER_COPIED,
  importZone,
  planImport,
  scanBeforeDelegation,
  type ZoneRecordWriter,
} from '../../../server/fuma/domains/zoneImport'

type Rec = Readonly<{ type: string, name: string, value: string, priority?: number }>

const MX_SET: readonly Rec[] = Object.freeze([
  { type: 'MX', name: 'example.com', value: 'mx.zoho.com', priority: 10 },
  { type: 'MX', name: 'example.com', value: 'mx2.zoho.com', priority: 20 },
  { type: 'MX', name: 'example.com', value: 'mx3.zoho.com', priority: 50 },
])

const SPF: Rec = { type: 'TXT', name: 'example.com', value: 'v=spf1 include:zoho.com ~all' }
const WWW: Rec = { type: 'CNAME', name: 'www.example.com', value: 'example.com' }

function writer(fail: readonly string[] = []): ZoneRecordWriter & { created: Rec[] } {
  const created: Rec[] = []
  return {
    created,
    async createRecord(_domain, record) {
      if (fail.includes(record.value)) throw new Error('provider rejected the record')
      created.push(record)
    },
    async listRecords() { return [] },
  }
}

describe('planImport', () => {
  it('copies the records whose loss would be invisible', () => {
    const plan = planImport([...MX_SET, SPF, WWW], [])
    expect(plan.create).toHaveLength(5)
    expect(plan.create.filter((r) => r.type === 'MX')).toHaveLength(3)
  })

  it('keeps all three MX records rather than collapsing them', () => {
    // The same lesson as the DNS-instruction primary key: a provider's MX set is several records at
    // one name differing only by value. Collapsing them breaks mail failover invisibly.
    const plan = planImport(MX_SET, [])
    expect(plan.create.map((r) => r.value).sort()).toEqual([
      'mx.zoho.com', 'mx2.zoho.com', 'mx3.zoho.com',
    ])
  })

  it('never copies NS, because that would undo the delegation', () => {
    const plan = planImport(
      [{ type: 'NS', name: 'example.com', value: 'ns1.oldhost.com' }, SPF],
      [],
    )
    expect(plan.create).toHaveLength(1)
    expect(plan.create[0]?.type).toBe('TXT')
    const note = plan.notes.find((n) => n.code === 'skipped-authority')
    expect(note?.message).toContain('undo the delegation')
  })

  it('never copies SOA', () => {
    const plan = planImport([{ type: 'SOA', name: 'example.com', value: 'ns1.oldhost.com.' }], [])
    expect(plan.create).toHaveLength(0)
    expect(NEVER_COPIED).toContain('SOA')
  })

  it('reports an unsupported type rather than dropping it silently', () => {
    // A silently dropped record is precisely the invisible breakage the import exists to prevent.
    const plan = planImport([{ type: 'DNSKEY', name: 'example.com', value: 'x' }], [])
    expect(plan.create).toHaveLength(0)
    const note = plan.notes.find((n) => n.code === 'unsupported-type')
    expect(note?.message).toContain('by hand')
    expect(COPYABLE).not.toContain('DNSKEY')
  })

  it('converges on a re-run instead of duplicating the MX set', () => {
    const plan = planImport(MX_SET, MX_SET)
    expect(plan.create).toHaveLength(0)
    expect(plan.notes.every((n) => n.code === 'already-present')).toBe(true)
  })

  it('deduplicates within a single source list', () => {
    const plan = planImport([SPF, SPF], [])
    expect(plan.create).toHaveLength(1)
  })

  it('treats a trailing dot and casing as the same record', () => {
    const plan = planImport(
      [{ type: 'MX', name: 'Example.com.', value: 'mx.zoho.com', priority: 10 }],
      [{ type: 'mx', name: 'example.com', value: 'mx.zoho.com', priority: 10 }],
    )
    expect(plan.create).toHaveLength(0)
  })

  it('distinguishes two MX hosts at the same preference', () => {
    const plan = planImport(
      [{ type: 'MX', name: 'example.com', value: 'a.mail.com', priority: 10 },
        { type: 'MX', name: 'example.com', value: 'b.mail.com', priority: 10 }],
      [],
    )
    expect(plan.create).toHaveLength(2)
  })
})

describe('importZone', () => {
  it('creates the planned records and reports completeness', async () => {
    const w = writer()
    const outcome = await importZone('example.com', planImport([...MX_SET, SPF], []), w)
    expect(outcome.complete).toBe(true)
    expect(outcome.imported).toHaveLength(4)
    expect(w.created).toHaveLength(4)
  })

  it('continues past a failure and reports the whole picture', async () => {
    // Aborting at the first failure would leave a partial zone AND hide how much else worked.
    const w = writer(['mx2.zoho.com'])
    const outcome = await importZone('example.com', planImport(MX_SET, []), w)
    expect(w.created).toHaveLength(2)
    expect(outcome.notes.filter((n) => n.code === 'created')).toHaveLength(2)
    expect(outcome.notes.filter((n) => n.code === 'failed')).toHaveLength(1)
  })

  it('is INCOMPLETE when any record failed, because one missing MX is a mail outage', async () => {
    const outcome = await importZone(
      'example.com',
      planImport(MX_SET, []),
      writer(['mx3.zoho.com']),
    )
    expect(outcome.complete).toBe(false)
  })

  it('is incomplete when a record could not be represented at all', async () => {
    const outcome = await importZone(
      'example.com',
      planImport([SPF, { type: 'DNSKEY', name: 'example.com', value: 'x' }], []),
      writer(),
    )
    expect(outcome.complete).toBe(false)
  })

  it('names the consequence in a failure note', async () => {
    const outcome = await importZone('example.com', planImport([SPF], []), writer([SPF.value]))
    const note = outcome.notes.find((n) => n.code === 'failed')
    expect(note?.message).toContain('stop resolving')
  })
})

describe('composition with the delegation gate', () => {
  it('a complete import clears the records-at-risk gate', async () => {
    const existing = [...MX_SET, SPF]
    const outcome = await importZone('example.com', planImport(existing, []), writer())
    expect(outcome.complete).toBe(true)
    // This is the whole point: the gate cloudflareDns refuses delegation on is now satisfied.
    expect(recordsAtRisk(existing, outcome.imported)).toHaveLength(0)
    expect(wouldBreakMail(recordsAtRisk(existing, outcome.imported))).toBe(false)
  })

  it('a PARTIAL import leaves mail at risk, so delegation still refuses', async () => {
    const existing = [...MX_SET, SPF]
    const outcome = await importZone(
      'example.com',
      planImport(existing, []),
      writer(['mx2.zoho.com']),
    )
    const atRisk = recordsAtRisk(existing, outcome.imported)
    expect(atRisk).toHaveLength(1)
    expect(wouldBreakMail(atRisk)).toBe(true)
  })
})

describe('scanBeforeDelegation — the ordering hazard', () => {
  const scanner = (records: readonly Rec[]) => ({
    async scan() { return records },
  })

  it('reads the records from the current provider', async () => {
    const result = await scanBeforeDelegation({
      domain: 'example.com',
      currentNameservers: ['ns1.oldhost.com'],
      destinationNameservers: ['kate.ns.cloudflare.com'],
      scanner: scanner([...MX_SET]),
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.records).toHaveLength(3)
  })

  it('REFUSES to scan when asked to query our own nameservers', async () => {
    // The catastrophe this prevents: our zone is empty at this point, so the scan would report
    // nothing to import, the gate would pass, delegation would complete, and every record the
    // domain had would be destroyed with a clean audit trail.
    const result = await scanBeforeDelegation({
      domain: 'example.com',
      currentNameservers: ['kate.ns.cloudflare.com'],
      destinationNameservers: ['kate.ns.cloudflare.com'],
      scanner: scanner([]),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('would-scan-destination')
      expect(result.message).toContain('destroyed')
    }
  })

  it('refuses on a PARTIAL delegation, where only one nameserver is ours', async () => {
    const result = await scanBeforeDelegation({
      domain: 'example.com',
      currentNameservers: ['ns1.oldhost.com', 'KATE.NS.CLOUDFLARE.COM.'],
      destinationNameservers: ['kate.ns.cloudflare.com'],
      scanner: scanner([...MX_SET]),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('would-scan-destination')
  })

  it('refuses when the current nameservers are unknown', async () => {
    const result = await scanBeforeDelegation({
      domain: 'example.com',
      currentNameservers: [],
      destinationNameservers: ['kate.ns.cloudflare.com'],
      scanner: scanner([]),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no-nameservers')
  })

  it('a failed lookup is NOT an empty zone', async () => {
    // Reporting a failed lookup as "no records" is the same catastrophe by a different route.
    const result = await scanBeforeDelegation({
      domain: 'example.com',
      currentNameservers: ['ns1.oldhost.com'],
      destinationNameservers: ['kate.ns.cloudflare.com'],
      scanner: { async scan(): Promise<readonly Rec[]> { throw new Error('SERVFAIL') } },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('lookup-failed')
      expect(result.message).toContain('not an empty zone')
    }
  })

  it('an empty zone from a real provider is a legitimate answer', async () => {
    // Distinct from the two failures above: asked the right servers, they answered, nothing there.
    const result = await scanBeforeDelegation({
      domain: 'example.com',
      currentNameservers: ['ns1.oldhost.com'],
      destinationNameservers: ['kate.ns.cloudflare.com'],
      scanner: scanner([]),
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.records).toHaveLength(0)
  })
})

describe('source-level gates', () => {
  it('NS stays in the never-copied set', () => {
    expect(NEVER_COPIED).toContain('NS')
  })

  it('the copyable set covers every silently-critical type', async () => {
    // If a silently-critical type were not copyable, the import could never clear the gate for it.
    for (const type of ['MX', 'TXT', 'SRV', 'CAA']) {
      expect(COPYABLE).toContain(type)
    }
  })
})

describe('the gate actually opens — end to end', () => {
  const NS = ['kate.ns.cloudflare.com', 'walt.ns.cloudflare.com']
  const existing = [...MX_SET, SPF, WWW]

  it('REFUSES delegation before the import, naming inbound mail', () => {
    const decision = decideOnboarding({
      mode: 'delegated', state: 'not-configured',
      existing, imported: [],
      observedNameservers: NS, requiredNameservers: NS,
    })
    expect(decision.ok).toBe(false)
    if (!decision.ok) {
      expect(decision.reason).toBe('mail-would-break')
      expect(decision.message).toContain('INBOUND MAIL')
    }
  })

  it('ALLOWS the write once the import has run and delegation is live', async () => {
    // This is the transition the whole zone-import step exists to produce. Before this the
    // one-click flow could only ever refuse.
    const outcome = await importZone('example.com', planImport(existing, []), writer())
    expect(outcome.complete).toBe(true)

    const decision = decideOnboarding({
      mode: 'delegated', state: 'delegated',
      existing, imported: outcome.imported,
      observedNameservers: NS, requiredNameservers: NS,
    })
    expect(decision.ok).toBe(true)
    if (decision.ok) expect(decision.canWriteRecords).toBe(true)
    expect(nextStep({
      mode: 'delegated', state: 'delegated',
      existing, imported: outcome.imported,
      observedNameservers: NS, requiredNameservers: NS,
    })).toContain('Nothing to do')
  })

  it('STILL refuses after a partial import, so one failed MX blocks delegation', async () => {
    const outcome = await importZone(
      'example.com', planImport(existing, []), writer(['mx2.zoho.com']),
    )
    expect(outcome.complete).toBe(false)
    const facts = {
      mode: 'delegated' as const, state: 'not-configured' as const,
      existing, imported: outcome.imported,
      observedNameservers: NS, requiredNameservers: NS,
    }
    expect(decideOnboarding(facts).ok).toBe(false)
    expect(nextStep(facts)).toContain('Import the domain')
  })
})
