import { Type, Value, type Static, type TSchema } from '@core/utils/typeboxHelpers'

export const PaystackScopeSchema = Type.Union([
  Type.Literal('platform_billing'),
  Type.Literal('customer_merchant'),
])
export type PaystackScope = Static<typeof PaystackScopeSchema>

export const PaystackMoneySchema = Type.Object({
  amountMinor: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  currency: Type.String({ minLength: 3, maxLength: 3, pattern: '^[A-Z]{3}$' }),
}, { additionalProperties: false })
export type PaystackMoney = Static<typeof PaystackMoneySchema>

export const PaystackReferenceSchema = Type.String({
  minLength: 16,
  maxLength: 100,
  pattern: '^[A-Za-z0-9._-]+$',
})

export const PaystackCredentialsSchema = Type.Object({
  scope: PaystackScopeSchema,
  publicKey: Type.String({ minLength: 1, maxLength: 512 }),
  secretKey: Type.String({ minLength: 1, maxLength: 512 }),
}, { additionalProperties: false })
export type PaystackCredentials = Static<typeof PaystackCredentialsSchema>

export const PaystackInitializeOptionsSchema = Type.Object({
  callbackUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  channels: Type.Optional(Type.Array(Type.Union([
    Type.Literal('card'),
    Type.Literal('mobile_money'),
    Type.Literal('bank'),
  ]), { minItems: 1, maxItems: 3, uniqueItems: true })),
}, { additionalProperties: false })
export type PaystackInitializeOptions = Static<typeof PaystackInitializeOptionsSchema>

const ProviderLabelsSchema = Type.Object({
  payment_purpose: Type.String({ minLength: 3, maxLength: 64 }),
  credential_scope: PaystackScopeSchema,
  obligation_sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
}, { additionalProperties: false })

const InitializeResponseSchema = Type.Object({
  status: Type.Literal(true),
  data: Type.Object({
    authorization_url: Type.String({ minLength: 1, maxLength: 2048 }),
    reference: PaystackReferenceSchema,
  }, { additionalProperties: true }),
}, { additionalProperties: true })

const VerifyResponseSchema = Type.Object({
  status: Type.Literal(true),
  data: Type.Object({
    id: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Integer({ minimum: 1 })]),
    reference: PaystackReferenceSchema,
    status: Type.Literal('success'),
    amount: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    currency: Type.String({ minLength: 3, maxLength: 3 }),
    channel: Type.String({ minLength: 1, maxLength: 64 }),
    metadata: ProviderLabelsSchema,
    authorization: Type.Optional(Type.Object({}, { additionalProperties: true })),
    customer: Type.Optional(Type.Object({}, { additionalProperties: true })),
  }, { additionalProperties: true }),
}, { additionalProperties: true })

const WebhookEventSchema = Type.Object({
  event: Type.String({ minLength: 1, maxLength: 100 }),
  data: Type.Object({
    id: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Integer({ minimum: 1 })]),
    reference: Type.Optional(PaystackReferenceSchema),
    amount: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
    currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
    metadata: Type.Optional(ProviderLabelsSchema),
  }, { additionalProperties: true }),
}, { additionalProperties: false })

type WebhookEvent = Static<typeof WebhookEventSchema>

export type VerifiedPaystackTransaction = Readonly<{
  scope: PaystackScope
  reference: string
  status: 'success'
  money: PaystackMoney
  channel: string
  channelDetail: string | null
  customerCode: string | null
  authorizationCode: string | null
  reusableAuthorization: boolean
  providerTransactionId: string
}>

export interface PaystackHttp {
  request(input: Readonly<{
    url: string
    method: 'GET' | 'POST'
    headers: Readonly<Record<string, string>>
    body?: string
  }>): Promise<Readonly<{ status: number; body: unknown }>>
}

export type PaystackInitialization = Readonly<{
  reference: string
  purpose: string
  money: PaystackMoney
  metadataHash: string
}>

export type PaystackSettlementIdentity = PaystackInitialization & Readonly<{
  providerTransactionId: string
}>

