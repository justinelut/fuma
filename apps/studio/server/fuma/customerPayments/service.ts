import { Type, Value } from '@core/utils/typeboxHelpers'
import type { PaymentPurpose, ScopedPaystackTransport, VerifiedPaystackTransaction } from '../paystack/transport'
import {
  CustomerMerchantCredentialEnvelopeSchema,
  CustomerMerchantSecretSchema,
  MembershipPurchaseRequestSchema,
  PublicationMembershipMetadataSchema,
  PublicationMerchantScopeSchema,
  PublicationPayerAuthoritySchema,
  merchantScopeKey,
  strictValue,
  type CustomerMerchantCredential,
  type CustomerMerchantCredentialEnvelope,
  type CustomerMerchantSecret,
  type MembershipInitialization,
  type MembershipOffer,
  type MembershipPurchase,
  type MembershipPurchaseRequest,
  type PaidMembership,
  type PublicationMembershipMetadata,
  type PublicationMerchantScope,
  type PublicationPayerAuthority,
} from './contracts'

export const PUBLICATION_MEMBERSHIP_PURPOSE = 'publication-membership'
export const CUSTOMER_PAYMENT_LIFECYCLE_JOB_KIND = 'fuma.customer-payment-lifecycle'
export const CUSTOMER_PAYMENT_CARD_RENEWAL_JOB_KIND = 'fuma.customer-payment-card-renewal'
const DAY_MS = 86_400_000

export class CustomerPaymentError extends Error {
  readonly code:
    | 'scope'
    | 'invalid'
    | 'not-found'
    | 'conflict'
    | 'unsupported'
    | 'verification'
    | 'provider'

  constructor(code: CustomerPaymentError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'CustomerPaymentError'
  }
}

export type MembershipActivation = Readonly<{
  metadata: PublicationMembershipMetadata
  transaction: VerifiedPaystackTransaction
  recurringAuthorization: CustomerMerchantCredentialEnvelope | null
  recurringCustomerCode: string | null
  activatedAt: string
}>

export type CardRenewalAuthority = Readonly<{
  membership: PaidMembership
  sourceMetadata: PublicationMembershipMetadata
  authorization: CustomerMerchantCredentialEnvelope
  customerCode: string | null
}>

export interface VerifiedCardRecurrenceTransport {
  /** Charges one stored authorization and returns provider-verified canonical evidence. */
  chargeAndVerify(input: Readonly<{
    reference: string
    authorizationCode: string
    customerCode: string | null
    amountMinor: number
    currency: 'KES'
    metadata: PublicationMembershipMetadata
  }>): Promise<VerifiedPaystackTransaction>
}

export interface CustomerCardRecurrenceTransportFactory {
  forCredential(
    credential: CustomerMerchantCredential,
    secret: CustomerMerchantSecret,
  ): Promise<VerifiedCardRecurrenceTransport> | VerifiedCardRecurrenceTransport
}

export interface CustomerPaymentRepository {
  activeCredential(scope: PublicationMerchantScope): Promise<CustomerMerchantCredential | null>
  credentialById(credentialId: string): Promise<CustomerMerchantCredential | null>
  saveCredential(input: CustomerMerchantCredential): Promise<CustomerMerchantCredential>
  preparePurchase(metadata: PublicationMembershipMetadata, createdAt: string): Promise<MembershipPurchase>
  recordInitialization(
    metadata: PublicationMembershipMetadata,
    reference: string,
    authorizationUrl: string | null,
  ): Promise<MembershipPurchase>
  exactPurchase(metadata: PublicationMembershipMetadata): Promise<MembershipPurchase | null>
  purchase(scope: PublicationMerchantScope, memberId: string, purchaseId: string): Promise<MembershipPurchase | null>
  activate(input: MembershipActivation): Promise<PaidMembership>
  membership(scope: PublicationMerchantScope, memberId: string, membershipId: string): Promise<PaidMembership | null>
  cardRenewalAuthority(
    scope: PublicationMerchantScope,
    memberId: string,
    membershipId: string,
  ): Promise<CardRenewalAuthority | null>
  acknowledgeReminder(reminderId: string, deliveredAt: string): Promise<void>
  processLifecycle(now: string, limit: number, cursor: string | null): Promise<Readonly<{
    processed: number
    nextCursor: string | null
    reminders: readonly MembershipReminder[]
    memberships: readonly PaidMembership[]
  }>>
}

