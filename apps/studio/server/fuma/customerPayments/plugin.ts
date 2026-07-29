import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import {
  CustomerPaymentCreateInputSchema,
  CustomerPaymentReceiptInputSchema,
  CustomerPaymentRefundInputSchema,
  type CustomerPaymentCreateInput,
  type CustomerPaymentInitialization,
  type CustomerPaymentReceipt,
  type CustomerPaymentReceiptInput,
  type CustomerPaymentRefund,
  type CustomerPaymentRefundInput,
  type CustomerPaymentPurpose,
} from '@core/plugin-sdk/paymentSchemas'
import type { HostCustomerPaymentBinding } from '../../plugins/host/paymentBindings'
import type { ArtifactInstallation } from '../artifacts'
import type { ApprovedArtifactReview } from '../artifactReviews'
import type { PaymentPurpose, ScopedPaystackTransport, VerifiedPaystackTransaction } from '../paystack/transport'
import type { CustomerMerchantCredential, CustomerMerchantSecret } from './contracts'
import {
  CustomerPaymentError,
  decryptSecret,
  exactScope,
  sha256,
  type CustomerMerchantCredentialCipher,
  type CustomerMerchantTransportFactory,
  type CustomerPaymentRepository,
} from './service'
import {
  CUSTOMER_PAYMENT_PLUGIN_ID,
  CUSTOMER_PAYMENT_PLUGIN_PERMISSIONS,
  CUSTOMER_PAYMENT_PLUGIN_VERSION,
  CustomerPluginPaymentMetadataSchema,
  CustomerPluginPaymentSchema,
  CustomerPaymentReceiptSchema,
  CustomerPluginRefundRecordSchema,
  ReviewedCustomerPaymentPluginAuthoritySchema,
  parseCustomerPluginContract,
  type CustomerPluginPayment,
  type CustomerPluginPaymentMetadata,
  type CustomerPluginRefundRecord,
  type ReviewedCustomerPaymentPluginAuthority,
} from './pluginContracts'

const ProviderRefundSchema = Type.Object({
  providerRefundId: Type.String({ minLength: 1, maxLength: 255 }),
}, { additionalProperties: false })

const PURPOSE_IDS = Object.freeze({
  deposit: 'fuma-plugin-deposit',
  donation: 'fuma-plugin-donation',
  checkout: 'fuma-plugin-checkout',
} satisfies Readonly<Record<CustomerPaymentPurpose, string>>)

export interface CustomerPluginPaymentRepository {
  preparePayment(metadata: CustomerPluginPaymentMetadata, payerEmailSha256: string, createdAt: string): Promise<CustomerPluginPayment>
  recordInitialization(metadata: CustomerPluginPaymentMetadata, reference: string, authorizationUrl: string): Promise<CustomerPluginPayment>
  exactPayment(metadata: CustomerPluginPaymentMetadata): Promise<CustomerPluginPayment | null>
  payment(authority: ReviewedCustomerPaymentPluginAuthority, paymentId: string): Promise<CustomerPluginPayment | null>
  settle(metadata: CustomerPluginPaymentMetadata, transaction: VerifiedPaystackTransaction, settledAt: string): Promise<CustomerPaymentReceipt>
  receipt(authority: ReviewedCustomerPaymentPluginAuthority, receiptId: string): Promise<CustomerPaymentReceipt | null>
  prepareRefund(payment: CustomerPluginPayment, receipt: CustomerPaymentReceipt, requestId: string, reasonSha256: string, createdAt: string): Promise<CustomerPluginRefundRecord>
  completeRefund(record: CustomerPluginRefundRecord, providerRefundSha256: string, refundedAt: string): Promise<CustomerPaymentRefund>
  refund(authority: ReviewedCustomerPaymentPluginAuthority, receiptId: string): Promise<CustomerPluginRefundRecord | null>
}

export interface VerifiedCustomerMerchantRefundTransport {
  refund(input: Readonly<{
    refundId: string
    reference: string
    amountMinor: number
    currency: 'KES'
    reason: string
  }>): Promise<Readonly<{ providerRefundId: string }>>
}

