export { AtomicPublishWorker, PUBLISH_RELEASE_JOB_KIND, publishWorkerRegistration } from '../publishing/workerPublisher'
export { FreeHostService, MemoryFreeHostRepository } from '../freeHosts/service'
export { EdgeDeliveryService, MemoryEdgeCache } from '../edgeDelivery/service'
export { MeteringService, VersionedCostCatalog, MemoryUsageLedger } from '../metering/service'
export { ScopedPaystackTransport, PaystackPurposeRegistry } from '../paystack/transport'
export { MemoryPaystackLedger } from '../paystack/memoryLedger'
export { EntitlementService, MemoryEntitlementRepository } from '../entitlements/service'
export { PlatformCheckoutService, MemoryCheckoutRepository } from '../checkout/service'
export { PlatformBillingReconciler, MemoryBillingRepository } from '../billing/reconciler'
export { QuotaService, MemoryQuotaRepository } from '../quotas/service'
export { CustomerMerchantPaymentService, MemoryMembershipRepository } from '../customerPayments/service'
export { DomainService } from '../domains/service'
export { CloudflareSaasReconciler, FakeCloudflareSaasAdapter } from '../cloudflare/reconciler'
export { AesGcmDomainSecretCipher } from '../domains/credentialCipher'
export { RegistrarService } from '../registrar/service'
export { CustomerDomainOperations } from '../domainOperations/service'
export { COMMERCIAL_EDGE_MIGRATIONS, COMMERCIAL_EDGE_MIGRATION_CHECKSUMS } from './migrations'
export { FakePaystackHttp, FakeRegistrarAdapter, FakeDnsProbe, FakeDomainSecretCipher } from './providerFakes'

export const COMMERCIAL_EDGE_JOB_KINDS=Object.freeze([
'fuma.publish-release','fuma.edge-purge','fuma.edge-warm','fuma.edge-rollback','fuma.meter-reconcile','fuma.billing-reconcile','fuma.billing-dunning','fuma.cloudflare-reconcile','fuma.registrar-purchase','fuma.registrar-renew','fuma.domain-transfer',
] as const)
export const COMMERCIAL_EDGE_PURPOSES=Object.freeze([
{purpose:'platform-recurring',scope:'platform_billing'},{purpose:'platform-setup',scope:'platform_billing'},{purpose:'publication-membership',scope:'customer_merchant'},
] as const)
export const COMMERCIAL_EDGE_TRANSFER_STEPS=Object.freeze([
{stepId:'customer-merchant-credentials',order:610,choices:['rekey','detach']},{stepId:'domain-outcome',order:620,choices:['retain-with-source','move-with-site','detach-and-manual']},
] as const)

/** Descriptor consumed by the primary runtime integrator; it does not mount global routes itself. */
export function describeCommercialEdgePhase(){return Object.freeze({tickets:['FUMA-048','FUMA-049','FUMA-050','FUMA-051','FUMA-052','FUMA-053','FUMA-054','FUMA-055','FUMA-056','FUMA-057','FUMA-058','FUMA-059','FUMA-060','FUMA-061','FUMA-062'],jobs:COMMERCIAL_EDGE_JOB_KINDS,paymentPurposes:COMMERCIAL_EDGE_PURPOSES,transferSteps:COMMERCIAL_EDGE_TRANSFER_STEPS,migrationRange:['000021','000034'] as const,noDefaultHost:true,credentialScopes:['platform_billing','customer_merchant','fuma-platform','customer-automation'] as const})}
