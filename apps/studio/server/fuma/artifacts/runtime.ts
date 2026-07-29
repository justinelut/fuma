import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import { runScheduleInWorker } from '../../plugins/host/rpc'
import type { FumaConfig } from '../config'
import { createMinioObjectStorage } from '../objectStorage'
import { TenantSharedArtifactObjectStore } from './objectStore'
import { PostgresArtifactAuthorityRepository } from './postgres'
import { ArtifactAuthorityError, type ArtifactInstallation } from './contracts'
import { ArtifactInstallationAuthority, type PluginWorkerDispatchPort } from './service'

const ScheduleDispatchSchema = Type.Object({
  scheduleId: Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }),
  maxDurationMs: Type.Integer({ minimum: 1, maximum: 30_000 }),
}, { additionalProperties: false })

export class NativePluginArtifactWorkerDispatch implements PluginWorkerDispatchPort {
  async dispatch(input: Readonly<{ installation: ArtifactInstallation; target: string; payload: unknown }>): Promise<unknown> {
    if (input.installation.artifactKind !== 'plugin' || input.target !== 'schedule') throw new ArtifactAuthorityError('policy-denied', 'Native artifact dispatch target is denied.')
    const parsed = safeParseValue(ScheduleDispatchSchema, input.payload)
    if (!parsed.ok) throw new ArtifactAuthorityError('invalid-contract', 'Plugin schedule dispatch is invalid.')
    return await runScheduleInWorker({ pluginId: input.installation.packageId, ...parsed.value })
  }
}

export type HostedArtifactRuntime = Readonly<{
  authority: ArtifactInstallationAuthority
  repository: PostgresArtifactAuthorityRepository
}>

export function createHostedArtifactRuntime(input: Readonly<{
  db: DbClient
  config: FumaConfig
  objectAccessSigningSecret: string
  workers?: PluginWorkerDispatchPort
  now?: () => Date
}>): HostedArtifactRuntime {
  const storage = createMinioObjectStorage({
    config: input.config.minio,
    policy: {
      allowedMimeTypes: ['application/zip', 'application/json'],
      maxObjectBytes: 25 * 1024 * 1024,
      maxTenantBytes: 50 * 1024 * 1024 * 1024,
    },
    signingSecret: input.objectAccessSigningSecret,
    accessUrlBase: `https://${input.config.hosts.product}/_fuma/objects`,
    ...(input.now ? { nowMs: () => input.now!().getTime() } : {}),
  })
  const repository = new PostgresArtifactAuthorityRepository(input.db)
  const objects = new TenantSharedArtifactObjectStore(storage, {
    organizationId: 'fuma-platform-artifacts',
    workspaceId: 'fuma-platform-artifacts',
    siteId: 'fuma-platform-artifacts',
  })
  return Object.freeze({
    repository,
    authority: new ArtifactInstallationAuthority({
      repository,
      objects,
      workers: input.workers ?? new NativePluginArtifactWorkerDispatch(),
      ...(input.now ? { now: input.now } : {}),
    }),
  })
}
