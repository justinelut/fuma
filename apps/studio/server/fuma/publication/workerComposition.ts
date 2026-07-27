import { createPostgresClient } from '../../db/postgres'
import { PostgresFumaJobContextAuthority } from '../context'
import { readFumaConfig } from '../config'
import { createFumaJobWorkerComponentFactory } from '../jobs'
import { AnonymousEdgeVisitorAuthority, createHostedEdgeRuntime, PublicationAccessEdgeHoleResolver } from '../edgeDelivery'
import { createPostgresPublishReleaseComposition } from '../publishing'
import type { FumaRuntimeComponentFactory } from '../runtime/boot'
import { createRuntimeControlComponent } from '../runtime/health'
import { createHostedPublicationRuntime } from './runtime'

function requiredObjectSigningSecret(env: Readonly<Record<string, unknown>>): string {
  const value = env.FUMA_OBJECT_ACCESS_SIGNING_SECRET
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 32) {
    throw new TypeError('FUMA_OBJECT_ACCESS_SIGNING_SECRET must contain at least 32 bytes.')
  }
  return value
}

export function createPublicationWorkerComponentFactory(
  env: Readonly<Record<string, unknown>> = process.env,
): FumaRuntimeComponentFactory {
  return (input) => {
    if (input.id !== 'durable-job-worker') {
      return createRuntimeControlComponent({
        id: input.id,
        role: input.role,
        port: input.settings.healthPort,
        log: input.log,
      })
    }
    return {
      id: input.id,
      async start(context) {
        const config = readFumaConfig(env)
        const db = createPostgresClient(config.database.url)
        const publication = await createHostedPublicationRuntime({ db, config, objectAccessSigningSecret: requiredObjectSigningSecret(env) })
        const publishing = createPostgresPublishReleaseComposition({
          db,
          config,
          objectAccessSigningSecret: requiredObjectSigningSecret(env),
        })
        const edge = createHostedEdgeRuntime({
          db,
          objectStorage: publishing.storage,
          redisUrl: config.redis.url,
          redisNamespace: `edge-${config.hosts.product.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 48)}`,
          visitors: new AnonymousEdgeVisitorAuthority(),
          holes: [new PublicationAccessEdgeHoleResolver(publication.graph.scheduling)],
        })
        await edge.cache.connect()
        const handlers = Object.freeze({
          ...publication.jobHandlers,
          ...publishing.jobHandlers,
          ...edge.jobs,
        })
        const worker = createFumaJobWorkerComponentFactory({
          env,
          db,
          handlers,
          jobAuthority: new PostgresFumaJobContextAuthority(db),
        })({
          id: input.id,
          role: input.role,
          settings: input.settings,
          log: input.log,
        })
        const handle = await worker.start(context)
        return {
          beginDrain: () => handle?.beginDrain?.(),
          async stop() {
            await handle?.stop?.()
            edge.cache.close()
            await publication.close()
          },
        }
      },
    }
  }
}
