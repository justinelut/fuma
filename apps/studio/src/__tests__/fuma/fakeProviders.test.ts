import { describe, expect, it } from 'bun:test'
import {
  FUMA_FAKE_PROVIDER_IDS,
  startFumaFakeProviderSuite,
} from '../helpers/fuma/fakeProviders'

function bodyHash(body: string): string {
  return new Bun.CryptoHasher('sha256').update(body).digest('hex')
}

describe('FUMA-002 fake provider servers', () => {
  it('validates every route set before binding any provider server', () => {
    expect(() => startFumaFakeProviderSuite({
      'platform-paystack': [{
        method: 'POST',
        path: 'missing-leading-slash',
        status: 202,
      }],
    })).toThrow('Fake provider route path must start with /')
  })

  it('runs independent localhost-only provider instances with deterministic routes', async () => {
    const suite = startFumaFakeProviderSuite()
    const servers = [
      suite.ociEmail,
      suite.platformPaystack,
      suite.customerPaystack,
      suite.cloudflare,
    ]

    try {
      expect(servers.map(({ providerId }) => providerId)).toEqual(FUMA_FAKE_PROVIDER_IDS)
      expect(new Set(servers.map(({ origin }) => origin)).size).toBe(4)
      for (const server of servers) {
        const url = new URL(server.origin)
        expect(url.hostname).toBe('127.0.0.1')
        expect(Number(url.port)).toBeGreaterThan(0)

        const response = await Bun.fetch(`${server.origin}/fixture`, { method: 'POST', body: server.providerId })
        expect(response.status).toBe(202)

        const [capture] = server.captures()
        expect(capture).toMatchObject({
          providerId: server.providerId,
          method: 'POST',
          path: '/fixture',
          status: 202,
          startedAtMs: Date.parse('2040-01-01T00:00:00.000Z'),
          durationMs: 5,
          bodyLength: server.providerId.length,
          bodySha256: bodyHash(server.providerId),
        })
        expect(capture.completedAtMs).toBe(capture.startedAtMs + 5)
      }
    } finally {
      await suite.close()
      await suite.close()
    }
  })

  it('retains hashes and redacted headers but never raw bodies or secret-bearing header values', async () => {
    const suite = startFumaFakeProviderSuite({
      'platform-paystack': [{
        method: 'PUT',
        path: '/payments?attempt=1',
        status: 207,
        responseBody: 'deterministic-response',
        timingMs: 11,
      }],
    })
    const rawBody = 'raw-request-material-that-must-not-be-retained'
    const secretValues = [
      'Bearer header-material',
      'session-cookie-material',
      'provider-api-key-material',
      'webhook-signature-material',
      'CLOUDFLARE_GLOBAL_API_KEY_SENTINEL',
      'adversarial-authkey-material',
      'provider-access-key-material',
    ]

    try {
      const response = await Bun.fetch(`${suite.platformPaystack.origin}/payments?attempt=1`, {
        method: 'PUT',
        headers: {
          authorization: secretValues[0],
          cookie: secretValues[1],
          'x-api-key': secretValues[2],
          'x-paystack-signature': secretValues[3],
          'x-fixture-label': 'safe-label',
        },
        body: rawBody,
      })
      expect(response.status).toBe(207)

      const cloudflareResponse = await Bun.fetch(`${suite.cloudflare.origin}/fixture`, {
        method: 'POST',
        headers: {
          'x-auth-key': secretValues[4],
          'x-authkey': secretValues[5],
          'x-access-key': secretValues[6],
        },
      })
      expect(cloudflareResponse.status).toBe(202)

      const [capture] = suite.platformPaystack.captures()
      expect(capture.bodyLength).toBe(rawBody.length)
      expect(capture.bodySha256).toBe(bodyHash(rawBody))
      expect(capture.durationMs).toBe(11)
      expect(capture.headers.authorization).toBe('[REDACTED]')
      expect(capture.headers.cookie).toBe('[REDACTED]')
      expect(capture.headers['x-api-key']).toBe('[REDACTED]')
      expect(capture.headers['x-paystack-signature']).toBe('[REDACTED]')
      expect(capture.headers['x-fixture-label']).toBe('safe-label')

      const [cloudflareCapture] = suite.cloudflare.captures()
      expect(cloudflareCapture.headers['x-auth-key']).toBe('[REDACTED]')
      expect(cloudflareCapture.headers['x-authkey']).toBe('[REDACTED]')
      expect(cloudflareCapture.headers['x-access-key']).toBe('[REDACTED]')

      const retained = JSON.stringify([
        ...suite.platformPaystack.captures(),
        ...suite.cloudflare.captures(),
      ])
      expect(retained).not.toContain(rawBody)
      for (const secret of secretValues) expect(retained).not.toContain(secret)

      suite.reset()
      expect(suite.platformPaystack.captures()).toEqual([])
      expect(suite.cloudflare.captures()).toEqual([])
    } finally {
      await suite.close()
    }
  })
})