export type PaystackSettlementClaim = PaystackSettlementIdentity & Readonly<{
  claimId: string
}>

export interface ScopedPaystackLedger {
  readonly scope: PaystackScope
  recordInitialization(initialization: PaystackInitialization): Promise<boolean>
  exactInitialization(initialization: PaystackInitialization): Promise<boolean>
  ingestEvent(eventId: string, rawHash: string): Promise<boolean>
  claimSettlement(identity: PaystackSettlementIdentity): Promise<
    | Readonly<{ state: 'claimed'; claim: PaystackSettlementClaim }>
    | Readonly<{ state: 'settled' }>
    | Readonly<{ state: 'busy' }>
  >
  completeSettlement(claim: PaystackSettlementClaim): Promise<void>
  releaseSettlement(claim: PaystackSettlementClaim): Promise<void>
}

export interface PaystackLedgerRepository {
  forScope(scope: PaystackScope): ScopedPaystackLedger
}

export type PaymentPurpose<T = unknown> = Readonly<{
  id: string
  scope: PaystackScope
  metadataSchema: TSchema
  authorize(metadata: T): Promise<void>
  expected(metadata: T): PaystackMoney
  settle(transaction: VerifiedPaystackTransaction, metadata: T): Promise<void>
}>

export class PaystackError extends Error {
  readonly code:
    | 'scope-crossing'
    | 'invalid-purpose'
    | 'provider'
    | 'tampered-webhook'
    | 'verification-mismatch'
    | 'duplicate'

  constructor(code: PaystackError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'PaystackError'
  }
}

function isStrictObjectSchema(schema: TSchema): boolean {
  return schema.type === 'object' && schema.additionalProperties === false
}

export class PaystackPurposeRegistry {
  readonly #purposes = new Map<string, PaymentPurpose>()

  register<T>(purpose: PaymentPurpose<T>): this {
    if (
      !/^[a-z][a-z0-9-]{2,63}$/.test(purpose.id)
      || !Value.Check(PaystackScopeSchema, purpose.scope)
      || !isStrictObjectSchema(purpose.metadataSchema)
      || this.#purposes.has(purpose.id)
    ) {
      throw new PaystackError('invalid-purpose', 'Payment purpose contract is invalid or already registered.')
    }
    this.#purposes.set(purpose.id, Object.freeze({ ...purpose }))
    return this
  }

  exact<T = unknown>(id: string, scope: PaystackScope): PaymentPurpose<T> {
    const purpose = this.#purposes.get(id)
    if (!purpose) throw new PaystackError('invalid-purpose', 'Unregistered payment purpose.')
    if (purpose.scope !== scope) {
      throw new PaystackError('scope-crossing', 'Purpose cannot cross Paystack credential scopes.')
    }
    return purpose as PaymentPurpose<T>
  }

  registered(scope: PaystackScope): readonly string[] {
    return Object.freeze([...this.#purposes.values()]
      .filter((purpose) => purpose.scope === scope)
      .map((purpose) => purpose.id)
      .sort())
  }
}

function constantTimeHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{128}$/i.test(left) || !/^[a-f0-9]{128}$/i.test(right) || left.length !== right.length) {
    return false
  }
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

