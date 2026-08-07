import { describe, it, expect } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  MANAGED_RELAY_METERS,
  MailConfigurationSchema,
  canBeManagedRelay,
  connectedSendCostMicros,
  decideUsageRecording,
  describeSwitch,
  isMetered,
  metersFor,
  validateConfiguration,
  type MailConfiguration,
} from '../../../server/fuma/email/deliveryMode'
import { findProvider } from '../../../server/fuma/email/providerCatalogue'

const AT = '2026-08-01T00:00:00.000Z'

const connected = (providerId: string | null = 'google-workspace'): MailConfiguration => ({
  mode: 'connected', providerId, decidedAt: AT,
})

const managed = (providerId: string | null = null): MailConfiguration => ({
  mode: 'managed', providerId, decidedAt: AT,
})

describe('validating a configuration', () => {
  it('accepts connected mail naming a known provider', () => {
    expect(validateConfiguration(connected('zoho-mail'))).toBeNull()
  })

  it('accepts managed relay with no provider', () => {
    expect(validateConfiguration(managed())).toBeNull()
  })

  it('refuses connected mail with no provider named', () => {
    // Nothing would know which DNS records the domain should carry.
    expect(validateConfiguration(connected(null))?.code).toBe('connected-needs-provider')
  })

  it('refuses a provider outside the catalogue', () => {
    expect(validateConfiguration(connected('mailchimp'))?.code).toBe('unknown-provider')
  })

  it('refuses managed relay carrying a provider id', () => {
    // Carrying one invites reading it and concluding the customer pays that vendor,
    // which is the confusion that leads to unmetered sending.
    const problem = validateConfiguration(managed('resend'))
    expect(problem?.code).toBe('managed-takes-no-provider')
    expect(problem?.message).toMatch(/unmetered sending/)
  })

  it('validates against its own schema', () => {
    expect(Value.Check(MailConfigurationSchema, connected())).toBe(true)
    expect(Value.Check(MailConfigurationSchema, managed())).toBe(true)
  })

  it('refuses an unknown mode', () => {
    expect(Value.Check(MailConfigurationSchema, {
      mode: 'relayed', providerId: null, decidedAt: AT,
    })).toBe(false)
  })
})

describe('what gets metered', () => {
  it('meters managed relay', () => {
    // We bear the cost per message, so it must be metered and priced.
    expect(isMetered(managed())).toBe(true)
  })

  it('does not meter connected mail', () => {
    // The customer pays their vendor directly; there is no cost of ours to recover.
    expect(isMetered(connected())).toBe(false)
  })

  it('meters both recipients and bytes for managed relay', () => {
    // Per-message alone under-recovers large newsletters; per-byte alone
    // under-recovers a thousand tiny notifications.
    expect([...metersFor(managed())]).toEqual([...MANAGED_RELAY_METERS])
    expect(MANAGED_RELAY_METERS).toContain('email_recipients')
    expect(MANAGED_RELAY_METERS).toContain('email_message_bytes')
  })

  it('returns no meters at all for connected mail', () => {
    // An empty list, not zero readings: zero implies we measured and found nothing,
    // when there is nothing of ours to measure.
    expect(metersFor(connected())).toEqual([])
  })

  it('derives metering from mode alone', () => {
    // If it depended on observable usage, a metering outage would look like a free
    // tier.
    for (const providerId of ['google-workspace', 'resend', 'sendgrid']) {
      expect(isMetered(connected(providerId))).toBe(false)
    }
    expect(isMetered(managed())).toBe(true)
  })
})

describe('deciding whether to record usage', () => {
  it('records against both meters for managed relay', () => {
    const decision = decideUsageRecording(managed())
    expect(decision.record).toBe(true)
    if (!decision.record) return
    expect([...decision.meters]).toEqual([...MANAGED_RELAY_METERS])
  })

  it('declines for connected mail and names the provider', () => {
    // "Not metered because their own provider sent it" is a correct outcome; silence
    // would be indistinguishable from a dropped meter.
    const decision = decideUsageRecording(connected('google-workspace'))
    expect(decision.record).toBe(false)
    if (decision.record) return
    expect(decision.reason).toMatch(/Google Workspace/)
    expect(decision.reason).toMatch(/nothing to meter and nothing to charge/)
  })

  it('still explains itself when the provider is unrecognised', () => {
    const decision = decideUsageRecording({
      mode: 'connected', providerId: 'gone-away', decidedAt: AT,
    })
    expect(decision.record).toBe(false)
    if (decision.record) return
    expect(decision.reason).toMatch(/gone-away/)
  })
})

describe('switching mode', () => {
  it('reports metering starting when moving to managed', () => {
    const change = describeSwitch('connected', 'managed')
    expect(change.meteringChange).toBe('starts')
    expect(change.advice).toMatch(/free to them a moment ago/)
  })

  it('reports metering stopping and warns about DNS when moving away', () => {
    // Switching before their records resolve means mail stops rather than moves.
    const change = describeSwitch('managed', 'connected')
    expect(change.meteringChange).toBe('stops')
    expect(change.advice).toMatch(/records resolve first/)
  })

  it('reports no change when the mode is the same', () => {
    expect(describeSwitch('managed', 'managed').meteringChange).toBe('unchanged')
    expect(describeSwitch('connected', 'connected').meteringChange).toBe('unchanged')
  })
})

describe('a connected provider is never our relay', () => {
  it('refuses every catalogue provider as a managed relay', () => {
    // A sending-only provider is still their account and their bill; routing our
    // relay through it would charge a customer for capacity they already pay for.
    for (const id of ['google-workspace', 'resend', 'sendgrid', 'zoho-mail']) {
      expect(canBeManagedRelay(findProvider(id)!)).toBe(false)
    }
  })
})

describe('cost exposure', () => {
  it('is zero for connected mail, stated explicitly', () => {
    // Callable rather than assumed, so a per-tenant cost total cannot quietly omit
    // connected mail instead of including it as zero.
    expect(connectedSendCostMicros()).toBe(0)
  })
})
