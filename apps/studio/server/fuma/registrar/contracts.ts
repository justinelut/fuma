import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import { DomainCredentialAuthoritySchema, DomainScopeSchema } from '../domains/contracts'

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const HostnameSchema = Type.String({ minLength: 3, maxLength: 253, pattern: '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$' })
const TimestampSchema = Type.String({ format: 'date-time' })
const HashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' })
const MoneySchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })

export const RegistrarAvailabilitySchema = Type.Object({
  hostname: HostnameSchema,
  available: Type.Boolean(),
}, { additionalProperties: false })
export type RegistrarAvailability = Readonly<Static<typeof RegistrarAvailabilitySchema>>

export const RegistrarQuoteSchema = Type.Object({
  quoteId: IdSchema,
  provider: IdSchema,
  hostname: HostnameSchema,
  available: Type.Literal(true),
  currency: Type.Literal('KES'),
  registrationAmountMinor: MoneySchema,
  renewalAmountMinor: MoneySchema,
  periodYears: Type.Integer({ minimum: 1, maximum: 10 }),
  expiresAt: TimestampSchema,
  providerQuoteReference: IdSchema,
  termsHash: HashSchema,
}, { additionalProperties: false })
export type RegistrarQuote = Readonly<Static<typeof RegistrarQuoteSchema>>

export const RegistrationContactSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  email: Type.String({ format: 'email', maxLength: 320 }),
  phoneE164: Type.String({ pattern: '^\\+254[0-9]{9}$' }),
  address: Type.String({ minLength: 1, maxLength: 500 }),
  country: Type.Literal('KE'),
}, { additionalProperties: false })
export type RegistrationContact = Readonly<Static<typeof RegistrationContactSchema>>

export const RegistrationContactsSchema = Type.Object({
  registrant: RegistrationContactSchema,
  administrative: RegistrationContactSchema,
  technical: RegistrationContactSchema,
  billing: RegistrationContactSchema,
}, { additionalProperties: false })
export type RegistrationContacts = Readonly<Static<typeof RegistrationContactsSchema>>

/** Compatibility input retained for the original policy service. Hosted routes use the confirmed commands below. */
export const RegistrarPurchaseSchema = Type.Object({
  organizationId: IdSchema,
  quoteId: IdSchema,
  expectedAmountMinor: MoneySchema,
  currency: Type.Literal('KES'),
  contact: RegistrationContactSchema,
  stepUpProof: Type.String({ minLength: 1, maxLength: 2048 }),
}, { additionalProperties: false })

export const RegistrarRenewSchema = Type.Object({
  organizationId: IdSchema,
  registrationId: IdSchema,
  quoteId: IdSchema,
  expectedAmountMinor: MoneySchema,
  currency: Type.Literal('KES'),
  periodYears: Type.Integer({ minimum: 1, maximum: 10 }),
  stepUpProof: Type.String({ minLength: 1, maxLength: 2048 }),
}, { additionalProperties: false })
export type RegistrarRenew = Readonly<Static<typeof RegistrarRenewSchema>>

export const RegistrarSearchRequestSchema = Type.Object({
  hostname: Type.String({ minLength: 1, maxLength: 1024 }),
  periodYears: Type.Integer({ minimum: 1, maximum: 10 }),
}, { additionalProperties: false })

export const ConfirmedRegistrarPurchaseSchema = Type.Object({
  requestId: IdSchema,
  quoteId: IdSchema,
  expectedHostname: HostnameSchema,
  expectedAmountMinor: MoneySchema,
  currency: Type.Literal('KES'),
  expectedTermsHash: HashSchema,
  contacts: RegistrationContactsSchema,
  confirmation: Type.String({ minLength: 12, maxLength: 300 }),
  stepUpProof: Type.String({ minLength: 1, maxLength: 2048 }),
}, { additionalProperties: false })
export type ConfirmedRegistrarPurchase = Readonly<Static<typeof ConfirmedRegistrarPurchaseSchema>>

export const ConfirmedRegistrarRenewalSchema = Type.Object({
  requestId: IdSchema,
  registrationId: IdSchema,
  quoteId: IdSchema,
  expectedHostname: HostnameSchema,
  expectedPreviousExpiresAt: TimestampSchema,
  expectedAmountMinor: MoneySchema,
  currency: Type.Literal('KES'),
  periodYears: Type.Integer({ minimum: 1, maximum: 10 }),
  expectedTermsHash: HashSchema,
  confirmation: Type.String({ minLength: 10, maxLength: 300 }),
  stepUpProof: Type.String({ minLength: 1, maxLength: 2048 }),
}, { additionalProperties: false })
export type ConfirmedRegistrarRenewal = Readonly<Static<typeof ConfirmedRegistrarRenewalSchema>>