function sha256(input: string | Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(input).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`
}

function metadataHash(metadata: unknown): string {
  return sha256(canonicalJson(metadata))
}

function requiredText(value: unknown, label: string): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length === 0) {
    throw new PaystackError('verification-mismatch', `${label} is missing from the verified transaction.`)
  }
  return String(value)
}

function optionalNestedText(value: unknown, property: string): string | null {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as Record<string, unknown>)[property]
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

function explicitProviderBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new PaystackError('provider', 'Paystack provider URL is invalid.')
  }
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
    || (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new PaystackError('provider', 'Paystack provider URL must be an explicit HTTPS origin.')
  }
  return url.origin
}

function exactHttpsUrl(value: string, label: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new PaystackError('provider', `${label} is invalid.`)
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new PaystackError('provider', `${label} must use HTTPS without URL credentials.`)
  }
  return url.toString()
}

function expectedReferencePrefix(scope: PaystackScope, purpose: string): string {
  return `${scope === 'platform_billing' ? 'pb' : 'cm'}_${purpose}_`
}

function exactLabels(
  labels: Static<typeof ProviderLabelsSchema>,
  scope: PaystackScope,
  purpose: string,
  obligationHash: string,
): boolean {
  return labels.credential_scope === scope
    && labels.payment_purpose === purpose
    && labels.obligation_sha256 === obligationHash
}

export function signPaystackWebhook(secret: string, raw: Uint8Array): string {
  return new Bun.CryptoHasher('sha512', secret).update(raw).digest('hex')
}

export function verifyPaystackWebhook(secret: string, raw: Uint8Array, signature: string): void {
  if (!constantTimeHex(signPaystackWebhook(secret, raw), signature)) {
    throw new PaystackError('tampered-webhook', 'Paystack webhook signature is invalid.')
  }
}

export function newPaystackReference(scope: PaystackScope, purpose: string): string {
  return `${expectedReferencePrefix(scope, purpose)}${crypto.randomUUID().replaceAll('-', '')}`
}

export type ScopedPaystackTransportOptions = Readonly<{
  providerBaseUrl: string
  referenceFactory?: (scope: PaystackScope, purpose: string) => string
}>

export class ScopedPaystackTransport {
  readonly #baseUrl: string
  readonly #credentials: PaystackCredentials
  readonly #http: PaystackHttp
  readonly #ledger: ScopedPaystackLedger
  readonly #registry: PaystackPurposeRegistry
  readonly #referenceFactory: (scope: PaystackScope, purpose: string) => string

  constructor(
    credentials: PaystackCredentials,
    http: PaystackHttp,
    ledger: PaystackLedgerRepository,
    registry: PaystackPurposeRegistry,
    options: ScopedPaystackTransportOptions | string,
  ) {
    if (!Value.Check(PaystackCredentialsSchema, credentials)) {
      throw new PaystackError('provider', 'Scoped Paystack credentials are incomplete.')
    }
    this.#credentials = Object.freeze({ ...credentials })
    this.#http = http
    this.#ledger = ledger.forScope(credentials.scope)
    if (this.#ledger.scope !== credentials.scope) {
      throw new PaystackError('scope-crossing', 'Ledger scope does not match Paystack credentials.')
    }
    this.#registry = registry
    const normalized = typeof options === 'string' ? { providerBaseUrl: options } : options
    this.#baseUrl = explicitProviderBaseUrl(normalized.providerBaseUrl)
    this.#referenceFactory = normalized.referenceFactory ?? newPaystackReference
  }

  get scope(): PaystackScope {
    return this.#credentials.scope
  }

  #headers(): Readonly<Record<string, string>> {
    return Object.freeze({
      authorization: `Bearer ${this.#credentials.secretKey}`,
      'content-type': 'application/json',
    })
  }

  async initialize<T>(
    purposeId: string,
    metadata: T,
    email: string,
    options: PaystackInitializeOptions = {},
  ): Promise<Readonly<{ reference: string; authorizationUrl: string }>> {
    const purpose = this.#registry.exact<T>(purposeId, this.scope)
    if (
      !Value.Check(purpose.metadataSchema, metadata)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || !Value.Check(PaystackInitializeOptionsSchema, options)
    ) {
      throw new PaystackError('invalid-purpose', 'Purpose metadata, payer email, or options are invalid.')
    }
    await purpose.authorize(metadata)
    const money = purpose.expected(metadata)
    if (!Value.Check(PaystackMoneySchema, money)) {
      throw new PaystackError('verification-mismatch', 'Expected money is invalid.')
    }
    const callbackUrl = options.callbackUrl === undefined
      ? undefined
      : exactHttpsUrl(options.callbackUrl, 'Checkout callback')
    const reference = this.#referenceFactory(this.scope, purposeId)
    if (
      !Value.Check(PaystackReferenceSchema, reference)
      || !reference.startsWith(expectedReferencePrefix(this.scope, purposeId))
    ) {
      throw new PaystackError('verification-mismatch', 'Generated reference does not match its credential scope and purpose.')
    }
    const obligationHash = metadataHash(metadata)
    const initialization = Object.freeze({
      reference,
      purpose: purposeId,
      money: Object.freeze({ ...money }),
      metadataHash: obligationHash,
    })
    await this.#ledger.recordInitialization(initialization)
    const response = await this.#http.request({
      url: `${this.#baseUrl}/transaction/initialize`,
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({
        email,
        amount: money.amountMinor,
        currency: money.currency,
        reference,
        ...(callbackUrl === undefined ? {} : { callback_url: callbackUrl }),
        ...(options.channels === undefined ? {} : { channels: options.channels }),
        metadata: {
          payment_purpose: purposeId,
          credential_scope: this.scope,
          obligation_sha256: obligationHash,
        },
      }),
    })
    if (!Value.Check(InitializeResponseSchema, response.body) || response.status !== 200) {
      throw new PaystackError('provider', 'Paystack initialization failed exact response validation.')
    }
    const body = response.body as Static<typeof InitializeResponseSchema>
    if (body.data.reference !== reference) {
      throw new PaystackError('verification-mismatch', 'Paystack returned a different transaction reference.')
    }
    const authorizationUrl = exactHttpsUrl(body.data.authorization_url, 'Paystack authorization URL')
    return Object.freeze({ reference, authorizationUrl })
  }

  async #obligation<T>(purposeId: string, reference: string, metadata: T): Promise<Readonly<{
    purpose: PaymentPurpose<T>
    initialization: PaystackInitialization
  }>> {
    const purpose = this.#registry.exact<T>(purposeId, this.scope)
    if (
      !Value.Check(PaystackReferenceSchema, reference)
      || !reference.startsWith(expectedReferencePrefix(this.scope, purposeId))
      || !Value.Check(purpose.metadataSchema, metadata)
    ) {
      throw new PaystackError('verification-mismatch', 'Verification input does not match its credential scope and purpose.')
    }
    await purpose.authorize(metadata)
    const money = purpose.expected(metadata)
    if (!Value.Check(PaystackMoneySchema, money)) {
      throw new PaystackError('verification-mismatch', 'Local payment obligation is invalid.')
    }
    const initialization = Object.freeze({
      reference,
      purpose: purposeId,
      money: Object.freeze({ ...money }),
      metadataHash: metadataHash(metadata),
    })
    if (!await this.#ledger.exactInitialization(initialization)) {
      throw new PaystackError('verification-mismatch', 'Reference is not an exact initialized local obligation.')
    }
    return Object.freeze({ purpose, initialization })
  }

  async verify<T>(purposeId: string, reference: string, metadata: T): Promise<VerifiedPaystackTransaction> {
    const { initialization } = await this.#obligation(purposeId, reference, metadata)
    const response = await this.#http.request({
      url: `${this.#baseUrl}/transaction/verify/${encodeURIComponent(reference)}`,
      method: 'GET',
      headers: this.#headers(),
    })
    if (!Value.Check(VerifyResponseSchema, response.body) || response.status !== 200) {
      throw new PaystackError('verification-mismatch', 'Provider transaction failed strict verification.')
    }
    const body = response.body as Static<typeof VerifyResponseSchema>
    const data = body.data
    if (
      data.reference !== reference
      || data.amount !== initialization.money.amountMinor
      || data.currency !== initialization.money.currency
      || !exactLabels(data.metadata, this.scope, purposeId, initialization.metadataHash)
    ) {
      throw new PaystackError('verification-mismatch', 'Provider transaction does not match the exact local obligation.')
    }
    const authorizationCode = optionalNestedText(data.authorization, 'authorization_code')
    return Object.freeze({
      scope: this.scope,
      reference,
      status: 'success',
      money: initialization.money,
      channel: data.channel,
      channelDetail: optionalNestedText(data.authorization, 'bank')
        ?? optionalNestedText(data.authorization, 'brand'),
      customerCode: optionalNestedText(data.customer, 'customer_code'),
      authorizationCode,
      reusableAuthorization: Boolean(
        data.authorization
        && (data.authorization as Record<string, unknown>).reusable === true
        && authorizationCode,
      ),
      providerTransactionId: requiredText(data.id, 'Provider transaction ID'),
    })
  }

  async #assertWebhookObligation(event: WebhookEvent): Promise<void> {
    const reference = event.data.reference
    if (reference === undefined) return
    const labels = event.data.metadata
    if (!labels) throw new PaystackError('verification-mismatch', 'Referenced webhook is missing exact labels.')
    const purpose = this.#registry.exact(labels.payment_purpose, this.scope)
    if (!reference.startsWith(expectedReferencePrefix(this.scope, purpose.id))) {
      throw new PaystackError('scope-crossing', 'Webhook reference cannot cross credential scopes or purposes.')
    }
    const expected = event.data.amount === undefined || event.data.currency === undefined
      ? null
      : Object.freeze({ amountMinor: event.data.amount, currency: event.data.currency })
    if (expected === null || !Value.Check(PaystackMoneySchema, expected)) {
      throw new PaystackError('verification-mismatch', 'Referenced webhook is missing exact money.')
    }
    const initialization = Object.freeze({
      reference,
      purpose: purpose.id,
      money: expected,
      metadataHash: labels.obligation_sha256,
    })
    if (
      !exactLabels(labels, this.scope, purpose.id, initialization.metadataHash)
      || !await this.#ledger.exactInitialization(initialization)
    ) {
      throw new PaystackError('verification-mismatch', 'Webhook labels or obligation do not match local authority.')
    }
  }

  async ingestWebhook(raw: Uint8Array, signature: string): Promise<Readonly<{
    duplicate: boolean
    eventId: string
  }>> {
    verifyPaystackWebhook(this.#credentials.secretKey, raw, signature)
    let event: unknown
    try {
      event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
    } catch {
      throw new PaystackError('tampered-webhook', 'Signed body is not valid UTF-8 JSON.')
    }
    if (!Value.Check(WebhookEventSchema, event)) {
      throw new PaystackError('tampered-webhook', 'Webhook contract is invalid.')
    }
    const value = event as WebhookEvent
    await this.#assertWebhookObligation(value)
    const eventId = `${value.event}:${value.data.id}`
    const inserted = await this.#ledger.ingestEvent(eventId, sha256(raw))
    return Object.freeze({ duplicate: !inserted, eventId })
  }

  async settle<T>(purposeId: string, reference: string, metadata: T): Promise<VerifiedPaystackTransaction> {
    const purpose = this.#registry.exact<T>(purposeId, this.scope)
    const transaction = await this.verify(purposeId, reference, metadata)
    const identity = Object.freeze({
      reference,
      purpose: purposeId,
      money: transaction.money,
      metadataHash: metadataHash(metadata),
      providerTransactionId: transaction.providerTransactionId,
    })
    const result = await this.#ledger.claimSettlement(identity)
    if (result.state === 'settled') return transaction
    if (result.state === 'busy') {
      throw new PaystackError('duplicate', 'Payment reconciliation is already in progress.')
    }
    try {
      await purpose.settle(transaction, metadata)
      await this.#ledger.completeSettlement(result.claim)
    } catch (error) {
      await this.#ledger.releaseSettlement(result.claim)
      throw error
    }
    return transaction
  }

  redactedSummary(): Readonly<{
    scope: PaystackScope
    publicKeyFingerprint: string
    credentials: '[REDACTED]'
  }> {
    return Object.freeze({
      scope: this.scope,
      publicKeyFingerprint: sha256(this.#credentials.publicKey).slice(0, 12),
      credentials: '[REDACTED]',
    })
  }
}
