import { describe, expect, it } from 'bun:test'
import { MemoryPaystackLedger } from '../../../server/fuma/paystack/memoryLedger'
import {
  PaystackPurposeRegistry,
  ScopedPaystackTransport,
  type PaystackHttp,
  type PaystackScope,
} from '../../../server/fuma/paystack/transport'
import type { PublicationMembershipMetadata, PublicationMerchantScope } from '../../../server/fuma/customerPayments/contracts'
import { CustomerCardRenewalService } from '../../../server/fuma/customerPayments/cardRenewal'
import { CustomerPaymentLifecycleService } from '../../../server/fuma/customerPayments/lifecycle'
import {
  CustomerMerchantPaymentService,
  MemoryCustomerPaymentRepository,
  createPublicationMembershipPurpose,
} from '../../../server/fuma/customerPayments/service'
import {
  DeterministicCardRecurrenceAuthority,
  DeterministicCardRecurrenceTransport,
  DeterministicCardRecurrenceTransportFactory,
  DeterministicCustomerMerchantTransportFactory,
  DeterministicCustomerPaymentCipher,
  DeterministicMembershipCatalog,
  DeterministicMembershipReminderSink,
  DeterministicPaidAccessProjector,
} from '../../../server/fuma/customerPayments/fakes'

const ORIGIN = 'https://customer-paystack.fixture.test'
const NOW = '2026-07-28T10:00:00.000Z'
const scope: PublicationMerchantScope = Object.freeze({
  platformId: 'platform-fixture',
  organizationId: 'organization-customer',
  workspaceId: 'workspace-publication',
  siteId: 'site-publication',
  ownerKey: 'owner-customer',
  ownerGeneration: 7,
})
const authority = Object.freeze({
  scope,
  memberId: 'member-one',
  memberSessionId: 'member-session-one',
  email: 'member@example.test',
})

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
}
function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}
function labels(scopeValue: PaystackScope, metadata: PublicationMembershipMetadata) {
  return {
    payment_purpose: 'publication-membership',
    credential_scope: scopeValue,
    obligation_sha256: sha256(canonical(metadata)),
  }
}

class CustomerPaystackFake implements PaystackHttp {
  readonly requests: Array<Readonly<{ method: string; url: string; authorization: string; body?: string }>> = []
  readonly transactions = new Map<string, Record<string, unknown>>()
  initializeFailures = 0

  async request(input: Readonly<{
    url: string
    method: 'GET' | 'POST'
    headers: Readonly<Record<string, string>>
    body?: string
  }>): Promise<Readonly<{ status: number; body: unknown }>> {
    this.requests.push({
      method: input.method,
      url: input.url,
      authorization: input.headers.authorization ?? '',
      ...(input.body === undefined ? {} : { body: input.body }),
    })
    if (input.method === 'POST') {
      if (this.initializeFailures > 0) {
        this.initializeFailures -= 1
        return { status: 503, body: { status: false } }
      }
      const body = JSON.parse(input.body ?? '{}') as { reference: string }
      return {
        status: 200,
        body: { status: true, data: {
          reference: body.reference,
          authorization_url: `https://checkout.fixture.test/${body.reference}`,
        } },
      }
    }
    const reference = decodeURIComponent(input.url.split('/').at(-1) ?? '')
    const transaction = this.transactions.get(reference)
    return transaction
      ? { status: 200, body: { status: true, data: transaction } }
      : { status: 404, body: { status: false } }
  }
}

function createFixture(now: () => Date = () => new Date(NOW), transportScope: PaystackScope = 'customer_merchant') {
  const repository = new MemoryCustomerPaymentRepository()
  const cipher = new DeterministicCustomerPaymentCipher()
  const access = new DeterministicPaidAccessProjector()
  const catalog = new DeterministicMembershipCatalog()
  catalog.set(scope, Object.freeze({
    tierId: 'card-tier', amountMinor: 12_500, currency: 'KES', periodDays: 30, graceDays: 5, active: true,
  }))
  catalog.set(scope, Object.freeze({
    tierId: 'mobile-tier', amountMinor: 4_000, currency: 'KES', periodDays: 7, graceDays: 2, active: true,
  }))
  const recurrence = new DeterministicCardRecurrenceAuthority()
  const http = new CustomerPaystackFake()
  const ledger = new MemoryPaystackLedger(() => 'customer-payment-claim')
  const registry = new PaystackPurposeRegistry().register(
    createPublicationMembershipPurpose(repository, cipher, access, now),
  )
  const transport = new ScopedPaystackTransport(
    { scope: transportScope, publicKey: 'fixture-public', secretKey: 'fixture-secret' },
    http,
    ledger,
    registry,
    { providerBaseUrl: ORIGIN },
  )
  const factory = new DeterministicCustomerMerchantTransportFactory(transport)
  const service = new CustomerMerchantPaymentService({
    repository, catalog, recurrence, cipher, transports: factory, now,
  })
  return { repository, cipher, access, catalog, recurrence, http, ledger, transport, factory, service }
}

