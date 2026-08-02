import { describe, expect, test } from 'bun:test'
import {
  ConfiguredPublicContactSink,
  DurablePublicContactRoutingAuthority,
  readPublicContactSinkConfig,
  type PublicContactReceiptRepository,
  type PublicContactRoutingReceipt,
} from './contact'

const value = Object.freeze({
  kind: 'general' as const,
  name: 'Reader',
  email: 'reader@example.test',
  message: 'A bounded contact request for the Fuma team.',
  consentVersion: '2026-07-26' as const,
  replayToken: 'contact_replay_1234',
})

const configured = Object.freeze({
  FUMA_PUBLIC_CONTACT_ROUTING_URL: 'https://contact.internal/ingest',
  FUMA_PUBLIC_CONTACT_ROUTING_TOKEN: 'private-contact-routing-token-000001',
  FUMA_PUBLIC_CONTACT_RETENTION_DAYS: '30',
  FUMA_PUBLIC_CONTACT_RETENTION_POLICY_VERSION: 'privacy-2026-07',
})

describe('configured public contact routing', () => {
  test('is absent by default and rejects partial or unsafe configuration', () => {
    expect(readPublicContactSinkConfig({})).toBeNull()
    expect(() => readPublicContactSinkConfig({ FUMA_PUBLIC_CONTACT_ROUTING_URL: configured.FUMA_PUBLIC_CONTACT_ROUTING_URL })).toThrow('incomplete')
    expect(() => readPublicContactSinkConfig({ ...configured, FUMA_PUBLIC_CONTACT_ROUTING_URL: 'http://contact.internal/ingest' })).toThrow('HTTPS')
    expect(() => readPublicContactSinkConfig({ ...configured, FUMA_PUBLIC_CONTACT_ROUTING_URL: 'https://contact.internal/ingest?secret=x' })).toThrow('HTTPS')
    expect(() => readPublicContactSinkConfig({ ...configured, FUMA_PUBLIC_CONTACT_RETENTION_DAYS: '401' })).toThrow('retention')
  })

  test('forwards only strict requests with private auth, bounded timeout, and no redirects', async () => {
    let request: Request | null = null
    const config = readPublicContactSinkConfig({ ...configured, FUMA_PUBLIC_CONTACT_ROUTING_TIMEOUT_MS: '500' })!
    const sink = new ConfiguredPublicContactSink(config, (async (input, init) => {
      request = new Request(input, init)
      return new Response(null, { status: 202 })
    }) as typeof fetch)
    expect(await sink.accept(value)).toBe(true)
    expect(request).not.toBeNull()
    const sent = request!
    expect(sent.url).toBe('https://contact.internal/ingest')
    expect(sent.headers.get('authorization')).toBe('Bearer private-contact-routing-token-000001')
    expect(sent.headers.get('cookie')).toBeNull()
    expect(await sent.json()).toEqual(value)
    expect(await sink.accept({ ...value, message: '<script>' } as never)).toBe(false)
  })

  test('persists one strict receipt and distinguishes exact replay from mutation', async () => {
    const claims = new Map<string, Parameters<PublicContactReceiptRepository['claim']>[0]>()
    const receipts = new Map<string, PublicContactRoutingReceipt>()
    const repository: PublicContactReceiptRepository = {
      async claim(claim) {
        const receipt = receipts.get(claim.replayToken)
        if (receipt) {
          return receipt.requestSha256 === claim.requestSha256 && receipt.routedAs === claim.routedAs
            ? { outcome: 'replay', receipt }
            : { outcome: 'conflict' }
        }
        const existing = claims.get(claim.replayToken)
        if (existing) {
          return existing.requestSha256 === claim.requestSha256
            ? { outcome: 'busy', retryAfterSeconds: 1 }
            : { outcome: 'conflict' }
        }
        claims.set(claim.replayToken, claim)
        return { outcome: 'acquired' }
      },
      async complete({ claim, receipt }) {
        if (claims.get(claim.replayToken)?.leaseOwner !== claim.leaseOwner) return false
        claims.delete(claim.replayToken)
        receipts.set(claim.replayToken, receipt)
        return true
      },
      async release({ replayToken, leaseOwner }) {
        if (claims.get(replayToken)?.leaseOwner === leaseOwner) claims.delete(replayToken)
      },
    }
    let deliveries = 0
    const authority = new DurablePublicContactRoutingAuthority({
      repository,
      sink: { accept: async () => { deliveries += 1; return true } },
      retentionDays: 30,
      retentionPolicyVersion: 'privacy-2026-07',
      now: () => Date.parse('2026-07-31T06:00:00Z'),
    })
    const accepted = await authority.route(value)
    expect(accepted).toMatchObject({ outcome: 'accepted', receipt: { disposition: 'accepted', deleteAfter: '2026-08-30T06:00:00Z' } })
    expect(await authority.route(value)).toMatchObject({ outcome: 'accepted', receipt: { disposition: 'replayed' } })
    expect(await authority.route({ ...value, message: 'Mutated replay body.' })).toEqual({ outcome: 'conflict' })
    expect(deliveries).toBe(1)
  })
})
