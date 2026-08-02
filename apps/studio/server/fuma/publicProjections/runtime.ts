import type { DbClient } from '../../db/client'
import { FumaRedisCoordination, BunRedisDriver } from '../redis'
import { PublicProjectionAuthorityCatalog } from './authority'
import { createPublicProjectionBoundary, type PublicProjectionBoundary } from './boundary'
import {
  ConfiguredPublicContactSink,
  DurablePublicContactRoutingAuthority,
  PostgresPublicContactReceiptRepository,
  readPublicContactSinkConfig,
  type PublicContactRoutingAuthority,
} from './contact'
import { readPrivateProjectionConfig } from './config'
import type { PublicHandoffIssuer } from '../publicHandoff'
import {
  ConfiguredPublicStatusProjectionAuthority,
  readPublicStatusAuthorityConfig,
  type PublicStatusProjectionAuthority,
} from './status'
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
  contact?: PublicContactRoutingAuthority
  status?: PublicStatusProjectionAuthority
  handoff?: PublicHandoffIssuer
}>

export async function createHostedPublicProjectionRuntime(
  input: HostedPublicProjectionRuntimeInput,
): Promise<HostedPublicProjectionRuntime> {
  const env = input.env ?? process.env
  const config = readPrivateProjectionConfig(env)
  const contactConfig = readPublicContactSinkConfig(env)
  const statusConfig = readPublicStatusAuthorityConfig(env)
  const contact = input.contact ?? (contactConfig
    ? new DurablePublicContactRoutingAuthority({
        repository: new PostgresPublicContactReceiptRepository(input.db),
        sink: new ConfiguredPublicContactSink(contactConfig),
        retentionDays: contactConfig.retentionDays,
        retentionPolicyVersion: contactConfig.retentionPolicyVersion,
      })
    : undefined)
  const status = input.status ?? (statusConfig
    ? new ConfiguredPublicStatusProjectionAuthority(statusConfig)
    : undefined)
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
    ...(status ? { status } : {}),
    ...(input.handoff ? { handoff: input.handoff } : {}),
  })
  return Object.freeze({
    boundary,
    authority,
    close: () => coordination.close(),
  })
}
