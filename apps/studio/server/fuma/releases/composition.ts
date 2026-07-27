import type { DbClient } from '../../db/client'
import type { TenantObjectStorage } from '../objectStorage'
import { PostgresReleaseRepository } from './repository'
import { ReleaseService } from './service'

export type PostgresReleaseCompositionInput = Readonly<{
  db: DbClient
  objectStorage: TenantObjectStorage
  now?: () => Date
}>

export type PostgresReleaseComposition = Readonly<{
  repository: PostgresReleaseRepository
  service: ReleaseService
}>

/**
 * Production FUMA-048 composition. PostgreSQL is the durable lifecycle,
 * pointer, retention, and current-owner authority; FUMA-008 remains the
 * immutable byte authority injected here. Rendering, object writes, and job
 * registration deliberately stay outside this graph.
 */
export function createPostgresReleaseComposition(
  input: PostgresReleaseCompositionInput,
): PostgresReleaseComposition {
  const repository = new PostgresReleaseRepository(input.db)
  return Object.freeze({
    repository,
    service: new ReleaseService({
      repository,
      objectStorage: input.objectStorage,
      ...(input.now ? { now: input.now } : {}),
    }),
  })
}
