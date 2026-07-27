import type { DbClient } from '../../db/client'
import type { FumaConfig } from '../config'
import { createMinioObjectStorage } from '../objectStorage'
import { createPostgresReleaseComposition } from '../releases'
import {
  PostgresPublishAttemptAuthority,
  PostgresPublishSnapshotAuthority,
} from './postgresAdapters'
import { CoreSemanticReleaseRenderer } from './semanticRenderer'
import {
  AtomicPublishWorker,
  publishWorkerRegistration,
} from './workerPublisher'

const PUBLISH_MIME_TYPES = Object.freeze([
  'text/html', 'text/css',
  'image/avif', 'image/jpeg', 'image/png', 'image/webp',
])

export function createPostgresPublishReleaseComposition(input: Readonly<{
  db: DbClient
  config: FumaConfig
  objectAccessSigningSecret: string
  now?: () => Date
}>) {
  if (Buffer.byteLength(input.objectAccessSigningSecret, 'utf8') < 32) {
    throw new TypeError('FUMA_OBJECT_ACCESS_SIGNING_SECRET must contain at least 32 bytes.')
  }
  const storage = createMinioObjectStorage({
    config: input.config.minio,
    policy: {
      allowedMimeTypes: PUBLISH_MIME_TYPES,
      maxObjectBytes: 25 * 1024 * 1024,
      maxTenantBytes: 20 * 1024 * 1024 * 1024,
    },
    signingSecret: input.objectAccessSigningSecret,
    accessUrlBase: `https://${input.config.hosts.product}/_fuma/objects`,
    ...(input.now ? { nowMs: () => input.now!().getTime() } : {}),
  })
  const releases = createPostgresReleaseComposition({
    db: input.db,
    objectStorage: storage,
    ...(input.now ? { now: input.now } : {}),
  })
  const worker = new AtomicPublishWorker({
    snapshots: new PostgresPublishSnapshotAuthority(input.db),
    renderer: new CoreSemanticReleaseRenderer(),
    storage,
    releases: releases.service,
    attempts: new PostgresPublishAttemptAuthority(input.db, input.now),
    ...(input.now ? { now: input.now } : {}),
  })
  return Object.freeze({
    storage,
    releases,
    worker,
    jobHandlers: publishWorkerRegistration(worker),
  })
}
