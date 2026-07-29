import { Type, type Static } from '@core/utils/typeboxHelpers'

const PaymentIdSchema = Type.String({
  minLength: 1,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
})
const PaymentTimestampSchema = Type.String({
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$',
})
const PaymentHashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' })

export const CustomerPaymentPurposeSchema = Type.Union([
  Type.Literal('deposit'),
  Type.Literal('donation'),
  Type.Literal('checkout'),
])
export type CustomerPaymentPurpose = Static<typeof CustomerPaymentPurposeSchema>

export const CustomerPaymentCreateInputSchema = Type.Object({
  requestId: PaymentIdSchema,
  purpose: CustomerPaymentPurposeSchema,
  amountMinor: Type.Integer({ minimum: 100, maximum: 100_000_000 }),
  currency: Type.Literal('KES'),
  payerEmail: Type.String({
    minLength: 3,
    maxLength: 320,
    pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
  }),
  returnPath: Type.String({
    minLength: 1,
    maxLength: 256,
    pattern: '^/(?:[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._~-]+)*)?$',
  }),
}, { additionalProperties: false })
export type CustomerPaymentCreateInput = Readonly<Static<typeof CustomerPaymentCreateInputSchema>>

export const CustomerPaymentInitializationSchema = Type.Object({
  paymentId: PaymentIdSchema,
  purpose: CustomerPaymentPurposeSchema,
  amountMinor: Type.Integer({ minimum: 100, maximum: 100_000_000 }),
  currency: Type.Literal('KES'),
  reference: Type.String({ minLength: 16, maxLength: 100, pattern: '^[A-Za-z0-9._-]+$' }),
  authorizationUrl: Type.String({ minLength: 1, maxLength: 2_048, pattern: '^https://' }),
  state: Type.Literal('initialized'),
}, { additionalProperties: false })
export type CustomerPaymentInitialization = Readonly<Static<typeof CustomerPaymentInitializationSchema>>

export const CustomerPaymentReceiptInputSchema = Type.Object({
  paymentId: PaymentIdSchema,
  reference: Type.String({ minLength: 16, maxLength: 100, pattern: '^[A-Za-z0-9._-]+$' }),
}, { additionalProperties: false })
export type CustomerPaymentReceiptInput = Readonly<Static<typeof CustomerPaymentReceiptInputSchema>>

export const CustomerPaymentReceiptSchema = Type.Object({
  receiptId: PaymentIdSchema,
  paymentId: PaymentIdSchema,
  purpose: CustomerPaymentPurposeSchema,
  amountMinor: Type.Integer({ minimum: 100, maximum: 100_000_000 }),
  currency: Type.Literal('KES'),
  providerReferenceSha256: PaymentHashSchema,
  providerTransactionSha256: PaymentHashSchema,
  settledAt: PaymentTimestampSchema,
}, { additionalProperties: false })
export type CustomerPaymentReceipt = Readonly<Static<typeof CustomerPaymentReceiptSchema>>

export const CustomerPaymentRefundInputSchema = Type.Object({
  receiptId: PaymentIdSchema,
  requestId: PaymentIdSchema,
  reason: Type.String({ minLength: 10, maxLength: 500 }),
}, { additionalProperties: false })
export type CustomerPaymentRefundInput = Readonly<Static<typeof CustomerPaymentRefundInputSchema>>

export const CustomerPaymentRefundSchema = Type.Object({
  refundId: PaymentIdSchema,
  receiptId: PaymentIdSchema,
  paymentId: PaymentIdSchema,
  amountMinor: Type.Integer({ minimum: 100, maximum: 100_000_000 }),
  currency: Type.Literal('KES'),
  providerRefundSha256: PaymentHashSchema,
  state: Type.Literal('refunded'),
  refundedAt: PaymentTimestampSchema,
}, { additionalProperties: false })
export type CustomerPaymentRefund = Readonly<Static<typeof CustomerPaymentRefundSchema>>
