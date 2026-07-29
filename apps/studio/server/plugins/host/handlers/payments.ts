import type { ApiCallFor } from '../../protocol/apiCallSchema'
import type { DbClient } from '../../../db/client'
import type { HostPluginRecord } from '../types'
import { replyApiOk } from '../apiReplies'
import { requiredHostCustomerPayments } from '../paymentBindings'

function binding(entry: HostPluginRecord) {
  const value = requiredHostCustomerPayments(entry.manifest.id)
  if (value.pluginId !== entry.manifest.id || value.exactVersion !== entry.manifest.version) {
    throw new Error('Reviewed customer-payment binding does not match the loaded plugin release')
  }
  return value
}

export async function handleCustomerPaymentCreate(
  msg: ApiCallFor<'payments.customer.create'>,
  entry: HostPluginRecord,
  _db: DbClient,
): Promise<void> {
  replyApiOk(msg.pluginId, msg.correlationId, await binding(entry).create(msg.args[0]))
}

export async function handleCustomerPaymentReceipt(
  msg: ApiCallFor<'payments.customer.receipt'>,
  entry: HostPluginRecord,
  _db: DbClient,
): Promise<void> {
  replyApiOk(msg.pluginId, msg.correlationId, await binding(entry).receipt(msg.args[0]))
}

export async function handleCustomerPaymentRefund(
  msg: ApiCallFor<'payments.customer.refund'>,
  entry: HostPluginRecord,
  _db: DbClient,
): Promise<void> {
  replyApiOk(msg.pluginId, msg.correlationId, await binding(entry).refund(msg.args[0]))
}
