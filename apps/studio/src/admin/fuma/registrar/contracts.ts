import { Type } from '@core/utils/typeboxHelpers'

export type RegistrarQuoteWire = Readonly<{
  quoteId: string; provider: string; hostname: string; available: true; currency: 'KES'
  registrationAmountMinor: number; renewalAmountMinor: number; periodYears: number
  expiresAt: string; providerQuoteReference: string; termsHash: string
}>
export type RegistrarContactWire = Readonly<{ name: string; email: string; phoneE164: string; address: string; country: 'KE' }>
export type RegistrarContactsWire = Readonly<{
  registrant: RegistrarContactWire; administrative: RegistrarContactWire
  technical: RegistrarContactWire; billing: RegistrarContactWire
}>
export type RegistrarRegistrationWire = Readonly<{
  registrationId: string; quoteId: string; hostname: string; providerReference: string
  registeredAt: string; expiresAt: string; state: 'active' | 'ambiguous' | 'renewal-due'; receiptId: string
}>
export type RegistrarPurchaseReceiptWire = Readonly<{
  receiptId: string; operationId: string; registrationId: string; quoteId: string; idempotencyKey: string
  providerReference: string; hostname: string; amountMinor: number; currency: 'KES'; periodYears: number
  registeredAt: string; expiresAt: string
}>
export type RegistrarRenewalReceiptWire = Readonly<{
  receiptId: string; registrationId: string; quoteId: string; idempotencyKey: string
  providerReference: string; previousExpiresAt: string; expiresAt: string; amountMinor: number
  currency: 'KES'; periodYears: number
}>

export interface RegistrarHttpClient {
  search(input: Readonly<{ hostname: string; periodYears: number }>): Promise<RegistrarQuoteWire>
  purchase(input: Readonly<{
    requestId: string; quoteId: string; expectedHostname: string; expectedAmountMinor: number; currency: 'KES'
    expectedTermsHash: string; contacts: RegistrarContactsWire; confirmation: string; stepUpProof: string
  }>): Promise<RegistrarPurchaseReceiptWire>
  renew(input: Readonly<{
    requestId: string; registrationId: string; quoteId: string; expectedHostname: string
    expectedPreviousExpiresAt: string; expectedAmountMinor: number; currency: 'KES'; periodYears: number
    expectedTermsHash: string; confirmation: string; stepUpProof: string
  }>): Promise<RegistrarRenewalReceiptWire>
  registrations(): Promise<readonly RegistrarRegistrationWire[]>
}


const IdSchema = Type.String({ minLength: 1, maxLength: 255 })
const TimestampSchema = Type.String({ format: 'date-time' })
const KesMinorSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
export const RegistrarQuoteWireSchema = Type.Object({
  quoteId: IdSchema, provider: IdSchema, hostname: IdSchema, available: Type.Literal(true), currency: Type.Literal('KES'),
  registrationAmountMinor: KesMinorSchema, renewalAmountMinor: KesMinorSchema,
  periodYears: Type.Integer({ minimum: 1, maximum: 10 }), expiresAt: TimestampSchema,
  providerQuoteReference: IdSchema, termsHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
}, { additionalProperties: false })
export const RegistrarPurchaseReceiptWireSchema = Type.Object({
  receiptId: IdSchema, operationId: IdSchema, registrationId: IdSchema, quoteId: IdSchema,
  idempotencyKey: IdSchema, providerReference: IdSchema, hostname: IdSchema, amountMinor: KesMinorSchema,
  currency: Type.Literal('KES'), periodYears: Type.Integer({ minimum: 1, maximum: 10 }),
  registeredAt: TimestampSchema, expiresAt: TimestampSchema,
}, { additionalProperties: false })
export const RegistrarRenewalReceiptWireSchema = Type.Object({
  receiptId: IdSchema, registrationId: IdSchema, quoteId: IdSchema, idempotencyKey: IdSchema,
  providerReference: IdSchema, previousExpiresAt: TimestampSchema, expiresAt: TimestampSchema,
  amountMinor: KesMinorSchema, currency: Type.Literal('KES'), periodYears: Type.Integer({ minimum: 1, maximum: 10 }),
}, { additionalProperties: false })
export const RegistrarRegistrationWireSchema = Type.Object({
  registrationId: IdSchema, quoteId: IdSchema, hostname: IdSchema, providerReference: IdSchema,
  registeredAt: TimestampSchema, expiresAt: TimestampSchema,
  state: Type.Union([Type.Literal('active'), Type.Literal('ambiguous'), Type.Literal('renewal-due')]),
  receiptId: IdSchema,
}, { additionalProperties: false })
export const RegistrarRegistrationsWireSchema = Type.Array(RegistrarRegistrationWireSchema, { maxItems: 10_000 })
