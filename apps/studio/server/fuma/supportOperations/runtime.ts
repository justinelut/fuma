import type { AuditService } from '../audit'
import type { DbClient } from '../../db/client'
import type { FumaSiteAuthorizationAuthority } from '../context'
import { PostgresSupportOperationsRepository } from './postgres'
import { createSupportOperationsScopedRoutes } from './routes'
import {
  SupportOperationsService,
  type ImmutableSupportEvidenceAuthority,
  type ModerationMutationAuthority,
  type OwnerRecoveryAuthority,
  type SupportAuthorityResolver,
  type SupportImpersonationAuthority,
} from './service'

export type HostedSupportOperationsPorts = Readonly<{
  authority: SupportAuthorityResolver
  evidence: ImmutableSupportEvidenceAuthority
  impersonation: SupportImpersonationAuthority
  moderation: ModerationMutationAuthority
  recovery: OwnerRecoveryAuthority
  routeAuthorization: FumaSiteAuthorizationAuthority
  audit: Pick<AuditService, 'recordRequest'>
}>

/**
 * Production composition deliberately accepts only canonical domain authorities.
 * It does not update auth, users, organizations, sites, or owner credentials directly.
 */
export function createHostedSupportOperationsRuntime(input: Readonly<{
  db: DbClient
  ports: HostedSupportOperationsPorts
  now?: () => Date
}>) {
  const repository = new PostgresSupportOperationsRepository(input.db)
  const { routeAuthorization, ...servicePorts } = input.ports
  const service = new SupportOperationsService({ repository, ...servicePorts, ...(input.now ? { now: input.now } : {}) })
  return Object.freeze({ repository, service, scopedRoutes: createSupportOperationsScopedRoutes(service, routeAuthorization) })
}
