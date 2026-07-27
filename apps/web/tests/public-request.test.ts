import { describe, expect, test } from 'bun:test'
import {
  constantTimeEqual,
  isPublicWebRequest,
  isSameOriginPublicRequest,
  readBoundedJson,
} from '../lib/public-request'

const PUBLIC = 'https://3002.blyss.co.ke'

describe('public Web request boundary', () => {
  test('requires exact HTTPS URL, Host, and Origin agreement', () => {
    const safe = new Request(`${PUBLIC}/api/contact`, { headers: { host: '3002.blyss.co.ke', origin: PUBLIC } })
    expect(isPublicWebRequest(safe)).toBe(true)
    expect(isSameOriginPublicRequest(safe)).toBe(true)
    expect(isSameOriginPublicRequest(new Request(`${PUBLIC}/api/contact`, { headers: { host: 'fuma.co.ke', origin: PUBLIC } }))).toBe(false)
    expect(isSameOriginPublicRequest(new Request(`${PUBLIC}/api/contact`, { headers: { origin: 'https://attacker.test' } }))).toBe(false)
    expect(isPublicWebRequest(new Request('http://3002.blyss.co.ke/api/contact'))).toBe(false)
  })

  test('accepts only bounded JSON bodies', async () => {
    const valid = await readBoundedJson(new Request(`${PUBLIC}/api/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: '{"safe":true}',
    }), 64)
    expect(valid).toEqual({ ok: true, value: { safe: true } })

    expect(await readBoundedJson(new Request(`${PUBLIC}/api/contact`, {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
    }), 64)).toEqual({ ok: false, status: 415 })
    expect(await readBoundedJson(new Request(`${PUBLIC}/api/contact`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(65),
    }), 64)).toEqual({ ok: false, status: 413 })
  })

  test('compares secret values without prefix or length acceptance', () => {
    expect(constantTimeEqual('same-value', 'same-value')).toBe(true)
    expect(constantTimeEqual('same-value', 'same-valu')).toBe(false)
    expect(constantTimeEqual('same-value', 'same-value-extra')).toBe(false)
  })
})