async function attach(fixture: ReturnType<typeof createFixture>) {
  return fixture.service.attachCredential(scope, {
    scope: 'customer_merchant', publicKey: 'pk_customer', secretKey: 'sk_customer',
  }, 'credential-customer-one')
}

async function initializeCard(fixture: ReturnType<typeof createFixture>, requestId = 'request-card-one') {
  const initialized = await fixture.service.initialize(authority, {
    requestId,
    tierId: 'card-tier',
    channel: 'card',
    mobileProvider: null,
    renewalOfMembershipId: null,
    renewalConfirmationId: null,
  })
  const purchase = await fixture.repository.purchase(scope, authority.memberId, initialized.purchaseId)
  if (!purchase) throw new Error('fixture purchase missing')
  fixture.http.transactions.set(initialized.reference, {
    id: `transaction-${requestId}`,
    reference: initialized.reference,
    status: 'success',
    amount: purchase.metadata.amountMinor,
    currency: 'KES',
    channel: 'card',
    metadata: labels('customer_merchant', purchase.metadata),
    authorization: { authorization_code: `AUTH_${requestId}`, reusable: true, brand: 'visa' },
    customer: { customer_code: 'CUS_member_one' },
  })
  return initialized
}

async function initializeMobile(fixture: ReturnType<typeof createFixture>, requestId = 'request-mobile-one') {
  const initialized = await fixture.service.initialize(authority, {
    requestId,
    tierId: 'mobile-tier',
    channel: 'mobile_money',
    mobileProvider: 'safaricom',
    renewalOfMembershipId: null,
    renewalConfirmationId: `confirmation-${requestId}`,
  })
  const purchase = await fixture.repository.purchase(scope, authority.memberId, initialized.purchaseId)
  if (!purchase) throw new Error('fixture purchase missing')
  fixture.http.transactions.set(initialized.reference, {
    id: `transaction-${requestId}`,
    reference: initialized.reference,
    status: 'success',
    amount: purchase.metadata.amountMinor,
    currency: 'KES',
    channel: 'mobile_money',
    metadata: labels('customer_merchant', purchase.metadata),
    authorization: { bank: 'safaricom' },
  })
  return initialized
}

