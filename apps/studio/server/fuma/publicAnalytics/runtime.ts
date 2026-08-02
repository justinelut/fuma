import type { DbClient } from '../../db/client'
import { createPublicMarketingAnalyticsBoundary, type PublicMarketingAnalyticsBoundary } from './boundary'
import { PostgresPublicMarketingAnalyticsRepository } from './postgres'
import { PublicMarketingAnalyticsRetentionJob } from './retention'
import { PublicMarketingAnalyticsService } from './service'

export const PUBLIC_MARKETING_ANALYTICS_SCHEMA_SENTINEL = '000079_public_marketing_analytics:applied' as const

export type HostedPublicMarketingAnalyticsRuntime = Readonly<{
  service: PublicMarketingAnalyticsService
  boundary: PublicMarketingAnalyticsBoundary
  retention: PublicMarketingAnalyticsRetentionJob
}>

/**
 * Central composition may pass the sentinel only after 000078 is finalized and
 * 000079 is registered/applied. Until then the authority remains unavailable,
 * never an in-memory production fallback.
 */
export function createHostedPublicMarketingAnalyticsRuntime(input: Readonly<{
  db: DbClient
  privateHost: string
  webServiceToken: string
  schemaSentinel: string | undefined
  now?: () => Date
}>): HostedPublicMarketingAnalyticsRuntime | undefined {
  if (input.schemaSentinel !== PUBLIC_MARKETING_ANALYTICS_SCHEMA_SENTINEL) return undefined
  const repository = new PostgresPublicMarketingAnalyticsRepository(input.db)
  const service = new PublicMarketingAnalyticsService({ repository, ...(input.now ? { now: input.now } : {}) })
  return Object.freeze({
    service,
    boundary: createPublicMarketingAnalyticsBoundary({
      host: input.privateHost,
      serviceToken: input.webServiceToken,
      service,
      ...(input.now ? { now: input.now } : {}),
    }),
    retention: new PublicMarketingAnalyticsRetentionJob(service),
  })
}
