import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import { normalizePublicHost } from '../freeHosts/service'

export const RegistrarQuoteSchema = Type.Object({
  quoteId: Type.String({ minLength: 1, maxLength: 255 }),
  provider: Type.String({ minLength: 1, maxLength: 255 }),
  hostname: Type.String({ minLength: 1, maxLength: 253 }),
  available: Type.Literal(true),
  currency: Type.Literal('KES'),
  registrationAmountMinor: Type.Integer({ minimum: 1 }),
  renewalAmountMinor: Type.Integer({ minimum: 1 }),
  periodYears: Type.Integer({ minimum: 1, maximum: 10 }),
  expiresAt: Type.String({ format: 'date-time' }),
  providerQuoteReference: Type.String({ minLength: 1, maxLength: 255 }),
  termsHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
}, { additionalProperties: false })
export type RegistrarQuote = Static<typeof RegistrarQuoteSchema>

export const RegistrationContactSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  email: Type.String({ format: 'email' }),
  phoneE164: Type.String({ pattern: '^\\+254[0-9]{9}$' }),
  address: Type.String({ minLength: 1, maxLength: 500 }),
  country: Type.Literal('KE'),
}, { additionalProperties: false })
export type RegistrationContact = Static<typeof RegistrationContactSchema>

export const RegistrarPurchaseSchema = Type.Object({
  organizationId: Type.String({ minLength: 1, maxLength: 255 }),
  quoteId: Type.String({ minLength: 1, maxLength: 255 }),
  expectedAmountMinor: Type.Integer({ minimum: 1 }),
  currency: Type.Literal('KES'),
  contact: RegistrationContactSchema,
  stepUpProof: Type.String({ minLength: 1, maxLength: 2048 }),
}, { additionalProperties: false })

export const RegistrarRenewSchema = Type.Object({
  organizationId: Type.String({ minLength: 1, maxLength: 255 }),
  registrationId: Type.String({ minLength: 1, maxLength: 255 }),
  quoteId: Type.String({ minLength: 1, maxLength: 255 }),
  expectedAmountMinor: Type.Integer({ minimum: 1 }),
  currency: Type.Literal('KES'),
  periodYears: Type.Integer({ minimum: 1, maximum: 10 }),
  stepUpProof: Type.String({ minLength: 1, maxLength: 2048 }),
}, { additionalProperties: false })
export type RegistrarRenew = Static<typeof RegistrarRenewSchema>

export type DomainRegistration = Readonly<{
  registrationId: string
  quoteId: string
  hostname: string
  providerReference: string
  registeredAt: string
  expiresAt: string
  state: 'active' | 'ambiguous' | 'renewal-due'
  receiptId: string
}>
export type RegistrarRenewalReceipt = Readonly<{
  receiptId: string
  registrationId: string
  quoteId: string
  idempotencyKey: string
  providerReference: string
  previousExpiresAt: string
  expiresAt: string
  amountMinor: number
  currency: 'KES'
  periodYears: number
}>

const PurchaseResultSchema = Type.Object({
  providerReference: Type.String({ minLength: 1, maxLength: 255 }),
  registeredAt: Type.String({ format: 'date-time' }),
  expiresAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false })
const RenewalResultSchema = Type.Object({
  providerReference: Type.String({ minLength: 1, maxLength: 255 }),
  expiresAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false })
type PurchaseResult = Static<typeof PurchaseResultSchema>
type RenewalResult = Static<typeof RenewalResultSchema>

export interface RegistrarAdapter {
  search(hostname: string): Promise<Readonly<{ available: boolean }>>
  quote(hostname: string, years: number): Promise<RegistrarQuote>
  purchase(quote: RegistrarQuote, contact: RegistrationContact, idempotencyKey: string): Promise<PurchaseResult>
  lookupByIdempotency(idempotencyKey: string): Promise<PurchaseResult | null>
  renew(registration: DomainRegistration, years: number, idempotencyKey: string): Promise<RenewalResult>
  lookupRenewalByIdempotency(idempotencyKey: string): Promise<RenewalResult | null>
}
export interface RegistrarRepository {
  quote(id: string): Promise<RegistrarQuote | null>
  saveQuote(quote: RegistrarQuote): Promise<void>
  registrationForQuote(id: string): Promise<DomainRegistration | null>
  registration(id: string): Promise<DomainRegistration | null>
  saveRegistration(registration: DomainRegistration): Promise<DomainRegistration>
  renewal(idempotencyKey: string): Promise<RegistrarRenewalReceipt | null>
  saveRenewal(receipt: RegistrarRenewalReceipt): Promise<RegistrarRenewalReceipt>
}
export interface StepUpAuthority { consume(proof: string, purpose: string): Promise<boolean> }