/** Bridges verified payment state into FUMA-039 paid Publication access authority. */
export interface PaidPublicationAccessProjector {
  sync(membership: PaidMembership, providerReferenceSha256: string): Promise<void>
}

export interface MembershipCatalog {
  exact(scope: PublicationMerchantScope, tierId: string): Promise<MembershipOffer | null>
}

export interface CardRecurrenceAuthority {
  supports(input: Readonly<{
    scope: PublicationMerchantScope
    country: 'KE'
    currency: 'KES'
  }>): Promise<boolean>
}

export interface CustomerMerchantCredentialCipher {
  encrypt(scope: string, plaintext: Uint8Array): Promise<CustomerMerchantCredentialEnvelope>
  decrypt(scope: string, envelope: CustomerMerchantCredentialEnvelope): Promise<Uint8Array>
}

export interface CustomerMerchantTransportFactory {
  forCredential(
    credential: CustomerMerchantCredential,
    secret: CustomerMerchantSecret,
  ): Promise<ScopedPaystackTransport> | ScopedPaystackTransport
}

export type MembershipReminder = Readonly<{
  reminderId: string
  membershipId: string
  siteId: string
  memberId: string
  kind: 'renewal-due' | 'grace-started' | 'expired'
  dueAt: string
  renewal: PaidMembership['renewal']
}>

export interface MembershipReminderSink {
  deliver(reminder: MembershipReminder): Promise<void>
}

export function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

function credentialAad(scope: PublicationMerchantScope, credentialId: string, version: number): string {
  return `customer_merchant:${merchantScopeKey(scope)}:${credentialId}:${version}`
}

export function authorizationAad(metadata: PublicationMembershipMetadata): string {
  return `customer_merchant:authorization:${metadata.credentialId}:${metadata.credentialVersion}:${metadata.purchaseId}`
}

function purchaseId(authority: PublicationPayerAuthority, requestId: string): string {
  return `purchase:${sha256(`${merchantScopeKey(authority.scope)}:${authority.memberId}:${requestId}`).slice(0, 40)}`
}

export function referenceFor(metadata: PublicationMembershipMetadata): string {
  return `cm_${PUBLICATION_MEMBERSHIP_PURPOSE}_${sha256(metadata.purchaseId).slice(0, 40)}`
}

function membershipId(metadata: PublicationMembershipMetadata): string {
  return `membership:${sha256(`${metadata.siteId}:${metadata.memberId}:${metadata.tierId}`).slice(0, 40)}`
}

export function exactScope(left: PublicationMerchantScope, right: PublicationMerchantScope): boolean {
  return merchantScopeKey(left) === merchantScopeKey(right)
}

function exactMetadata(left: PublicationMembershipMetadata, right: PublicationMembershipMetadata): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function validateRequest(raw: unknown): MembershipPurchaseRequest {
  const request = strictValue(MembershipPurchaseRequestSchema, raw, 'Membership purchase request')
  if (request.channel === 'card') {
    if (request.mobileProvider !== null || request.renewalConfirmationId !== null) {
      throw new CustomerPaymentError('invalid', 'Card recurrence cannot carry mobile-money confirmation fields.')
    }
  } else if (request.mobileProvider === null || request.renewalConfirmationId === null) {
    throw new CustomerPaymentError(
      'invalid',
      'Safaricom/Airtel Paystack mobile money requires explicit user confirmation for every prepaid period.',
    )
  }
  return Object.freeze(request)
}

export async function decryptSecret(
  cipher: CustomerMerchantCredentialCipher,
  credential: CustomerMerchantCredential,
): Promise<CustomerMerchantSecret> {
  if (credential.scope !== 'customer_merchant' || credential.state !== 'active') {
    throw new CustomerPaymentError('scope', 'Publication revenue requires active customer_merchant credentials.')
  }
  const bytes = await cipher.decrypt(
    credentialAad(credential.merchantScope, credential.credentialId, credential.version),
    credential.envelope,
  )
  try {
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return Object.freeze(strictValue(CustomerMerchantSecretSchema, raw, 'Customer merchant secret'))
  } catch (error) {
    if (error instanceof CustomerPaymentError) throw error
    throw new CustomerPaymentError('scope', 'Customer merchant credentials could not be authenticated.')
  } finally {
    bytes.fill(0)
  }
}

