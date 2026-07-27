import type { DbClient } from '../../db/client'
import { PostgresDynamicPublicationRepository } from './dynamicPublicationRepository'
import { DynamicPublicationService } from './dynamicPublicationService'
import {
  DynamicPublicationPublicBoundary,
  createDynamicPublicationScopedRouteDeclarations,
  type DynamicPublicationPublicBoundaryOptions,
} from './dynamicPublicationRoutes'

export type DynamicPublicationComposition = Readonly<{
  service: DynamicPublicationService
  scopedRoutes: ReturnType<typeof createDynamicPublicationScopedRouteDeclarations>
  createPublicBoundary(options: Omit<DynamicPublicationPublicBoundaryOptions, 'service'>): DynamicPublicationPublicBoundary
}>

/** Dedicated FUMA-037 seam; central composition only appends routes and mounts the returned boundary. */
export function createDynamicPublicationComposition(db: DbClient): DynamicPublicationComposition {
  const service = new DynamicPublicationService(new PostgresDynamicPublicationRepository(db))
  return Object.freeze({
    service,
    scopedRoutes: createDynamicPublicationScopedRouteDeclarations(service),
    createPublicBoundary: (options) => new DynamicPublicationPublicBoundary({ ...options, service }),
  })
}
