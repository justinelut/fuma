import type { FumaRedisCoordination } from '../redis'
import type { FumaJobService } from '../jobs'
import type { DbClient } from '../../db/client'
import type { TenantObjectStorage } from '../objectStorage'
import {
  createFumaScopedRouteBoundary,
  type FumaScopedRouteBoundary,
  type FumaScopedRouteBoundaryDependencies,
  type FumaScopedRouteDeclaration,
} from '../context'
import { PostgresPublicationRevisionRepository, PublicationRevisionService, PublicationRevisionSnapshotStore } from './revisions'
import { PostgresPublicationCollaborationStore, PublicationCollaborationEvents, PublicationCollaborationService, PublicationPresenceService } from './collaboration'
import { PostgresPublicationDomainStore } from './postgresStore'
import { PostgresPublicationWorkflowStore, PublicationWorkflowService } from './editorialWorkflow'
import { createPublicationScopedRouteDeclarations, type PublicationRoutePorts } from './routes'
import { PublicationMemberAccessService } from './memberAccess'
import { PostgresPublicationMemberAccessRepository } from './memberAccessPostgres'
import { PostgresPublicationSchedulingRepository } from './schedulingAccessPostgres'
import { PublicationSchedulingService } from './schedulingAccess'
import { createPublicationSchedulingScopedRoutes, PublicationPublicAccessAdapter } from './schedulingAdapters'
import { createEmailSettingsServiceGraph } from './emailSettingsComposition'
import { createDynamicPublicationComposition } from './dynamicPublicationComposition'
import { createPublicationPrivacyAnalyticsFeature } from './privacyAnalyticsComposition'
import { createNewsletterComposerServiceGraph } from './newsletterComposerComposition'
import { PublicationCampaignService } from './campaignDelivery'
import { PublicationDeliverabilityControlService } from './deliverability'
import { PostgresPublicationDeliverabilityControlStore } from './deliverabilityPostgres'
import {
  PublicationAnalyticsService,
  PublicationAudienceService,
  PublicationDeliverabilityService,
  PublicationEditorialService,
  PublicationEmailSettingsService,
  PublicationIdentityService,
  PublicationNewsletterService,
  type OciEmailDeliveryProvider,
  type PublicationIdAuthority,
  type PublicationUnsubscribeLinkIssuer,
} from './services'

export type FumaPublicationServicesInput = Readonly<{
  db:DbClient
  objectStorage:TenantObjectStorage
  redis:FumaRedisCoordination
  jobs?:FumaJobService
  oci:OciEmailDeliveryProvider
  ids:PublicationIdAuthority
  unsubscribe?:PublicationUnsubscribeLinkIssuer
  unsubscribeFactory?:(deliverability:PublicationDeliverabilityService)=>PublicationUnsubscribeLinkIssuer
  now?:()=>Date
}>

export type FumaPublicationServiceGraph=Readonly<PublicationRoutePorts&{
  scheduling:PublicationSchedulingService
  publicAccess:PublicationPublicAccessAdapter
  emailSettingsV2:ReturnType<typeof createEmailSettingsServiceGraph>
  dynamicPublication:ReturnType<typeof createDynamicPublicationComposition>
  privacyAnalytics:ReturnType<typeof createPublicationPrivacyAnalyticsFeature>
  newsletterComposer:ReturnType<typeof createNewsletterComposerServiceGraph>
  deliverabilityControls:PublicationDeliverabilityControlService
  scopedRoutes:readonly FumaScopedRouteDeclaration[]
}>

