import { fumaLaunchRegistry } from '@core/fuma'
import type { DbClient } from '../../db/client'
import type { FumaSiteAuthorizationAuthority } from '../context'
import {
  PaidHandoffService,
  type PaidHandoffAuditAuthority,
  type PaidHandoffChoiceAuthority,
  type PaidHandoffCompletionAuthority,
  type PaidHandoffNotificationAuthority,
  type PaidHandoffRefundEscalationAuthority,
} from './paidHandoff'
import {
  PaidHandoffApplicationService,
  type PaidHandoffCommandAuthority,
} from './paidHandoffApplication'
import {
  PostgresPaidHandoffOutboxAuthority,
  PostgresPaidHandoffReadinessAuthority,
  type PaidHandoffCurrentAcceptanceAuthority,
  type PaidHandoffIdentityAuthority,
} from './paidHandoffPostgres'
import { createFreshPaidHandoffCommandAuthority, type PaidHandoffHostedSessionResolver } from './paidHandoffAuthority'
import { createPaidHandoffScopedRoutes } from './paidHandoffRoutes'
import { PostgresTransferRepository } from './repository'
import {
  TransferService,
  type TransferAuditPort,
  type TransferCommandEnqueuePort,
  type TransferEligibilityAuthority,
  type TransferManifestAuthority,
} from './service'
import type { TransferStepRegistry } from './stepRegistry'

/**
 * Canonical FUMA-023 service composition. The complete step registry must be
 * assembled from the existing base/object/domain/AI/MCP/artifact/payment/
 * collaborator authorities; this factory rejects substituting another saga.
 */
export function createHostedPaidHandoffTransferService(input: Readonly<{
  db: DbClient
  stepRegistry: TransferStepRegistry
  manifestAuthority: TransferManifestAuthority
  eligibilityAuthority: TransferEligibilityAuthority
  enqueue: TransferCommandEnqueuePort
  audit: TransferAuditPort
  now?: () => Date
}>): TransferService {
  if (input.db.dialect !== 'postgres') throw new TypeError('Hosted paid handoff requires PostgreSQL.')
  return new TransferService({
    repository: new PostgresTransferRepository(input.db),
    registry: fumaLaunchRegistry,
    stepRegistry: input.stepRegistry,
    manifestAuthority: input.manifestAuthority,
    eligibilityAuthority: input.eligibilityAuthority,
    enqueue: input.enqueue,
    audit: input.audit,
    ...(input.now ? { now: input.now } : {}),
  })
}

/**
 * FUMA-074 orchestration over one already-composed canonical TransferService.
 * Fresh Better Auth/permission resolution, all six choice owners, durable
 * notification delivery, quota/managed-owner completion, and escalation are
 * explicit required ports so no browser or fallback authority can be used.
 */
export function createHostedPaidHandoffRuntime(input: Readonly<{
  db: DbClient
  transfer: TransferService
  identity: PaidHandoffIdentityAuthority
  currentAcceptance: PaidHandoffCurrentAcceptanceAuthority
  commandAuthority: PaidHandoffCommandAuthority
  resolveSession: PaidHandoffHostedSessionResolver
  choices: PaidHandoffChoiceAuthority
  notifications: PaidHandoffNotificationAuthority
  completion: PaidHandoffCompletionAuthority
  refundEscalations: PaidHandoffRefundEscalationAuthority
  audit: PaidHandoffAuditAuthority
  authorization?: FumaSiteAuthorizationAuthority
  now?: () => Date
}>) {
  if (input.db.dialect !== 'postgres') throw new TypeError('Hosted paid handoff runtime requires PostgreSQL.')
  const readiness = new PostgresPaidHandoffReadinessAuthority({
    db: input.db,
    identity: input.identity,
    current: input.currentAcceptance,
  })
  const service = new PaidHandoffService({
    readiness,
    choices: input.choices,
    outbox: new PostgresPaidHandoffOutboxAuthority(input.db),
    transfer: input.transfer,
    notifications: input.notifications,
    completion: input.completion,
    refundEscalations: input.refundEscalations,
    audit: input.audit,
    ...(input.now ? { now: input.now } : {}),
  })
  const application = new PaidHandoffApplicationService({
    handoff: service,
    readiness,
    transfer: input.transfer,
    authority: createFreshPaidHandoffCommandAuthority({
      resolveSession: input.resolveSession,
      commands: input.commandAuthority,
      ...(input.now ? { now: input.now } : {}),
    }),
    ...(input.now ? { now: input.now } : {}),
  })
  return Object.freeze({
    readiness,
    service,
    application,
    scopedRoutes: createPaidHandoffScopedRoutes(application, input.authorization),
  })
}
