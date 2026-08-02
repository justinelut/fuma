import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { publicMarketingAnalyticsMigration } from '../../../server/fuma/db/migrations/000079_public_marketing_analytics'
import { assertHostedMigrationIsAdditive } from '../../../server/fuma/db/migrationPolicy'
import {
  PUBLIC_MARKETING_ANALYTICS_SCHEMA_SENTINEL,
  createHostedPublicMarketingAnalyticsRuntime,
} from '../../../server/fuma/publicAnalytics/runtime'

const migrationIndex = readFileSync(resolve(import.meta.dir, '../../../server/fuma/db/migrations/index.ts'), 'utf8')

describe('FUMA-WEB-016 migration serialization and runtime gate', () => {
  test('keeps 000079 isolated behind open candidate 000078 without mutating the shared index', () => {
    expect(publicMarketingAnalyticsMigration.id).toBe('000079_public_marketing_analytics')
    expect(() => assertHostedMigrationIsAdditive(publicMarketingAnalyticsMigration)).not.toThrow()
    expect(migrationIndex).toContain('000078_next_source_portability_authority')
    expect(migrationIndex).not.toContain('000079_public_marketing_analytics')
  })

  test('stores only minimized dimensions and SHA-256 opaque correlation', () => {
    const sql = publicMarketingAnalyticsMigration.sql.toLowerCase()
    expect(sql).toContain('correlation_sha256')
    expect(sql).not.toMatch(/\b(email|ip_address|user_agent|visitor_id|session_id|member_id|staff_id|payment_reference|tenant_id)\b/)
    expect(sql).not.toContain('handoff_correlation')
    expect(sql).toContain("collection_basis in ('cookieless-baseline','explicit-consent','product-authority')")
    expect(sql).toContain('fuma_public_marketing_events_retention_v1')
    expect(sql).toContain('fuma_public_marketing_daily_retention_v1')
  })

  test('refuses to construct PostgreSQL runtime without the exact applied-schema sentinel', () => {
    const db = { dialect: 'postgres' } as never
    const common = { db, privateHost: 'studio-internal.service', webServiceToken: 'a'.repeat(48) }
    expect(createHostedPublicMarketingAnalyticsRuntime({ ...common, schemaSentinel: undefined })).toBeUndefined()
    expect(createHostedPublicMarketingAnalyticsRuntime({ ...common, schemaSentinel: '000078:applied' })).toBeUndefined()
    expect(createHostedPublicMarketingAnalyticsRuntime({ ...common, schemaSentinel: PUBLIC_MARKETING_ANALYTICS_SCHEMA_SENTINEL })).toBeDefined()
  })
})
