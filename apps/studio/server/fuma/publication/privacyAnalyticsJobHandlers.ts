import { PublicationAnalyticsRetentionResultSchema } from '@core/fuma/publication/analyticsContracts'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { FumaScopedJobHandler } from '../jobs'
import type { PublicationPrivacyAnalyticsService } from './privacyAnalytics'
import { bindPublicationScope } from './scope'

const RetentionPayloadSchema=Type.Object({},{additionalProperties:false})

/** Additive trusted handler seam. Payloads deliberately contain no tenant, site, profile, clock, or subject authority. */
export function createPublicationPrivacyAnalyticsJobHandlers(service:Pick<PublicationPrivacyAnalyticsService,'enforceRetention'>):Readonly<Record<string,FumaScopedJobHandler>>{return Object.freeze({
  'publication.analytics-retention':async(context)=>{const parsed=safeParseValue(RetentionPayloadSchema,context.job.payload);if(!parsed.ok)throw new TypeError('Publication analytics-retention payload is invalid.');if(context.jobContext.kind!=='site'||context.repositoryScope===null)throw new TypeError('Publication analytics retention requires trusted site authority.');const scope=bindPublicationScope(context.repositoryScope,context.jobContext.profile.id);const effectKey=`publication-analytics-retention:${context.jobContext.actor.jobId}`;const existing=await context.readDurableResult(effectKey);if(existing)return existing.result;const result=await service.enforceRetention(scope);const validated=safeParseValue(PublicationAnalyticsRetentionResultSchema,result);if(!validated.ok)throw new Error('Publication analytics retention result is invalid.');return (await context.commitDurableResult(effectKey,validated.value)).result},
})}