export class RegistrarError extends Error {
  readonly code: 'invalid' | 'stale-quote' | 'changed-quote' | 'step-up' | 'entitlement' | 'ambiguous';
  constructor(code: 'invalid' | 'stale-quote' | 'changed-quote' | 'step-up' | 'entitlement' | 'ambiguous', message: string) {
    super(message); this.code = code;
    this.name = 'RegistrarError'
  }
}

function currentQuote(quote: RegistrarQuote | null, now: Date): RegistrarQuote {
  const expiresAt = quote ? Date.parse(quote.expiresAt) : Number.NaN
  if (!quote || !Value.Check(RegistrarQuoteSchema, quote) || !Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    throw new RegistrarError('stale-quote', 'Exact registrar quote is missing, invalid, or expired.')
  }
  return quote
}

export class RegistrarService {
  private readonly adapter: RegistrarAdapter;
  private readonly repository: RegistrarRepository;
  private readonly stepUp: StepUpAuthority;
  private readonly entitled: (organizationId: string) => Promise<boolean>;
  private readonly now: () => Date;
  private readonly onRegistered?: (registration: DomainRegistration) => Promise<void>;
  constructor(
    adapter: RegistrarAdapter,
    repository: RegistrarRepository,
    stepUp: StepUpAuthority,
    entitled: (organizationId: string) => Promise<boolean>,
    now: () => Date = () => new Date(),
    onRegistered?: (registration: DomainRegistration) => Promise<void>,
  ) { this.adapter = adapter; this.repository = repository; this.stepUp = stepUp; this.entitled = entitled; this.now = now; this.onRegistered = onRegistered;}

  async searchAndQuote(hostnameInput: string, years: number): Promise<RegistrarQuote> {
    if (!Number.isSafeInteger(years) || years < 1 || years > 10) throw new RegistrarError('invalid', 'Registration period must be between one and ten years.')
    const hostname = normalizePublicHost(hostnameInput)
    const found = await this.adapter.search(hostname)
    if (!found.available) throw new RegistrarError('invalid', 'Domain is unavailable.')
    const quote = await this.adapter.quote(hostname, years)
    if (!Value.Check(RegistrarQuoteSchema, quote)
      || normalizePublicHost(quote.hostname) !== hostname
      || quote.periodYears !== years
      || Date.parse(quote.expiresAt) <= this.now().getTime()) {
      throw new RegistrarError('changed-quote', 'Registrar quote does not match the exact search request.')
    }
    await this.repository.saveQuote(Object.freeze(structuredClone(quote)))
    return quote
  }

