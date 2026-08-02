import { describe, expect, test } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { publicMarketingAnalyticsMigration } from '../../../server/fuma/db/migrations/000079_public_marketing_analytics'
import { PostgresPublicMarketingAnalyticsRepository } from '../../../server/fuma/publicAnalytics/postgres'
import { PublicMarketingAnalyticsService } from '../../../server/fuma/publicAnalytics/service'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = '2040-02-01T12:00:00.000Z'
const CORRELATION = 'opaque_postgres_handoff_correlation_2040'
const CONTEXT = Object.freeze({ receivedAt: NOW, globalPrivacyControl: false, doNotTrack: false, traffic: 'human' as const })
const HANDOFF = Object.freeze({
  version: 1 as const,
  kind: 'handoff_started' as const,
  routeClass: 'pricing' as const,
  timestamp: '2040-02-01T10:05:00Z',
  consent: 'granted' as const,
  campaignSource: 'campaign' as const,
  handoffCorrelation: CORRELATION,
})

function quote(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe schema.')
  return `"${value}"`
}

function scoped(connection: string, schema: string): string {
  const url = new URL(connection)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

describe('FUMA-WEB-016 optional native PostgreSQL acceptance', () => {
  test.skipIf(!postgresUrl)('persists one deduplicated hash-only reordered funnel and enforces retention', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_marketing_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await db.unsafe(publicMarketingAnalyticsMigration.sql)
      const repository = new PostgresPublicMarketingAnalyticsRepository(db)
      const service = new PublicMarketingAnalyticsService({ repository, now: () => new Date(NOW) })
      const attempts = await Promise.all(Array.from({ length: 8 }, () => service.collectPublic(HANDOFF, CONTEXT)))
      expect(attempts.filter((result) => !result.replayed)).toHaveLength(1)
      expect(attempts.filter((result) => result.replayed)).toHaveLength(7)

      for (const [eventId, stage, occurredAt] of [
        ['paid-pg', 'paid', '2040-02-01T10:09:00Z'],
        ['publish-pg', 'publish', '2040-02-01T10:08:00Z'],
        ['site-pg', 'site', '2040-02-01T10:07:00Z'],
        ['signup-pg', 'signup', '2040-02-01T10:06:00Z'],
      ] as const) {
        await service.recordAuthorityStage({ eventId, stage, occurredAt, handoffCorrelation: CORRELATION })
      }

      const report = await service.report({ from: '2040-02-01', to: '2040-02-02' })
      expect(report.funnel).toEqual({ visits: 1, signups: 1, sites: 1, publishes: 1, paid: 1 })
      const stored = await db<{ count: string; raw_correlation_count: string }>`
        select count(*)::text count,
          count(*) filter (where correlation_sha256=${CORRELATION})::text raw_correlation_count
        from fuma_public_marketing_events_v1
      `
      expect(stored.rows[0]).toEqual({ count: '5', raw_correlation_count: '0' })

      const retentionService = new PublicMarketingAnalyticsService({ repository, now: () => new Date('2041-03-10T12:00:00.000Z') })
      expect(await retentionService.enforceRetention()).toMatchObject({ rawEventsDeleted: 5, aggregatesDeleted: 5 })
      process.stdout.write('[FUMA-WEB-016 PostgreSQL] contention=8 events=5 funnel=1/1/1/1/1 hashOnly=true retention=5/5\n')
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      const leftovers = await admin<{ count: string }>`select count(*)::text count from pg_namespace where nspname=${schema}`
      expect(leftovers.rows[0]?.count).toBe('0')
    }
  }, 120_000)
})
