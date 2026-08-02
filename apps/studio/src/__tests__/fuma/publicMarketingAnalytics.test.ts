import { describe, expect, test } from 'bun:test'
import { MemoryPublicMarketingAnalyticsRepository } from '../../../server/fuma/publicAnalytics/memory'
import { PublicMarketingAnalyticsService } from '../../../server/fuma/publicAnalytics/service'

const NOW = '2040-02-01T12:00:00.000Z'
const RANGE = Object.freeze({ from: '2040-02-01', to: '2040-02-02' })
const context = Object.freeze({
  receivedAt: NOW,
  globalPrivacyControl: false,
  doNotTrack: false,
  traffic: 'human' as const,
})
const page = Object.freeze({
  version: 1 as const,
  kind: 'page_view' as const,
  routeClass: 'home' as const,
  timestamp: '2040-02-01T10:00:00Z',
  consent: 'not_required' as const,
  campaignSource: 'organic' as const,
})
const handoff = Object.freeze({
  version: 1 as const,
  kind: 'handoff_started' as const,
  routeClass: 'pricing' as const,
  timestamp: '2040-02-01T10:05:00Z',
  consent: 'granted' as const,
  campaignSource: 'campaign' as const,
  planId: 'launch-monthly',
  handoffCorrelation: 'opaque_handoff_correlation_2040',
})

function harness(now = NOW) {
  const repository = new MemoryPublicMarketingAnalyticsRepository()
  const service = new PublicMarketingAnalyticsService({ repository, now: () => new Date(now) })
  return { repository, service }
}

