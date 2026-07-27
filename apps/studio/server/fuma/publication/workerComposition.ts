import { createPostgresClient } from '../../db/postgres'
import { PostgresFumaJobContextAuthority } from '../context'
import { createPlatformBillingRuntime } from '../billing'
import {
  PostgresPlatformCheckoutRepository,
  registerPlatformCheckoutPurposes,
} from '../checkout'
import { createHostedPaystackRuntime } from '../paystack/runtime'
import { createQuotaRuntime } from '../quotas'
import { readFumaConfig } from '../config'
import { createFumaJobWorkerComponentFactory } from '../jobs'
import { AnonymousEdgeVisitorAuthority, createHostedEdgeRuntime, PublicationAccessEdgeHoleResolver } from '../edgeDelivery'
import {
  createHostedMeteringRuntime,
  HOSTED_COST_BASELINE_V1,
  withNewsletterMetering,
  withPublishMetering,
} from '../metering'
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
        const paystack = createHostedPaystackRuntime({ db, config })
        const checkoutRepository = new PostgresPlatformCheckoutRepository(db)
        registerPlatformCheckoutPurposes(paystack.registry, checkoutRepository)
        const billing = createPlatformBillingRuntime({
          db,
          transport: paystack.platformBilling,
        })
        const metering = createHostedMeteringRuntime({ db })
        await Promise.all(HOSTED_COST_BASELINE_V1.map((input) => metering.costs.append(input)))
        await metering.costs.assertComplete()
        const quota = createQuotaRuntime({ db })
        const publication = await createHostedPublicationRuntime({
          db,
          config,
          objectAccessSigningSecret: requiredObjectSigningSecret(env),
          campaignQuota: quota.campaign,
        })
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
        const newsletterHandler = publication.jobHandlers['publication.newsletter-send']
        const publishHandler = publishing.jobHandlers['fuma.publish-release']
        if (!newsletterHandler || !publishHandler) throw new TypeError('Metered durable handlers are unavailable.')
        const handlers = Object.freeze({
          ...publication.jobHandlers,
          ...publishing.jobHandlers,
          ...edge.jobs,
          ...metering.jobs,
          ...billing.jobs,
          ...quota.jobs,
          'publication.newsletter-send': withNewsletterMetering(newsletterHandler, metering.collector),
          'fuma.publish-release': withPublishMetering(publishHandler, metering.collector),
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
