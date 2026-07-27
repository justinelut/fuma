import type { DbClient } from '../../db/client'
import type { TenantObjectStorage } from '../objectStorage'
import { createPostgresReleaseComposition } from '../releases'
import type { FumaRuntimeComponent } from '../runtime/lifecycle'
import { edgeDeliveryJobRegistration } from './jobHandlers'
import {
  PostgresEdgeHostAuthority,
  PostgresEdgePointerAuthority,
  PostgresEdgeReleaseReader,
} from './postgres'
import { FreeHostEdgeBoundary, type EdgeVisitorAuthority } from './publicBoundary'
import { BunRedisEdgeCache, createBunRedisEdgeCacheComponent } from './redisCache'
import { EdgeDeliveryService, type EdgeHoleResolver } from './service'

export type HostedEdgeRuntime = Readonly<{
  service: EdgeDeliveryService
  boundary: FreeHostEdgeBoundary
  cache: BunRedisEdgeCache
  component: FumaRuntimeComponent
  jobs: ReturnType<typeof edgeDeliveryJobRegistration>
}>

/** Ticket-local production graph; conductor mounts its boundary/component/jobs centrally. */
export function createHostedEdgeRuntime(input: Readonly<{
  db: DbClient
  objectStorage: TenantObjectStorage
  redisUrl: string
  redisNamespace: string
  visitors: EdgeVisitorAuthority
  holes: readonly EdgeHoleResolver[]
  now?: () => Date
}>): HostedEdgeRuntime {
  const releases = createPostgresReleaseComposition({
    db: input.db,
    objectStorage: input.objectStorage,
    ...(input.now ? { now: input.now } : {}),
  })
  const cache = new BunRedisEdgeCache(input.redisUrl, input.redisNamespace)
  const service = new EdgeDeliveryService({
    cache,
    reader: new PostgresEdgeReleaseReader(releases.repository, input.objectStorage),
    pointers: new PostgresEdgePointerAuthority(releases.repository, releases.service, input.now),
    holes: input.holes,
    ...(input.now ? { now: () => input.now!().getTime() } : {}),
  })
  const hosts = new PostgresEdgeHostAuthority(input.db)
  return Object.freeze({
    service,
    boundary: new FreeHostEdgeBoundary(service, input.visitors),
    cache,
    component: createBunRedisEdgeCacheComponent(cache),
    jobs: edgeDeliveryJobRegistration({ service, hosts }),
  })
}
