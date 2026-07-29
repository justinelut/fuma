import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import {
  CustomerPaymentCreateInputSchema,
  CustomerPaymentInitializationSchema,
  CustomerPaymentPurposeSchema,
  CustomerPaymentReceiptSchema,
  CustomerPaymentRefundSchema,
} from '@core/plugin-sdk/paymentSchemas'
import { PublicationMerchantScopeSchema } from './contracts'

const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Hash = Type.String({ pattern: '^[a-f0-9]{64}$' })
const Version = Type.String({ pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' })
const Timestamp = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$' })

export const CUSTOMER_PAYMENT_PLUGIN_ID = 'fuma.customer-payments'
export const CUSTOMER_PAYMENT_PLUGIN_VERSION = '1.0.0'
export const CUSTOMER_PAYMENT_PLUGIN_PERMISSIONS = Object.freeze([
  'cms.routes',
  'modules.register',
  'payments.customer.create',
  'payments.customer.refund',
] as const)

export const ReviewedCustomerPaymentPluginAuthoritySchema = Type.Object({
  merchantScope: PublicationMerchantScopeSchema,
  installationId: Id,
  artifactId: Id,
  packageId: Type.Literal(CUSTOMER_PAYMENT_PLUGIN_ID),
  exactVersion: Type.Literal(CUSTOMER_PAYMENT_PLUGIN_VERSION),
  contentHashSha256: Hash,
  reviewSubmissionId: Id,
  reviewDecisionId: Id,
  reviewSignatureKeyId: Id,
  siteOrigin: Type.String({ minLength: 9, maxLength: 2_048, pattern: '^https://' }),
}, { additionalProperties: false })
export type ReviewedCustomerPaymentPluginAuthority = Readonly<Static<typeof ReviewedCustomerPaymentPluginAuthoritySchema>>

export const CustomerPluginPaymentMetadataSchema = Type.Object({
  paymentId: Id,
  requestId: Id,
  purpose: CustomerPaymentPurposeSchema,
  amountMinor: Type.Integer({ minimum: 100, maximum: 100_000_000 }),
  currency: Type.Literal('KES'),
  returnPath: CustomerPaymentCreateInputSchema.properties.returnPath,
  ...PublicationMerchantScopeSchema.properties,
  installationId: Id,
  artifactId: Id,
  contentHashSha256: Hash,
  exactVersion: Version,
  reviewSubmissionId: Id,
  reviewDecisionId: Id,
  reviewSignatureKeyId: Id,
  credentialId: Id,
  credentialVersion: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false })
export type CustomerPluginPaymentMetadata = Readonly<Static<typeof CustomerPluginPaymentMetadataSchema>>

export const CustomerPluginPaymentSchema = Type.Object({
  metadata: CustomerPluginPaymentMetadataSchema,
  payerEmailSha256: Hash,
  reference: Type.Union([Type.String({ minLength: 16, maxLength: 100, pattern: '^[A-Za-z0-9._-]+$' }), Type.Null()]),
  authorizationUrl: Type.Union([Type.String({ minLength: 1, maxLength: 2_048, pattern: '^https://' }), Type.Null()]),
  state: Type.Union([
    Type.Literal('prepared'),
    Type.Literal('initialized'),
    Type.Literal('settled'),
    Type.Literal('refunded'),
  ]),
  createdAt: Timestamp,
  settledAt: Type.Union([Timestamp, Type.Null()]),
  refundedAt: Type.Union([Timestamp, Type.Null()]),
}, { additionalProperties: false })
export type CustomerPluginPayment = Readonly<Static<typeof CustomerPluginPaymentSchema>>

export const CustomerPluginRefundRecordSchema = Type.Object({
  refundId: Id,
  receiptId: Id,
  paymentId: Id,
  requestId: Id,
  reasonSha256: Hash,
  amountMinor: Type.Integer({ minimum: 100, maximum: 100_000_000 }),
  currency: Type.Literal('KES'),
  providerRefundSha256: Type.Union([Hash, Type.Null()]),
  state: Type.Union([Type.Literal('prepared'), Type.Literal('refunded')]),
  createdAt: Timestamp,
  refundedAt: Type.Union([Timestamp, Type.Null()]),
}, { additionalProperties: false })
export type CustomerPluginRefundRecord = Readonly<Static<typeof CustomerPluginRefundRecordSchema>>

export {
  CustomerPaymentInitializationSchema,
  CustomerPaymentReceiptSchema,
  CustomerPaymentRefundSchema,
}

export function parseCustomerPluginContract<T extends TSchema>(schema: T, value: unknown, label: string): Readonly<Static<T>> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new TypeError(`${label} failed its strict TypeBox contract.`)
  return deepFreeze(parsed.value)
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}
