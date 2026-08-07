import { describe, it, expect } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  EMAIL_PROVIDERS,
  EmailProviderSchema,
  connectionComplete,
  deliverabilityWarnings,
  detectConflict,
  findProvider,
  mergeSpf,
  perDomainRecords,
  planRecords,
  requiredRecords,
} from '../../../server/fuma/email/providerCatalogue'

const EXPECTED = [
  'google-workspace', 'microsoft-365', 'zoho-mail', 'resend', 'sendgrid',
] as const

describe('the catalogue', () => {
  it('ships every provider the product offers', () => {
    expect(EMAIL_PROVIDERS.map((provider) => provider.id)).toEqual([...EXPECTED])
  })

  it('validates every entry against its own schema', () => {
    // The catalogue is data, so it has to be checkable as data.
    for (const provider of EMAIL_PROVIDERS) {
      expect(Value.Check(EmailProviderSchema, provider)).toBe(true)
    }
  })

  it('finds a provider by id and refuses an unknown one', () => {
    expect(findProvider('zoho-mail')?.label).toBe('Zoho Mail')
    expect(findProvider('not-a-provider')).toBeNull()
  })

  it('marks mailbox providers as handling inbound and senders as not', () => {
    // The distinction that stops a transactional sender taking over somebody's
    // inbound mail.
    expect(findProvider('google-workspace')?.handlesInbound).toBe(true)
    expect(findProvider('microsoft-365')?.handlesInbound).toBe(true)
    expect(findProvider('zoho-mail')?.handlesInbound).toBe(true)
    expect(findProvider('resend')?.handlesInbound).toBe(false)
    expect(findProvider('sendgrid')?.handlesInbound).toBe(false)
  })

  it('gives every inbound provider MX records', () => {
    for (const id of ['google-workspace', 'microsoft-365', 'zoho-mail']) {
      const provider = findProvider(id)
      expect(provider?.records.some((record) => record.type === 'MX')).toBe(true)
    }
  })

  it('gives sending-only providers no MX records at all', () => {
    // Not an oversight: adding MX would move inbound mail.
    for (const id of ['resend', 'sendgrid']) {
      const provider = findProvider(id)
      expect(provider?.records.some((record) => record.type === 'MX')).toBe(false)
    }
  })

  it('gives every MX record a priority', () => {
    for (const provider of EMAIL_PROVIDERS) {
      for (const record of provider.records) {
        if (record.type !== 'MX') continue
        expect(record.priority).toBeDefined()
      }
    }
  })

  it('orders Zoho’s three MX records by preference', () => {
    const mx = findProvider('zoho-mail')?.records.filter((record) => record.type === 'MX') ?? []
    expect(mx.map((record) => record.priority)).toEqual([10, 20, 50])
  })

  it('marks provider-issued values as perDomain rather than inventing them', () => {
    // A guessed DKIM key produces a record that looks right and verifies false.
    for (const provider of EMAIL_PROVIDERS) {
      for (const record of provider.records) {
        if (!record.value.startsWith('PROVIDER_ISSUED') && !record.host.startsWith('PROVIDER_ISSUED')) {
          continue
        }
        expect(record.perDomain).toBe(true)
      }
    }
  })

  it('lists the records a provider must supply', () => {
    const perDomain = perDomainRecords(findProvider('sendgrid')!)
    expect(perDomain.length).toBeGreaterThan(0)
    expect(perDomain.every((record) => record.perDomain === true)).toBe(true)
  })

  it('separates required records from optional ones', () => {
    // A connection missing only DKIM is working-but-weak, not failed.
    const google = findProvider('google-workspace')!
    const required = requiredRecords(google).map((record) => record.purpose)
    expect(required).toContain('mail-routing')
    expect(required).not.toContain('dkim')
  })
})

describe('SPF merging', () => {
  it('creates a record when none exists', () => {
    expect(mergeSpf(null, ['_spf.google.com']))
      .toBe('v=spf1 include:_spf.google.com ~all')
  })

  it('adds an include to an existing record rather than creating a second', () => {
    // Two SPF TXT records make the domain's SPF invalid outright, which shows up as
    // mail failing authentication rather than as an obvious error.
    const merged = mergeSpf('v=spf1 include:_spf.google.com ~all', ['sendgrid.net'])
    expect(merged).toBe('v=spf1 include:_spf.google.com include:sendgrid.net ~all')
    expect(merged.match(/v=spf1/g)).toHaveLength(1)
  })

  it('does not duplicate an include already present', () => {
    // Reconnecting the same provider must converge, not accumulate.
    expect(mergeSpf('v=spf1 include:zoho.com ~all', ['zoho.com']))
      .toBe('v=spf1 include:zoho.com ~all')
  })

  it('accepts an include with or without the prefix', () => {
    expect(mergeSpf(null, ['include:zoho.com'])).toBe('v=spf1 include:zoho.com ~all')
  })

  it('keeps a hard fail rather than loosening it', () => {
    // Weakening somebody's SPF as a side effect of adding a sender is a security
    // regression they did not ask for.
    expect(mergeSpf('v=spf1 include:a.com -all', ['b.com']))
      .toBe('v=spf1 include:a.com include:b.com -all')
  })

  it('preserves mechanisms other than includes', () => {
    expect(mergeSpf('v=spf1 ip4:198.51.100.1 include:a.com ~all', ['b.com']))
      .toBe('v=spf1 ip4:198.51.100.1 include:a.com include:b.com ~all')
  })

  it('adds several includes at once', () => {
    expect(mergeSpf(null, ['a.com', 'b.com']))
      .toBe('v=spf1 include:a.com include:b.com ~all')
  })
})

