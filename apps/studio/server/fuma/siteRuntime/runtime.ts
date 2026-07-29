import type { DbClient } from '../../db/client'
import { BunRedisDriver, FumaRedisCoordination } from '../redis'
import type { TenantObjectStorage } from '../objectStorage'
import { createSiteRuntimePrivateBoundary, type SiteRuntimePrivateBoundary } from './boundary'
import { readSiteRuntimeConfig } from './config'
import { SiteRuntimeApplicationAuthority, type SiteRuntimeMemberProjectionPort, type SiteRuntimeMutationAdapter } from './application'
import { PostgresSiteRuntimeApplicationRepository, PostgresSiteRuntimeLegacyReader } from './postgresApplication'
import { PostgresSiteRuntimeAuthority } from './service'

export type HostedSiteRuntimeAuthority = Readonly<{
  boundary: SiteRuntimePrivateBoundary
  privateHost: string
  close(): Promise<void>
}>

export async function createHostedSiteRuntimeAuthority(input: Readonly<{
  db: DbClient
  storage: TenantObjectStorage
  members?: SiteRuntimeMemberProjectionPort
  mutations?: SiteRuntimeMutationAdapter
  env?: Readonly<Record<string, unknown>>
  coordination?: FumaRedisCoordination
}>): Promise<HostedSiteRuntimeAuthority> {
  const config = readSiteRuntimeConfig(input.env ?? process.env)
  const coordination = input.coordination ?? new FumaRedisCoordination({
    namespace: `${config.redisNamespace}-site-runtime`,
    driver: new BunRedisDriver(config.redisUrl),
  })
  await coordination.connect()
  const applicationRepository = new PostgresSiteRuntimeApplicationRepository(input.db)
  const application = new SiteRuntimeApplicationAuthority({
    rollouts: applicationRepository,
    receipts: applicationRepository,
    legacy: new PostgresSiteRuntimeLegacyReader(input.db, input.storage),
    ...(input.members ? { members: input.members } : {}),
    ...(input.mutations ? { mutations: input.mutations } : {}),
  })
  const authority = new PostgresSiteRuntimeAuthority({
    db: input.db,
    storage: input.storage,
    coordination,
    application,
    supportedDeployments: config.supportedDeployments,
  })
  return Object.freeze({
    privateHost: config.privateHost,
    boundary: createSiteRuntimePrivateBoundary({ host: config.privateHost, serviceToken: config.serviceToken, authority }),
    close: () => coordination.close(),
  })
}
