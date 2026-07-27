import { PublicationCollaborativeResourceKindSchema } from '@core/fuma/publication'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { FumaScopedJobHandler } from '../jobs'
import { bindPublicationScope } from './scope'
import { createPublicationSchedulingJobHandlers } from './schedulingJobHandlers'
import type { FumaPublicationServiceGraph } from './composition'

const PublishDuePayloadSchema=Type.Object({contentId:Type.String({minLength:1,maxLength:255}),workflowVersion:Type.Integer({minimum:1})},{additionalProperties:false})
const RevisionPeriodicPayloadSchema=Type.Object({revisionId:Type.String({minLength:1,maxLength:255}),resourceKind:PublicationCollaborativeResourceKindSchema,resourceId:Type.String({minLength:1,maxLength:255}),retentionDays:Type.Integer({minimum:1,maximum:3650})},{additionalProperties:false})
const RevisionMaintenancePayloadSchema=Type.Object({limit:Type.Integer({minimum:1,maximum:500}),graceMs:Type.Optional(Type.Integer({minimum:60000,maximum:30*86400000}))},{additionalProperties:false})
const NewsletterSendPayloadSchema=Type.Object({campaignId:Type.String({minLength:1,maxLength:255}),snapshotSha256:Type.String({pattern:'^[0-9a-f]{64}$'})},{additionalProperties:false})

function site(context:Parameters<FumaScopedJobHandler>[0]){
  if(context.jobContext.kind!=='site'||context.repositoryScope===null)throw new TypeError('Publication jobs require trusted site authority.')
  return {scope:bindPublicationScope(context.repositoryScope,context.jobContext.profile.id),actorId:context.jobContext.actor.jobId}
}

export function createPublicationJobHandlers(graph:Pick<FumaPublicationServiceGraph,'editorial'|'campaigns'|'revisions'|'scheduling'|'privacyAnalytics'>,now:()=>Date=()=>new Date()):Readonly<Record<string,FumaScopedJobHandler>>{
  return Object.freeze({
    ...createPublicationSchedulingJobHandlers(graph.scheduling),
    ...(graph.privacyAnalytics?.jobHandlers ?? {}),
    'publication.revision-periodic':async(context)=>{
      const parsed=safeParseValue(RevisionPeriodicPayloadSchema,context.job.payload);if(!parsed.ok)throw new TypeError('Publication periodic revision payload is invalid.')
      const trusted=site(context);const effectKey=`revision:${parsed.value.revisionId}`;const existing=await context.readDurableResult(effectKey);if(existing)return existing.result
      const revision=await graph.revisions.capturePeriodicCurrent(trusted.scope,trusted.actorId,parsed.value)
      return (await context.commitDurableResult(effectKey,{revisionId:revision.revisionId,sequence:revision.sequence,checksumSha256:revision.checksumSha256})).result
    },
    'publication.revision-retention':async(context)=>{
      const parsed=safeParseValue(RevisionMaintenancePayloadSchema,context.job.payload);if(!parsed.ok)throw new TypeError('Publication revision retention payload is invalid.')
      const trusted=site(context);const effectKey=`revision-retention:${context.job.id}`;const existing=await context.readDurableResult(effectKey);if(existing)return existing.result
      const expired=await graph.revisions.expireRetention(trusted.scope,trusted.actorId,parsed.value.limit)
      return (await context.commitDurableResult(effectKey,{expired})).result
    },
    'publication.revision-gc':async(context)=>{
      const parsed=safeParseValue(RevisionMaintenancePayloadSchema,context.job.payload);if(!parsed.ok)throw new TypeError('Publication revision GC payload is invalid.')
      const trusted=site(context);const effectKey=`revision-gc:${context.job.id}`;const existing=await context.readDurableResult(effectKey);if(existing)return existing.result
      const collected=await graph.revisions.collectGarbage(trusted.scope,trusted.actorId,parsed.value.graceMs??3600000,parsed.value.limit)
      return (await context.commitDurableResult(effectKey,{collected})).result
    },
    'publication.publish-due':async(context)=>{
      const parsed=safeParseValue(PublishDuePayloadSchema,context.job.payload);if(!parsed.ok)throw new TypeError('Publication publish-due payload is invalid.')
      const effectKey=`publish:${parsed.value.contentId}:${parsed.value.workflowVersion}`;const existing=await context.readDurableResult(effectKey);if(existing)return existing.result
      const trusted=site(context);const published=await graph.editorial.publishDue(trusted.scope,{...parsed.value,actorId:trusted.actorId,now:now().toISOString()})
      const result={contentId:parsed.value.contentId,published:published!==null,workflowVersion:published?.workflowVersion??parsed.value.workflowVersion}
      return (await context.commitDurableResult(effectKey,result)).result
    },
    'publication.newsletter-send':async(context)=>{
      const parsed=safeParseValue(NewsletterSendPayloadSchema,context.job.payload);if(!parsed.ok)throw new TypeError('Publication newsletter-send payload is invalid.')
      const effectKey=`campaign:${parsed.value.campaignId}:${parsed.value.snapshotSha256}`;const existing=await context.readDurableResult(effectKey);if(existing)return existing.result
      const trusted=site(context);const deliveries=await graph.campaigns.send(trusted.scope,parsed.value.campaignId,parsed.value.snapshotSha256)
      if(deliveries.some(delivery=>delivery.status==='failed'))throw new Error('One or more OCI campaign submissions failed and require durable retry.')
      const progress=await graph.campaigns.progress(trusted.scope,parsed.value.campaignId)
      const result={campaignId:parsed.value.campaignId,snapshotSha256:parsed.value.snapshotSha256,status:progress.status,recipientCount:progress.recipientCount,deliveryCount:progress.completed,messageSizeBytes:progress.messageSizeBytes,meteredAt:now().toISOString()}
      return (await context.commitDurableResult(effectKey,result)).result
    },
  })
}
