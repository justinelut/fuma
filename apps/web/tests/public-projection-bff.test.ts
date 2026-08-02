import { describe, expect, test } from 'bun:test'
import {
  fetchPublicProjection,
  handlePublicProjectionBff,
  readPublicProjectionClientConfig,
  type PublicProjectionClientConfig,
} from '../lib/public-projections'

const config: PublicProjectionClientConfig = Object.freeze({
  internalOrigin: 'http://studio-internal.service:3001',
  serviceToken: 'projection-service-token-0000000001',
  publicHosts: Object.freeze(['3002.blyss.co.ke', 'trimly.co.ke']),
  timeoutMs: 100,
})

const envelope = {
  data: {
    items: [{
      id: 'product_website',
      slug: 'website',
      name: 'Website',
      summary: 'A public product description.',
      profiles: ['website'],
      available: true,
      featureKeys: ['visual-editor'],
      updatedAt: '2026-07-25T20:00:00Z',
    }],
    page: { hasMore: false, nextCursor: null },
  },
  meta: { schemaVersion: 1, datasetVersion: 'product-facts:7', etag: '"product-facts-7"' },
}

function upstream(body: unknown = envelope, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': status === 200 ? 'public, max-age=30' : 'no-store',
      ...(status === 200 ? { etag: envelope.meta.etag } : {}),
      ...headers,
    },
  })
}

describe('Next public projection BFF', () => {
  test('forwards only the service credential and safe conditional header', async () => {
    let captured: Request | null = null
    const response = await handlePublicProjectionBff(new Request(
      'https://3002.blyss.co.ke/api/public/v1/product-facts?limit=6',
      { headers: { cookie: 'visitor-session=private', authorization: 'Bearer visitor-token', 'if-none-match': '"old"' } },
    ), {
      config,
      fetchImpl: async (input, init) => {
        captured = new Request(input, init)
        return upstream()
      },
    })

    expect(response.status).toBe(200)
    expect(captured).not.toBeNull()
    expect(captured!.headers.get('authorization')).toBe(`Bearer ${config.serviceToken}`)
    expect(captured!.headers.get('x-fuma-audience')).toBe('fuma-public-web')
    expect(captured!.headers.get('x-fuma-request-id')).toMatch(/^[0-9a-f-]{36}$/)
    expect(captured!.headers.get('cookie')).toBeNull()
    expect(captured!.headers.get('if-none-match')).toBe('"old"')
    expect(captured!.url).toBe('http://studio-internal.service:3001/_fuma/private/public/v1/product-facts?limit=6')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('x-fuma-dataset-version')).toBe('product-facts:7')
  })

  test('fails closed on unknown public hosts and public/private-origin confusion', async () => {
    const unknown = await handlePublicProjectionBff(new Request('https://attacker.test/api/public/v1/product-facts'), {
      config,
      fetchImpl: async () => upstream(),
    })
    expect(unknown.status).toBe(404)

    expect(() => readPublicProjectionClientConfig({
      FUMA_PUBLIC_PROJECTION_INTERNAL_ORIGIN: 'https://trimly.co.ke',
      FUMA_PUBLIC_PROJECTION_SERVICE_TOKEN: config.serviceToken,
    })).toThrow('private-cluster')
    expect(() => readPublicProjectionClientConfig({
      FUMA_PUBLIC_PROJECTION_INTERNAL_ORIGIN: 'https://api' + '.trimly.co.ke',
      FUMA_PUBLIC_PROJECTION_SERVICE_TOKEN: config.serviceToken,
    })).toThrow('private-cluster')
    expect(() => readPublicProjectionClientConfig({
      FUMA_PUBLIC_PROJECTION_INTERNAL_ORIGIN: 'http://studio-internal.service:3001',
      FUMA_PUBLIC_PROJECTION_SERVICE_TOKEN: config.serviceToken,
      FUMA_PUBLIC_WEB_HOSTS: 'trimly.co.ke,attacker.test',
    })).toThrow('host configuration')
  })

  test('rejects malformed filters before any private request', async () => {
    let calls = 0
    for (const query of ['limit=101', 'limit=6&limit=7', 'organizationId=org_private']) {
      const response = await handlePublicProjectionBff(new Request(
        `https://3002.blyss.co.ke/api/public/v1/product-facts?${query}`,
      ), { config, fetchImpl: async () => { calls += 1; return upstream() } })
      expect(response.status).toBe(400)
    }
    expect(calls).toBe(0)
  })

  test('redacts malformed, extra-field, oversized, and untrusted 5xx responses', async () => {
    for (const responseFactory of [
      () => upstream({ ...envelope, data: { ...envelope.data, items: [{ ...envelope.data.items[0], staffEmail: 'private@example.test' }] } }),
      () => new Response(JSON.stringify(envelope), { status: 200, headers: { 'content-type': 'text/plain', etag: envelope.meta.etag } }),
      () => new Response('{"stack":"/private/path","secret":"value"}', { status: 500, headers: { 'content-type': 'application/json' } }),
      () => new Response('x'.repeat(524_289), { status: 200 }),
    ]) {
      const response = await fetchPublicProjection('product-facts', new URLSearchParams(), null, {
        config,
        fetchImpl: async () => responseFactory(),
      })
      expect(response.status).toBe(503)
      const text = await response.text()
      expect(text).toContain('temporarily_unavailable')
      expect(text).not.toContain('private@example.test')
      expect(text).not.toContain('/private/path')
      expect(text).not.toContain('secret')
    }
  })

  test('preserves only validated 429 errors and safe retry metadata', async () => {
    const response = await fetchPublicProjection('product-facts', new URLSearchParams(), null, {
      config,
      fetchImpl: async () => upstream({
        error: { code: 'rate_limited', message: 'Try again shortly.', retryAfterSeconds: 30 },
      }, 429, { 'retry-after': '30', 'set-cookie': 'staff=forbidden' }),
    })
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('30')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  test('accepts only matching conditional revalidation without stale fallback', async () => {
    const response = await fetchPublicProjection('pricing', new URLSearchParams(), '"pricing-7"', {
      config,
      fetchImpl: async () => new Response(null, {
        status: 304,
        headers: { etag: '"pricing-7"', 'set-cookie': 'staff=forbidden' },
      }),
    })
    expect(response.status).toBe(304)
    expect(response.headers.get('etag')).toBe('"pricing-7"')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('cache-control')).not.toContain('stale-while-revalidate')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  test('fails safely on timeout and mismatched ETag/schema versions', async () => {
    const timeout = await fetchPublicProjection('product-facts', new URLSearchParams(), null, {
      config,
      fetchImpl: async (_input, init) => await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('private timeout detail')))
      }),
    })
    expect(timeout.status).toBe(503)

    const mismatched = await fetchPublicProjection('product-facts', new URLSearchParams(), null, {
      config,
      fetchImpl: async () => upstream(envelope, 200, { etag: '"different"' }),
    })
    expect(mismatched.status).toBe(503)
  })
})