describe('FUMA-WEB-016 privacy-preserving marketing analytics', () => {
  test('keeps the cookieless baseline but suppresses optional, GPC, DNT, bot, and internal traffic', async () => {
    const { repository, service } = harness()
    expect(await service.collectPublic(page, context)).toMatchObject({ accepted: true, reason: 'accepted' })
    expect(await service.collectPublic({ ...handoff, consent: 'denied' }, context)).toEqual({ accepted: false, replayed: false, reason: 'consent-required' })
    expect(await service.collectPublic(handoff, { ...context, globalPrivacyControl: true })).toEqual({ accepted: false, replayed: false, reason: 'global-privacy-control' })
    expect(await service.collectPublic(handoff, { ...context, doNotTrack: true })).toEqual({ accepted: false, replayed: false, reason: 'do-not-track' })
    expect(await service.collectPublic(handoff, { ...context, traffic: 'known-bot' })).toEqual({ accepted: false, replayed: false, reason: 'traffic-filtered' })
    expect(await service.collectPublic(handoff, { ...context, traffic: 'internal' })).toEqual({ accepted: false, replayed: false, reason: 'traffic-filtered' })
    expect(repository.events.size).toBe(1)
    expect([...repository.events.values()][0]).toMatchObject({ kind: 'page-view', correlationSha256: null, collectionBasis: 'cookieless-baseline' })
  })

  test('rejects PII, identity, tenant, payment, staff, member, path, and cross-host identifier fields', async () => {
    const { service } = harness()
    for (const extra of [
      { email: 'person@example.test' }, { userId: 'user-1' }, { tenantId: 'tenant-1' },
      { paymentReference: 'pay-1' }, { staffId: 'staff-1' }, { memberId: 'member-1' },
      { path: '/private' }, { visitorId: 'cross-host-id' }, { sessionId: 'session-1' },
    ]) {
      await expect(service.collectPublic({ ...page, ...extra }, context)).rejects.toMatchObject({ code: 'invalid-event' })
    }
    await expect(service.recordAuthorityStage({
      eventId: 'signup-1', stage: 'signup', handoffCorrelation: handoff.handoffCorrelation,
      occurredAt: NOW, userId: 'forbidden',
    })).rejects.toMatchObject({ code: 'invalid-event' })
    await expect(service.recordAuthorityStage({
      eventId: 'signup-invalid-time', stage: 'signup', handoffCorrelation: handoff.handoffCorrelation,
      occurredAt: '2040-99-99T10:00:00Z',
    })).rejects.toMatchObject({ code: 'invalid-event' })
  })

  test('deduplicates exact public/authority events and joins a fully reordered opaque funnel', async () => {
    const { repository, service } = harness()
    expect(await service.collectPublic(handoff, context)).toMatchObject({ accepted: true, replayed: false })
    expect(await service.collectPublic(handoff, context)).toMatchObject({ accepted: true, replayed: true })
    for (const [eventId, stage, occurredAt] of [
      ['paid-1', 'paid', '2040-02-01T10:09:00Z'],
      ['publish-1', 'publish', '2040-02-01T10:08:00Z'],
      ['site-1', 'site', '2040-02-01T10:07:00Z'],
      ['signup-1', 'signup', '2040-02-01T10:06:00Z'],
    ] as const) {
      expect(await service.recordAuthorityStage({ eventId, stage, occurredAt, handoffCorrelation: handoff.handoffCorrelation })).toMatchObject({ accepted: true, replayed: false })
    }
    expect(await service.recordAuthorityStage({ eventId: 'signup-1', stage: 'signup', occurredAt: '2040-02-01T10:06:00Z', handoffCorrelation: handoff.handoffCorrelation })).toMatchObject({ replayed: true })
    const report = await service.report(RANGE)
    expect(report.totals).toMatchObject({ handoffs: 1, signups: 1, sites: 1, publishes: 1, paid: 1 })
    expect(report.funnel).toEqual({ visits: 1, signups: 1, sites: 1, publishes: 1, paid: 1 })
    expect(report.conversionBasisPoints).toEqual({ visitToSignup: 10_000, signupToSite: 10_000, siteToPublish: 10_000, publishToPaid: 10_000 })
    expect(repository.events.size).toBe(5)
    const serialized = JSON.stringify([...repository.events.values()])
    expect(serialized).not.toContain(handoff.handoffCorrelation)
    expect(serialized).not.toMatch(/userId|siteId|tenant|payment|member|staff|email|visitor/i)
  })

  test('requires authoritative stage chronology while tolerating network arrival reordering', async () => {
    const { service } = harness()
    const correlation = 'opaque_bad_chronology_2040'
    await service.collectPublic({ ...handoff, handoffCorrelation: correlation }, context)
    for (const [eventId, stage, occurredAt] of [
      ['paid-bad', 'paid', '2040-02-01T10:09:00Z'],
      ['publish-bad', 'publish', '2040-02-01T10:08:00Z'],
      ['site-bad', 'site', '2040-02-01T10:07:00Z'],
      ['signup-before-handoff', 'signup', '2040-02-01T10:04:00Z'],
    ] as const) {
      await service.recordAuthorityStage({ eventId, stage, occurredAt, handoffCorrelation: correlation })
    }
    expect((await service.report(RANGE)).funnel).toEqual({ visits: 1, signups: 0, sites: 0, publishes: 0, paid: 0 })
  })

  test('fails safely on provider blockage and validates bounded report ranges', async () => {
    const { repository, service } = harness()
    repository.failWrites = true
    await expect(service.collectPublic(page, context)).rejects.toThrow('storage unavailable')
    await expect(service.report({ from: '2040-01-01', to: '2040-03-01' })).rejects.toMatchObject({ code: 'invalid-range' })
  })

  test('deletes raw opaque joins after 30 days and aggregate rows after 400 days', async () => {
    const oldNow = '2038-12-01T12:00:00.000Z'
    const { repository, service } = harness(oldNow)
    await service.collectPublic({ ...page, timestamp: '2038-12-01T10:00:00Z' }, { ...context, receivedAt: oldNow })
    const retention = new PublicMarketingAnalyticsService({ repository, now: () => new Date('2040-02-01T12:00:00.000Z') })
    expect(await retention.enforceRetention()).toEqual({
      rawEventsDeleted: 1,
      aggregatesDeleted: 1,
      rawBefore: '2040-01-02T12:00:00.000Z',
      aggregatesBefore: '2038-12-28',
    })
    expect(repository.events.size).toBe(0)
    expect(repository.daily.size).toBe(0)
  })
})
