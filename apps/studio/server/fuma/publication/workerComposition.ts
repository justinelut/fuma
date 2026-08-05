import { createPostgresClient } from '../../db/postgres'
import { PostgresFumaJobContextAuthority } from '../context'
import { createPlatformBillingRuntime } from '../billing'
import {
  PostgresPlatformCheckoutRepository,
  registerPlatformCheckoutPurposes,
} from '../checkout'
import { createHostedPaystackRuntime } from '../paystack/runtime'
import { createQuotaRuntime } from '../quotas'
import { createHostedEntitlementRuntime, readHostedKesCostConversion } from '../entitlements'
import { createHostedDomainRuntime, readHostedDomainCredentialKeyring } from '../domains/runtime'
import { createHostedCloudflareRuntime } from '../cloudflare/runtime'
import { createHostedRegistrarRuntime } from '../registrar/runtime'
import { FetchRegistrarGatewayHttpClient, RegistrarGatewayAdapter } from '../registrar/productionGateway'
import { readHostedRegistrarConfig } from '../registrar/config'
import { platformCredentialAuthority } from '../domains/contracts'
import { createHostedDomainOperationsRuntime } from '../domainOperations/runtime'
import { AesGcmRegistrarAuthCodeVault } from '../domainOperations/authCodeVault'
import { PostgresDomainOperationsRepository } from '../domainOperations/postgres'
import { RegistrarTransferGatewayAdapter } from '../domainOperations/productionRegistrarTransfer'
import { CloudflareCustomerDnsDetachPort, OciRegistrarAuthCodeDelivery, PostgresDomainAutomationCredentialPort, PostgresDomainOutcomeEffects, PostgresDomainOutcomeOwnerAuthority, ProductionDomainDnsObserver } from '../domainOperations/productionAdapters'
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
        const domainWorkerConfigured = typeof env.FUMA_KES_FX_VERSION === 'string'
          && typeof env.FUMA_KES_MINOR_NUMERATOR === 'string'
          && typeof env.FUMA_USD_MICROS_DENOMINATOR === 'string'
          && typeof env.FUMA_DOMAIN_CREDENTIAL_ACTIVE_KEY_ID === 'string'
          && typeof env.FUMA_DOMAIN_CREDENTIAL_KEYRING === 'string'
        let cloudflare: ReturnType<typeof createHostedCloudflareRuntime> | undefined
        let domains: Awaited<ReturnType<typeof createHostedDomainRuntime>> | undefined
        let entitlements: ReturnType<typeof createHostedEntitlementRuntime> | undefined
        if (domainWorkerConfigured) {
          const kes = readHostedKesCostConversion(env)
          entitlements = createHostedEntitlementRuntime({ db, usdMicrosToKesMinor: kes.convert, costConversionVersion: kes.version })
          const keyring = readHostedDomainCredentialKeyring(env as Readonly<Record<string, string | undefined>>)
          domains = await (async () => {
            try {
              return await createHostedDomainRuntime({ db, keyring, provider: Object.freeze({ async execute(): Promise<never> { throw new TypeError('Generic domain credential operations require an explicit provider adapter.') } }), entitlements: entitlements!.service, quotas: quota.service, metering: metering.service })
            } finally { for (const entry of keyring.keys) entry.bytes.fill(0) }
          })()
          cloudflare = createHostedCloudflareRuntime({ db, config, domains })
        }
        const publication = await createHostedPublicationRuntime({
          db,
          config,
          objectAccessSigningSecret: requiredObjectSigningSecret(env),
          campaignQuota: quota.campaign,
        })
        let registrar: ReturnType<typeof createHostedRegistrarRuntime> | undefined
        let domainOperations: ReturnType<typeof createHostedDomainOperationsRuntime> | undefined
        let registrarProvider: RegistrarGatewayAdapter | undefined
        let transferProvider: RegistrarTransferGatewayAdapter | undefined
        const registrarConfig = readHostedRegistrarConfig(env)
        if (registrarConfig && config.ociEmail && domains && cloudflare && entitlements) {
          const authority = platformCredentialAuthority('fuma')
          const token = new TextEncoder().encode(registrarConfig.apiToken)
          const fingerprint = new Bun.CryptoHasher('sha256').update(token).digest('hex')
          const current = await domains.repository.credentialExact(authority, registrarConfig.credentialId)
          if (!current) await domains.service.storeCredential({ credentialId: registrarConfig.credentialId, authority, plaintext: token, createdAt: registrarConfig.credentialCreatedAt })
          else if (current.state !== 'active' || current.fingerprintSha256 !== fingerprint) { token.fill(0); throw new TypeError('Registrar credential rotation requires an explicit reviewed domain credential rotation.') }
          const http = new FetchRegistrarGatewayHttpClient()
          registrarProvider = new RegistrarGatewayAdapter({ origin: registrarConfig.gatewayOrigin, token, http })
          transferProvider = new RegistrarTransferGatewayAdapter({ origin: registrarConfig.gatewayOrigin, token, http })
          token.fill(0)
          registrar = createHostedRegistrarRuntime({ db, provider: registrarProvider, domains: domains.service, stepUp: { async consume() { return false } }, entitled: async (scope) => (await entitlements!.service.evaluate(scope.organizationId)).source !== 'none', authority, credentialId: registrarConfig.credentialId })
          const operationsRepository = new PostgresDomainOperationsRepository(db)
          domainOperations = createHostedDomainOperationsRuntime({ db, dns: new ProductionDomainDnsObserver({ cloudflare: cloudflare.reconciler }), automation: new PostgresDomainAutomationCredentialPort(domains.repository), registrar: transferProvider, delivery: new OciRegistrarAuthCodeDelivery({ db, oci: publication.oci, senderEmail: config.ociEmail.approvedSender }), authCodes: new AesGcmRegistrarAuthCodeVault(domains.keys), detach: new CloudflareCustomerDnsDetachPort({ cloudflare: cloudflare.reconciler, domains: domains.repository }), owner: new PostgresDomainOutcomeOwnerAuthority(db), effects: new PostgresDomainOutcomeEffects(operationsRepository) })
        }
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
          ...(cloudflare?.jobs ?? {}),
          ...(registrar?.jobs ?? {}),
          ...(domainOperations?.jobs ?? {}),
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
            registrarProvider?.close()
            transferProvider?.close()
            cloudflare?.close()
            edge.cache.close()
            await publication.close()
          },
        }
      },
    }
  }
}
