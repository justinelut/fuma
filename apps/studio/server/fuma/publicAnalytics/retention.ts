import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import { PublicMarketingRetentionResultSchema, type PublicMarketingRetentionResult } from '@core/fuma/publicAnalytics/contracts'
import type { PublicMarketingAnalyticsService } from './service'

const EmptyRetentionPayloadSchema = Type.Object({}, { additionalProperties: false })

/** Scheduler integration supplies durable execution; payloads cannot inject clocks, scope, or subject data. */
export class PublicMarketingAnalyticsRetentionJob {
  readonly #service: Pick<PublicMarketingAnalyticsService, 'enforceRetention'>
  constructor(service: Pick<PublicMarketingAnalyticsService, 'enforceRetention'>) {
    this.#service = service
  }

  async run(payload: unknown): Promise<PublicMarketingRetentionResult> {
    if (!safeParseValue(EmptyRetentionPayloadSchema, payload).ok) throw new TypeError('Marketing analytics retention payload must be empty.')
    const result = await this.#service.enforceRetention()
    const parsed = safeParseValue(PublicMarketingRetentionResultSchema, result)
    if (!parsed.ok) throw new Error('Marketing analytics retention result is invalid.')
    return Object.freeze(parsed.value)
  }
}
