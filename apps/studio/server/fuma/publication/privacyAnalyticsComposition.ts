import type { DbClient } from '../../db/client'
import type { FumaScopedRouteDeclaration } from '../context'
import type { FumaScopedJobHandler } from '../jobs'
import { createPublicationPrivacyAnalyticsScopedRoutes, PublicationPrivacyAnalyticsPublicAdapter } from './privacyAnalyticsAdapters'
import { createPublicationPrivacyAnalyticsJobHandlers } from './privacyAnalyticsJobHandlers'
import { PublicationPrivacyAnalyticsService } from './privacyAnalytics'
import { PostgresPublicationPrivacyAnalyticsRepository } from './privacyAnalyticsPostgres'
import type { PublicationIdAuthority } from './servicePorts'

export type PublicationPrivacyAnalyticsFeature=Readonly<{
  service:PublicationPrivacyAnalyticsService
  publicAdapter:PublicationPrivacyAnalyticsPublicAdapter
  scopedRoutes:readonly FumaScopedRouteDeclaration[]
  jobHandlers:Readonly<Record<string,FumaScopedJobHandler>>
}>

/** Central composition can mount this single isolated graph without importing UI or legacy analytics. */
export function createPublicationPrivacyAnalyticsFeature(input:Readonly<{db:DbClient;ids:PublicationIdAuthority;now?:()=>Date}>):PublicationPrivacyAnalyticsFeature{const repository=new PostgresPublicationPrivacyAnalyticsRepository(input.db);const service=new PublicationPrivacyAnalyticsService({repository,ids:input.ids,...(input.now?{now:input.now}:{})});return Object.freeze({service,publicAdapter:new PublicationPrivacyAnalyticsPublicAdapter(service),scopedRoutes:createPublicationPrivacyAnalyticsScopedRoutes(service),jobHandlers:createPublicationPrivacyAnalyticsJobHandlers(service)})}
