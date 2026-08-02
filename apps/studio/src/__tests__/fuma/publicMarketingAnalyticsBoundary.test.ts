import { describe, expect, test } from 'bun:test'
import { createPublicMarketingAnalyticsBoundary } from '../../../server/fuma/publicAnalytics/boundary'
import { MemoryPublicMarketingAnalyticsRepository } from '../../../server/fuma/publicAnalytics/memory'
import { PublicMarketingAnalyticsService } from '../../../server/fuma/publicAnalytics/service'

const HOST = 'studio-internal.service'
const TOKEN = 'a'.repeat(48)
const EVENT = Object.freeze({ version: 1, kind: 'page_view', routeClass: 'home', timestamp: '2040-02-01T10:00:00Z', consent: 'not_required' })

function request(body: unknown, headers: Record<string, string> = {}, path = '/_fuma/private/public/v1/acquisition-events', host = HOST): Request {
  const values = new Map(Object.entries({
    host: HOST,
    authorization: `Bearer ${TOKEN}`,
    'x-fuma-audience': 'fuma-public-web',
    'x-fuma-request-id': '123e4567-e89b-42d3-a456-426614174000',
    'x-fuma-gpc': '0',
    'x-fuma-dnt': '0',
    'x-fuma-traffic': 'human',
    'content-type': 'application/json',
    ...headers,
  }).map(([key, value]) => [key.toLowerCase(), value]))
  const text = JSON.stringify(body)
  return {
    url: `http://${host}${path}`,
    method: 'POST',
    headers: { get: (key: string) => values.get(key.toLowerCase()) ?? null, has: (key: string) => values.has(key.toLowerCase()) },
    text: async () => text,
  } as unknown as Request
}

function harness() {
  const repository = new MemoryPublicMarketingAnalyticsRepository()
  const service = new PublicMarketingAnalyticsService({ repository, now: () => new Date('2040-02-01T12:00:00.000Z') })
  const boundary = createPublicMarketingAnalyticsBoundary({ host: HOST, serviceToken: TOKEN, service, now: () => new Date('2040-02-01T12:00:00.000Z') })
  return { boundary, repository }
}

describe('FUMA-WEB-016 private acquisition endpoint', () => {
  test('accepts only the existing private Web service authority and emits no cookie', async () => {
    const { boundary, repository } = harness()
    expect(boundary.handles(request(EVENT))).toBe(true)
    const accepted = await boundary.handle(request(EVENT))
    expect(accepted?.status).toBe(202)
    expect(accepted?.headers.get('cache-control')).toBe('no-store')
    expect(accepted?.headers.get('set-cookie')).toBeNull()
    expect(repository.events.size).toBe(1)
    for (const headers of [
      { authorization: 'Bearer wrong' },
      { 'x-fuma-audience': 'fuma-admin' },
      { cookie: '__Host-fuma_app=visitor' },
      { 'x-forwarded-authorization': 'Bearer visitor' },
    ]) {
      expect((await boundary.handle(request(EVENT, headers)))?.status, JSON.stringify(headers)).toBe(404)
    }
    expect((await boundary.handle(request(EVENT, {}, '/_fuma/private/public/v1/acquisition-events', 'attacker.internal')))?.status).toBe(404)
  })

  test('suppresses GPC centrally and rejects malformed traffic classes, queries, and private fields', async () => {
    const { boundary, repository } = harness()
    const gpc = await boundary.handle(request(EVENT, { 'x-fuma-gpc': '1' }))
    expect(await gpc?.json()).toMatchObject({ accepted: false, reason: 'global-privacy-control' })
    expect(repository.events.size).toBe(0)
    expect((await boundary.handle(request(EVENT, { 'x-fuma-traffic': 'visitor-123' })))?.status).toBe(400)
    expect((await boundary.handle(request({ ...EVENT, email: 'person@example.test' })))?.status).toBe(400)
    expect((await boundary.handle(request(EVENT, {}, '/_fuma/private/public/v1/acquisition-events?tenant=private')))?.status).toBe(400)
  })

  test('returns a safe unavailable response when durable storage is blocked', async () => {
    const { boundary, repository } = harness()
    repository.failWrites = true
    const response = await boundary.handle(request(EVENT))
    expect(response?.status).toBe(503)
    expect(await response?.json()).toEqual({ error: 'temporarily_unavailable' })
  })
})
