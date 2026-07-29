import { Type } from '@sinclair/typebox'
import {
  CustomerPaymentCreateInputSchema,
  CustomerPaymentReceiptInputSchema,
  CustomerPaymentRefundInputSchema,
} from '@core/plugin-sdk/paymentSchemas'

export const CustomerPaymentCreateArgsSchema = Type.Tuple([
  CustomerPaymentCreateInputSchema,
])
export const CustomerPaymentReceiptArgsSchema = Type.Tuple([
  CustomerPaymentReceiptInputSchema,
])
export const CustomerPaymentRefundArgsSchema = Type.Tuple([
  CustomerPaymentRefundInputSchema,
])