async function transportFor(
  factory: CustomerMerchantTransportFactory,
  cipher: CustomerMerchantCredentialCipher,
  credential: CustomerMerchantCredential,
): Promise<ScopedPaystackTransport> {
  const secret = await decryptSecret(cipher, credential)
  const transport = await factory.forCredential(credential, secret)
  if (transport.scope !== 'customer_merchant') {
    throw new CustomerPaymentError('scope', 'Platform billing transport cannot process Publication revenue.')
  }
  return transport
}

export function createPublicationMembershipPurpose(
  repository: CustomerPaymentRepository,
  cipher: CustomerMerchantCredentialCipher,
  access: PaidPublicationAccessProjector,
  now: () => Date = () => new Date(),
): PaymentPurpose<PublicationMembershipMetadata> {
  return Object.freeze({
    id: PUBLICATION_MEMBERSHIP_PURPOSE,
    scope: 'customer_merchant' as const,
    metadataSchema: PublicationMembershipMetadataSchema,
    async authorize(metadata) {
      const purchase = await repository.exactPurchase(metadata)
      if (!purchase || !exactMetadata(purchase.metadata, metadata) || purchase.state === 'failed') {
        throw new CustomerPaymentError('scope', 'Payment obligation is not exact current Publication authority.')
      }
    },
    expected(metadata) {
      return Object.freeze({ amountMinor: metadata.amountMinor, currency: metadata.currency })
    },
    async settle(transaction, metadata) {
      if (transaction.scope !== 'customer_merchant' || transaction.money.amountMinor !== metadata.amountMinor
        || transaction.money.currency !== metadata.currency || transaction.channel !== metadata.channel) {
        throw new CustomerPaymentError('verification', 'Verified transaction does not match the exact membership obligation.')
      }
      let recurringAuthorization: CustomerMerchantCredentialEnvelope | null = null
      if (metadata.channel === 'card') {
        if (!transaction.reusableAuthorization || transaction.authorizationCode === null) {
          throw new CustomerPaymentError('unsupported', 'This card does not provide a reusable Paystack authorization.')
        }
        recurringAuthorization = await cipher.encrypt(
          authorizationAad(metadata),
          new TextEncoder().encode(transaction.authorizationCode),
        )
      } else {
        const provider = transaction.channelDetail?.toLowerCase() ?? ''
        if (metadata.mobileProvider === null || provider !== metadata.mobileProvider) {
          throw new CustomerPaymentError('verification', 'Verified mobile-money provider is not the confirmed Safaricom/Airtel provider.')
        }
        if (metadata.renewalConfirmationId === null) {
          throw new CustomerPaymentError('verification', 'Automatic mobile-money renewal is forbidden.')
        }
      }
      const membership = await repository.activate({
        metadata,
        transaction,
        recurringAuthorization,
        recurringCustomerCode: metadata.channel === 'card' ? transaction.customerCode : null,
        activatedAt: now().toISOString(),
      })
      await access.sync(membership, sha256(transaction.reference))
    },
  })
}

export class CustomerMerchantPaymentService {
  readonly #repository: CustomerPaymentRepository
  readonly #catalog: MembershipCatalog
  readonly #recurrence: CardRecurrenceAuthority
  readonly #cipher: CustomerMerchantCredentialCipher
  readonly #transports: CustomerMerchantTransportFactory
  readonly #now: () => Date

  constructor(input: Readonly<{
    repository: CustomerPaymentRepository
    catalog: MembershipCatalog
    recurrence: CardRecurrenceAuthority
    cipher: CustomerMerchantCredentialCipher
    transports: CustomerMerchantTransportFactory
    now?: () => Date
  }>) {
    this.#repository = input.repository
    this.#catalog = input.catalog
    this.#recurrence = input.recurrence
    this.#cipher = input.cipher
    this.#transports = input.transports
    this.#now = input.now ?? (() => new Date())
  }

