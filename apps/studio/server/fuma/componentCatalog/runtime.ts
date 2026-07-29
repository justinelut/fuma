import type { DbClient } from '../../db/client'
import type { ArtifactInstallationAuthority } from '../artifacts'
import type { ArtifactReviewService } from '../artifactReviews'
import { PostgresComponentCatalogRepository } from './postgres'
import { createComponentCatalogScopedRoutes } from './routes'
import { ComponentCatalogService } from './service'
import type { ComponentSourceValidator } from './sourceValidator'

export function createHostedComponentCatalogRuntime(input: Readonly<{ db: DbClient; artifacts: ArtifactInstallationAuthority; reviews: ArtifactReviewService; validator?: ComponentSourceValidator; now?: () => Date }>) {
  const repository = new PostgresComponentCatalogRepository(input.db)
  const service = new ComponentCatalogService({ repository, artifacts: input.artifacts, reviews: input.reviews, ...(input.validator ? { validator: input.validator } : {}), ...(input.now ? { now: input.now } : {}) })
  return Object.freeze({ repository, service, scopedRoutes: createComponentCatalogScopedRoutes(service) })
}