describe('conflict detection', () => {
  it('refuses a second inbound provider', () => {
    // MX records are not additive: two providers deliver unpredictably to one.
    const conflict = detectConflict(findProvider('zoho-mail')!, 'google-workspace')
    expect(conflict?.code).toBe('inbound-already-configured')
    expect(conflict?.message).toMatch(/not additive/)
    expect(conflict?.message).toMatch(/Switch providers explicitly/)
  })

  it('allows reconnecting the same inbound provider', () => {
    // Idempotent reconnection is normal, not a conflict.
    expect(detectConflict(findProvider('zoho-mail')!, 'zoho-mail')).toBeNull()
  })

  it('allows the first inbound provider', () => {
    expect(detectConflict(findProvider('google-workspace')!, null)).toBeNull()
  })

  it('allows a sending-only provider alongside an existing mailbox', () => {
    // Adding transactional sending must not require touching inbound mail.
    expect(detectConflict(findProvider('resend')!, 'google-workspace')).toBeNull()
    expect(detectConflict(findProvider('sendgrid')!, 'microsoft-365')).toBeNull()
  })
})

describe('planning the records to apply', () => {
  it('emits exactly one SPF record', () => {
    const planned = planRecords(findProvider('google-workspace')!, null)
    expect(planned.filter((record) => record.purpose === 'spf')).toHaveLength(1)
  })

  it('merges into the existing SPF rather than adding another', () => {
    const planned = planRecords(findProvider('resend')!, 'v=spf1 include:_spf.google.com ~all')
    const spf = planned.find((record) => record.purpose === 'spf')
    expect(spf?.value).toBe('v=spf1 include:_spf.google.com include:amazonses.com ~all')
  })

  it('keeps the non-SPF records intact', () => {
    const planned = planRecords(findProvider('zoho-mail')!, null)
    expect(planned.filter((record) => record.type === 'MX')).toHaveLength(3)
    expect(planned.some((record) => record.purpose === 'dkim')).toBe(true)
  })

  it('is idempotent: applying twice yields the same set', () => {
    // Computed from the desired end state, so reconnecting cannot duplicate MX rows.
    const provider = findProvider('zoho-mail')!
    const first = planRecords(provider, null)
    const spf = first.find((record) => record.purpose === 'spf')?.value ?? null
    const second = planRecords(provider, spf)
    expect(second).toEqual(first)
  })

  it('places SPF on the host the provider declares', () => {
    // Resend publishes SPF on a subdomain, not the apex.
    const planned = planRecords(findProvider('resend')!, null)
    expect(planned.find((record) => record.purpose === 'spf')?.host).toBe('send')
  })
})

describe('completion and deliverability', () => {
  it('reports a connection complete when every required purpose resolves', () => {
    expect(connectionComplete(findProvider('google-workspace')!, [
      'mail-routing', 'spf', 'verification',
    ])).toEqual({ complete: true })
  })

  it('names what is missing rather than just failing', () => {
    const result = connectionComplete(findProvider('google-workspace')!, ['mail-routing'])
    expect(result.complete).toBe(false)
    if (result.complete) return
    expect([...result.missing].sort()).toEqual(['spf', 'verification'])
  })

  it('does not demand optional records for completion', () => {
    // DKIM is not required to deliver, so its absence is a warning, not a failure.
    expect(connectionComplete(findProvider('zoho-mail')!, [
      'mail-routing', 'spf', 'verification',
    ]).complete).toBe(true)
  })

  it('warns about missing DKIM and DMARC', () => {
    const warnings = deliverabilityWarnings(['mail-routing', 'spf'])
    expect(warnings.some((warning) => warning.includes('DKIM'))).toBe(true)
    expect(warnings.some((warning) => warning.includes('DMARC'))).toBe(true)
  })

  it('stays quiet when both are present', () => {
    expect(deliverabilityWarnings(['mail-routing', 'spf', 'dkim', 'dmarc'])).toEqual([])
  })
})
