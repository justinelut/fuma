import { describe, expect, test } from 'bun:test'
import { ConfiguredPublicContactSink, readPublicContactSinkConfig } from './contact'

const value = Object.freeze({
  kind: 'general' as const,
  name: 'Reader',
  email: 'reader@example.test',
  message: 'A bounded contact request for the Fuma team.',
  consentVersion: '2026-07-26' as const,
  replayToken: 'contact_replay_1234',
})

describe('configured public contact routing', () => {
  test('is absent by default and rejects partial or unsafe configuration', () => {
    expect(readPublicContactSinkConfig({})).toBeNull()
    expect(() => readPublicContactSinkConfig({ FUMA_PUBLIC_CONTACT_ROUTING_URL: 'https://contact.internal/ingest' })).toThrow('incomplete')
    expect(() => readPublicContactSinkConfig({ FUMA_PUBLIC_CONTACT_ROUTING_URL: 'http://contact.internal/ingest', FUMA_PUBLIC_CONTACT_ROUTING_TOKEN: 'x'.repeat(32) })).toThrow('HTTPS')
    expect(() => readPublicContactSinkConfig({ FUMA_PUBLIC_CONTACT_ROUTING_URL: 'https://contact.internal/ingest?secret=x', FUMA_PUBLIC_CONTACT_ROUTING_TOKEN: 'x'.repeat(32) })).toThrow('HTTPS')
  })

  test('forwards only strict requests with private auth, bounded timeout, and no redirects', async () => {
    let request: Request | null = null
    const config = readPublicContactSinkConfig({
      FUMA_PUBLIC_CONTACT_ROUTING_URL: 'https://contact.internal/ingest',
      FUMA_PUBLIC_CONTACT_ROUTING_TOKEN: 'private-contact-routing-token-000001',
      FUMA_PUBLIC_CONTACT_ROUTING_TIMEOUT_MS: '500',
    })!
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
})
