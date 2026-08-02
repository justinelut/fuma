import { describe, expect, test } from 'bun:test'
import type { PublicationAnalyticsCollectionContext } from '@core/fuma/publication/analyticsContracts'
import { PublicationPrivacyAnalyticsPublicAdapter } from '../../../server/fuma/publication/privacyAnalyticsAdapters'
import { PublicationPrivacyAnalyticsPublicBoundary } from '../../../server/fuma/publication/privacyAnalyticsPublicBoundary'
import type { PublicationRepositoryScope } from '../../../server/fuma/publication/scope'

const scope: PublicationRepositoryScope = Object.freeze({
  platformId: 'platform', organizationId: 'organization', workspaceId: 'workspace', siteId: 'site',
  ownerKey: 'owner', generation: 1, state: 'active', transferFence: null, profileId: 'publication',
})
const body = JSON.stringify({ kind: 'post-read', contentId: 'post-a', referrer: 'direct', audience: 'public', memberSource: 'none', newsletterId: null })

describe('FUMA-040 public analytics boundary', () => {
  test('derives exact host scope, consent, GPC, DNT, and bot state outside the event body', async () => {
    const captured: PublicationAnalyticsCollectionContext[] = []
    const adapter = new PublicationPrivacyAnalyticsPublicAdapter({
      async collect(_scope, _input, context) {
        captured.push(context)
        return { accepted: false, reason: 'global-privacy-control' }
      },
    } as never)
    const boundary = new PublicationPrivacyAnalyticsPublicBoundary({
      adapter,
      hosts: { async scopeForHost(host) { return host === 'tenant.trimly.co.ke' ? scope : null } },
      now: () => new Date('2040-01-02T03:04:05.000Z'),
    })
    const request = new Request('https://tenant.trimly.co.ke/_fuma/publication/analytics', {
      method: 'POST', body,
      headers: { 'content-type': 'application/json', 'user-agent': 'ExampleBot/1.0' },
    })
    request.headers.set('cookie', '__Host-fuma_analytics_consent=granted')
    request.headers.set('sec-gpc', '1')
    request.headers.set('dnt', '1')
    const response = await boundary.handle(request)
    expect(response?.status).toBe(202)
    expect(captured).toEqual([{ occurredAt: '2040-01-02T03:04:05.000Z', consent: 'granted', globalPrivacyControl: true, doNotTrack: true, bot: 'known-bot' }])
  })

  test('fails unknown hosts closed before collection and rejects non-POST methods', async () => {
    let calls = 0
    const adapter = new PublicationPrivacyAnalyticsPublicAdapter({ async collect() { calls += 1; return { accepted: true, reason: 'accepted' } } } as never)
    const boundary = new PublicationPrivacyAnalyticsPublicBoundary({ adapter, hosts: { async scopeForHost() { return null } } })
    expect((await boundary.handle(new Request('https://unknown.example/_fuma/publication/analytics', { method: 'POST', body, headers: { 'content-type': 'application/json' } })))?.status).toBe(404)
    expect((await boundary.handle(new Request('https://unknown.example/_fuma/publication/analytics')))?.status).toBe(405)
    expect(calls).toBe(0)
  })
})