  async attachCredential(
    rawScope: unknown,
    rawSecret: unknown,
    credentialId: string,
  ): Promise<CustomerMerchantCredential> {
    const scope = strictValue(
      PublicationMerchantScopeSchema,
      rawScope,
      'Merchant credential scope',
    )
    const secret = strictValue(CustomerMerchantSecretSchema, rawSecret, 'Customer merchant secret')
    if (!Value.Check(Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }), credentialId)) {
      throw new CustomerPaymentError('invalid', 'Credential ID is invalid.')
    }
    const prior = await this.#repository.activeCredential(scope)
    const version = (prior?.version ?? 0) + 1
    const plaintext = new TextEncoder().encode(JSON.stringify(secret))
    try {
      const envelope = strictValue(
        CustomerMerchantCredentialEnvelopeSchema,
        await this.#cipher.encrypt(credentialAad(scope, credentialId, version), plaintext),
        'Customer merchant credential envelope',
      )
      const at = this.#now().toISOString()
      return await this.#repository.saveCredential(Object.freeze({
        credentialId,
        scope: 'customer_merchant' as const,
        merchantScope: Object.freeze({ ...scope }),
        version,
        envelope: Object.freeze(envelope),
        state: 'active' as const,
        createdAt: prior?.createdAt ?? at,
        updatedAt: at,
      }))
    } finally {
      plaintext.fill(0)
    }
  }

  async initialize(rawAuthority: unknown, rawRequest: unknown): Promise<MembershipInitialization> {
    const authority = strictValue(PublicationPayerAuthoritySchema, rawAuthority, 'Publication payer authority')
    const request = validateRequest(rawRequest)
    const offer = await this.#catalog.exact(authority.scope, request.tierId)
    if (!offer || !offer.active) throw new CustomerPaymentError('not-found', 'Membership tier was not found.')
    const credential = await this.#repository.activeCredential(authority.scope)
    if (!credential || !exactScope(credential.merchantScope, authority.scope) || credential.state !== 'active') {
      throw new CustomerPaymentError('not-found', 'Publication payment capability is unavailable.')
    }
    if (request.channel === 'card' && !await this.#recurrence.supports({
      scope: authority.scope,
      country: 'KE',
      currency: 'KES',
    })) {
      throw new CustomerPaymentError('unsupported', 'Card recurrence is unavailable for this merchant/country/currency.')
    }
    if (request.renewalOfMembershipId !== null) {
      const current = await this.#repository.membership(
        authority.scope,
        authority.memberId,
        request.renewalOfMembershipId,
      )
      if (!current) throw new CustomerPaymentError('not-found', 'Renewed membership was not found.')
    }
    const metadata: PublicationMembershipMetadata = Object.freeze({
      purchaseId: purchaseId(authority, request.requestId),
      ...authority.scope,
      memberId: authority.memberId,
      tierId: offer.tierId,
      credentialId: credential.credentialId,
      credentialVersion: credential.version,
      amountMinor: offer.amountMinor,
      currency: offer.currency,
      periodDays: offer.periodDays,
      graceDays: offer.graceDays,
      channel: request.channel,
      mobileProvider: request.mobileProvider,
      renewalOfMembershipId: request.renewalOfMembershipId,
      renewalConfirmationId: request.renewalConfirmationId,
    })
    const purchase = await this.#repository.preparePurchase(metadata, this.#now().toISOString())
    if (purchase.reference !== null && purchase.authorizationUrl !== null) {
      return Object.freeze({
        purchaseId: metadata.purchaseId,
        reference: purchase.reference,
        authorizationUrl: purchase.authorizationUrl,
        channel: metadata.channel,
        renewalMode: metadata.channel === 'card' ? 'supported-card-recurring' : 'manual-mobile-money',
      })
    }
    const transport = await transportFor(this.#transports, this.#cipher, credential)
    const initialized = await transport.initialize(PUBLICATION_MEMBERSHIP_PURPOSE, metadata, authority.email, {
      channels: [metadata.channel],
      reference: referenceFor(metadata),
    })
    await this.#repository.recordInitialization(metadata, initialized.reference, initialized.authorizationUrl)
    return Object.freeze({
      purchaseId: metadata.purchaseId,
      reference: initialized.reference,
      authorizationUrl: initialized.authorizationUrl,
      channel: metadata.channel,
      renewalMode: metadata.channel === 'card' ? 'supported-card-recurring' : 'manual-mobile-money',
    })
  }

  async reconcile(
    rawAuthority: unknown,
    purchaseIdValue: string,
    reference: string,
  ): Promise<PaidMembership> {
    const authority = strictValue(PublicationPayerAuthoritySchema, rawAuthority, 'Publication payer authority')
    const purchase = await this.#repository.purchase(authority.scope, authority.memberId, purchaseIdValue)
    if (!purchase || purchase.reference !== reference || purchase.state === 'failed') {
      throw new CustomerPaymentError('not-found', 'Payment obligation was not found.')
    }
    const credential = await this.#repository.credentialById(purchase.metadata.credentialId)
    if (!credential || credential.version !== purchase.metadata.credentialVersion
      || !exactScope(credential.merchantScope, authority.scope)) {
      throw new CustomerPaymentError('scope', 'Payment credential authority changed.')
    }
    const transport = await transportFor(this.#transports, this.#cipher, credential)
    await transport.settle(PUBLICATION_MEMBERSHIP_PURPOSE, reference, purchase.metadata)
    const result = await this.#repository.membership(
      authority.scope,
      authority.memberId,
      membershipId(purchase.metadata),
    )
    if (!result) throw new CustomerPaymentError('verification', 'Verified payment did not activate membership.')
    return result
  }

  async ingestWebhook(
    credentialId: string,
    raw: Uint8Array,
    signature: string,
  ): Promise<Readonly<{ duplicate: boolean; eventId: string }>> {
    if (!Value.Check(Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }), credentialId)) {
      throw new CustomerPaymentError('invalid', 'Customer merchant webhook credential ID is invalid.')
    }
    const credential = await this.#repository.credentialById(credentialId)
    if (!credential || credential.scope !== 'customer_merchant' || credential.state !== 'active') {
      throw new CustomerPaymentError('not-found', 'Customer merchant webhook authority is unavailable.')
    }
    const transport = await transportFor(this.#transports, this.#cipher, credential)
    return transport.ingestWebhook(raw, signature)
  }

  daraja(): never {
    throw new CustomerPaymentError('unsupported', 'Daraja is not implemented.')
  }
}

