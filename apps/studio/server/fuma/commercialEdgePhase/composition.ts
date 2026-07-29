export { FreeHostService, MemoryFreeHostRepository } from '../freeHosts/service'
export { EdgeDeliveryService, MemoryEdgeCache } from '../edgeDelivery/service'
export { MeteringService, VersionedCostCatalog, MemoryUsageLedger } from '../metering/service'
export { ScopedPaystackTransport, PaystackPurposeRegistry } from '../paystack/transport'
export { MemoryPaystackLedger } from '../paystack/memoryLedger'
export { EntitlementService, MemoryEntitlementRepository } from '../entitlements/service'
export { PlatformCheckoutService } from '../checkout/service'
export { MemoryCheckoutRepository } from '../checkout/memory'
export { PlatformBillingReconciler, MemoryBillingRepository } from '../billing/reconciler'
export { QuotaService, MemoryQuotaRepository } from '../quotas/service'
export { CustomerMerchantPaymentService, MemoryCustomerPaymentRepository } from '../customerPayments/service'
export { AesGcmCustomerPaymentCredentialCipher } from '../customerPayments/credentialCipher'
export { createHostedCustomerPaymentRuntime } from '../customerPayments/runtime'
export {
  CustomerMerchantPluginPaymentService,
  ReviewedCustomerPaymentPluginBinding,
  MemoryCustomerPluginPaymentRepository,
  createCustomerPluginPaymentPurposes,
} from '../customerPayments/plugin'
export { DomainService } from '../domains/service'
export { CloudflareSaasReconciler, DomainServiceCloudflareTransitionPort, FakeCloudflareSaasAdapter } from '../cloudflare/reconciler'
export { CloudflareForSaasApiAdapter } from '../cloudflare/adapter'
export { PostgresCloudflareStateRepository } from '../cloudflare/repository'
export { createCloudflareRouteDeclarations } from '../cloudflare/routes'
export { cloudflareJobRegistration } from '../cloudflare/jobHandlers'
export { AesGcmDomainSecretCipher } from '../domains/credentialCipher'
export { RegistrarService } from '../registrar/service'
export { RegistrarWorkflow } from '../registrar/workflow'
export { createHostedRegistrarRuntime } from '../registrar/runtime'
export { DomainOperationsService } from '../domainOperations/service'
export { createHostedDomainOperationsRuntime } from '../domainOperations/runtime'
export {
  DOMAIN_OUTCOME_TRANSFER_STEP_ID,
  DOMAIN_OUTCOME_TRANSFER_STEP_ORDER,
} from '../domainOperations/transferStep'
export { DOMAIN_TRANSFER_JOB_KIND } from '../domainOperations/jobs'
export { COMMERCIAL_EDGE_MIGRATIONS, COMMERCIAL_EDGE_MIGRATION_CHECKSUMS } from './migrations'
export { FakePaystackHttp, FakeRegistrarAdapter, FakeDnsProbe, FakeDomainSecretCipher } from './providerFakes'

export const COMMERCIAL_EDGE_JOB_KINDS = Object.freeze([
  'fuma.publish-release',
  'fuma.edge-purge',
  'fuma.edge-warm',
  'fuma.edge-rollback',
  'fuma.meter-reconcile',
  'fuma.billing-reconcile',
  'fuma.billing-dunning',
  'fuma.customer-payment-lifecycle',
  'fuma.customer-payment-card-renewal',
  'fuma.cloudflare-reconcile',
  'fuma.registrar-purchase',
  'fuma.registrar-renew',
  'fuma.domain-transfer',
] as const)

export const COMMERCIAL_EDGE_PURPOSES = Object.freeze([
  { purpose: 'platform-recurring', scope: 'platform_billing' },
  { purpose: 'platform-setup', scope: 'platform_billing' },
  { purpose: 'publication-membership', scope: 'customer_merchant' },
  { purpose: 'fuma-plugin-deposit', scope: 'customer_merchant' },
  { purpose: 'fuma-plugin-donation', scope: 'customer_merchant' },
  { purpose: 'fuma-plugin-checkout', scope: 'customer_merchant' },
] as const)

export const COMMERCIAL_EDGE_SCOPED_ROUTE_GROUPS = Object.freeze([
  'customer-merchant-payments',
  'cloudflare-saas-hostnames',
  'registrar-lifecycle',
  'domain-operations',
] as const)

export const COMMERCIAL_EDGE_TRANSFER_STEPS = Object.freeze([
  {
    stepId: 'customer-merchant-credentials',
    order: 610,
    choices: ['rekey', 'detach'],
  },
  {
    stepId: 'domain-outcome',
    order: 620,
    choices: ['retain-with-source', 'move-with-site', 'detach-and-manual'],
  },
] as const)

/** Descriptor consumed by the primary runtime integrator; it does not mount global routes itself. */
export function describeCommercialEdgePhase() {
  return Object.freeze({
    tickets: [
      'FUMA-048',
      'FUMA-049',
      'FUMA-050',
      'FUMA-051',
      'FUMA-052',
      'FUMA-053',
      'FUMA-054',
      'FUMA-055',
      'FUMA-056',
      'FUMA-057',
      'FUMA-058',
      'FUMA-059',
      'FUMA-060',
      'FUMA-061',
      'FUMA-062',
    ] as const,
    jobs: COMMERCIAL_EDGE_JOB_KINDS,
    paymentPurposes: COMMERCIAL_EDGE_PURPOSES,
    transferSteps: COMMERCIAL_EDGE_TRANSFER_STEPS,
    migrationRange: ['000021', '000034'] as const,
    authorityMigrationIds: ['000061', '000062', '000064', '000065', '000067'] as const,
    routeGroups: COMMERCIAL_EDGE_SCOPED_ROUTE_GROUPS,
    noDefaultHost: true,
    credentialScopes: [
      'platform_billing',
      'customer_merchant',
      'fuma-platform',
      'customer-automation',
    ] as const,
  })
}