export interface CustomerMerchantRefundTransportFactory {
  forCredential(
    credential: CustomerMerchantCredential,
    secret: CustomerMerchantSecret,
  ): Promise<VerifiedCustomerMerchantRefundTransport> | VerifiedCustomerMerchantRefundTransport
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right)
}

function validNow(now: () => Date): string {
  const value = now().toISOString()
  if (new Date(value).toISOString() !== value) throw new CustomerPaymentError('invalid', 'Payment clock is invalid.')
  return value
}

function purposeId(purpose: CustomerPaymentPurpose): string {
  return PURPOSE_IDS[purpose]
}

function paymentId(authority: ReviewedCustomerPaymentPluginAuthority, requestId: string): string {
  return `plugin-payment:${sha256(`${authority.merchantScope.platformId}:${authority.merchantScope.ownerKey}:${authority.merchantScope.ownerGeneration}:${authority.installationId}:${requestId}`).slice(0, 40)}`
}

function referenceFor(metadata: CustomerPluginPaymentMetadata): string {
  return `cm_${purposeId(metadata.purpose)}_${sha256(metadata.paymentId).slice(0, 40)}`
}

function exactOrigin(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new CustomerPaymentError('scope', 'Plugin payment site origin is invalid.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new CustomerPaymentError('scope', 'Plugin payment site origin must be one exact HTTPS origin.')
  }
  return url.origin
}

async function transportFor(
  factory: CustomerMerchantTransportFactory,
  cipher: CustomerMerchantCredentialCipher,
  credential: CustomerMerchantCredential,
): Promise<ScopedPaystackTransport> {
  const secret = await decryptSecret(cipher, credential)
  const transport = await factory.forCredential(credential, secret)
  if (transport.scope !== 'customer_merchant') throw new CustomerPaymentError('scope', 'Plugin payments require the customer_merchant transport.')
  return transport
}

async function refundTransportFor(
  factory: CustomerMerchantRefundTransportFactory,
  cipher: CustomerMerchantCredentialCipher,
  credential: CustomerMerchantCredential,
): Promise<VerifiedCustomerMerchantRefundTransport> {
  const secret = await decryptSecret(cipher, credential)
  return await factory.forCredential(credential, secret)
}

export function createCustomerPluginPaymentPurposes(
  repository: CustomerPluginPaymentRepository,
  now: () => Date = () => new Date(),
): readonly PaymentPurpose<CustomerPluginPaymentMetadata>[] {
  return Object.freeze((Object.keys(PURPOSE_IDS) as CustomerPaymentPurpose[]).map((purpose) => Object.freeze({
    id: purposeId(purpose),
    scope: 'customer_merchant' as const,
    metadataSchema: CustomerPluginPaymentMetadataSchema,
    async authorize(metadata: CustomerPluginPaymentMetadata) {
      const payment = await repository.exactPayment(metadata)
      if (!payment || payment.metadata.purpose !== purpose || !['prepared', 'initialized', 'settled'].includes(payment.state)) {
        throw new CustomerPaymentError('scope', 'Plugin payment obligation is not exact current authority.')
      }
    },
    expected(metadata: CustomerPluginPaymentMetadata) {
      return Object.freeze({ amountMinor: metadata.amountMinor, currency: metadata.currency })
    },
    async settle(transaction: VerifiedPaystackTransaction, metadata: CustomerPluginPaymentMetadata) {
      if (transaction.scope !== 'customer_merchant'
        || transaction.money.amountMinor !== metadata.amountMinor
        || transaction.money.currency !== metadata.currency) {
        throw new CustomerPaymentError('verification', 'Verified transaction does not match the plugin payment obligation.')
      }
      await repository.settle(metadata, transaction, validNow(now))
    },
  })))
}

export class CustomerMerchantPluginPaymentService {
  readonly #credentials: Pick<CustomerPaymentRepository, 'activeCredential' | 'credentialById'>
  readonly #repository: CustomerPluginPaymentRepository
  readonly #cipher: CustomerMerchantCredentialCipher
  readonly #transports: CustomerMerchantTransportFactory
  readonly #refunds: CustomerMerchantRefundTransportFactory | null
  readonly #now: () => Date

