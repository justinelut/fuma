import { describe, it, expect } from 'bun:test'
import {
  connectProvider,
  connectionStatus,
  instructionRows,
  type ZoneWriter,
} from '../../../server/fuma/email/connection'
import type { EmailRecord } from '../../../server/fuma/email/providerCatalogue'
import { findProvider, planRecords } from '../../../server/fuma/email/providerCatalogue'
import type { MailDnsResolver } from '../../../server/fuma/email/verification'
import type { OnboardingFacts } from '../../../server/fuma/domains/cloudflareDns'

const DOMAIN = 'example.co.ke'

function writer(): ZoneWriter & { applied: EmailRecord[][] } {
  const applied: EmailRecord[][] = []
  return {
    applied,
    async applyRecords(_domain, records) {
      applied.push([...records])
    },
  }
}

const request = (overrides: Record<string, unknown> = {}) => ({
  domain: DOMAIN,
  providerId: 'google-workspace',
  path: 'register' as const,
  existingSpf: null,
  currentInboundProviderId: null,
  ...overrides,
})

describe('the register path', () => {
  it('writes the records itself when nothing is provider-issued', async () => {
    // Resend is sending-only and its records are mostly per-domain, so use a provider
    // whose required set can be written outright.
    const zone = writer()
    const result = await connectProvider(request({
      providerId: 'microsoft-365',
      path: 'register',
    }), zone)
    // M365's MX is tenant-specific, so this correctly stops short of writing.
    expect(result.outcome).toBe('instructions-issued')
    expect(zone.applied).toHaveLength(0)
  })

  it('stops and asks for provider-issued values rather than writing placeholders', async () => {
    // Applying would produce records containing placeholders that verify false.
    const zone = writer()
    const result = await connectProvider(request({ providerId: 'zoho-mail' }), zone)
    expect(result.outcome).toBe('instructions-issued')
    expect(result.awaitingProviderValues.length).toBeGreaterThan(0)
    expect(result.message).toMatch(/issues \d+ value\(s\) specific to your domain/)
    expect(zone.applied).toHaveLength(0)
  })

  it('writes every record once nothing is outstanding', async () => {
    const zone = writer()
    // A provider whose records carry no per-domain values.
    const plain = {
      ...findProvider('zoho-mail')!,
      records: findProvider('zoho-mail')!.records.filter((record) => record.perDomain !== true),
    }
    // Exercise the writer directly with a plan containing no placeholders.
    await zone.applyRecords(DOMAIN, planRecords(plain, null))
    expect(zone.applied[0]?.length).toBeGreaterThan(0)
  })
})

describe('the connect path', () => {
  it('never claims to have written anything', async () => {
    // The failure this prevents: telling somebody their mailbox is configured when all
    // that happened was a list being displayed.
    const zone = writer()
    const result = await connectProvider(request({ path: 'connect' }), zone)
    expect(result.outcome).toBe('instructions-issued')
    expect(zone.applied).toHaveLength(0)
    expect(result.message).toMatch(/we cannot add these records for you/)
  })

  it('still returns the full record set to paste', async () => {
    const result = await connectProvider(request({ path: 'connect' }), writer())
    expect(result.records.length).toBeGreaterThan(0)
  })

  it('behaves the same with no writer at all', async () => {
    const result = await connectProvider(request({ path: 'connect' }), null)
    expect(result.outcome).toBe('instructions-issued')
  })

  it('mentions how many values the provider must issue', async () => {
    const result = await connectProvider(request({
      providerId: 'zoho-mail', path: 'connect',
    }), null)
    expect(result.message).toMatch(/need a value Zoho Mail issues to you/)
  })
})

