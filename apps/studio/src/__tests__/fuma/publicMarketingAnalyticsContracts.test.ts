import { describe, expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import {
  PublicMarketingCollectionResultSchema,
  PublicMarketingDailyRowSchema,
  PublicMarketingReportSchema,
  PublicMarketingStoredEventSchema,
} from '../../core/fuma/publicAnalytics/contracts'
import { PublicMarketingAnalyticsHttpClient } from '../../admin/fuma/publicAnalytics/client'

const HASH = 'a'.repeat(64)
const STORED = Object.freeze({
  eventIdSha256: HASH,
  kind: 'page-view',
  routeClass: 'home',
  campaignSource: null,
  correlationSha256: null,
  collectionBasis: 'cookieless-baseline',
  occurredAt: '2040-02-01T10:00:00Z',
  receivedAt: '2040-02-01T10:00:01Z',
  day: '2040-02-01',
})
const REPORT = Object.freeze({
  range: { from: '2040-02-01', to: '2040-02-02' },
  retention: { rawEventDays: 30, aggregateDays: 400 },
  totals: { pageViews: 1, ctaSelections: 0, handoffs: 0, signups: 0, sites: 0, publishes: 0, paid: 0 },
  funnel: { visits: 0, signups: 0, sites: 0, publishes: 0, paid: 0 },
  conversionBasisPoints: { visitToSignup: 0, signupToSite: 0, siteToPublish: 0, publishToPaid: 0 },
  routes: [{ routeClass: 'home', pageViews: 1, handoffs: 0 }],
  campaigns: [],
})

describe('FUMA-WEB-016 strict contracts', () => {
  test('closes storage semantics and collection decisions in TypeBox', () => {
    expect(Value.Check(PublicMarketingStoredEventSchema, STORED)).toBe(true)
    expect(Value.Check(PublicMarketingStoredEventSchema, { ...STORED, collectionBasis: 'product-authority' })).toBe(false)
    expect(Value.Check(PublicMarketingStoredEventSchema, { ...STORED, kind: 'handoff', correlationSha256: null, collectionBasis: 'explicit-consent' })).toBe(false)
    expect(Value.Check(PublicMarketingStoredEventSchema, { ...STORED, kind: 'signup', routeClass: 'home', correlationSha256: HASH, collectionBasis: 'product-authority' })).toBe(false)
    expect(Value.Check(PublicMarketingDailyRowSchema, {
      day: '2040-02-01', kind: 'paid', routeClass: null, campaignSource: null,
      collectionBasis: 'explicit-consent', count: 1,
    })).toBe(false)
    expect(Value.Check(PublicMarketingDailyRowSchema, {
      day: '2040-02-01', kind: 'paid', routeClass: null, campaignSource: null,
      collectionBasis: 'product-authority', count: 0,
    })).toBe(false)
    expect(Value.Check(PublicMarketingCollectionResultSchema, { accepted: false, replayed: true, reason: 'accepted' })).toBe(false)
    expect(Value.Check(PublicMarketingReportSchema, {
      ...REPORT,
      conversionBasisPoints: { ...REPORT.conversionBasisPoints, visitToSignup: 10_001 },
    })).toBe(false)
  })

  test('rejects protocol-relative paths and malformed ranges before fetch', async () => {
    expect(() => new PublicMarketingAnalyticsHttpClient({ basePath: '//analytics.example.test/report' })).toThrow('same-origin')
    expect(() => new PublicMarketingAnalyticsHttpClient({ basePath: '/admin\\analytics' })).toThrow('same-origin')
    let requests = 0
    const client = new PublicMarketingAnalyticsHttpClient({
      basePath: '/admin/fuma/analytics',
      fetchImpl: (async () => {
        requests += 1
        return Response.json(REPORT)
      }) as typeof fetch,
    })
    await expect(client.report({ from: 'not-a-date', to: '2040-02-02' })).rejects.toThrow('range is invalid')
    expect(requests).toBe(0)
    await expect(client.report(REPORT.range)).resolves.toEqual(REPORT)
    expect(requests).toBe(1)
  })
})
