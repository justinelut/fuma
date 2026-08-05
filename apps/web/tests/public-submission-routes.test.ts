import { describe, expect, test } from 'bun:test'
import { isSameOriginPublicRequest } from '../lib/public-request'
import { POST as contact } from '../app/api/contact/route'
import { POST as events } from '../app/api/events/route'
import { POST as handoff } from '../app/api/handoff/route'
import { POST as vitals } from '../app/api/vitals/route'

const PUBLIC = 'https://3002.blyss.co.ke'

function request(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${PUBLIC}${path}`, {
    method: 'POST',
    headers: {
      host: '3002.blyss.co.ke',
      origin: PUBLIC,
      'content-type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function expectNoStore(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('set-cookie')).toBeNull()
}

describe('public submission routes', () => {
  test('accepts exact public origin behind forwarded HTTPS and rejects forwarded HTTP', () => {
    const proxied = new Request('http://trimly.co.ke/api/handoff', {
      method: 'POST',
      headers: { host: 'trimly.co.ke', origin: 'https://trimly.co.ke', 'x-forwarded-proto': 'https' },
    })
    const insecure = new Request('http://trimly.co.ke/api/handoff', {
      method: 'POST',
      headers: { host: 'trimly.co.ke', origin: 'https://trimly.co.ke', 'x-forwarded-proto': 'http' },
    })
    const proxiedWithoutProtocol = new Request('http://trimly.co.ke/api/handoff', {
      method: 'POST',
      headers: { host: 'trimly.co.ke', origin: 'https://trimly.co.ke' },
    })
    const internallyRewritten = new Request('http://127.0.0.1:3002/api/handoff', {
      method: 'POST',
      headers: { host: 'trimly.co.ke', origin: 'https://trimly.co.ke' },
    })
    expect(isSameOriginPublicRequest(proxied)).toBe(true)
    expect(isSameOriginPublicRequest(proxiedWithoutProtocol)).toBe(true)
    expect(isSameOriginPublicRequest(internallyRewritten)).toBe(true)
    expect(isSameOriginPublicRequest(insecure)).toBe(false)
  })
  test('reject cross-origin and non-JSON requests without private calls', async () => {
    for (const [path, handler] of [
      ['/api/handoff', handoff],
      ['/api/contact', contact],
      ['/api/events', events],
      ['/api/vitals', vitals],
    ] as const) {
      const crossOrigin = await handler(request(path, {}, { origin: 'https://attacker.test' }))
      expect(crossOrigin.status).toBe(404)
      expectNoStore(crossOrigin)
      const wrongType = await handler(request(path, '{}', { 'content-type': 'text/plain' }))
      expect(wrongType.status).toBe(415)
      expectNoStore(wrongType)
    }
  })

  test('rejects hostile handoff and contact fields as invalid requests', async () => {
    const hostileHandoff = await handoff(request('/api/handoff', {
      kind: 'choose_plan', source: 'pricing', planId: 'plan_launch', redirect: 'https://attacker.test', email: 'person@example.test',
    }))
    expect(hostileHandoff.status).toBe(400)
    expectNoStore(hostileHandoff)

    const hostileContact = await contact(request('/api/contact', {
      kind: 'general', name: 'A User\r\nBcc: private@example.test', email: 'user@example.test',
      message: 'A bounded public request.', consentVersion: '2026-07-26', replayToken: 'abcdefghijklmnop', recipient: 'private@example.test',
    }))
    expect(hostileContact.status).toBe(400)
    expectNoStore(hostileContact)
  })

  test('accepts valid minimized events even when the private collector is unavailable', async () => {
    const response = await events(request('/api/events', {
      version: 1, kind: 'page_view', routeClass: 'home', timestamp: '2026-07-26T09:00:00Z', consent: 'not_required',
    }))
    expect(response.status).toBe(202)
    expectNoStore(response)
  })

  test('rejects private analytics fields and silently filters bots', async () => {
    const privateEvent = await events(request('/api/events', {
      version: 1, kind: 'page_view', routeClass: 'home', timestamp: '2026-07-26T09:00:00Z', consent: 'not_required', tenantId: 'private',
    }))
    expect(privateEvent.status).toBe(400)
    expectNoStore(privateEvent)

    const bot = await events(request('/api/events', {}, { 'user-agent': 'ExampleCrawler/1.0' }))
    expect(bot.status).toBe(202)
    expectNoStore(bot)
  })

  test('bounds bodies and Web Vital fields', async () => {
    const oversized = await handoff(request('/api/handoff', JSON.stringify({ value: 'x'.repeat(4_100) })))
    expect(oversized.status).toBe(413)
    expectNoStore(oversized)

    const invalidVital = await vitals(request('/api/vitals', {
      name: 'LCP', value: 900, rating: 'good', routeClass: 'home', sessionId: 'cross-host',
    }))
    expect(invalidVital.status).toBe(400)
    expectNoStore(invalidVital)
  })

  test('suppresses collection under GPC and DNT without disrupting the page', async () => {
    for (const headers of [{ 'sec-gpc': '1' }, { dnt: '1' }]) {
      const response = await events(request('/api/events', {
        version: 1, kind: 'page_view', routeClass: 'home', timestamp: '2026-07-26T09:00:00Z', consent: 'not_required',
      }, headers))
      expect(response.status).toBe(202)
      expectNoStore(response)
    }
  })
})
