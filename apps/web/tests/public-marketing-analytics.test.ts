import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import nextConfig from '../next.config'
import { collectAcquisition } from '../lib/private-bridge'

const root = resolve(import.meta.dir, '..')
const analyticsSources = [
  'app/api/events/route.ts',
  'components/analytics-beacon.tsx',
  'components/consent-banner.tsx',
  'components/intent-form.tsx',
  'lib/acquisition-client.ts',
].map((path) => readFileSync(resolve(root, path), 'utf8')).join('\n')

test('FUMA-WEB-016 keeps analytics first-party, storage-safe, and non-blocking', async () => {
  expect(analyticsSources).not.toMatch(/document\.cookie|localStorage|fingerprint|deviceId|visitorId/i)
  expect(analyticsSources).not.toMatch(/google-analytics|googletagmanager|segment\.com|mixpanel|posthog/i)
  expect(analyticsSources).not.toMatch(/fetch\(['"]https?:\/\//)
  expect(analyticsSources).not.toContain("await fetch('/api/events'")
  expect(analyticsSources).toContain('readConsentPreference(sessionStorage)')
  expect(analyticsSources).toContain('sendOptionalAcquisition(acquisitionEvent, consent)')

  const groups = await nextConfig.headers?.()
  const headers = Object.fromEntries(groups?.[0]?.headers.map(({ key, value }) => [key, value]) ?? [])
  const csp = headers['Content-Security-Policy'] ?? ''
  expect(csp).toContain("connect-src 'self' https://auth.trimly.co.ke")
  expect(csp).not.toMatch(/connect-src[^;]*https?:\/\/(?!auth\.trimly\.co\.ke)/)
})


test('FUMA-WEB-016 forwards only minimized events and coarse privacy classifications', async () => {
  let target = ''
  let forwarded: RequestInit | undefined
  const accepted = await collectAcquisition({
    version: 1,
    kind: 'page_view',
    routeClass: 'home',
    timestamp: '2040-02-01T10:00:00Z',
    consent: 'not_required',
  }, {
    globalPrivacyControl: false,
    doNotTrack: false,
    traffic: 'human',
  }, {
    config: {
      internalOrigin: 'http://studio-internal.service',
      serviceToken: 'a'.repeat(48),
      publicHosts: ['trimly.co.ke'],
      timeoutMs: 500,
    },
    fetchImpl: (async (input, init) => {
      target = String(input)
      forwarded = init
      return new Response(null, { status: 202 })
    }),
  })
  expect(accepted).toBe(true)
  expect(target).toBe('http://studio-internal.service/_fuma/private/public/v1/acquisition-events')
  const headers = forwarded?.headers as Record<string, string>
  expect(Object.keys(headers).sort()).toEqual([
    'accept',
    'authorization',
    'content-type',
    'x-fuma-audience',
    'x-fuma-dnt',
    'x-fuma-gpc',
    'x-fuma-request-id',
    'x-fuma-traffic',
  ])
  expect(headers).toMatchObject({
    'x-fuma-audience': 'fuma-public-web',
    'x-fuma-dnt': '0',
    'x-fuma-gpc': '0',
    'x-fuma-traffic': 'human',
  })
  expect(forwarded?.credentials).toBeUndefined()
})
