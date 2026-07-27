import { createHash, randomUUID } from 'node:crypto'
import type { DbClient } from '../../db/client'
import type { FumaConfig } from '../config'
import type { CampaignQuotaAuthority } from '../quotas'
import { FumaJobService, PostgresFumaJobRepository, RedisFumaJobReadyQueue, type FumaScopedJobHandler } from '../jobs'
import { BunRedisDriver, FumaRedisCoordination } from '../redis'
import { createMinioObjectStorage } from '../objectStorage'
import { createFumaPublicationServiceGraph } from './composition'
import { createPublicationJobHandlers } from './jobHandlers'
import { OciEmailDeliveryAdapter } from './ociEmailDelivery'
import { OciRsaRequestSigner } from './ociRequestSigner'
import { HmacPublicationProviderEventVerifier, PostgresPublicationPublicAuthority, PublicationPublicBoundary } from './publicRoutes'
import type { PublicationIdAuthority, PublicationUnsubscribeLinkIssuer } from './services'
import type { PublicationRepositoryScope } from './scope'
import { PublicationUnsubscribeTokenSigner } from './unsubscribeTokens'
import { PublicationEngagementTokenSigner } from './engagementTokens'

export type HostedPublicationRuntime=Readonly<{
  graph:ReturnType<typeof createFumaPublicationServiceGraph>
  publicBoundary:PublicationPublicBoundary
  jobHandlers:Readonly<Record<string,FumaScopedJobHandler>>
  close:()=>Promise<void>
}>

function namespace(host:string):string{return `publication-${host.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').slice(0,48)}`}

export async function createHostedPublicationRuntime(input:Readonly<{db:DbClient;config:FumaConfig;objectAccessSigningSecret:string;now?:()=>Date;campaignQuota?:CampaignQuotaAuthority}>):Promise<HostedPublicationRuntime>{
  if(Buffer.byteLength(input.objectAccessSigningSecret,'utf8')<32)throw new TypeError('FUMA_OBJECT_ACCESS_SIGNING_SECRET must contain at least 32 bytes.')
  const now=input.now??(()=>new Date())
  const driver=new BunRedisDriver(input.config.redis.url);const redis=new FumaRedisCoordination({namespace:namespace(input.config.hosts.product),driver})
  const readyQueue=new RedisFumaJobReadyQueue(input.config.redis.url,namespace(input.config.hosts.product));await Promise.all([redis.connect(),readyQueue.connect()])
  const jobs=new FumaJobService({repository:new PostgresFumaJobRepository(input.db),readyQueue,admission:{maxActivePerOrganization:10_000,maxActivePerSite:2_000},now})
  const ids:PublicationIdAuthority=Object.freeze({id:(kind:string)=>`${kind}-${randomUUID()}`,sha256:(value:string)=>createHash('sha256').update(value).digest('hex')})
  const oci=new OciEmailDeliveryAdapter({region:input.config.ociEmail.region,compartmentId:input.config.ociEmail.compartmentId,approvedSender:input.config.ociEmail.approvedSender,signer:new OciRsaRequestSigner({...input.config.ociEmail,now})})
  const tokenSigner=new PublicationUnsubscribeTokenSigner(input.config.publication.unsubscribeSigningSecret)
  const engagementSigner=new PublicationEngagementTokenSigner(input.config.publication.unsubscribeSigningSecret)
  const objectStorage=createMinioObjectStorage({config:input.config.minio,policy:{allowedMimeTypes:['application/json'],maxObjectBytes:100*1024*1024,maxTenantBytes:20*1024*1024*1024},signingSecret:input.objectAccessSigningSecret,accessUrlBase:`https://${input.config.hosts.product}/_fuma/objects`,nowMs:()=>now().getTime()})
  const graph=createFumaPublicationServiceGraph({db:input.db,objectStorage,redis,jobs,oci,ids,now,campaignQuota:input.campaignQuota,unsubscribeFactory:(deliverability):PublicationUnsubscribeLinkIssuer=>Object.freeze({
    async issue(scope:PublicationRepositoryScope,request:Parameters<PublicationUnsubscribeLinkIssuer['issue']>[1]){
      const issuedAt=request.issuedAt;const claims=await deliverability.issueUnsubscribe(scope,{tokenId:ids.id('unsubscribe'),memberId:request.memberId,newsletterId:request.newsletterId,issuedAt,expiresAt:new Date(Date.parse(issuedAt)+30*24*60*60*1000).toISOString()})
      const token=tokenSigner.issue({scope,claims});return `https://${input.config.hosts.product}/_fuma/publication/unsubscribe?token=${encodeURIComponent(token)}`
    },
  })})
  await graph.scheduling.recoverAll()
  const publicBoundary=new PublicationPublicBoundary({signer:tokenSigner,deliverability:graph.deliverability,authority:new PostgresPublicationPublicAuthority(input.db),verifier:new HmacPublicationProviderEventVerifier(input.config.ociEmail.eventVerificationSecret),engagement:{signer:engagementSigner,control:graph.deliverabilityControls},redis,now})
  return Object.freeze({graph,publicBoundary,jobHandlers:createPublicationJobHandlers(graph,now),close:async()=>{await Promise.all([readyQueue.close(),redis.close()])}})
}
