import {
  CardRenewalCommandSchema,
  CustomerMerchantCredentialEnvelopeSchema,
  strictValue,
  type CardRenewalCommand,
  type PaidMembership,
  type PublicationMembershipMetadata,
} from './contracts'
import {
  CustomerPaymentError,
  authorizationAad,
  decryptSecret,
  exactScope,
  referenceFor,
  sha256,
  type CardRecurrenceAuthority,
  type CustomerCardRecurrenceTransportFactory,
  type CustomerMerchantCredentialCipher,
  type CustomerPaymentRepository,
  type MembershipCatalog,
  type PaidPublicationAccessProjector,
} from './service'

function renewalPurchaseId(membershipId: string, expectedRevision: number): string {
  return `purchase:${sha256(`${membershipId}:${expectedRevision}`).slice(0, 40)}`
}

/** Recurs only provider-supported reusable cards; mobile money never enters this service. */
export class CustomerCardRenewalService {
  readonly #repository: CustomerPaymentRepository
  readonly #catalog: MembershipCatalog
  readonly #recurrence: CardRecurrenceAuthority
  readonly #cipher: CustomerMerchantCredentialCipher
  readonly #transports: CustomerCardRecurrenceTransportFactory
  readonly #access: PaidPublicationAccessProjector
  readonly #now: () => Date

  constructor(input: Readonly<{
    repository: CustomerPaymentRepository
    catalog: MembershipCatalog
    recurrence: CardRecurrenceAuthority
    cipher: CustomerMerchantCredentialCipher
    transports: CustomerCardRecurrenceTransportFactory
    access: PaidPublicationAccessProjector
    now?: () => Date
  }>) {
    this.#repository = input.repository
    this.#catalog = input.catalog
    this.#recurrence = input.recurrence
    this.#cipher = input.cipher
    this.#transports = input.transports
    this.#access = input.access
    this.#now = input.now ?? (() => new Date())
  }

  async renew(rawCommand: unknown): Promise<PaidMembership> {
    const command = Object.freeze(
      strictValue(CardRenewalCommandSchema, rawCommand, 'Card renewal command'),
    ) as CardRenewalCommand
    const authority = await this.#repository.cardRenewalAuthority(
      command.scope,
      command.memberId,
      command.membershipId,
    )
    if (!authority) {
      throw new CustomerPaymentError('conflict', 'Card renewal authority is stale or unavailable.')
    }
    if (authority.membership.revision !== command.expectedRevision) {
      const retry = await this.#repository.purchase(
        command.scope,
        command.memberId,
        renewalPurchaseId(command.membershipId, command.expectedRevision),
      )
      if (authority.membership.revision === command.expectedRevision + 1
        && retry?.state === 'settled'
        && retry.metadata.renewalOfMembershipId === command.membershipId) {
        await this.#access.sync(authority.membership, sha256(authority.membership.providerReference))
        return authority.membership
      }
      throw new CustomerPaymentError('conflict', 'Card renewal authority is stale or unavailable.')
    }
    if (authority.membership.renewal !== 'supported-card-recurring'
      || authority.membership.state === 'expired') {
      throw new CustomerPaymentError('unsupported', 'Membership is not eligible for recurring card renewal.')
    }
    const credential = await this.#repository.credentialById(authority.membership.credentialId)
    if (!credential || credential.version !== authority.membership.credentialVersion
      || credential.state !== 'active' || !exactScope(credential.merchantScope, command.scope)) {
      throw new CustomerPaymentError('scope', 'Card renewal credential authority changed.')
    }
    if (!await this.#recurrence.supports({ scope: command.scope, country: 'KE', currency: 'KES' })) {
      throw new CustomerPaymentError('unsupported', 'Card recurrence is unavailable for this merchant/country/currency.')
    }
    const offer = await this.#catalog.exact(command.scope, authority.membership.tierId)
    if (!offer || !offer.active) throw new CustomerPaymentError('not-found', 'Membership tier was not found.')
    const metadata: PublicationMembershipMetadata = Object.freeze({
      purchaseId: renewalPurchaseId(authority.membership.membershipId, command.expectedRevision),
      ...command.scope,
      memberId: command.memberId,
      tierId: offer.tierId,
      credentialId: credential.credentialId,
      credentialVersion: credential.version,
      amountMinor: offer.amountMinor,
      currency: offer.currency,
      periodDays: offer.periodDays,
      graceDays: offer.graceDays,
      channel: 'card',
      mobileProvider: null,
      renewalOfMembershipId: authority.membership.membershipId,
      renewalConfirmationId: null,
    })
    const prepared = await this.#repository.preparePurchase(metadata, this.#now().toISOString())
    if (prepared.state === 'settled') {
      const settled = await this.#repository.membership(command.scope, command.memberId, command.membershipId)
      if (!settled) throw new CustomerPaymentError('verification', 'Settled renewal has no membership.')
      await this.#access.sync(settled, sha256(settled.providerReference))
      return settled
    }
    const reference = prepared.reference ?? referenceFor(metadata)
    if (prepared.reference === null) await this.#repository.recordInitialization(metadata, reference, null)

    const secret = await decryptSecret(this.#cipher, credential)
    const authorizationBytes = await this.#cipher.decrypt(
      authorizationAad(authority.sourceMetadata),
      authority.authorization,
    )
    try {
      const authorizationCode = new TextDecoder('utf-8', { fatal: true }).decode(authorizationBytes)
      if (authorizationCode.length === 0 || authorizationCode.length > 512) {
        throw new CustomerPaymentError('scope', 'Stored recurring card authorization is invalid.')
      }
      const transport = await this.#transports.forCredential(credential, secret)
      const transaction = await transport.chargeAndVerify({
        reference,
        authorizationCode,
        customerCode: authority.customerCode,
        amountMinor: metadata.amountMinor,
        currency: metadata.currency,
        metadata,
      })
      if (transaction.scope !== 'customer_merchant' || transaction.reference !== reference
        || transaction.status !== 'success' || transaction.money.amountMinor !== metadata.amountMinor
        || transaction.money.currency !== metadata.currency || transaction.channel !== 'card'
        || !transaction.reusableAuthorization || transaction.authorizationCode === null) {
        throw new CustomerPaymentError('verification', 'Recurring card charge did not match the exact renewal obligation.')
      }
      const nextAuthorizationBytes = new TextEncoder().encode(transaction.authorizationCode)
      try {
        const recurringAuthorization = strictValue(
          CustomerMerchantCredentialEnvelopeSchema,
          await this.#cipher.encrypt(authorizationAad(metadata), nextAuthorizationBytes),
          'Recurring authorization envelope',
        )
        const membership = await this.#repository.activate({
          metadata,
          transaction,
          recurringAuthorization: Object.freeze(recurringAuthorization),
          recurringCustomerCode: transaction.customerCode ?? authority.customerCode,
          activatedAt: this.#now().toISOString(),
        })
        await this.#access.sync(membership, sha256(transaction.reference))
        return membership
      } finally {
        nextAuthorizationBytes.fill(0)
      }
    } catch (error) {
      if (error instanceof CustomerPaymentError) throw error
      throw new CustomerPaymentError('provider', 'Recurring card renewal could not be verified.')
    } finally {
      authorizationBytes.fill(0)
    }
  }
}