  async purchase(raw: unknown): Promise<DomainRegistration> {
    if (!Value.Check(RegistrarPurchaseSchema, raw)) throw new RegistrarError('invalid', 'Registrar purchase input failed strict TypeBox validation.')
    const input = Object.freeze(structuredClone(raw)) as Static<typeof RegistrarPurchaseSchema>
    if (!await this.entitled(input.organizationId)) throw new RegistrarError('entitlement', 'Domain purchase entitlement denied.')
    if (!await this.stepUp.consume(input.stepUpProof, `registrar-purchase:${input.quoteId}`)) throw new RegistrarError('step-up', 'Fresh step-up is required.')
    const quote = currentQuote(await this.repository.quote(input.quoteId), this.now())
    if (quote.registrationAmountMinor !== input.expectedAmountMinor || quote.currency !== input.currency) throw new RegistrarError('changed-quote', 'Quote amount or currency changed.')
    const existing = await this.repository.registrationForQuote(quote.quoteId)
    if (existing) return existing
    const idempotencyKey = `registrar-purchase:${quote.quoteId}`
    let purchased: PurchaseResult | null
    try {
      purchased = await this.adapter.purchase(quote, input.contact, idempotencyKey)
    } catch {
      purchased = await this.adapter.lookupByIdempotency(idempotencyKey)
      if (!purchased) throw new RegistrarError('ambiguous', 'Registrar timeout is ambiguous; reconciliation is required before retry.')
    }
    if (!purchased
      || !Value.Check(PurchaseResultSchema, purchased)
      || !Number.isFinite(Date.parse(purchased.registeredAt))
      || !Number.isFinite(Date.parse(purchased.expiresAt))
      || Date.parse(purchased.expiresAt) <= Date.parse(purchased.registeredAt)) {
      throw new RegistrarError('ambiguous', 'Registrar purchase result failed exact receipt validation.')
    }
    const registration = await this.repository.saveRegistration(Object.freeze({
      registrationId: `registration:${quote.quoteId}`,
      quoteId: quote.quoteId,
      hostname: normalizePublicHost(quote.hostname),
      providerReference: purchased.providerReference,
      registeredAt: purchased.registeredAt,
      expiresAt: purchased.expiresAt,
      state: 'active' as const,
      receiptId: `receipt:${quote.quoteId}`,
    }))
    await this.onRegistered?.(registration)
    return registration
  }

  async renew(raw: unknown): Promise<RegistrarRenewalReceipt> {
    if (!Value.Check(RegistrarRenewSchema, raw)) throw new RegistrarError('invalid', 'Registrar renewal input failed strict TypeBox validation.')
    const input = Object.freeze(structuredClone(raw)) as RegistrarRenew
    if (!await this.entitled(input.organizationId)) throw new RegistrarError('entitlement', 'Domain renewal entitlement denied.')
    if (!await this.stepUp.consume(input.stepUpProof, `registrar-renew:${input.registrationId}`)) throw new RegistrarError('step-up', 'Fresh step-up is required.')
    const registration = await this.repository.registration(input.registrationId)
    if (!registration || registration.state === 'ambiguous') throw new RegistrarError('invalid', 'Exact active registration is unavailable.')
    const quote = currentQuote(await this.repository.quote(input.quoteId), this.now())
    if (normalizePublicHost(quote.hostname) !== normalizePublicHost(registration.hostname)
      || quote.renewalAmountMinor !== input.expectedAmountMinor
      || quote.currency !== input.currency
      || quote.periodYears !== input.periodYears) {
      throw new RegistrarError('changed-quote', 'Renewal quote changed or belongs to another registration.')
    }
    const idempotencyKey = `registrar-renew:${registration.registrationId}:${registration.expiresAt}`
    const existing = await this.repository.renewal(idempotencyKey)
    if (existing) return existing
    let renewed: RenewalResult | null
    try {
      renewed = await this.adapter.renew(registration, input.periodYears, idempotencyKey)
    } catch {
      renewed = await this.adapter.lookupRenewalByIdempotency(idempotencyKey)
      if (!renewed) throw new RegistrarError('ambiguous', 'Registrar renewal timeout is ambiguous; reconciliation is required before retry.')
    }
    if (!renewed
      || !Value.Check(RenewalResultSchema, renewed)
      || !Number.isFinite(Date.parse(renewed.expiresAt))
      || Date.parse(renewed.expiresAt) <= Date.parse(registration.expiresAt)) {
      throw new RegistrarError('ambiguous', 'Registrar renewal result failed exact receipt validation.')
    }
    return await this.repository.saveRenewal(Object.freeze({
      receiptId: `renewal-receipt:${registration.registrationId}:${registration.expiresAt}`,
      registrationId: registration.registrationId,
      quoteId: quote.quoteId,
      idempotencyKey,
      providerReference: renewed.providerReference,
      previousExpiresAt: registration.expiresAt,
      expiresAt: renewed.expiresAt,
      amountMinor: input.expectedAmountMinor,
      currency: input.currency,
      periodYears: input.periodYears,
    }))
  }
}
