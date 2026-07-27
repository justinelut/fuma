import { describe, expect, test } from 'bun:test'
import type { PublicProjectionAuthority } from './authority'
import { createPublicProjectionBoundary, type PublicProjectionCoordination } from './boundary'

const HOST = 'studio-internal.service:3001'
const TOKEN = 'projection-service-token-0000000001'

function productSource(extraItem: Record<string, unknown> = {}) {
  return {
    datasetVersion: 'product-facts:7',
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
        ...extraItem,
      }],
      page: { hasMore: false, nextCursor: null },
    },
  }
}

function fixture(options: Readonly<{
  authority?: PublicProjectionAuthority
  allowed?: boolean
  limitFailure?: boolean
}> = {}) {
  const cache = new Map<string, string>()
  const authority = options.authority ?? {
    read: async () => productSource(),
  }
  const coordination: PublicProjectionCoordination = {
    consumeLimit: async () => {
      if (options.limitFailure) throw new Error('redis details must not escape')
      return { allowed: options.allowed ?? true, remaining: 10, retryAfterMs: 1_500 }
    },
    cacheGet: async (key) => cache.get(key) ?? null,
    cacheSet: async (key, value) => {
      cache.set(key, value)
      return true
    },
  }
  return {
    authority,
    boundary: createPublicProjectionBoundary({ host: HOST, serviceToken: TOKEN, authority, coordination }),
  }
}

function projectionRequest(path = '/_fuma/private/public/v1/product-facts?limit=10', headers: Record<string, string> = {}) {
  return new Request(`http://${HOST}${path}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'x-fuma-audience': 'fuma-public-web',
      'x-fuma-request-id': crypto.randomUUID(),
      ...headers,
    },
  })
}

describe('Studio public projection boundary', () => {
  test('returns a strict versioned envelope with deterministic ETag and 304 support', async () => {
    const { boundary } = fixture()
    const first = await boundary.handle(projectionRequest())
    expect(first?.status).toBe(200)
    const body = await first?.json() as { meta: { schemaVersion: number; datasetVersion: string; etag: string } }
    expect(body.meta.schemaVersion).toBe(1)
    expect(body.meta.datasetVersion).toBe('product-facts:7')
    expect(first?.headers.get('etag')).toBe(body.meta.etag)

    const second = await boundary.handle(projectionRequest(undefined, { 'if-none-match': body.meta.etag }))
    expect(second?.status).toBe(304)
    expect(await second?.text()).toBe('')
  })

  test('uses validated cache entries without re-reading authority', async () => {
    let reads = 0
    const { boundary } = fixture({ authority: { read: async () => { reads += 1; return productSource() } } })
    expect((await boundary.handle(projectionRequest()))?.status).toBe(200)
    expect((await boundary.handle(projectionRequest()))?.status).toBe(200)
    expect(reads).toBe(1)
  })

  test('fails closed for wrong host, wrong token, missing service context, visitor cookies, and unowned resources', async () => {
    const { boundary } = fixture()
    const wrongHost = new Request('http://other.internal/_fuma/private/public/v1/product-facts', {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect((await boundary.handle(wrongHost))?.status).toBe(404)
    expect((await boundary.handle(projectionRequest('/_fuma/private/public/v1/product-facts?limit=10', { authorization: 'Bearer wrong-token' })))?.status).toBe(404)
    expect((await boundary.handle(new Request(`http://${HOST}/_fuma/private/public/v1/product-facts`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })))?.status).toBe(404)
    const cookieHeaders = new Headers({
      authorization: `Bearer ${TOKEN}`,
      'x-fuma-audience': 'fuma-public-web',
      'x-fuma-request-id': crypto.randomUUID(),
      cookie: 'visitor=credential',
    })
    const cookieRequest = {
      url: `http://${HOST}/_fuma/private/public/v1/product-facts?limit=10`,
      method: 'GET',
      headers: cookieHeaders,
    } as Request
    expect(cookieRequest.headers.get('cookie')).toBe('visitor=credential')
    expect((await boundary.handle(cookieRequest))?.status).toBe(404)
    expect((await boundary.handle(projectionRequest('/_fuma/private/public/v1/private-offers')))?.status).toBe(404)
  })

  test('rejects duplicate, unknown, oversized, and cross-tenant filters', async () => {
    const { boundary } = fixture()
    for (const path of [
      '/_fuma/private/public/v1/product-facts?limit=10&limit=20',
      '/_fuma/private/public/v1/product-facts?limit=101',
      '/_fuma/private/public/v1/product-facts?organizationId=org_private',
      '/_fuma/private/public/v1/templates?industry=not%20bounded',
    ]) {
      const response = await boundary.handle(projectionRequest(path))
      expect(response?.status).toBe(400)
      expect(response?.headers.get('cache-control')).toBe('no-store')
    }
  })

  test('rejects authority schema drift and private fields without reflecting details', async () => {
    const { boundary } = fixture({
      authority: { read: async () => productSource({ staffEmail: 'private@example.test', secret: 'never' }) },
    })
    const response = await boundary.handle(projectionRequest())
    expect(response?.status).toBe(503)
    const text = await response?.text() ?? ''
    expect(text).toContain('temporarily_unavailable')
    expect(text).not.toContain('private@example.test')
    expect(text).not.toContain('secret')
  })

  test('rejects duplicate stable public IDs within one page', async () => {
    const duplicated = productSource()
    duplicated.data.items.push({ ...duplicated.data.items[0] })
    const { boundary } = fixture({ authority: { read: async () => duplicated } })
    const response = await boundary.handle(projectionRequest())
    expect(response?.status).toBe(503)
    expect(await response?.text()).toContain('temporarily_unavailable')
  })

  test('rate limiting and coordination outages return bounded safe errors', async () => {
    const limited = await fixture({ allowed: false }).boundary.handle(projectionRequest())
    expect(limited?.status).toBe(429)
    expect(limited?.headers.get('retry-after')).toBe('2')

    const unavailable = await fixture({ limitFailure: true }).boundary.handle(projectionRequest())
    expect(unavailable?.status).toBe(503)
    expect(await unavailable?.json()).toEqual({
      error: { code: 'temporarily_unavailable', message: 'Public data is temporarily unavailable.', retryAfterSeconds: 30 },
    })
  })
})
