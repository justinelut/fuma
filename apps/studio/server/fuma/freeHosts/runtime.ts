import type { DbClient } from '../../db/client'
import type { FumaConfig } from '../config'
import { createMinioObjectStorage } from '../objectStorage'
import { FreeHostPublicRouter, type FreeHostPublicBoundary, type FreeHostRouteExtension } from './publicRouter'
import { PostgresFreeHostRepository } from './repository'
import { FreeHostService } from './service'

const HOSTED_RELEASE_MIME_TYPES = Object.freeze(['text/html', 'text/css'])

export type HostedFreeHostRuntime = Readonly<{
  boundary: FreeHostPublicBoundary
  repository: PostgresFreeHostRepository
}>

export function readFreeHostObjectSigningSecret(
  env: Readonly<Record<string, unknown>> = process.env,
): string {
  const value = env.FUMA_OBJECT_ACCESS_SIGNING_SECRET
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 32) {
    throw new TypeError('FUMA_OBJECT_ACCESS_SIGNING_SECRET must contain at least 32 bytes.')
  }
  return value
}

/** Central FUMA-050 hosted-web composition; no memory repository or default tenant is available here. */
export function createHostedFreeHostRuntime(input: Readonly<{
  db: DbClient
  config: FumaConfig
  objectAccessSigningSecret: string
  extensions?: readonly FreeHostRouteExtension[]
  now?: () => Date
}>): HostedFreeHostRuntime {
  const storage = createMinioObjectStorage({
    config: input.config.minio,
    policy: {
      allowedMimeTypes: HOSTED_RELEASE_MIME_TYPES,
      maxObjectBytes: 25 * 1024 * 1024,
      maxTenantBytes: 20 * 1024 * 1024 * 1024,
    },
    signingSecret: input.objectAccessSigningSecret,
    accessUrlBase: `https://${input.config.hosts.product}/_fuma/objects`,
    ...(input.now ? { nowMs: () => input.now!().getTime() } : {}),
  })
  const repository = new PostgresFreeHostRepository(input.db)
  const service = new FreeHostService(repository, repository, input.now)
  return Object.freeze({
    repository,
    boundary: new FreeHostPublicRouter({
      service,
      storage,
      controlHosts: [input.config.hosts.product],
      ...(input.extensions ? { extensions: input.extensions } : {}),
    }),
  })
}
