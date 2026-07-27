import type { DbClient } from '../../db/client'
import { PostgresProviderCostCatalog } from '../metering/postgres'
import { PostgresEntitlementRepository, PostgresOfferDestinationAuthority } from './postgres'
import { EntitlementService } from './service'

export function createHostedEntitlementRuntime(input: Readonly<{
  db: DbClient
  usdMicrosToKesMinor: (usdMicros: bigint) => number
  now?: () => Date
}>) {
  const repository = new PostgresEntitlementRepository(input.db)
  const destinations = new PostgresOfferDestinationAuthority(input.db)
  const catalog = new PostgresProviderCostCatalog(input.db, input.now)
  const service = new EntitlementService({
    repository,
    destinations,
    catalog,
    usdMicrosToKesMinor: input.usdMicrosToKesMinor,
    now: input.now,
  })
  return Object.freeze({ repository, destinations, catalog, service })
}