describe('FUMA-058 customer-merchant paid Publication', () => {
  it('activates separate recurring-card and explicit-confirmation Safaricom prepaid memberships', async () => {
    const fixture = createFixture()
    await attach(fixture)
    const card = await initializeCard(fixture)
    const cardMembership = await fixture.service.reconcile(authority, card.purchaseId, card.reference)
    const mobile = await initializeMobile(fixture)
    const mobileMembership = await fixture.service.reconcile(authority, mobile.purchaseId, mobile.reference)

    expect(cardMembership).toMatchObject({ renewal: 'supported-card-recurring', state: 'active' })
    expect(mobileMembership).toMatchObject({ renewal: 'manual-mobile-money', state: 'active' })
    expect(fixture.access.states.size).toBe(2)
    expect([...fixture.ledger.reconciliations.keys()].every((key) => key.startsWith('customer_merchant:'))).toBe(true)
    expect(fixture.factory.calls).toEqual([
      { credentialId: 'credential-customer-one', scope: 'customer_merchant' },
      { credentialId: 'credential-customer-one', scope: 'customer_merchant' },
      { credentialId: 'credential-customer-one', scope: 'customer_merchant' },
      { credentialId: 'credential-customer-one', scope: 'customer_merchant' },
    ])
    process.stdout.write('[FUMA-058 demo] card=active+recurring mobile=safaricom+manual-prepaid paidAccess=projected ledgers=customer-only\n')
  })

  it('renews only supported reusable cards with exact verified recurrence evidence', async () => {
    const fixture = createFixture()
    await attach(fixture)
    const initialized = await initializeCard(fixture)
    const initial = await fixture.service.reconcile(authority, initialized.purchaseId, initialized.reference)
    const recurrenceTransport = new DeterministicCardRecurrenceTransport()
    recurrenceTransport.respond = (input) => Object.freeze({
      scope: 'customer_merchant', reference: input.reference, status: 'success',
      money: Object.freeze({ amountMinor: input.amountMinor, currency: 'KES' }),
      channel: 'card', channelDetail: 'visa', customerCode: input.customerCode,
      authorizationCode: 'AUTH_rotated', reusableAuthorization: true,
      providerTransactionId: 'transaction-card-renewal',
    })
    const renewals = new CustomerCardRenewalService({
      repository: fixture.repository,
      catalog: fixture.catalog,
      recurrence: fixture.recurrence,
      cipher: fixture.cipher,
      transports: new DeterministicCardRecurrenceTransportFactory(recurrenceTransport),
      access: fixture.access,
      now: () => new Date('2026-08-26T10:00:00.000Z'),
    })
    const renewed = await renewals.renew({
      schemaVersion: 1,
      scope,
      memberId: authority.memberId,
      membershipId: initial.membershipId,
      expectedRevision: initial.revision,
    })
    expect(renewed.revision).toBe(2)
    expect(Date.parse(renewed.accessUntil)).toBeGreaterThan(Date.parse(initial.accessUntil))
    expect(recurrenceTransport.charges).toHaveLength(1)
    expect(recurrenceTransport.charges[0]?.authorizationCode).toBe('AUTH_request-card-one')
  })


  it('recovers paid-access projection after a post-settlement fault without charging twice', async () => {
    const fixture = createFixture()
    await attach(fixture)
    const initialized = await initializeCard(fixture, 'projector-fault')
    const initial = await fixture.service.reconcile(authority, initialized.purchaseId, initialized.reference)
    const recurring = new DeterministicCardRecurrenceTransport()
    recurring.respond = (input) => Object.freeze({
      scope: 'customer_merchant', reference: input.reference, status: 'success',
      money: Object.freeze({ amountMinor: input.amountMinor, currency: 'KES' }),
      channel: 'card', channelDetail: 'visa', customerCode: input.customerCode,
      authorizationCode: 'AUTH_after_fault', reusableAuthorization: true,
      providerTransactionId: 'transaction-projector-renewal-fault',
    })
    let projections = 0
    const renewals = new CustomerCardRenewalService({
      repository: fixture.repository, catalog: fixture.catalog, recurrence: fixture.recurrence,
      cipher: fixture.cipher, transports: new DeterministicCardRecurrenceTransportFactory(recurring),
      access: { async sync() { projections += 1; if (projections === 1) throw new Error('projector unavailable') } },
      now: () => new Date('2026-08-26T10:00:00.000Z'),
    })
    const command = {
      schemaVersion: 1 as const, scope, memberId: authority.memberId,
      membershipId: initial.membershipId, expectedRevision: initial.revision,
    }
    await expect(renewals.renew(command)).rejects.toMatchObject({ code: 'provider' })
    const recovered = await renewals.renew(command)
    expect(recovered.revision).toBe(2)
    expect(recurring.charges).toHaveLength(1)
    expect(projections).toBe(2)
  })
  it('requires explicit Safaricom/Airtel confirmation each period and has no Daraja path', async () => {
    const fixture = createFixture()
    await attach(fixture)
    await expect(fixture.service.initialize(authority, {
      requestId: 'mobile-no-confirmation', tierId: 'mobile-tier', channel: 'mobile_money',
      mobileProvider: 'airtel', renewalOfMembershipId: null, renewalConfirmationId: null,
    })).rejects.toMatchObject({ code: 'invalid' })
    expect(() => fixture.service.daraja()).toThrow('Daraja is not implemented.')

    await initializeMobile(fixture, 'same-confirmation')
    await expect(fixture.service.initialize(authority, {
      requestId: 'different-request', tierId: 'mobile-tier', channel: 'mobile_money',
      mobileProvider: 'safaricom', renewalOfMembershipId: null,
      renewalConfirmationId: 'confirmation-same-confirmation',
    })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('fails closed on unsupported Kenya/KES card recurrence before provider access', async () => {
    const fixture = createFixture()
    await attach(fixture)
    fixture.recurrence.supported = false
    await expect(initializeCard(fixture)).rejects.toMatchObject({ code: 'unsupported' })
    expect(fixture.http.requests).toHaveLength(0)
  })

  it('distrusts provider labels, amount, currency, channel and mobile provider', async () => {
    for (const mutate of [
      (transaction: Record<string, unknown>) => ({ ...transaction, amount: 12_501 }),
      (transaction: Record<string, unknown>) => ({ ...transaction, currency: 'USD' }),
      (transaction: Record<string, unknown>) => ({ ...transaction, channel: 'mobile_money' }),
      (transaction: Record<string, unknown>) => ({
        ...transaction,
        metadata: { ...(transaction.metadata as object), obligation_sha256: '0'.repeat(64) },
      }),
    ]) {
      const fixture = createFixture()
      await attach(fixture)
      const initialized = await initializeCard(fixture)
      fixture.http.transactions.set(initialized.reference, mutate(fixture.http.transactions.get(initialized.reference)!))
      await expect(fixture.service.reconcile(authority, initialized.purchaseId, initialized.reference)).rejects.toThrow()
      expect(fixture.repository.memberships.size).toBe(0)
    }
  })

  it('is idempotent across duplicate initialize/reconcile and releases provider failures for retry', async () => {
    const fixture = createFixture()
    await attach(fixture)
    fixture.http.initializeFailures = 1
    await expect(initializeCard(fixture, 'retry-card')).rejects.toThrow()
    const initialized = await initializeCard(fixture, 'retry-card')
    const first = await fixture.service.reconcile(authority, initialized.purchaseId, initialized.reference)
    const duplicate = await fixture.service.reconcile(authority, initialized.purchaseId, initialized.reference)
    expect(duplicate).toEqual(first)
    expect(fixture.repository.memberships.size).toBe(1)
    expect(fixture.access.states.size).toBe(1)
  })

  it('emits deduplicated due/grace/expiry reminders and projects every lifecycle state', async () => {
    let now = new Date(NOW)
    const fixture = createFixture(() => now)
    await attach(fixture)
    const initialized = await initializeMobile(fixture, 'lifecycle')
    const membership = await fixture.service.reconcile(authority, initialized.purchaseId, initialized.reference)
    const reminders = new DeterministicMembershipReminderSink()
    const lifecycle = new CustomerPaymentLifecycleService(
      fixture.repository, reminders, fixture.access, () => now,
    )

    now = new Date(Date.parse(membership.accessUntil) - 2 * 86_400_000)
    await lifecycle.run()
    await lifecycle.run()
    now = new Date(Date.parse(membership.accessUntil) + 1)
    await lifecycle.run()
    now = new Date(Date.parse(membership.graceUntil) + 1)
    await lifecycle.run()

    expect([...reminders.delivered.values()].map(({ kind }) => kind).sort()).toEqual([
      'expired', 'grace-started', 'renewal-due',
    ])
    expect(fixture.access.states.get(membership.membershipId)?.membership.state).toBe('expired')
  })


  it('retries an undelivered reminder after sink failure and acknowledges only success', async () => {
    let now = new Date(NOW)
    const fixture = createFixture(() => now)
    await attach(fixture)
    const initialized = await initializeMobile(fixture, 'reminder-fault')
    const membership = await fixture.service.reconcile(authority, initialized.purchaseId, initialized.reference)
    now = new Date(Date.parse(membership.accessUntil) - 86_400_000)
    let attempts = 0
    const lifecycle = new CustomerPaymentLifecycleService(fixture.repository, {
      async deliver() {
        attempts += 1
        if (attempts === 1) throw new Error('fixture reminder outage')
      },
    }, fixture.access, () => now)
    await expect(lifecycle.run()).rejects.toThrow('fixture reminder outage')
    await lifecycle.run()
    await lifecycle.run()
    expect(attempts).toBe(2)
  })
  it('never permits a platform-billing transport or ledger to process Publication revenue', async () => {
    const fixture = createFixture(() => new Date(NOW), 'platform_billing')
    await attach(fixture)
    await expect(initializeCard(fixture)).rejects.toMatchObject({ code: 'scope' })
    expect([...fixture.ledger.initializations.keys()]).toHaveLength(0)
  })
})
