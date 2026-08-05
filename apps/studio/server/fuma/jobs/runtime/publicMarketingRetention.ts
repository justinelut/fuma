import { PublicMarketingRetentionResultSchema } from '@core/fuma/publicAnalytics/contracts'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { FumaJobJsonValue } from '../contracts'
import type { FumaScopedJobHandler } from '../integration'
import { RECURRING_JOB_KINDS } from './recurringProducers'

export interface PublicMarketingAnalyticsRetentionRunner {
  run(payload: unknown): Promise<unknown>
}

/**
 * Registration seam for the platform-global public marketing retention job.
 * The production worker must merge this registration only when the public
 * analytics schema/runtime is available.
 */
export function publicMarketingAnalyticsRetentionJobRegistration(input: Readonly<{
  retention: PublicMarketingAnalyticsRetentionRunner
  protectedOrganizationId: string
}>): Readonly<Record<typeof RECURRING_JOB_KINDS.publicMarketingAnalyticsRetention, FumaScopedJobHandler>> {
  const kind = RECURRING_JOB_KINDS.publicMarketingAnalyticsRetention
  const handler: FumaScopedJobHandler = async (context) => {
    if (context.job.kind !== kind
      || context.job.organizationId !== input.protectedOrganizationId
      || context.job.siteId !== null
      || context.jobContext.kind !== 'organization'
      || context.repositoryScope !== null
      || context.jobContext.scope.organization.id !== input.protectedOrganizationId) {
      throw new TypeError('Public marketing analytics retention requires protected platform authority.')
    }
    const effectKey = `${kind}:v1:${context.job.id}`
    const prior = await context.readDurableResult(effectKey)
    if (prior) {
      const parsed = safeParseValue(PublicMarketingRetentionResultSchema, prior.result)
      if (!parsed.ok) throw new TypeError('Durable public marketing analytics retention result is invalid.')
      return parsed.value as FumaJobJsonValue
    }
    const result = await input.retention.run(context.job.payload)
    const parsed = safeParseValue(PublicMarketingRetentionResultSchema, result)
    if (!parsed.ok) throw new TypeError('Public marketing analytics retention result is invalid.')
    return (await context.commitDurableResult(effectKey, parsed.value as FumaJobJsonValue)).result
  }
  return Object.freeze({ [kind]: handler })
}
