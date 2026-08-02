import { describe, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { proxy } from '../proxy'

const request = (url: string, host: string, headers: Record<string, string> = {}) => new NextRequest(url, {
  headers: { host, ...headers },
})

const blyssProxyHeaders = {
  'x-forwarded-proto': 'https',
  'cdn-loop': 'cloudflare; loops=1',
  'cf-ray': 'a21298e8fb9e73a7-JNB',
  'cf-visitor': '{"scheme":"https"}',
}

describe('public Web exact host dispatch', () => {
  test('allows only canonical and required acceptance public hosts', () => {
    expect(proxy(request('https://trimly.co.ke/', 'trimly.co.ke')).status).toBe(200)
    expect(proxy(request('https://3002.blyss.co.ke/', '3002.blyss.co.ke')).status).toBe(200)
    expect(proxy(request('https://attacker.test/', 'attacker.test')).status).toBe(404)
    expect(proxy(request('https://direct-origin.test/', 'direct-origin.test')).status).toBe(404)
  })

  test('accepts the constrained Blyss loopback origin only in explicit acceptance mode', () => {
    expect(proxy(request('http://127.0.0.1:3002/', '127.0.0.1:3002', blyssProxyHeaders)).status).toBe(404)
    process.env.FUMA_BLYSS_ACCEPTANCE_PROXY = '1'
    try {
      expect(proxy(request('http://127.0.0.1:3002/', '127.0.0.1:3002', blyssProxyHeaders)).status).toBe(200)
      expect(proxy(request('http://127.0.0.1:3002/', '127.0.0.1:3002', { ...blyssProxyHeaders, 'cf-ray': 'forged' })).status).toBe(404)
      expect(proxy(request('http://127.0.0.1:3002/', '127.0.0.1:3002', { ...blyssProxyHeaders, 'x-forwarded-proto': 'http' })).status).toBe(404)
    } finally {
      delete process.env.FUMA_BLYSS_ACCEPTANCE_PROXY
    }
  })

  test('redirects www to canonical while preserving path and query', () => {
    const response = proxy(request('https://www.trimly.co.ke/docs/getting-started?ref=public', 'www.trimly.co.ke'))
    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe('https://trimly.co.ke/docs/getting-started?ref=public')
  })

  test('restricts internal host to probes and metrics', () => {
    expect(proxy(request('https://web-internal.service/api/health', 'web-internal.service')).status).toBe(200)
    expect(proxy(request('https://web-internal.service/', 'web-internal.service')).status).toBe(404)
  })

  test('marks exact configured preview host noindex', () => {
    process.env.FUMA_PUBLIC_PREVIEW_HOST = 'candidate.preview.example'
    const response = proxy(request('https://candidate.preview.example/', 'candidate.preview.example'))
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    delete process.env.FUMA_PUBLIC_PREVIEW_HOST
  })
})
