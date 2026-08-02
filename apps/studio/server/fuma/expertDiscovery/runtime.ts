import type { DbClient } from '../../db/client'
import type { FumaSiteAuthorizationAuthority } from '../context'
import type { TenantObjectStorage } from '../objectStorage'
import { EXPERT_DISCOVERY_INTEGRATION } from './contracts'
import { expertDiscoveryConsoleContribution } from './consoleContribution'
import { importExpertInquiryKey, ObjectStorageExpertInquiryVault } from './inquiryVault'
import { PostgresExpertDiscoveryRepository } from './postgres'
import {
  PostgresExpertDiscoveryAuthority,
  PostgresExpertDiscoveryInvalidationPort,
  PostgresExpertInquiryAbuseAuthority,
  PostgresExpertModerationAuthority,
  PostgresExpertPluginReviewAuthority,
  PostgresExpertTransferAuthority,
} from './production'
import { createExpertDiscoveryScopedRoutes } from './routes'
import { ExpertDiscoveryService } from './service'

export async function createHostedExpertDiscoveryRuntime(input: Readonly<{
  db: DbClient
  storage: TenantObjectStorage
  inquiryKey: Readonly<{ bytes: Uint8Array; keyId: string }>
  abusePepper: string
  approvalAuthorization?: FumaSiteAuthorizationAuthority
  now?: () => Date
}>) {
  const repository = new PostgresExpertDiscoveryRepository(input.db)
  const vault = new ObjectStorageExpertInquiryVault({
    storage: input.storage,
    keys: await importExpertInquiryKey(input.inquiryKey.bytes, input.inquiryKey.keyId),
  })
  const service = new ExpertDiscoveryService({
    repository,
    authority: new PostgresExpertDiscoveryAuthority({ db: input.db, ...(input.now ? { now: input.now } : {}) }),
    moderation: new PostgresExpertModerationAuthority(input.db),
    plugins: new PostgresExpertPluginReviewAuthority(input.db),
    transfers: new PostgresExpertTransferAuthority(input.db),
    inquiryAbuse: new PostgresExpertInquiryAbuseAuthority({ db: input.db, pepper: input.abusePepper }),
    vault,
    invalidation: new PostgresExpertDiscoveryInvalidationPort(input.db),
    ...(input.now ? { now: input.now } : {}),
  })
  return Object.freeze({
    integration: EXPERT_DISCOVERY_INTEGRATION,
    consoleContribution: expertDiscoveryConsoleContribution,
    repository,
    service,
    scopedRoutes: createExpertDiscoveryScopedRoutes(service, input.approvalAuthorization),
  })
}
