import type { DbClient } from '../../db/client'
import type { PaystackPurposeRegistry } from '../paystack/transport'
import { CustomerCardRenewalService } from './cardRenewal'
import { CustomerPaymentLifecycleService } from './lifecycle'
import { PostgresCustomerPaymentRepository } from './repository'
import {
  createCustomerMerchantCredentialRouteDeclarations,
  CustomerMemberPaymentBoundary,
  CustomerMerchantWebhookBoundary,
  type PublicationPayerAuthorityResolver,
} from './routes'
import {
  CustomerMerchantPaymentService,
  createPublicationMembershipPurpose,
  type CardRecurrenceAuthority,
  type CustomerCardRecurrenceTransportFactory,
  type CustomerMerchantCredentialCipher,
  type CustomerMerchantTransportFactory,
  type MembershipCatalog,
  type MembershipReminderSink,
  type PaidPublicationAccessProjector,
} from './service'
import {
  CustomerMerchantPluginPaymentService,
  createCustomerPluginPaymentPurposes,
  type CustomerMerchantRefundTransportFactory,
} from './plugin'
import { PostgresCustomerPluginPaymentRepository } from './pluginRepository'
import {
  createCustomerMerchantCredentialTransferStep,
  PostgresCustomerCredentialTransferRepository,
  type CustomerCredentialTransferOwnerAuthority,
} from './transferStep'

export type HostedCustomerPaymentRuntimeInput = Readonly<{
  db: DbClient
  registry: PaystackPurposeRegistry
  cipher: CustomerMerchantCredentialCipher
  transports: CustomerMerchantTransportFactory
  refunds?: CustomerMerchantRefundTransportFactory
  cardTransports: CustomerCardRecurrenceTransportFactory
  catalog: MembershipCatalog
  recurrence: CardRecurrenceAuthority
  access: PaidPublicationAccessProjector
  reminders: MembershipReminderSink
  payerAuthority: PublicationPayerAuthorityResolver
  transferOwner: CustomerCredentialTransferOwnerAuthority
  now?: () => Date
}>

/**
 * Hosted composition seam. Global Bun route/job/transfer registries consume the returned
 * declarations and boundaries; this module never mounts an app-global router itself.
 */
export function createHostedCustomerPaymentRuntime(input: HostedCustomerPaymentRuntimeInput) {
  const now = input.now ?? (() => new Date())
  const repository = new PostgresCustomerPaymentRepository(input.db)
  const pluginRepository = new PostgresCustomerPluginPaymentRepository(input.db)
  input.registry.register(createPublicationMembershipPurpose(
    repository,
    input.cipher,
    input.access,
    now,
  ))
  for (const purpose of createCustomerPluginPaymentPurposes(pluginRepository, now)) {
    input.registry.register(purpose)
  }
  const service = new CustomerMerchantPaymentService({
    repository,
    catalog: input.catalog,
    recurrence: input.recurrence,
    cipher: input.cipher,
    transports: input.transports,
    now,
  })
  const pluginPayments = new CustomerMerchantPluginPaymentService({
    credentials: repository,
    repository: pluginRepository,
    cipher: input.cipher,
    transports: input.transports,
    ...(input.refunds ? { refunds: input.refunds } : {}),
    now,
  })
  const cardRenewal = new CustomerCardRenewalService({
    repository,
    catalog: input.catalog,
    recurrence: input.recurrence,
    cipher: input.cipher,
    transports: input.cardTransports,
    access: input.access,
    now,
  })
  const lifecycle = new CustomerPaymentLifecycleService(
    repository,
    input.reminders,
    input.access,
    now,
  )
  const transferRepository = new PostgresCustomerCredentialTransferRepository(input.db)
  const transferStep = createCustomerMerchantCredentialTransferStep(
    transferRepository,
    input.transferOwner,
  )
  const scopedRoutes = createCustomerMerchantCredentialRouteDeclarations(service)
  const memberPayments = new CustomerMemberPaymentBoundary(service, input.payerAuthority)
  const webhooks = new CustomerMerchantWebhookBoundary(service)

  return Object.freeze({
    repository,
    service,
    pluginRepository,
    pluginPayments,
    cardRenewal,
    lifecycle,
    transferRepository,
    transferStep,
    scopedRoutes,
    memberPayments,
    webhooks,
  })
}