// Recurring card renewal is implemented in ./cardRenewal.

// Membership lifecycle orchestration is implemented in ./lifecycle.

export class MemoryCustomerPaymentRepository implements CustomerPaymentRepository {
  readonly credentials = new Map<string, CustomerMerchantCredential>()
  readonly purchases = new Map<string, MembershipPurchase>()
  readonly memberships = new Map<string, PaidMembership>()
  readonly authorizationEnvelopes = new Map<string, CustomerMerchantCredentialEnvelope>()
  readonly cardAuthorities = new Map<string, Omit<CardRenewalAuthority, 'membership'>>()
  readonly verifiedTransactions = new Map<string, Readonly<{
    purchaseId: string
    reference: string
    providerTransactionId: string
  }>>()
  readonly remindersByKey = new Map<string, MembershipReminder>()
  readonly deliveredReminderIds = new Set<string>()

  async activeCredential(scope: PublicationMerchantScope) {
    return [...this.credentials.values()].find((item) => exactScope(item.merchantScope, scope) && item.state === 'active') ?? null
  }
  async credentialById(id: string) { return this.credentials.get(id) ?? null }
  async saveCredential(input: CustomerMerchantCredential) {
    const existing = this.credentials.get(input.credentialId)
    if (existing && (!exactScope(existing.merchantScope, input.merchantScope) || input.version < existing.version)) {
      throw new CustomerPaymentError('conflict', 'Credential identity or version changed.')
    }
    for (const [id, credential] of this.credentials) {
      if (id !== input.credentialId && exactScope(credential.merchantScope, input.merchantScope) && credential.state === 'active') {
        this.credentials.set(id, Object.freeze({ ...credential, state: 'rekey-required', updatedAt: input.updatedAt }))
      }
    }
    this.credentials.set(input.credentialId, input)
    return input
  }
  async preparePurchase(metadata: PublicationMembershipMetadata, createdAt: string) {
    const existing = this.purchases.get(metadata.purchaseId)
    if (existing) {
      if (!exactMetadata(existing.metadata, metadata)) throw new CustomerPaymentError('conflict', 'Purchase identity changed on retry.')
      return existing
    }
    if (metadata.renewalConfirmationId !== null && [...this.purchases.values()].some((purchase) => (
      purchase.metadata.purchaseId !== metadata.purchaseId
      && purchase.metadata.memberId === metadata.memberId
      && purchase.metadata.siteId === metadata.siteId
      && purchase.metadata.renewalConfirmationId === metadata.renewalConfirmationId
    ))) {
      throw new CustomerPaymentError('conflict', 'Mobile-money renewal confirmation was already consumed.')
    }
    const value: MembershipPurchase = Object.freeze({
      metadata,
      reference: null,
      authorizationUrl: null,
      state: 'prepared',
      createdAt,
      settledAt: null,
    })
    this.purchases.set(metadata.purchaseId, value)
    return value
  }
  async recordInitialization(
    metadata: PublicationMembershipMetadata,
    reference: string,
    authorizationUrl: string | null,
  ) {
    const purchase = await this.exactPurchase(metadata)
    if (!purchase) throw new CustomerPaymentError('not-found', 'Purchase was not prepared.')
    if (purchase.reference !== null && (purchase.reference !== reference || purchase.authorizationUrl !== authorizationUrl)) {
      throw new CustomerPaymentError('conflict', 'Initialization changed on retry.')
    }
    const updated: MembershipPurchase = Object.freeze({ ...purchase, reference, authorizationUrl, state: 'initialized' })
    this.purchases.set(metadata.purchaseId, updated)
    return updated
  }
  async exactPurchase(metadata: PublicationMembershipMetadata) {
    const found = this.purchases.get(metadata.purchaseId)
    return found && exactMetadata(found.metadata, metadata) ? found : null
  }
  async purchase(scope: PublicationMerchantScope, memberId: string, id: string) {
    const found = this.purchases.get(id)
    return found && found.metadata.memberId === memberId && exactScope(found.metadata, scope) ? found : null
  }
  async activate(input: MembershipActivation) {
    const id = membershipId(input.metadata)
    const existingPurchase = this.purchases.get(input.metadata.purchaseId)
    if (!existingPurchase || existingPurchase.reference !== input.transaction.reference) {
      throw new CustomerPaymentError('verification', 'Activation has no exact initialized purchase.')
    }
    const reused = [...this.verifiedTransactions.values()].find((transaction) => (
      transaction.providerTransactionId === input.transaction.providerTransactionId
      || transaction.reference === input.transaction.reference
    ))
    if (reused && reused.purchaseId !== input.metadata.purchaseId) {
      throw new CustomerPaymentError('conflict', 'Verified provider transaction was already used for another obligation.')
    }
    const existing = this.memberships.get(id)
    if (existing && existing.providerTransactionId === input.transaction.providerTransactionId) return existing
    const startMs = Math.max(
      Date.parse(input.activatedAt),
      existing ? Date.parse(existing.accessUntil) : Number.NEGATIVE_INFINITY,
    )
    const accessUntil = new Date(startMs + input.metadata.periodDays * DAY_MS).toISOString()
    const graceUntil = new Date(Date.parse(accessUntil) + input.metadata.graceDays * DAY_MS).toISOString()
    const membership: PaidMembership = Object.freeze({
      membershipId: id,
      scope: Object.freeze({
        platformId: input.metadata.platformId,
        organizationId: input.metadata.organizationId,
        workspaceId: input.metadata.workspaceId,
        siteId: input.metadata.siteId,
        ownerKey: input.metadata.ownerKey,
        ownerGeneration: input.metadata.ownerGeneration,
      }),
      memberId: input.metadata.memberId,
      tierId: input.metadata.tierId,
      accessFrom: new Date(startMs).toISOString(),
      accessUntil,
      graceUntil,
      renewal: input.metadata.channel === 'card' ? 'supported-card-recurring' : 'manual-mobile-money',
      state: 'active',
      providerReference: input.transaction.reference,
      providerTransactionId: input.transaction.providerTransactionId,
      credentialId: input.metadata.credentialId,
      credentialVersion: input.metadata.credentialVersion,
      revision: (existing?.revision ?? 0) + 1,
      updatedAt: input.activatedAt,
    })
    this.memberships.set(id, membership)
    this.verifiedTransactions.set(input.metadata.purchaseId, Object.freeze({
      purchaseId: input.metadata.purchaseId,
      reference: input.transaction.reference,
      providerTransactionId: input.transaction.providerTransactionId,
    }))
    if (input.recurringAuthorization) {
      this.authorizationEnvelopes.set(id, input.recurringAuthorization)
      this.cardAuthorities.set(id, Object.freeze({
        sourceMetadata: input.metadata,
        authorization: input.recurringAuthorization,
        customerCode: input.recurringCustomerCode,
      }))
    }
    this.purchases.set(input.metadata.purchaseId, Object.freeze({
      ...existingPurchase,
      state: 'settled',
      settledAt: input.activatedAt,
    }))
    return membership
  }
  async membership(scope: PublicationMerchantScope, memberId: string, id: string) {
    const found = this.memberships.get(id)
    return found && found.memberId === memberId && exactScope(found.scope, scope) ? found : null
  }
  async cardRenewalAuthority(scope: PublicationMerchantScope, memberId: string, id: string) {
    const membership = await this.membership(scope, memberId, id)
    const authority = this.cardAuthorities.get(id)
    return membership && authority
      ? Object.freeze({ membership, ...authority })
      : null
  }
  async acknowledgeReminder(id: string) {
    if (![...this.remindersByKey.values()].some((reminder) => reminder.reminderId === id)) {
      throw new CustomerPaymentError('not-found', 'Membership reminder was not found.')
    }
    this.deliveredReminderIds.add(id)
  }
  async processLifecycle(now: string, limit: number, cursor: string | null) {
    const rows = [...this.memberships.values()]
      .filter((row) => cursor === null || row.membershipId > cursor)
      .sort((a, b) => a.membershipId.localeCompare(b.membershipId))
      .slice(0, limit)
    const reminders: MembershipReminder[] = []
    const memberships: PaidMembership[] = []
    const at = Date.parse(now)
    for (const row of rows) {
      const state = at < Date.parse(row.accessUntil) ? 'active' : at < Date.parse(row.graceUntil) ? 'grace' : 'expired'
      const kind = state === 'active' ? (Date.parse(row.accessUntil) - at <= 3 * DAY_MS ? 'renewal-due' : null)
        : state === 'grace' ? 'grace-started' : 'expired'
      const updated = state === row.state ? row : Object.freeze({ ...row, state, revision: row.revision + 1, updatedAt: now })
      this.memberships.set(row.membershipId, updated)
      memberships.push(updated)
      if (kind) {
        const key = `${row.membershipId}:${row.accessUntil}:${kind}`
        let reminder = this.remindersByKey.get(key)
        if (!reminder) {
          reminder = Object.freeze({
            reminderId: `reminder:${sha256(key).slice(0, 40)}`,
            membershipId: row.membershipId,
            siteId: row.scope.siteId,
            memberId: row.memberId,
            kind,
            dueAt: kind === 'expired' ? row.graceUntil : row.accessUntil,
            renewal: row.renewal,
          })
          this.remindersByKey.set(key, reminder)
        }
        if (!this.deliveredReminderIds.has(reminder.reminderId)) reminders.push(reminder)
      }
    }
    return Object.freeze({
      processed: rows.length,
      nextCursor: rows.length === limit ? rows.at(-1)?.membershipId ?? null : null,
      reminders: Object.freeze(reminders),
      memberships: Object.freeze(memberships),
    })
  }
}

export { MemoryCustomerPaymentRepository as MemoryMembershipRepository }