  constructor(input: Readonly<{
    credentials: Pick<CustomerPaymentRepository, 'activeCredential' | 'credentialById'>
    repository: CustomerPluginPaymentRepository
    cipher: CustomerMerchantCredentialCipher
    transports: CustomerMerchantTransportFactory
    refunds?: CustomerMerchantRefundTransportFactory
    now?: () => Date
  }>) {
    this.#credentials = input.credentials
    this.#repository = input.repository
    this.#cipher = input.cipher
    this.#transports = input.transports
    this.#refunds = input.refunds ?? null
    this.#now = input.now ?? (() => new Date())
  }

  async create(rawAuthority: unknown, rawInput: unknown): Promise<CustomerPaymentInitialization> {
    const authority = parseCustomerPluginContract(ReviewedCustomerPaymentPluginAuthoritySchema, rawAuthority, 'Reviewed payment plugin authority') as ReviewedCustomerPaymentPluginAuthority
    const input = parseCustomerPluginContract(CustomerPaymentCreateInputSchema, rawInput, 'Plugin payment create input') as CustomerPaymentCreateInput
    const origin = exactOrigin(authority.siteOrigin)
    const credential = await this.#credentials.activeCredential(authority.merchantScope)
    if (!credential || credential.state !== 'active' || !exactScope(credential.merchantScope, authority.merchantScope)) {
      throw new CustomerPaymentError('not-found', 'Customer merchant payment capability is unavailable.')
    }
    const metadata = parseCustomerPluginContract(CustomerPluginPaymentMetadataSchema, {
      paymentId: paymentId(authority, input.requestId),
      requestId: input.requestId,
      purpose: input.purpose,
      amountMinor: input.amountMinor,
      currency: input.currency,
      returnPath: input.returnPath,
      ...authority.merchantScope,
      installationId: authority.installationId,
      artifactId: authority.artifactId,
      contentHashSha256: authority.contentHashSha256,
      exactVersion: authority.exactVersion,
      reviewSubmissionId: authority.reviewSubmissionId,
      reviewDecisionId: authority.reviewDecisionId,
      reviewSignatureKeyId: authority.reviewSignatureKeyId,
      credentialId: credential.credentialId,
      credentialVersion: credential.version,
    }, 'Plugin payment metadata') as CustomerPluginPaymentMetadata
    const emailHash = sha256(input.payerEmail.trim().toLowerCase())
    const payment = await this.#repository.preparePayment(metadata, emailHash, validNow(this.#now))
    if (payment.payerEmailSha256 !== emailHash) throw new CustomerPaymentError('conflict', 'Payment request identity changed on retry.')
    if (payment.reference !== null && payment.authorizationUrl !== null) return initialization(payment)
    const transport = await transportFor(this.#transports, this.#cipher, credential)
    const initialized = await transport.initialize(purposeId(metadata.purpose), metadata, input.payerEmail, {
      reference: referenceFor(metadata),
      callbackUrl: new URL(metadata.returnPath, origin).toString(),
    })
    return initialization(await this.#repository.recordInitialization(metadata, initialized.reference, initialized.authorizationUrl))
  }

  async receipt(rawAuthority: unknown, rawInput: unknown): Promise<CustomerPaymentReceipt> {
    const authority = parseCustomerPluginContract(ReviewedCustomerPaymentPluginAuthoritySchema, rawAuthority, 'Reviewed payment plugin authority') as ReviewedCustomerPaymentPluginAuthority
    const input = parseCustomerPluginContract(CustomerPaymentReceiptInputSchema, rawInput, 'Plugin payment receipt input') as CustomerPaymentReceiptInput
    const payment = await this.#repository.payment(authority, input.paymentId)
    if (!payment || payment.reference !== input.reference || payment.state === 'refunded') throw new CustomerPaymentError('not-found', 'Plugin payment obligation was not found.')
    const credential = await this.#credentials.credentialById(payment.metadata.credentialId)
    if (!credential || credential.version !== payment.metadata.credentialVersion || credential.state !== 'active'
      || !exactScope(credential.merchantScope, authority.merchantScope)) {
      throw new CustomerPaymentError('scope', 'Plugin payment credential authority changed.')
    }
    const transport = await transportFor(this.#transports, this.#cipher, credential)
    await transport.settle(purposeId(payment.metadata.purpose), input.reference, payment.metadata)
    const receipt = await this.#repository.receipt(authority, `plugin-receipt:${sha256(payment.metadata.paymentId).slice(0, 40)}`)
    if (!receipt) throw new CustomerPaymentError('verification', 'Verified plugin payment has no durable receipt.')
    return receipt
  }

  async refund(rawAuthority: unknown, rawInput: unknown): Promise<CustomerPaymentRefund> {
    const authority = parseCustomerPluginContract(ReviewedCustomerPaymentPluginAuthoritySchema, rawAuthority, 'Reviewed payment plugin authority') as ReviewedCustomerPaymentPluginAuthority
    const input = parseCustomerPluginContract(CustomerPaymentRefundInputSchema, rawInput, 'Plugin payment refund input') as CustomerPaymentRefundInput
    const existing = await this.#repository.refund(authority, input.receiptId)
    if (existing) {
      const expectedRefundId = `plugin-refund:${sha256(`${input.receiptId}:${input.requestId}`).slice(0, 40)}`
      if (existing.refundId !== expectedRefundId || existing.reasonSha256 !== sha256(input.reason)) {
        throw new CustomerPaymentError('conflict', 'Plugin receipt already has another refund.')
      }
      return publicRefund(existing)
    }
    const receipt = await this.#repository.receipt(authority, input.receiptId)
    if (!receipt) throw new CustomerPaymentError('not-found', 'Plugin payment receipt was not found.')
    const payment = await this.#repository.payment(authority, receipt.paymentId)
    if (!payment || payment.state !== 'settled' || payment.reference === null) throw new CustomerPaymentError('conflict', 'Only one exact settled payment can be refunded.')
    const credential = await this.#credentials.credentialById(payment.metadata.credentialId)
    if (!credential || credential.version !== payment.metadata.credentialVersion || credential.state !== 'active'
      || !exactScope(credential.merchantScope, authority.merchantScope)) {
      throw new CustomerPaymentError('scope', 'Plugin refund credential authority changed.')
    }
    const refundId = `plugin-refund:${sha256(`${receipt.receiptId}:${input.requestId}`).slice(0, 40)}`
    const record = await this.#repository.prepareRefund(payment, receipt, input.requestId, sha256(input.reason), validNow(this.#now))
    if (record.refundId !== refundId || record.reasonSha256 !== sha256(input.reason)) throw new CustomerPaymentError('conflict', 'Refund request identity changed on retry.')
    if (!this.#refunds) throw new CustomerPaymentError('unsupported', 'Customer merchant refund transport is unavailable.')
    const refunds = await refundTransportFor(this.#refunds, this.#cipher, credential)
    const provider = safeParseValue(ProviderRefundSchema, await refunds.refund({
      refundId,
      reference: payment.reference,
      amountMinor: receipt.amountMinor,
      currency: receipt.currency,
      reason: input.reason,
    }))
    if (!provider.ok) throw new CustomerPaymentError('provider', 'Customer merchant refund response is invalid.')
    return await this.#repository.completeRefund(record, sha256(provider.value.providerRefundId), validNow(this.#now))
  }
}

function initialization(payment: CustomerPluginPayment): CustomerPaymentInitialization {
  if (payment.reference === null || payment.authorizationUrl === null || payment.state === 'prepared') {
    throw new CustomerPaymentError('verification', 'Plugin payment initialization is incomplete.')
  }
  return Object.freeze({
    paymentId: payment.metadata.paymentId,
    purpose: payment.metadata.purpose,
    amountMinor: payment.metadata.amountMinor,
    currency: payment.metadata.currency,
    reference: payment.reference,
    authorizationUrl: payment.authorizationUrl,
    state: 'initialized' as const,
  })
}

export class MemoryCustomerPluginPaymentRepository implements CustomerPluginPaymentRepository {
  readonly payments = new Map<string, CustomerPluginPayment>()
  readonly receipts = new Map<string, CustomerPaymentReceipt>()
  readonly refunds = new Map<string, CustomerPluginRefundRecord>()
  readonly transactionOwners = new Map<string, string>()

  async preparePayment(metadata: CustomerPluginPaymentMetadata, payerEmailSha256: string, createdAt: string): Promise<CustomerPluginPayment> {
    const existing = this.payments.get(metadata.paymentId)
    if (existing) {
      if (!same(existing.metadata, metadata) || existing.payerEmailSha256 !== payerEmailSha256) throw new CustomerPaymentError('conflict', 'Plugin payment identity changed on retry.')
      return existing
    }
    const value = parseCustomerPluginContract(CustomerPluginPaymentSchema, { metadata, payerEmailSha256, reference: null, authorizationUrl: null, state: 'prepared', createdAt, settledAt: null, refundedAt: null }, 'Plugin payment') as CustomerPluginPayment
    this.payments.set(metadata.paymentId, value)
    return value
  }

  async recordInitialization(metadata: CustomerPluginPaymentMetadata, reference: string, authorizationUrl: string): Promise<CustomerPluginPayment> {
    const current = this.payments.get(metadata.paymentId)
    if (!current || !same(current.metadata, metadata)) throw new CustomerPaymentError('not-found', 'Plugin payment was not prepared.')
    if (current.reference !== null && (current.reference !== reference || current.authorizationUrl !== authorizationUrl)) throw new CustomerPaymentError('conflict', 'Plugin payment initialization changed on retry.')
    const value = parseCustomerPluginContract(CustomerPluginPaymentSchema, { ...current, reference, authorizationUrl, state: current.state === 'prepared' ? 'initialized' : current.state }, 'Initialized plugin payment') as CustomerPluginPayment
    this.payments.set(metadata.paymentId, value)
    return value
  }

  async exactPayment(metadata: CustomerPluginPaymentMetadata): Promise<CustomerPluginPayment | null> {
    const value = this.payments.get(metadata.paymentId)
    return value && same(value.metadata, metadata) ? value : null
  }

  async payment(authority: ReviewedCustomerPaymentPluginAuthority, id: string): Promise<CustomerPluginPayment | null> {
    const value = this.payments.get(id)
    return value && exactAuthority(value.metadata, authority) ? value : null
  }

  async settle(metadata: CustomerPluginPaymentMetadata, transaction: VerifiedPaystackTransaction, settledAt: string): Promise<CustomerPaymentReceipt> {
    const current = await this.exactPayment(metadata)
    if (!current || current.reference !== transaction.reference) throw new CustomerPaymentError('verification', 'Plugin settlement is not an exact initialized obligation.')
    const receiptId = `plugin-receipt:${sha256(metadata.paymentId).slice(0, 40)}`
    const existing = this.receipts.get(receiptId)
    const owner = this.transactionOwners.get(transaction.providerTransactionId)
    if (owner && owner !== receiptId) throw new CustomerPaymentError('conflict', 'Provider transaction was already used by another plugin payment.')
    const receipt = parseCustomerPluginContract(CustomerPaymentReceiptSchema, {
      receiptId, paymentId: metadata.paymentId, purpose: metadata.purpose,
      amountMinor: metadata.amountMinor, currency: metadata.currency,
      providerReferenceSha256: sha256(transaction.reference),
      providerTransactionSha256: sha256(transaction.providerTransactionId), settledAt,
    }, 'Plugin payment receipt') as CustomerPaymentReceipt
    if (existing && !same(existing, receipt)) throw new CustomerPaymentError('conflict', 'Plugin receipt identity changed on retry.')
    this.transactionOwners.set(transaction.providerTransactionId, receiptId)
    this.receipts.set(receiptId, existing ?? receipt)
    this.payments.set(metadata.paymentId, parseCustomerPluginContract(CustomerPluginPaymentSchema, { ...current, state: 'settled', settledAt: current.settledAt ?? settledAt }, 'Settled plugin payment') as CustomerPluginPayment)
    return existing ?? receipt
  }

  async receipt(authority: ReviewedCustomerPaymentPluginAuthority, receiptId: string): Promise<CustomerPaymentReceipt | null> {
    const receipt = this.receipts.get(receiptId)
    if (!receipt) return null
    return await this.payment(authority, receipt.paymentId) ? receipt : null
  }

  async prepareRefund(payment: CustomerPluginPayment, receipt: CustomerPaymentReceipt, requestId: string, reasonSha256: string, createdAt: string): Promise<CustomerPluginRefundRecord> {
    const prior = [...this.refunds.values()].find((value) => value.receiptId === receipt.receiptId)
    const refundId = `plugin-refund:${sha256(`${receipt.receiptId}:${requestId}`).slice(0, 40)}`
    const value = parseCustomerPluginContract(CustomerPluginRefundRecordSchema, {
      refundId, receiptId: receipt.receiptId, paymentId: payment.metadata.paymentId,
      requestId, reasonSha256, amountMinor: receipt.amountMinor, currency: receipt.currency,
      providerRefundSha256: null, state: 'prepared', createdAt, refundedAt: null,
    }, 'Plugin refund record') as CustomerPluginRefundRecord
    if (prior) {
      if (!same(prior, value) && prior.state !== 'refunded') throw new CustomerPaymentError('conflict', 'Plugin refund identity changed on retry.')
      if (prior.refundId !== refundId || prior.reasonSha256 !== reasonSha256) throw new CustomerPaymentError('conflict', 'Plugin receipt already has another refund.')
      return prior
    }
    this.refunds.set(refundId, value)
    return value
  }

  async completeRefund(record: CustomerPluginRefundRecord, providerRefundSha256: string, refundedAt: string): Promise<CustomerPaymentRefund> {
    const current = this.refunds.get(record.refundId)
    if (!current || !same(current, record)) throw new CustomerPaymentError('conflict', 'Plugin refund claim changed.')
    const completed = parseCustomerPluginContract(CustomerPluginRefundRecordSchema, { ...record, providerRefundSha256, state: 'refunded', refundedAt }, 'Completed plugin refund') as CustomerPluginRefundRecord
    this.refunds.set(record.refundId, completed)
    const payment = this.payments.get(record.paymentId)
    if (!payment) throw new CustomerPaymentError('verification', 'Refunded plugin payment is unavailable.')
    this.payments.set(record.paymentId, parseCustomerPluginContract(CustomerPluginPaymentSchema, { ...payment, state: 'refunded', refundedAt }, 'Refunded plugin payment') as CustomerPluginPayment)
    return publicRefund(completed)
  }

  async refund(authority: ReviewedCustomerPaymentPluginAuthority, receiptId: string): Promise<CustomerPluginRefundRecord | null> {
    const value = [...this.refunds.values()].find((candidate) => candidate.receiptId === receiptId && candidate.state === 'refunded')
    if (!value || !await this.payment(authority, value.paymentId)) return null
    return value
  }
}

function publicRefund(value: CustomerPluginRefundRecord): CustomerPaymentRefund {
  if (value.state !== 'refunded' || value.providerRefundSha256 === null || value.refundedAt === null) throw new CustomerPaymentError('verification', 'Plugin refund is incomplete.')
  return Object.freeze({ refundId: value.refundId, receiptId: value.receiptId, paymentId: value.paymentId, amountMinor: value.amountMinor, currency: value.currency, providerRefundSha256: value.providerRefundSha256, state: 'refunded', refundedAt: value.refundedAt })
}

function exactAuthority(metadata: CustomerPluginPaymentMetadata, authority: ReviewedCustomerPaymentPluginAuthority): boolean {
  return exactScope(metadata, authority.merchantScope)
    && metadata.installationId === authority.installationId
    && metadata.artifactId === authority.artifactId
    && metadata.contentHashSha256 === authority.contentHashSha256
    && metadata.exactVersion === authority.exactVersion
    && metadata.reviewSubmissionId === authority.reviewSubmissionId
    && metadata.reviewDecisionId === authority.reviewDecisionId
    && metadata.reviewSignatureKeyId === authority.reviewSignatureKeyId
}

export interface CustomerPaymentPluginReviewAuthority {
  verify(submissionId: string): Promise<ApprovedArtifactReview>
}

export interface CustomerPaymentPluginInstallationAuthority {
  readInstallation(scope: Pick<ArtifactInstallation, 'platformId' | 'ownerKey' | 'installationId'>): Promise<ArtifactInstallation | null>
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join('\n') === [...right].sort().join('\n')
}

export class ReviewedCustomerPaymentPluginBinding implements HostCustomerPaymentBinding {
  readonly pluginId = CUSTOMER_PAYMENT_PLUGIN_ID
  readonly artifactId: string
  readonly contentHashSha256: string
  readonly exactVersion = CUSTOMER_PAYMENT_PLUGIN_VERSION
  readonly #submissionId: string
  readonly #scope: Pick<ArtifactInstallation, 'platformId' | 'ownerKey' | 'installationId'>
  readonly #siteOrigin: string
  readonly #reviews: CustomerPaymentPluginReviewAuthority
  readonly #installations: CustomerPaymentPluginInstallationAuthority
  readonly #payments: CustomerMerchantPluginPaymentService

  constructor(input: Readonly<{
    submissionId: string
    installation: Pick<ArtifactInstallation, 'platformId' | 'ownerKey' | 'installationId' | 'artifactId' | 'contentHashSha256'>
    siteOrigin: string
    reviews: CustomerPaymentPluginReviewAuthority
    installations: CustomerPaymentPluginInstallationAuthority
    payments: CustomerMerchantPluginPaymentService
  }>) {
    this.#submissionId = input.submissionId
    this.#scope = Object.freeze({ platformId: input.installation.platformId, ownerKey: input.installation.ownerKey, installationId: input.installation.installationId })
    this.artifactId = input.installation.artifactId
    this.contentHashSha256 = input.installation.contentHashSha256
    this.#siteOrigin = exactOrigin(input.siteOrigin)
    this.#reviews = input.reviews
    this.#installations = input.installations
    this.#payments = input.payments
  }

  async create(input: CustomerPaymentCreateInput): Promise<CustomerPaymentInitialization> {
    return await this.#payments.create(await this.#authority('payments.customer.create'), input)
  }

  async receipt(input: CustomerPaymentReceiptInput): Promise<CustomerPaymentReceipt> {
    return await this.#payments.receipt(await this.#authority('payments.customer.create'), input)
  }

  async refund(input: CustomerPaymentRefundInput): Promise<CustomerPaymentRefund> {
    return await this.#payments.refund(await this.#authority('payments.customer.refund'), input)
  }

  async #authority(requiredPermission: 'payments.customer.create' | 'payments.customer.refund'): Promise<ReviewedCustomerPaymentPluginAuthority> {
    let approved: ApprovedArtifactReview
    let installation: ArtifactInstallation | null
    try {
      ;[approved, installation] = await Promise.all([
        this.#reviews.verify(this.#submissionId),
        this.#installations.readInstallation(this.#scope),
      ])
    } catch {
      throw new CustomerPaymentError('scope', 'Reviewed customer-payment plugin authority is unavailable.')
    }
    const artifact = approved.submission.artifact
    if (!installation || installation.state !== 'active' || installation.artifactKind !== 'plugin'
      || installation.executionPolicy !== 'plugin-sandbox-worker' || installation.packageId !== CUSTOMER_PAYMENT_PLUGIN_ID
      || installation.exactVersion !== CUSTOMER_PAYMENT_PLUGIN_VERSION || installation.secret !== null
      || installation.artifactId !== artifact.artifactId || installation.contentHashSha256 !== artifact.contentHashSha256
      || this.artifactId !== artifact.artifactId || this.contentHashSha256 !== artifact.contentHashSha256
      || !sameValues(artifact.permissions, CUSTOMER_PAYMENT_PLUGIN_PERMISSIONS)
      || !artifact.permissions.includes(requiredPermission)
      || approved.decision.signature === null || approved.revocation !== null) {
      throw new CustomerPaymentError('scope', 'Reviewed customer-payment plugin authority is unavailable.')
    }
    return parseCustomerPluginContract(ReviewedCustomerPaymentPluginAuthoritySchema, {
      merchantScope: {
        platformId: installation.platformId,
        organizationId: installation.organizationId,
        workspaceId: installation.workspaceId,
        siteId: installation.siteId,
        ownerKey: installation.ownerKey,
        ownerGeneration: installation.ownerGeneration,
      },
      installationId: installation.installationId,
      artifactId: installation.artifactId,
      packageId: installation.packageId,
      exactVersion: installation.exactVersion,
      contentHashSha256: installation.contentHashSha256,
      reviewSubmissionId: approved.submission.submissionId,
      reviewDecisionId: approved.decision.decisionId,
      reviewSignatureKeyId: approved.decision.signature.keyId,
      siteOrigin: this.#siteOrigin,
    }, 'Current reviewed payment plugin authority') as ReviewedCustomerPaymentPluginAuthority
  }
}
