import type { DbClient } from '../../db/client'
import { FumaRedisCoordination, BunRedisDriver } from '../redis'
import { PublicProjectionAuthorityCatalog } from './authority'
import { createPublicProjectionBoundary, type PublicProjectionBoundary } from './boundary'
import { ConfiguredPublicContactSink, readPublicContactSinkConfig } from './contact'
import { readPrivateProjectionConfig } from './config'
import { createHostedPublicProjectionAuthorityCatalog } from './registeredAuthorities'

export type HostedPublicProjectionRuntime = Readonly<{
  boundary: PublicProjectionBoundary
  authority: PublicProjectionAuthorityCatalog
  close(): Promise<void>
}>

export type HostedPublicProjectionRuntimeInput = Readonly<{
  db: DbClient
  env?: Readonly<Record<string, unknown>>
  authority?: PublicProjectionAuthorityCatalog
  coordination?: FumaRedisCoordination
}>

export async function createHostedPublicProjectionRuntime(
  input: HostedPublicProjectionRuntimeInput,
): Promise<HostedPublicProjectionRuntime> {
  const env = input.env ?? process.env
  const config = readPrivateProjectionConfig(env)
  const contactConfig = readPublicContactSinkConfig(env)
  const contact = contactConfig ? new ConfiguredPublicContactSink(contactConfig) : undefined
  const authority = input.authority ?? createHostedPublicProjectionAuthorityCatalog(input.db)
  const coordination = input.coordination ?? new FumaRedisCoordination({
    namespace: config.redisNamespace,
    driver: new BunRedisDriver(config.redisUrl),
  })
  await coordination.connect()
  const boundary = createPublicProjectionBoundary({
    host: config.host,
    serviceToken: config.serviceToken,
    authority,
    coordination,
    ...(contact ? { contact } : {}),
  })
  return Object.freeze({
    boundary,
    authority,
    close: () => coordination.close(),
  })
}
