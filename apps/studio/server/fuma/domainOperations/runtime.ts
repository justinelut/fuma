import type { DbClient } from '../../db/client'
import type { DomainOperationsServiceOptions } from './service'
import { DomainOperationsService } from './service'
import { PostgresDomainOperationsRepository } from './postgres'
import { createDomainOperationsScopedRoutes } from './routes'
import { domainTransferJobRegistration } from './jobs'
import { createDomainOutcomeTransferStep, type DomainOutcomeEffectPort, type DomainOutcomeOwnerAuthority } from './transferStep'

export type HostedDomainOperationsRuntimeInput=Readonly<Omit<DomainOperationsServiceOptions,'repository'>&{db:DbClient;owner:DomainOutcomeOwnerAuthority;effects:DomainOutcomeEffectPort}>
/** Unmounted runtime seam. The conductor owns global router, worker, transfer registry, and migration registration. */
export function createHostedDomainOperationsRuntime(input:HostedDomainOperationsRuntimeInput){const repository=new PostgresDomainOperationsRepository(input.db);const service=new DomainOperationsService({...input,repository});return Object.freeze({repository,service,scopedRoutes:createDomainOperationsScopedRoutes(service),jobs:domainTransferJobRegistration(service),transferStep:createDomainOutcomeTransferStep(repository,input.owner,input.effects)})}
