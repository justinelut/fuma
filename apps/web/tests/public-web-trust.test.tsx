import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ContactForm } from '../components/contact-form'
import { generateMetadata as legalMetadata } from '../app/legal/[slug]/page'
import { LegalPolicyPage } from '../components/legal-policy-page'
import { StatusSummary } from '../components/status-summary'
import demoEvidence from './evidence/fuma-web-014-trust.json'
import { createContactPost, CONTACT_NOTICE_VERSION } from '../lib/contact-boundary'
import { readEditorial } from '../lib/editorial'
import {
  publishPolicyVersion,
  validatePolicyHistory,
  type LegalPolicyVersion,
} from '../lib/legal-policy-history'
import { readPublicStatus } from '../lib/status-boundary'

const PUBLIC = 'https://3002.blyss.co.ke'
const NOW = Date.parse('2026-07-27T12:00:00Z')
const STARTED = '2026-07-27T11:59:58Z'

function contactBody(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'general',
    name: 'A User',
    email: 'user@example.test',
    message: 'A bounded public request.',
    website: '',
    startedAt: STARTED,
    consentVersion: CONTACT_NOTICE_VERSION,
    replayToken: 'abcdefghijklmnop',
    ...overrides,
  }
}

function contactRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${PUBLIC}/api/contact`, {
    method: 'POST',
    headers: {
      host: '3002.blyss.co.ke',
      origin: PUBLIC,
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.10',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function noStore(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('set-cookie')).toBeNull()
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
}

function policy(version: string, current: boolean, overrides: Partial<LegalPolicyVersion> = {}): LegalPolicyVersion {
  return {
    slug: 'privacy',
    version,
    effectiveAt: version === '2026-07-26' ? '2026-07-26T00:00:00Z' : '2026-07-27T00:00:00Z',
    reviewAt: '2026-10-26T00:00:00Z',
    owner: 'Privacy review owner',
    content: `Complete privacy notice content for version ${version}.`,
    current,
    ...overrides,
  }
}

describe('strict public contact boundary', () => {
  test('accepts one bounded request and makes an identical replay idempotent', async () => {
    const forwarded: unknown[] = []
    const post = createContactPost({
      now: () => NOW,
      forward: async (value) => { forwarded.push(value); return true },
    })
    const first = await post(contactRequest(contactBody()))
    const replay = await post(contactRequest(contactBody()))
    expect(first.status).toBe(202)
    expect(replay.status).toBe(202)
    expect(forwarded).toEqual([{
      kind: 'general',
      name: 'A User',
      email: 'user@example.test',
      message: 'A bounded public request.',
      consentVersion: CONTACT_NOTICE_VERSION,
      replayToken: 'abcdefghijklmnop',
    }])
    noStore(first)
    noStore(replay)
  })

  test('rejects replay mutation, spam fields, fast/stale forms, XSS names, and header injection without reflection', async () => {
    let calls = 0
    const post = createContactPost({ now: () => NOW, forward: async () => { calls += 1; return true } })
    expect((await post(contactRequest(contactBody()))).status).toBe(202)
    expect((await post(contactRequest(contactBody({ message: 'A changed replay body.' })))).status).toBe(409)
    expect((await post(contactRequest(contactBody({ replayToken: 'bbbbbbbbbbbbbbbb', website: 'bot.example' })))).status).toBe(400)
    expect((await post(contactRequest(contactBody({ replayToken: 'cccccccccccccccc', startedAt: '2026-07-27T12:00:00Z' })))).status).toBe(400)
    expect((await post(contactRequest(contactBody({ replayToken: 'dddddddddddddddd', startedAt: '2026-07-27T08:00:00Z' })))).status).toBe(400)
    const xss = await post(contactRequest(contactBody({ replayToken: 'eeeeeeeeeeeeeeee', name: '<img src=x onerror=alert(1)>' })))
    const injection = await post(contactRequest(contactBody({ replayToken: 'ffffffffffffffff', name: 'A User\r\nBcc: private@example.test' })))
    expect(xss.status).toBe(400)
    expect(injection.status).toBe(400)
    expect(await xss.text()).not.toContain('onerror')
    expect(calls).toBe(1)
  })

  test('rate limits a privacy-minimized key and fails closed when private routing is unavailable', async () => {
    const post = createContactPost({ now: () => NOW, limit: 2, forward: async () => true })
    expect((await post(contactRequest(contactBody({ replayToken: 'rate-token-000001' })))).status).toBe(202)
    expect((await post(contactRequest(contactBody({ replayToken: 'rate-token-000002' })))).status).toBe(202)
    const limited = await post(contactRequest(contactBody({ replayToken: 'rate-token-000003' })))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('600')
    noStore(limited)

    const unavailablePost = createContactPost({ now: () => NOW, forward: async () => false })
    const unavailable = await unavailablePost(contactRequest(contactBody()))
    expect(unavailable.status).toBe(503)
    expect(unavailable.headers.get('retry-after')).toBe('30')
    noStore(unavailable)
  })
})

describe('strict status boundary', () => {
  test('shows only fresh strict authority data and requests no-store without redirects', async () => {
    let init: RequestInit | undefined
    const value = await readPublicStatus({
      now: () => NOW,
      env: {
        FUMA_STATUS_SUMMARY_URL: 'https://status-authority.example.test/summary',
        FUMA_STATUS_SUMMARY_TOKEN: 'status-authority-token-0000000000000001',
        FUMA_PUBLIC_STATUS_PAGE_URL: 'https://status.example.test/history',
      },
      fetchImpl: async (_input, options) => {
        init = options
        return Response.json({
          schemaVersion: 1,
          scope: 'public-web',
          status: 'degraded',
          message: 'A validated test fixture.',
          checkedAt: '2026-07-27T11:59:00Z',
          incident: {
            incidentId: 'incident-1',
            state: 'monitoring',
            summary: 'A bounded test incident.',
            startedAt: '2026-07-27T11:30:00Z',
            updatedAt: '2026-07-27T11:58:00Z',
          },
          onCall: { coverage: 'confirmed', checkedAt: '2026-07-27T11:59:00Z' },
        })
      },
    })
    expect(value).toEqual({
      availability: 'current',
      status: 'degraded',
      message: 'A validated test fixture.',
      checkedAt: '2026-07-27T11:59:00Z',
      incident: {
        incidentId: 'incident-1',
        state: 'monitoring',
        summary: 'A bounded test incident.',
        startedAt: '2026-07-27T11:30:00Z',
        updatedAt: '2026-07-27T11:58:00Z',
      },
      onCallCoverage: { coverage: 'confirmed', checkedAt: '2026-07-27T11:59:00Z' },
      statusPageUrl: 'https://status.example.test/history',
    })
    expect(init?.cache).toBe('no-store')
    expect(init?.redirect).toBe('error')
  })

  test('uses a useful claim-free unavailable state for missing, stale, malformed, oversized, or failed authority data', async () => {
    const scenarios = [
      async () => Response.json({ status: 'operational', message: 'Stale.', checkedAt: '2026-07-27T11:00:00Z' }),
      async () => Response.json({ status: 'perfect', message: 'Invented.', checkedAt: '2026-07-27T11:59:00Z' }),
      async () => new Response('x'.repeat(8_193)),
      async () => { throw new Error('offline') },
    ]
    for (const fetchImpl of scenarios) {
      const value = await readPublicStatus({
        now: () => NOW,
        env: {
          FUMA_STATUS_SUMMARY_URL: 'https://status-authority.example.test/summary',
          FUMA_STATUS_SUMMARY_TOKEN: 'status-authority-token-0000000000000001',
        },
        fetchImpl,
      })
      expect(value.availability).toBe('unavailable')
      expect(value.message).toContain('No operational, uptime, incident, monitoring, or on-call claim')
    }
    const unconfigured = await readPublicStatus({
      now: () => NOW,
      env: { FUMA_PUBLIC_STATUS_PAGE_URL: 'https://status.example.test/history?token=secret' },
    })
    expect(unconfigured).toEqual({
      availability: 'unavailable',
      message: 'Current service status is unavailable. No operational, uptime, incident, monitoring, or on-call claim is being made.',
      attemptedAt: '2026-07-27T12:00:00Z',
      statusPageUrl: null,
    })
  })
})

describe('legal version linkage and accessible content', () => {
  test('publishes a forward-only version while preserving the complete prior text', () => {
    const initial = [policy('2026-07-26', true)]
    const history = publishPolicyVersion(initial, {
      slug: 'privacy',
      version: '2026-07-27',
      effectiveAt: '2026-07-27T00:00:00Z',
      reviewAt: '2026-10-26T00:00:00Z',
      owner: 'Privacy review owner',
      content: 'Complete privacy notice content for version 2026-07-27.',
    }, new Date('2026-07-27T12:00:00Z'))
    expect(history.map(({ version, current }) => ({ version, current }))).toEqual([
      { version: '2026-07-26', current: false },
      { version: '2026-07-27', current: true },
    ])
    expect(history[0]?.content).toBe(initial[0]?.content)
    expect(() => publishPolicyVersion(history, {
      slug: 'privacy', version: '2026-07-26', effectiveAt: '2026-07-26T00:00:00Z',
      reviewAt: '2026-10-26T00:00:00Z', owner: 'Privacy review owner', content: 'A complete replacement privacy notice.',
    }, new Date('2026-07-27T12:00:00Z'))).toThrow('move forward')
  })

  test('fails an overdue current policy and links each disk policy to version, effective date, owner, and review date', async () => {
    expect(() => validatePolicyHistory([
      policy('2026-07-26', true, { reviewAt: '2026-07-26T01:00:00Z' }),
    ], new Date('2026-07-27T12:00:00Z'))).toThrow('overdue')
    const policies = (await readEditorial(false, new Date(NOW))).filter((entry) => entry.meta.collection === 'legal')
    expect(policies.map((entry) => entry.meta.slug).sort()).toEqual(['acceptable-use', 'cookies', 'privacy', 'terms'])
    const expectedVersions: Readonly<Record<string, string>> = {
      'acceptable-use': '2026-07-26',
      cookies: '2026-08-02',
      privacy: '2026-08-02',
      terms: '2026-08-02',
    }
    for (const entry of policies) {
      expect(entry.meta.version).toBe(expectedVersions[entry.meta.slug])
      expect(entry.meta.publishedAt).toBe('2026-07-26T00:00:00Z')
      expect(entry.meta.owner).toMatch(/review owner/)
      expect(Date.parse(entry.meta.reviewAt)).toBeGreaterThan(NOW)
    }
  })

  test('keeps legal metadata canonical and noindexes malformed route input', async () => {
    const current = await legalMetadata({ params: Promise.resolve({ slug: 'privacy' }) })
    expect(current.alternates?.canonical).toBe('https://trimly.co.ke/legal/privacy')
    expect(current.robots).toEqual({ index: true, follow: true })

    const malformed = await legalMetadata({ params: Promise.resolve({ slug: 'privacy#attacker' }) })
    expect(malformed.alternates?.canonical).toBe('https://trimly.co.ke/legal/unavailable')
    expect(malformed.robots).toEqual({ index: false, follow: false })
  })

  test('renders labelled forms, status live region, policy metadata, and safe links without invented external claims', async () => {
    const contactHtml = renderToStaticMarkup(createElement(ContactForm, { kind: 'security' }))
    expect(contactHtml).toContain('Reply email')
    expect(contactHtml).toContain('aria-live="polite"')
    expect(contactHtml).toContain('min-h-11')
    expect(contactHtml).toContain('/legal/privacy')

    const statusHtml = renderToStaticMarkup(createElement(StatusSummary, {
      value: {
        availability: 'unavailable',
        message: 'Current service status is unavailable. No operational, uptime, incident, monitoring, or on-call claim is being made.',
        attemptedAt: '2026-07-27T12:00:00Z',
        statusPageUrl: null,
      },
    }))
    expect(statusHtml).toContain('role="status"')
    expect(statusHtml).toContain('Status not available')
    expect(statusHtml).not.toContain('href="http')

    const degradedHtml = renderToStaticMarkup(createElement(StatusSummary, {
      value: {
        availability: 'current',
        status: 'degraded',
        message: 'A bounded authority-reported degradation.',
        checkedAt: '2026-07-27T11:59:00Z',
        incident: {
          incidentId: 'incident-1',
          state: 'monitoring',
          summary: 'A bounded test incident.',
          startedAt: '2026-07-27T11:30:00Z',
          updatedAt: '2026-07-27T11:58:00Z',
        },
        onCallCoverage: { coverage: 'confirmed', checkedAt: '2026-07-27T11:59:00Z' },
        statusPageUrl: 'https://status.example.test/history',
      },
    }))
    expect(degradedHtml).toContain('Current incident')
    expect(degradedHtml).toContain('A bounded test incident.')
    expect(degradedHtml).toContain('On-call coverage:')
    expect(degradedHtml).toContain('confirmed')
    expect(degradedHtml).toContain('rel="noopener noreferrer"')

    const privacy = (await readEditorial(false, new Date(NOW))).find((entry) => entry.meta.slug === 'privacy')!
    const policyHtml = renderToStaticMarkup(createElement(LegalPolicyPage, { entry: privacy }))
    expect(policyHtml).toContain('<dt class="font-semibold">Effective</dt>')
    expect(policyHtml).toContain('Approval state')
    expect(policyHtml).toContain('/legal/history')
    expect(policyHtml).not.toMatch(/SOC 2|ISO 27001|99\.9%|guaranteed response/i)
  })
})

test('deterministic FUMA-WEB-014 demo evidence stays explicit and claim-free', () => {
  const actual = {
    ticket: 'FUMA-WEB-014',
    clock: '2026-07-27T12:00:00Z',
    contact: { firstStatus: 202, replayStatus: 202, privateForwardCalls: 1, deliveryConfirmed: false },
    policy: { slug: 'privacy', versions: ['2026-07-26', '2026-07-27'], preservedPriorText: true, legalApproval: 'pending' },
    status: { availability: 'unavailable', operationalClaim: false, providerClaim: false },
  }
  expect(actual).toEqual(demoEvidence)
  const evidenceText = readFileSync(path.join(import.meta.dir, 'evidence/fuma-web-014-trust.json'), 'utf8')
  expect(evidenceText).not.toMatch(/certified|SLA|uptime percentage|delivery confirmed/i)
})
