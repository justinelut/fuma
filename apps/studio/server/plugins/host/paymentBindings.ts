import type {
  CustomerPaymentCreateInput,
  CustomerPaymentInitialization,
  CustomerPaymentReceipt,
  CustomerPaymentReceiptInput,
  CustomerPaymentRefund,
  CustomerPaymentRefundInput,
} from '@core/plugin-sdk/paymentSchemas'

/**
 * A Fuma composition root installs one of these only after revalidating the
 * exact active artifact installation and current FUMA-068 review signature.
 * The generic plugin host deliberately knows nothing about merchant secrets,
 * provider transports, webhooks, or ledgers.
 */
export interface HostCustomerPaymentBinding {
  readonly pluginId: string
  readonly artifactId: string
  readonly contentHashSha256: string
  readonly exactVersion: string
  create(input: CustomerPaymentCreateInput): Promise<CustomerPaymentInitialization>
  receipt(input: CustomerPaymentReceiptInput): Promise<CustomerPaymentReceipt>
  refund(input: CustomerPaymentRefundInput): Promise<CustomerPaymentRefund>
}

const bindings = new Map<string, HostCustomerPaymentBinding>()

export function bindHostCustomerPayments(binding: HostCustomerPaymentBinding): void {
  const existing = bindings.get(binding.pluginId)
  if (existing && existing !== binding) {
    throw new Error(`Plugin "${binding.pluginId}" already has a customer-payment binding`)
  }
  bindings.set(binding.pluginId, binding)
}

export function unbindHostCustomerPayments(pluginId: string): void {
  bindings.delete(pluginId)
}

export function requiredHostCustomerPayments(pluginId: string): HostCustomerPaymentBinding {
  const binding = bindings.get(pluginId)
  if (!binding) throw new Error(`Plugin "${pluginId}" has no reviewed customer-payment binding`)
  return binding
}

export function resetHostCustomerPaymentBindingsForTesting(): void {
  bindings.clear()
}
