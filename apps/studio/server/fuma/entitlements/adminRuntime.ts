import type { HostedStaffAuthRuntime } from '../../auth/hosted/runtime'
import type { DbClient } from '../../db/client'
import { createEntitlementAdminBoundary } from './adminBoundary'
import { PostgresEntitlementAdminRepository } from './adminPostgres'
import { EntitlementAdminService } from './adminService'
import type { EntitlementService } from './service'

export function createHostedEntitlementAdminRuntime(input: Readonly<{
  db: DbClient
  entitlementServiceFor: (db: DbClient) => EntitlementService
  hostedStaffAuth: Pick<HostedStaffAuthRuntime, 'resolveSession'>
  protectedOwnerEmail: string
  consoleHost: string
  productHost: string
  runtimeSecret: string
  now?: () => Date
}>) {
  const repository = new PostgresEntitlementAdminRepository(input.db, input.now)
  const service = new EntitlementAdminService({
    db: input.db,
    entitlementsFor: input.entitlementServiceFor,
    repository,
    now: input.now,
  })
  const boundary = createEntitlementAdminBoundary({
    db: input.db,
    service,
    resolveSession: input.hostedStaffAuth.resolveSession,
    protectedOwnerEmail: input.protectedOwnerEmail,
    consoleHost: input.consoleHost,
    productHost: input.productHost,
    runtimeSecret: input.runtimeSecret,
    now: input.now,
  })
  return Object.freeze({ repository, service, boundary })
}
