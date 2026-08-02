import type { DbClient } from '../../db/client'
import type { ComponentCatalogService } from '../componentCatalog'
import type { FumaSiteAuthorizationAuthority } from '../context'
import type { McpService } from '../mcp'
import { createInsertDataBackedSectionCapability } from '../aiBackendCapabilities'
import { PostgresCapabilityDashboardReadModel } from './postgresReadModel'
import { createCapabilityDashboardScopedRoutes } from './routes'
import { CapabilityDashboardService } from './service'
import { aiCapabilityDashboardConsoleContribution } from './consoleContribution'

export function createHostedCapabilityDashboardRuntime(input: Readonly<{
  db: DbClient
  components: Pick<ComponentCatalogService, 'execute'>
  mcp: Pick<McpService, 'revoke'>
  platformAuthorization: FumaSiteAuthorizationAuthority
  now?: () => Date
}>) {
  const metadata = createInsertDataBackedSectionCapability(input.components).metadata
  const readModel = new PostgresCapabilityDashboardReadModel(input.db)
  const service = new CapabilityDashboardService({ readModel, metadata, mcp: input.mcp, ...(input.now ? { now: input.now } : {}) })
  return Object.freeze({
    consoleContribution: aiCapabilityDashboardConsoleContribution,
    readModel,
    service,
    scopedRoutes: createCapabilityDashboardScopedRoutes(service, input.platformAuthorization),
  })
}
