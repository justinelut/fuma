import type { DbClient } from '../../db/client'
import type { AiCatalogService } from '../aiCatalog'
import type { AiByokMetadataCipher } from './credentialCipher'
import { aiCreditExpiryJobRegistration } from './jobs'
import { PostgresAiCreditRepository } from './postgres'
import { createAiCreditScopedRouteDeclarations } from './routes'
import { AiCreditService, type AiCreditAuditPort, type AiCreditMeterPort, type AiCreditQuotaPort } from './service'
import { createAiByokTransferStep, PostgresAiByokTransferRepository } from './transferStep'

export function createHostedAiCreditRuntime(input: Readonly<{ db: DbClient; catalog: Pick<AiCatalogService, 'quote'>; cipher: AiByokMetadataCipher; protectedOrganizationId: string; quota?: AiCreditQuotaPort; meter?: AiCreditMeterPort; audit?: AiCreditAuditPort; now?: () => Date }>) {
  const repository = new PostgresAiCreditRepository(input.db)
  const service = new AiCreditService({ repository, catalog: input.catalog, cipher: input.cipher, quota: input.quota, meter: input.meter, audit: input.audit, now: input.now })
  const transferRepository = new PostgresAiByokTransferRepository(input.db)
  return Object.freeze({ repository, service, scopedRoutes: createAiCreditScopedRouteDeclarations(service), jobs: aiCreditExpiryJobRegistration({ service, protectedOrganizationId: input.protectedOrganizationId, now: input.now }), transferRepository, transferStep: createAiByokTransferStep(transferRepository) })
}