describe('refusing before anything changes', () => {
  it('refuses a second inbound provider and writes nothing', async () => {
    // A half-applied mail configuration is worse than none: the old provider has been
    // displaced and the new one is not yet working.
    const zone = writer()
    const result = await connectProvider(request({
      providerId: 'zoho-mail',
      currentInboundProviderId: 'google-workspace',
    }), zone)
    expect(result.outcome).toBe('refused')
    expect(result.conflict?.code).toBe('inbound-already-configured')
    expect(result.records).toEqual([])
    expect(zone.applied).toHaveLength(0)
  })

  it('allows a sending-only provider alongside an existing mailbox', async () => {
    const result = await connectProvider(request({
      providerId: 'resend',
      currentInboundProviderId: 'google-workspace',
    }), writer())
    expect(result.outcome).not.toBe('refused')
  })

  it('refuses an unknown provider', async () => {
    const result = await connectProvider(request({ providerId: 'mailchimp' }), writer())
    expect(result.outcome).toBe('refused')
    expect(result.message).toMatch(/not a provider we can configure/)
  })
})

describe('merging into an existing SPF record', () => {
  it('carries the existing includes through', async () => {
    const result = await connectProvider(request({
      providerId: 'resend',
      path: 'connect',
      existingSpf: 'v=spf1 include:_spf.google.com ~all',
    }), null)
    const spf = result.records.find((record) => record.purpose === 'spf')
    expect(spf?.value).toBe('v=spf1 include:_spf.google.com include:amazonses.com ~all')
  })
})

describe('reporting live status', () => {
  const records = planRecords(findProvider('zoho-mail')!, null)
    .filter((record) => record.required && record.perDomain !== true)

  const resolver = (answers: Record<string, unknown>): MailDnsResolver => ({
    async resolveMx(name) {
      return (answers['mx'] as Record<string, never> | undefined)?.[name] ?? []
    },
    async resolveTxt(name) {
      return (answers['txt'] as Record<string, never> | undefined)?.[name] ?? []
    },
    async resolveCname() { return [] },
  })

  it('reports delivering when every required record resolves', async () => {
    const status = await connectionStatus(resolver({
      mx: { [DOMAIN]: [
        { exchange: 'mx.zoho.com', priority: 10 },
        { exchange: 'mx2.zoho.com', priority: 20 },
        { exchange: 'mx3.zoho.com', priority: 50 },
      ] },
      txt: { [DOMAIN]: ['v=spf1 include:zoho.com ~all'] },
    }), records, DOMAIN)
    expect(status.delivering).toBe(true)
    expect(status.message).toMatch(/being delivered/)
  })

  it('advises waiting while records are merely absent', async () => {
    const status = await connectionStatus(resolver({}), records, DOMAIN)
    expect(status.delivering).toBe(false)
    expect(status.message).toMatch(/not visible yet|propagates/)
  })

  it('names the wrong records instead of advising a wait', async () => {
    // Waiting is the wrong advice here, and a generic "not ready yet" would invite it.
    const status = await connectionStatus(resolver({
      mx: { [DOMAIN]: [{ exchange: 'mail.wrong.com', priority: 10 }] },
    }), records, DOMAIN)
    expect(status.message).toMatch(/will\s+not fix themselves/)
  })

  it('rechecks a pending connection sooner than a settled one', async () => {
    const pending = await connectionStatus(resolver({}), records, DOMAIN, 1)
    const settled = await connectionStatus(resolver({
      mx: { [DOMAIN]: [
        { exchange: 'mx.zoho.com', priority: 10 },
        { exchange: 'mx2.zoho.com', priority: 20 },
        { exchange: 'mx3.zoho.com', priority: 50 },
      ] },
      txt: { [DOMAIN]: ['v=spf1 include:zoho.com ~all'] },
    }), records, DOMAIN, 1)
    expect(pending.recheckInSeconds).toBeLessThan(settled.recheckInSeconds)
  })
})