export const DomainRegistrationSchema = Type.Object({
  registrationId: IdSchema,
  quoteId: IdSchema,
  hostname: HostnameSchema,
  providerReference: IdSchema,
  registeredAt: TimestampSchema,
  expiresAt: TimestampSchema,
  state: Type.Union([Type.Literal('active'), Type.Literal('ambiguous'), Type.Literal('renewal-due')]),
  receiptId: IdSchema,
}, { additionalProperties: false })
export type DomainRegistration = Readonly<Static<typeof DomainRegistrationSchema>>

export const RegistrarRenewalReceiptSchema = Type.Object({
  receiptId: IdSchema,
  registrationId: IdSchema,
  quoteId: IdSchema,
  idempotencyKey: Type.String({ minLength: 1, maxLength: 512 }),
  providerReference: IdSchema,
  previousExpiresAt: TimestampSchema,
  expiresAt: TimestampSchema,
  amountMinor: MoneySchema,
  currency: Type.Literal('KES'),
  periodYears: Type.Integer({ minimum: 1, maximum: 10 }),
}, { additionalProperties: false })
export type RegistrarRenewalReceipt = Readonly<Static<typeof RegistrarRenewalReceiptSchema>>

export const RegistrarPurchaseProviderResultSchema = Type.Object({
  providerReference: IdSchema,
  registeredAt: TimestampSchema,
  expiresAt: TimestampSchema,
}, { additionalProperties: false })
export type RegistrarPurchaseProviderResult = Readonly<Static<typeof RegistrarPurchaseProviderResultSchema>>

export const RegistrarRenewalProviderResultSchema = Type.Object({
  providerReference: IdSchema,
  expiresAt: TimestampSchema,
}, { additionalProperties: false })
export type RegistrarRenewalProviderResult = Readonly<Static<typeof RegistrarRenewalProviderResultSchema>>

export const RegistrarPurchaseReceiptSchema = Type.Object({
  receiptId: IdSchema,
  operationId: IdSchema,
  registrationId: IdSchema,
  quoteId: IdSchema,
  idempotencyKey: Type.String({ minLength: 1, maxLength: 512 }),
  providerReference: IdSchema,
  hostname: HostnameSchema,
  amountMinor: MoneySchema,
  currency: Type.Literal('KES'),
  periodYears: Type.Integer({ minimum: 1, maximum: 10 }),
  registeredAt: TimestampSchema,
  expiresAt: TimestampSchema,
}, { additionalProperties: false })
export type RegistrarPurchaseReceipt = Readonly<Static<typeof RegistrarPurchaseReceiptSchema>>

export const RegistrarOperationSchema = Type.Object({
  operationId: IdSchema,
  kind: Type.Union([Type.Literal('purchase'), Type.Literal('renew')]),
  scope: DomainScopeSchema,
  authority: DomainCredentialAuthoritySchema,
  requestHash: HashSchema,
  request: Type.Unknown(),
  quoteId: IdSchema,
  registrationId: Type.Union([IdSchema, Type.Null()]),
  idempotencyKey: Type.String({ minLength: 1, maxLength: 512 }),
  state: Type.Union([Type.Literal('pending'), Type.Literal('ambiguous'), Type.Literal('succeeded')]),
  attempts: Type.Integer({ minimum: 0, maximum: 100 }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false })
export type RegistrarOperation = Readonly<Static<typeof RegistrarOperationSchema>>

export const RegistrarDnsHandoffSchema = Type.Object({
  handoffId: IdSchema,
  scope: DomainScopeSchema,
  authority: DomainCredentialAuthoritySchema,
  credentialId: IdSchema,
  domainId: IdSchema,
  registrationId: IdSchema,
  hostname: HostnameSchema,
  state: Type.Union([Type.Literal('pending'), Type.Literal('completed')]),
  createdAt: TimestampSchema,
  completedAt: Type.Union([TimestampSchema, Type.Null()]),
}, { additionalProperties: false })
export type RegistrarDnsHandoff = Readonly<Static<typeof RegistrarDnsHandoffSchema>>

export function strictRegistrarValue<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new TypeError(`${label} failed strict TypeBox validation.`)
  return Object.freeze(structuredClone(parsed.value)) as Static<T>
}

export function canonicalRegistrarJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalRegistrarJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalRegistrarJson(record[key])}`).join(',')}}`
}

export function registrarHash(value: unknown): string {
  return new Bun.CryptoHasher('sha256').update(canonicalRegistrarJson(value)).digest('hex')
}