export function createFumaPublicationServiceGraph(input:FumaPublicationServicesInput):FumaPublicationServiceGraph{
  const store=new PostgresPublicationDomainStore(input.db)
  const settings=new PublicationEmailSettingsService(store)
  const audience=new PublicationAudienceService(store)
  const newsletters=new PublicationNewsletterService(store,settings,input.oci)
  const now=input.now??(()=>new Date())
  const workflow=new PublicationWorkflowService(new PostgresPublicationWorkflowStore(input.db),store,now)
  const editorial=new PublicationEditorialService(store,input.jobs??null,workflow)
  const identity=new PublicationIdentityService(store)
  const deliverabilityControls=new PublicationDeliverabilityControlService(new PostgresPublicationDeliverabilityControlStore(input.db),input.ids,input.now)
  const deliverability=new PublicationDeliverabilityService(store,input.ids,input.now,deliverabilityControls)
  const unsubscribe=input.unsubscribe??input.unsubscribeFactory?.(deliverability)
  const campaigns=new PublicationCampaignService({store,audience,newsletters,ids:input.ids,oci:input.oci,deliverabilityControls,...(input.jobs?{jobs:input.jobs}:{}),...(unsubscribe?{unsubscribe}:{}),...(input.now?{now:input.now}:{})})
  const collaboration=new PublicationCollaborationService(new PostgresPublicationCollaborationStore(input.db),now,new PublicationCollaborationEvents(input.redis))
  const revisions=new PublicationRevisionService({repository:new PostgresPublicationRevisionRepository(input.db),snapshots:new PublicationRevisionSnapshotStore(input.objectStorage),ids:input.ids,...(input.now?{now:input.now}:{})})
  const memberAccess=new PublicationMemberAccessService({repository:new PostgresPublicationMemberAccessRepository(input.db),domain:store,ids:input.ids,...(input.now?{now:input.now}:{})})
  const scheduling=new PublicationSchedulingService({
    repository:new PostgresPublicationSchedulingRepository(input.db),
    domain:store,
    editorial,
    members:memberAccess,
    jobs:input.jobs??Object.freeze({enqueue:async()=>{throw new Error('Durable Publication scheduling is unavailable.')}}),
    now,
  })
  const emailSettingsV2=createEmailSettingsServiceGraph({db:input.db,ids:input.ids,...(input.now?{now:input.now}:{})})
  const dynamicPublication=createDynamicPublicationComposition(input.db)
  const privacyAnalytics=createPublicationPrivacyAnalyticsFeature({db:input.db,ids:input.ids,...(input.now?{now:input.now}:{})})
  const newsletterComposer=createNewsletterComposerServiceGraph({
    db:input.db,
    content:store,
    memberAccess,
    emailSettings:emailSettingsV2.service,
    ids:input.ids,
    ...(input.now?{now:input.now}:{}),
  })
  const routePorts:PublicationRoutePorts={store,ids:input.ids,presence:new PublicationPresenceService(input.redis),collaboration,revisions,workflow,editorial,identity,audience,memberAccess,analytics:new PublicationAnalyticsService(store),settings,newsletters,campaigns,deliverability,deliverabilityControls,...(input.now?{now:input.now}:{})}
  const scopedRoutes=Object.freeze([
    ...createPublicationScopedRouteDeclarations(routePorts),
    ...createPublicationSchedulingScopedRoutes(scheduling),
    ...emailSettingsV2.scopedRoutes,
    ...dynamicPublication.scopedRoutes,
    ...privacyAnalytics.scopedRoutes,
    ...newsletterComposer.scopedRoutes,
  ])
  return Object.freeze({
    ...routePorts,
    scheduling,
    publicAccess:new PublicationPublicAccessAdapter(scheduling),
    emailSettingsV2,
    dynamicPublication,
    privacyAnalytics,
    newsletterComposer,
    deliverabilityControls,
    scopedRoutes,
  })
}

export type FumaPublicationCompositionInput=FumaPublicationServicesInput&Readonly<{boundary:FumaScopedRouteBoundaryDependencies}>

export function createFumaPublicationScopedApiBoundary(input:FumaPublicationCompositionInput):FumaScopedRouteBoundary{
  const graph=createFumaPublicationServiceGraph(input)
  return createFumaScopedRouteBoundary({...input.boundary,routes:graph.scopedRoutes})
}
