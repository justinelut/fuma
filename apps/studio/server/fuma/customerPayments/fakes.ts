import type { ScopedPaystackTransport, VerifiedPaystackTransaction } from '../paystack/transport'
import type {
  CustomerMerchantCredential,
  CustomerMerchantCredentialEnvelope,
  CustomerMerchantSecret,
  MembershipOffer,
  PaidMembership,
  PublicationMembershipMetadata,
  PublicationMerchantScope,
} from './contracts'
import type {
  CardRecurrenceAuthority,
  CustomerCardRecurrenceTransportFactory,
  CustomerMerchantCredentialCipher,
  CustomerMerchantTransportFactory,
  MembershipCatalog,
  MembershipReminder,
  MembershipReminderSink,
  PaidPublicationAccessProjector,
  VerifiedCardRecurrenceTransport,
} from './service'

/** Test-only reversible cipher that authenticates exact AAD and never stores plaintext strings. */
export class DeterministicCustomerPaymentCipher implements CustomerMerchantCredentialCipher {
  readonly #scopes = new Map<string, string>()

  async encrypt(scope: string, plaintext: Uint8Array): Promise<CustomerMerchantCredentialEnvelope> {
    const ciphertext = Buffer.from(plaintext.map((value) => value ^ 0x6d)).toString('base64')
    this.#scopes.set(ciphertext, scope)
    return Object.freeze({ ciphertext, keyId: 'fixture-customer-payment-key' })
  }

  async decrypt(scope: string, envelope: CustomerMerchantCredentialEnvelope): Promise<Uint8Array> {
    if (this.#scopes.get(envelope.ciphertext) !== scope) throw new Error('fixture AAD denied')
    return new Uint8Array(Buffer.from(envelope.ciphertext, 'base64')).map((value) => value ^ 0x6d)
  }
}

export class DeterministicMembershipCatalog implements MembershipCatalog {
  readonly offers = new Map<string, MembershipOffer>()
  set(scope: PublicationMerchantScope, offer: MembershipOffer): void {
    this.offers.set(`${scope.siteId}:${scope.ownerGeneration}:${offer.tierId}`, Object.freeze(offer))
  }
  async exact(scope: PublicationMerchantScope, tierId: string): Promise<MembershipOffer | null> {
    return this.offers.get(`${scope.siteId}:${scope.ownerGeneration}:${tierId}`) ?? null
  }
}

export class DeterministicCardRecurrenceAuthority implements CardRecurrenceAuthority {
  supported = true
  async supports(input: Readonly<{ country: 'KE'; currency: 'KES' }>): Promise<boolean> {
    return this.supported && input.country === 'KE' && input.currency === 'KES'
  }
}

export class DeterministicPaidAccessProjector implements PaidPublicationAccessProjector {
  readonly states = new Map<string, Readonly<{ membership: PaidMembership; referenceSha256: string }>>()
  async sync(membership: PaidMembership, providerReferenceSha256: string): Promise<void> {
    this.states.set(membership.membershipId, Object.freeze({ membership, referenceSha256: providerReferenceSha256 }))
  }
}

export class DeterministicMembershipReminderSink implements MembershipReminderSink {
  readonly delivered = new Map<string, MembershipReminder>()
  async deliver(reminder: MembershipReminder): Promise<void> {
    this.delivered.set(reminder.reminderId, reminder)
  }
}

export class DeterministicCustomerMerchantTransportFactory implements CustomerMerchantTransportFactory {
  readonly calls: Readonly<{ credentialId: string; scope: string }>[] = []
  readonly transport: ScopedPaystackTransport
  constructor(transport: ScopedPaystackTransport) { this.transport = transport }
  forCredential(credential: CustomerMerchantCredential, secret: CustomerMerchantSecret): ScopedPaystackTransport {
    ;(this.calls as { credentialId: string; scope: string }[]).push({
      credentialId: credential.credentialId,
      scope: secret.scope,
    })
    return this.transport
  }
}

export class DeterministicCardRecurrenceTransport implements VerifiedCardRecurrenceTransport {
  readonly charges: Readonly<{ reference: string; authorizationCode: string }>[] = []
  next: VerifiedPaystackTransaction | null = null
  respond: ((input: Readonly<{
    reference: string
    authorizationCode: string
    customerCode: string | null
    amountMinor: number
    currency: 'KES'
    metadata: PublicationMembershipMetadata
  }>) => VerifiedPaystackTransaction) | null = null
  async chargeAndVerify(input: Readonly<{
    reference: string
    authorizationCode: string
    customerCode: string | null
    amountMinor: number
    currency: 'KES'
    metadata: PublicationMembershipMetadata
  }>): Promise<VerifiedPaystackTransaction> {
    ;(this.charges as { reference: string; authorizationCode: string }[]).push({
      reference: input.reference,
      authorizationCode: input.authorizationCode,
    })
    if (this.respond) return this.respond(input)
    if (!this.next) throw new Error('fixture recurring transaction is not seeded')
    return this.next
  }
}

export class DeterministicCardRecurrenceTransportFactory implements CustomerCardRecurrenceTransportFactory {
  readonly credentials: string[] = []
  readonly transport: DeterministicCardRecurrenceTransport
  constructor(transport: DeterministicCardRecurrenceTransport) { this.transport = transport }
  forCredential(credential: CustomerMerchantCredential, secret: CustomerMerchantSecret): VerifiedCardRecurrenceTransport {
    if (secret.scope !== 'customer_merchant') throw new Error('fixture scope denied')
    this.credentials.push(credential.credentialId)
    return this.transport
  }
}
