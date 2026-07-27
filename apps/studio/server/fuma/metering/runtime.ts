import type { DbClient } from '../../db/client'
import { PLATFORM_ORGANIZATION_ID } from '../organizations'
import { MeteringCollector } from './collector'
import { meteringJobRegistration } from './jobHandlers'
import { PostgresProviderCostCatalog, PostgresProviderUsageAuthority, PostgresUsageLedger } from './postgres'
import { MeteringService } from './service'

export function createHostedMeteringRuntime(input: Readonly<{
  db: DbClient
  now?: () => Date
  protectedOrganizationId?: string
}>) {
  const ledger = new PostgresUsageLedger(input.db)
  const costs = new PostgresProviderCostCatalog(input.db, input.now)
  const providerUsage = new PostgresProviderUsageAuthority(input.db, input.now)
  const service = new MeteringService(ledger, costs)
  const collector = new MeteringCollector(service)
  const protectedOrganizationId = input.protectedOrganizationId ?? PLATFORM_ORGANIZATION_ID
  return Object.freeze({
    ledger,
    costs,
    providerUsage,
    service,
    collector,
    jobs: meteringJobRegistration({ service, providerUsage, protectedOrganizationId }),
  })
}
