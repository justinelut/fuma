import type { DbClient } from '../../db/client'
import { DomainCredentialAuthoritySchema, parseDomainContract, type DomainCredentialAuthority, type DomainService } from '../domains/service'
import { registrarJobRegistration } from './jobs'
import { DomainServiceRegistrarOnboarding } from './onboarding'
import { PostgresRegistrarWorkflowRepository } from './postgres'
import { createRegistrarScopedRouteDeclarations } from './routes'
import type { StepUpAuthority } from './service'
import { RegistrarWorkflow, type AuthorizedRegistrarProvider } from './workflow'

export type HostedRegistrarRuntimeInput = Readonly<{
  db: DbClient
  provider: AuthorizedRegistrarProvider
  domains: Pick<DomainService, 'create'>
  stepUp: StepUpAuthority
  stepUpIssuer?: import('./productionStepUp').RegistrarStepUpIssuer
  entitled: ConstructorParameters<typeof RegistrarWorkflow>[0]['entitled']
  authority: DomainCredentialAuthority
  credentialId: string
  now?: () => Date
}>

/**
 * Production composition seam. It refuses inferred/provider-default authority and returns only
 * declarations for conductor-owned global route/job registries.
 */
export function createHostedRegistrarRuntime(input: HostedRegistrarRuntimeInput) {
  const authority = parseDomainContract(DomainCredentialAuthoritySchema, input.authority, 'Hosted registrar authority') as DomainCredentialAuthority
  if (authority.scope !== 'fuma-platform' || !input.credentialId) {
    throw new TypeError('Hosted registrar requires explicit Fuma platform DomainCredentialAuthority and credential identity.')
  }
  const repository = new PostgresRegistrarWorkflowRepository(input.db)
  const onboarding = new DomainServiceRegistrarOnboarding(input.domains, authority, input.credentialId)
  const workflow = new RegistrarWorkflow({
    provider: input.provider,
    repository,
    stepUp: input.stepUp,
    entitled: input.entitled,
    onboarding,
    authority,
    credentialId: input.credentialId,
    now: input.now,
  })
  return Object.freeze({
    repository,
    workflow,
    onboarding,
    scopedRoutes: createRegistrarScopedRouteDeclarations(workflow, repository, input.stepUpIssuer),
    jobs: registrarJobRegistration(workflow),
  })
}
