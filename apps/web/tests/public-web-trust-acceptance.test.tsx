import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import LegalIndexPage, { metadata as legalIndexMetadata } from '../app/legal/page'
import { generateStaticParams as legalStaticParams } from '../app/legal/[slug]/page'
import { GET as securityText } from '../app/.well-known/security.txt/route'
import { StatusSummary } from '../components/status-summary'
import { readLegalPolicyApprovalManifest } from '../lib/legal-policy-approval'
import nextConfig from '../next.config'

const POLICY_SET_SHA256 = 'dea41b29f31b9109be53ecb3b48fdb1be4da9e0bad8dda2c502cb2264442685b'

describe('FUMA-WEB-014 public trust acceptance additions', () => {
  test('binds the complete current legal set to exact source bytes without inventing approval', async () => {
    const manifest = await readLegalPolicyApprovalManifest()
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      approvalState: 'pending',
      policySetSha256: POLICY_SET_SHA256,
      requiredApprovals: ['legal', 'privacy', 'trust-and-safety'],
      approvals: [],
    })
    expect(manifest.policies.map(({ slug, version }) => ({ slug, version }))).toEqual([
      { slug: 'acceptable-use', version: '2026-07-26' },
      { slug: 'cookies', version: '2026-08-02' },
      { slug: 'privacy', version: '2026-08-02' },
      { slug: 'terms', version: '2026-08-02' },
    ])
  })

  test('renders one canonical accessible legal index with every policy and pending evidence', async () => {
    expect(legalIndexMetadata.alternates?.canonical).toBe('https://trimly.co.ke/legal')
    const html = renderToStaticMarkup(await LegalIndexPage())
    expect(html).toContain('<h1')
    expect(html).toContain('Final review is still pending.')
    expect(html).not.toContain(POLICY_SET_SHA256)
    for (const slug of ['acceptable-use', 'cookies', 'privacy', 'terms']) {
      expect(html).toContain(`href="/legal/${slug}"`)
    }
    expect(html).not.toMatch(/certified|SLA guarantee/i)
  })

  test('pre-renders every current policy for standalone production delivery', async () => {
    expect(await legalStaticParams()).toEqual([
      { slug: 'acceptable-use' },
      { slug: 'cookies' },
      { slug: 'privacy' },
      { slug: 'terms' },
    ])
  })

  test('serves a bounded canonical security.txt without exposing a private recipient', async () => {
    const response = securityText()
    const text = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(text).toContain('Contact: https://trimly.co.ke/security')
    expect(text).toContain('Canonical: https://trimly.co.ke/.well-known/security.txt')
    expect(text).toContain('Expires: 2026-10-26T00:00:00Z')
    expect(text).not.toMatch(/mailto:|@|token|recipient/i)
  })

  test('presents status time in en-KE and Africa/Nairobi while retaining its ISO value', () => {
    const html = renderToStaticMarkup(createElement(StatusSummary, {
      value: {
        availability: 'unavailable',
        message: 'Current service status is unavailable. No operational, uptime, or incident claim is being made.',
        attemptedAt: '2026-07-27T12:00:00Z',
        statusPageUrl: null,
      },
    }))
    expect(html).toContain('dateTime="2026-07-27T12:00:00Z"')
    expect(html).toContain('27 Jul 2026, 15:00')
    expect(html).not.toContain('>2026-07-27T12:00:00Z</time>')
  })

  test('keeps forms same-origin and denies object, frame, and cross-origin opener risks', async () => {
    const groups = await nextConfig.headers?.()
    const headers = Object.fromEntries(groups?.[0]?.headers.map(({ key, value }) => [key, value]) ?? [])
    expect(headers['Content-Security-Policy']).toContain("object-src 'none'")
    expect(headers['Content-Security-Policy']).toContain("frame-src 'none'")
    expect(headers['Content-Security-Policy']).toContain("form-action 'self'")
    expect(headers['Content-Security-Policy']).not.toContain('form-action \'self\' https://app.trimly.co.ke')
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin')
    expect(headers['X-Permitted-Cross-Domain-Policies']).toBe('none')
  })
})