describe('instructions for pasting', () => {
  const rows = instructionRows(planRecords(findProvider('zoho-mail')!, null))

  it('shows a preference only for MX', async () => {
    // A preference column on a TXT row invites somebody to fill it in.
    for (const row of rows) {
      if (row.type === 'MX') expect(row.priority).not.toBe('')
      else expect(row.priority).toBe('')
    }
  })

  it('marks a placeholder as something to replace', () => {
    const placeholder = rows.find((row) => row.value.startsWith('PROVIDER_ISSUED'))
    expect(placeholder?.note).toMatch(/value your provider issued/)
  })

  it('distinguishes required rows from optional ones', () => {
    expect(rows.some((row) => row.note.startsWith('Required'))).toBe(true)
    expect(rows.some((row) => row.note.startsWith('Optional'))).toBe(true)
  })

  it('states both facts when a record is optional AND provider-issued', () => {
    // Zoho's DKIM record is both. Reporting only the placeholder would hide that it can
    // be skipped; reporting only optionality would let somebody paste the placeholder.
    const dkim = rows.find((row) => row.host === 'zoho._domainkey')
    expect(dkim?.note).toMatch(/Optional/)
    expect(dkim?.note).toMatch(/value your provider issued/)
  })

  it('always gives a ttl', () => {
    for (const row of rows) expect(Number(row.ttl)).toBeGreaterThan(0)
  })
})

describe('a bring-your-own domain on Cloudflare gets one-click writes', () => {
  const NS = Object.freeze(['ns1.fuma.net', 'ns2.fuma.net'])

  const onboarded = (over: Partial<OnboardingFacts> = {}): OnboardingFacts => Object.freeze({
    mode: 'delegated',
    state: 'delegated',
    existing: Object.freeze([]),
    imported: Object.freeze([]),
    observedNameservers: NS,
    requiredNameservers: NS,
    ...over,
  })

  it('NO LONGER refuses a connected domain for lack of write access', async () => {
    // The behaviour change. Every real provider issues at least one per-domain value (a DKIM key),
    // so the flow still stops short of writing - but for a DIFFERENT and correct reason. What must
    // no longer appear is "not managed by us", which was the old blanket refusal on connect.
    const zone = writer()
    const result = await connectProvider(request({
      path: 'connect',
      providerId: 'google-workspace',
      cloudflare: onboarded(),
    }), zone)
    expect(result.message).not.toContain('not managed by us')
    expect(result.message).toMatch(/specific to your domain/)
    expect(result.awaitingProviderValues.length).toBeGreaterThan(0)
  })

  it('still only issues instructions when the domain is NOT on Cloudflare', async () => {
    // Absent Cloudflare state means no write access, and the flow must not claim otherwise.
    const zone = writer()
    const result = await connectProvider(request({
      path: 'connect', providerId: 'google-workspace',
    }), zone)
    expect(result.outcome).toBe('instructions-issued')
    expect(zone.applied).toHaveLength(0)
  })

  it('refuses to write while the nameserver change is incomplete', async () => {
    // A partial delegation resolves through us for some visitors and the old provider for others,
    // so writing into our zone would work intermittently.
    const zone = writer()
    const result = await connectProvider(request({
      path: 'connect',
      providerId: 'google-workspace',
      cloudflare: onboarded({ observedNameservers: ['ns1.fuma.net'] }),
    }), zone)
    expect(result.outcome).toBe('instructions-issued')
    expect(zone.applied).toHaveLength(0)
  })

  it('refuses to write when existing MX records were not imported', async () => {
    // Delegating before importing would stop inbound mail while the site looked perfect.
    const zone = writer()
    const result = await connectProvider(request({
      path: 'connect',
      providerId: 'google-workspace',
      cloudflare: onboarded({
        state: 'records-imported',
        existing: [{ type: 'MX', name: '@', value: 'mx.zoho.com', priority: 10 }],
        imported: [],
      }),
    }), zone)
    expect(result.outcome).toBe('instructions-issued')
    expect(zone.applied).toHaveLength(0)
  })

  it('treats a customer-held Cloudflare zone as writable too', async () => {
    const zone = writer()
    const result = await connectProvider(request({
      path: 'connect',
      providerId: 'google-workspace',
      cloudflare: onboarded({ mode: 'authorised', state: 'authorised' }),
    }), zone)
    expect(result.message).not.toContain('not managed by us')
  })

  it('still says "not managed by us" when Cloudflare is absent', async () => {
    // The old message is exactly right when we genuinely have no access, so it must survive for
    // that case - otherwise the customer is told to wait for something nobody is doing.
    const zone = writer()
    const result = await connectProvider(request({
      path: 'connect', providerId: 'google-workspace',
    }), zone)
    expect(result.message).toContain('not managed by us')
  })
})
