import type {
  CustomerPaymentCreateInput,
  CustomerPaymentInitialization,
  CustomerPaymentReceipt,
  CustomerPaymentReceiptInput,
  CustomerPaymentRefund,
  CustomerPaymentRefundInput,
} from '../paymentSchemas'

/**
 * Host-owned customer-merchant payment bridge. The sandbox never receives
 * merchant credentials, provider webhook bytes, ledger access, or tenant
 * selectors; those authorities are derived out-of-band by the host.
 */
export interface ServerPluginCustomerPaymentsApi {
  create(input: CustomerPaymentCreateInput): Promise<CustomerPaymentInitialization>
  receipt(input: CustomerPaymentReceiptInput): Promise<CustomerPaymentReceipt>
  refund(input: CustomerPaymentRefundInput): Promise<CustomerPaymentRefund>
}
