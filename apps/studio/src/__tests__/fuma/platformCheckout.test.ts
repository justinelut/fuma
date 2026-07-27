import {
  MemoryCheckoutRepository,
  PlatformCheckoutError,
  PlatformCheckoutService,
  registerPlatformCheckoutPurposes,
  type MemoryCheckoutOffer,
  type MemoryCheckoutPlan,
  type PlatformCheckoutDestination,
  type PlatformCheckoutMetadata,
} from '../../../server/fuma/checkout'
import { MemoryPaystackLedger } from '../../../server/fuma/paystack/memoryLedger'
import {
  PaystackPurposeRegistry,
  ScopedPaystackTransport,
  type PaystackHttp,
  type PaystackScope,
} from '../../../server/fuma/paystack/transport'

const NOW = new Date('2026-07-28T09:00:00.000Z')
const PROVIDER_ORIGIN = 'https://api.paystack.fixture.test'
const CHECKOUT_ORIGIN = 'https://checkout.fixture.test'
const CALLBACK_ORIGIN = 'https://app.fuma.test'
const destination: PlatformCheckoutDestination = Object.freeze({
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  profileId: 'website',
})
const customer = Object.freeze({
  destination,
  customerActorId: 'user-a',
  payerEmail: 'owner@example.test',
})
const annualPlan: MemoryCheckoutPlan = Object.freeze({
  planId: 'business',
  priceBookVersion: 'book-2026-07',
  profileId: 'website',
  amountMinor: 120_000,
  currency: 'KES',
  cadence: 'annual',
  offeringClass: 'paid',
  checkoutAvailable: true,
  effectiveAt: '2026-07-01T00:00:00.000Z',
  expiresAt: null,
})
const annualOffer: MemoryCheckoutOffer = Object.freeze({
  offerId: 'offer-lawyer',
  offerVersion: 3,
  destination,
  recurringAmountMinor: 180_000,
  setupFeeMinor: 35_000,
  currency: 'KES',
  cadence: 'annual',
  effectiveAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2026-08-15T00:00:00.000Z',
  state: 'issued',
  candidateId: null,
  replaces: null,
})

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
    .join(',')}}`
}
function sha256(value: unknown): string {
  return new Bun.CryptoHasher('sha256').update(canonical(value)).digest('hex')
}

type InitializationBody = {
  email: string
  amount: number
  currency: string
  reference: string
  callback_url: string
  channels: string[]
  metadata: {
    payment_purpose: string
    credential_scope: PaystackScope
    obligation_sha256: string
  }
}

class CheckoutPaystackHttp implements PaystackHttp {
  readonly initializationBodies: InitializationBody[] = []
  readonly initializations = new Map<string, InitializationBody>()
  failInitializations = 0
  delayMs = 0
  authorizationOrigin = CHECKOUT_ORIGIN
  verifyChannel = 'card'
  mutateVerification: ((data: Record<string, unknown>) => Record<string, unknown>) | null = null

  async request(input: Readonly<{
    url: string
    method: 'GET' | 'POST'
    headers: Readonly<Record<string, string>>
    body?: string
  }>): Promise<Readonly<{ status: number; body: unknown }>> {
    if (input.method === 'POST' && input.url === `${PROVIDER_ORIGIN}/transaction/initialize`) {
      const body = JSON.parse(input.body ?? '{}') as InitializationBody
      this.initializationBodies.push(structuredClone(body))
      if (this.delayMs > 0) await Bun.sleep(this.delayMs)
      if (this.failInitializations > 0) {
        this.failInitializations -= 1
        return { status: 503, body: { status: false, message: 'private provider failure' } }
      }
      this.initializations.set(body.reference, structuredClone(body))
      return {
        status: 200,
        body: {
          status: true,
          data: {
            reference: body.reference,
            authorization_url: `${this.authorizationOrigin}/pay/${body.reference}`,
          },
        },
      }
    }
    const prefix = `${PROVIDER_ORIGIN}/transaction/verify/`
    if (input.method === 'GET' && input.url.startsWith(prefix)) {
      const reference = decodeURIComponent(input.url.slice(prefix.length))
      const initialized = this.initializations.get(reference)
      if (!initialized) return { status: 404, body: { status: false } }
      const exact = {
        id: `transaction-${reference}`,
        reference,
        status: 'success',
        amount: initialized.amount,
        currency: initialized.currency,
        channel: this.verifyChannel,
        metadata: initialized.metadata,
        authorization: {
          authorization_code: 'AUTH_customer_secret',
          reusable: true,
          brand: 'visa',
        },
        customer: { customer_code: 'CUS_customer_secret' },
      }
      return {
        status: 200,
        body: {
          status: true,
          data: this.mutateVerification ? this.mutateVerification(exact) : exact,
        },
      }
    }
    return { status: 503, body: { status: false } }
  }
}

type FixtureOptions = Readonly<{
  plans?: readonly MemoryCheckoutPlan[]
  offers?: readonly MemoryCheckoutOffer[]
  destinations?: readonly PlatformCheckoutDestination[]
  internalOrganizationIds?: readonly string[]
  activeSourceKeys?: readonly string[]
  transportScope?: 'platform_billing' | 'customer_merchant'
}>

function fixture(options: FixtureOptions = {}) {
  let claim = 0
  let reference = 0
  const repository = new MemoryCheckoutRepository({
    plans: options.plans ?? [annualPlan],
    offers: options.offers ?? [annualOffer],
    destinations: options.destinations ?? [destination],
    internalOrganizationIds: options.internalOrganizationIds,
    activeSourceKeys: options.activeSourceKeys,
    now: () => NOW,
    claimFactory: () => `claim-${++claim}`,
  })
  const registry = new PaystackPurposeRegistry()
  registerPlatformCheckoutPurposes(registry, repository)
  const ledger = new MemoryPaystackLedger()
  const http = new CheckoutPaystackHttp()
  const scope = options.transportScope ?? 'platform_billing'
  const transport = new ScopedPaystackTransport(
    {
      scope,
      publicKey: 'pk_test_fixture',
      secretKey: 'sk_test_private_fixture',
    },
    http,
    ledger,
    registry,
    { providerBaseUrl: PROVIDER_ORIGIN },
  )
  const service = scope === 'platform_billing'
    ? new PlatformCheckoutService(transport, repository, repository, {
        callbackOrigin: CALLBACK_ORIGIN,
        allowedChannels: ['card', 'mobile_money'],
        allowedAuthorizationOrigins: [CHECKOUT_ORIGIN],
        referenceFactory: (kind) => (
          `pb_platform-${kind}_${String(++reference).padStart(20, '0')}`
        ),
      })
    : null
  return { repository, registry, ledger, http, transport, service }
}

function publicIntent() {
  return {
    source: {
      kind: 'public-plan' as const,
      planId: annualPlan.planId,
      priceBookVersion: annualPlan.priceBookVersion,
      cadence: annualPlan.cadence,
    },
  }
}
function offerIntent() {
  return {
    source: {
      kind: 'private-offer' as const,
      offerId: annualOffer.offerId,
      offerVersion: annualOffer.offerVersion,
    },
  }
}

function metadataForRecord(
  record: ReturnType<MemoryCheckoutRepository['records']>[number],
  kind: 'setup' | 'recurring',
): PlatformCheckoutMetadata {
  const item = kind === 'setup' ? record.setup! : record.recurring
  return {
    checkoutId: record.checkoutId,
    candidateId: record.candidateId,
    sourceKind: record.source.kind,
    sourceId: record.source.kind === 'public-plan' ? record.source.planId : record.source.offerId,
    sourceVersion: record.source.kind === 'public-plan'
      ? record.source.priceBookVersion
      : String(record.source.offerVersion),
    organizationId: record.destination.organizationId,
    workspaceId: record.destination.workspaceId,
    siteId: record.destination.siteId,
    customerActorId: record.customerActorId,
    payerEmailSha256: record.payerEmailSha256,
    kind,
    amountMinor: item.amountMinor,
    currency: item.currency,
    cadence: record.cadence,
    callbackUrl: record.callbackUrl,
    allowedChannels: [...record.allowedChannels],
    evidenceSha256: record.evidenceSha256,
  }
}

describe('FUMA-055 isolated platform checkout', () => {
  it('converges concurrent public-plan clicks to one candidate, reference, and provider initialization', async () => {
    const value = fixture()
    value.http.delayMs = 25
    const results = await Promise.all(Array.from({ length: 8 }, () => (
      value.service!.initialize(publicIntent(), customer)
    )))
    expect(new Set(results.map(({ checkoutId }) => checkoutId))).toHaveLength(1)
    expect(new Set(results.map(({ recurring }) => recurring.reference))).toHaveLength(1)
    expect(value.repository.records()).toHaveLength(1)
    expect(value.http.initializationBodies).toHaveLength(1)
    expect(value.ledger.initializations).toHaveProperty('size', 1)
    const checkout = results[0]!
    expect(checkout).toMatchObject({
      state: 'awaiting-payment',
      cadence: 'annual',
      currency: 'KES',
      setup: null,
      recurring: { amountMinor: 120_000, state: 'ready' },
      destination,
    })
    const body = value.http.initializationBodies[0]!
    expect(body).toMatchObject({
      email: customer.payerEmail,
      amount: 120_000,
      currency: 'KES',
      callback_url: `${CALLBACK_ORIGIN}/admin/organizations/organization-a/workspaces/workspace-a/sites/site-a/settings/billing?checkout=${checkout.checkoutId.replace(':', '%3A')}`,
      channels: ['card', 'mobile_money'],
      metadata: {
        payment_purpose: 'platform-recurring',
        credential_scope: 'platform_billing',
      },
    })
    expect(JSON.stringify(checkout)).not.toMatch(/owner@example|payerEmail|customerActor|secret|authorization_code|customer_code/i)
  })

  it('accepts one exact issued private offer and keeps setup and recurring consideration distinct', async () => {
    const value = fixture()
    const checkout = await value.service!.initialize(offerIntent(), customer)
    expect(checkout).toMatchObject({
      cadence: 'annual',
      setup: { kind: 'setup', amountMinor: 35_000, state: 'ready' },
      recurring: { kind: 'recurring', amountMinor: 180_000, state: 'ready' },
    })
    expect(checkout.setup?.reference).not.toBe(checkout.recurring.reference)
    expect(value.http.initializationBodies.map(({ amount }) => amount)).toEqual([35_000, 180_000])
    expect(value.http.initializationBodies.map(({ metadata }) => metadata.payment_purpose)).toEqual([
      'platform-setup',
      'platform-recurring',
    ])
    const stored = value.repository.records()[0]!
    expect(stored.entitlementCandidateId).toBe('candidate:offer-lawyer:3')

    const setupVerified = await value.service!.verifyCallback(
      destination,
      checkout.checkoutId,
      checkout.setup!.reference!,
    )
    expect(setupVerified.setup?.state).toBe('callback-verified')
    expect(setupVerified.recurring.state).toBe('ready')
    const fullyVerified = await value.service!.verifyCallback(
      destination,
      checkout.checkoutId,
      checkout.recurring.reference!,
    )
    expect(fullyVerified.recurring.state).toBe('callback-verified')
    expect(fullyVerified.state).toBe('awaiting-payment')
    expect(value.ledger.reconciliations).toHaveProperty('size', 0)
    expect(JSON.stringify(fullyVerified)).not.toMatch(/CUS_customer_secret|AUTH_customer_secret/)
  })

  it('rejects caller authority, stale/replaced/withdrawn/settled sources, and internal grants', async () => {
    const strict = fixture()
    await expect(strict.service!.initialize({
      ...publicIntent(),
      organizationId: 'substituted',
      amountMinor: 1,
      callbackUrl: 'https://evil.example/callback',
      allowedChannels: ['bank'],
      internalGrant: false,
    }, customer)).rejects.toMatchObject({ code: 'invalid' })

    const currentPlan = { ...annualPlan, priceBookVersion: 'book-2026-08', effectiveAt: '2026-07-20T00:00:00.000Z' }
    const stale = fixture({ plans: [annualPlan, currentPlan] })
    await expect(stale.service!.initialize(publicIntent(), customer)).rejects.toMatchObject({ code: 'stale' })
    await expect(stale.service!.initialize({
      source: { ...publicIntent().source, priceBookVersion: 'missing' },
    }, customer)).rejects.toMatchObject({ code: 'not-found' })

    const withdrawn = fixture({ offers: [{ ...annualOffer, state: 'withdrawn' }] })
    await expect(withdrawn.service!.initialize(offerIntent(), customer)).rejects.toMatchObject({ code: 'stale' })
    const settled = fixture({
      offers: [{ ...annualOffer, state: 'accepted', candidateId: 'candidate:settled', candidateSettled: true }],
    })
    await expect(settled.service!.initialize(offerIntent(), customer)).rejects.toMatchObject({ code: 'already-settled' })
    const replacement: MemoryCheckoutOffer = {
      ...annualOffer,
      offerId: 'offer-lawyer-replacement',
      offerVersion: 1,
      replaces: { offerId: annualOffer.offerId, offerVersion: annualOffer.offerVersion },
    }
    const replaced = fixture({ offers: [annualOffer, replacement] })
    await expect(replaced.service!.initialize(offerIntent(), customer)).rejects.toMatchObject({ code: 'stale' })

    const internal = fixture({ internalOrganizationIds: [destination.organizationId] })
    await expect(internal.service!.initialize(publicIntent(), customer)).rejects.toMatchObject({ code: 'internal' })
    expect(internal.http.initializationBodies).toHaveLength(0)
    expect(internal.ledger.initializations).toHaveProperty('size', 0)
  })

  it('rejects redirect, callback reference, amount/currency/labels/channel, and purpose conflation', async () => {
    const redirect = fixture()
    redirect.http.authorizationOrigin = 'https://evil.example'
    await expect(redirect.service!.initialize(publicIntent(), customer)).rejects.toMatchObject({ code: 'verification' })
    expect(redirect.repository.records()[0]?.recurring.state).toBe('failed')

    const mismatchMutators: Array<(data: Record<string, unknown>) => Record<string, unknown>> = [
      (data) => ({ ...data, amount: 1 }),
      (data) => ({ ...data, currency: 'USD' }),
      (data) => ({ ...data, reference: 'pb_platform-recurring_substituted' }),
      (data) => ({ ...data, metadata: { ...(data.metadata as object), obligation_sha256: '0'.repeat(64) } }),
    ]
    for (const mutate of mismatchMutators) {
      const value = fixture()
      const checkout = await value.service!.initialize(publicIntent(), customer)
      value.http.mutateVerification = mutate
      await expect(value.service!.verifyCallback(
        destination,
        checkout.checkoutId,
        checkout.recurring.reference!,
      )).rejects.toMatchObject({ code: 'verification' })
    }
    const wrongReference = fixture()
    const checkout = await wrongReference.service!.initialize(publicIntent(), customer)
    await expect(wrongReference.service!.verifyCallback(
      destination,
      checkout.checkoutId,
      'pb_platform-recurring_substituted',
    )).rejects.toMatchObject({ code: 'verification' })
    wrongReference.http.verifyChannel = 'ussd'
    await expect(wrongReference.service!.verifyCallback(
      destination,
      checkout.checkoutId,
      checkout.recurring.reference!,
    )).rejects.toMatchObject({ code: 'verification' })

    const offer = fixture()
    const exact = await offer.service!.initialize(offerIntent(), customer)
    const stored = offer.repository.records()[0]!
    await expect(offer.transport.initialize(
      'platform-recurring',
      metadataForRecord(stored, 'setup'),
      customer.payerEmail,
      { reference: exact.setup!.reference! },
    )).rejects.toThrow('conflated')
  })

  it('recovers provider failure with the same durable reference and enforces cancellation', async () => {
    const value = fixture()
    value.http.failInitializations = 1
    await expect(value.service!.initialize(publicIntent(), customer)).rejects.toMatchObject({ code: 'provider' })
    const failed = value.repository.records()[0]!
    expect(failed.recurring.state).toBe('failed')
    const reference = failed.recurring.reference
    const retried = await value.service!.initialize(publicIntent(), customer)
    expect(retried.recurring.reference).toBe(reference)
    expect(value.http.initializationBodies.map((body) => body.reference)).toEqual([reference, reference])
    expect(value.ledger.initializations).toHaveProperty('size', 1)

    const cancelled = await value.service!.cancel(destination, retried.checkoutId)
    expect(cancelled.state).toBe('cancelled')
    await expect(value.service!.verifyCallback(
      destination,
      retried.checkoutId,
      retried.recurring.reference!,
    )).rejects.toMatchObject({ code: 'cancelled' })
    await expect(value.service!.initialize(publicIntent(), customer)).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('denies customer-merchant credentials and emits the standard/custom/internal demo evidence', async () => {
    const customerMerchant = fixture({ transportScope: 'customer_merchant' })
    expect(() => new PlatformCheckoutService(
      customerMerchant.transport,
      customerMerchant.repository,
      customerMerchant.repository,
      { callbackOrigin: CALLBACK_ORIGIN, allowedChannels: ['card'] },
    )).toThrow('cannot use customer merchant credentials')

    const standard = fixture()
    const standardCheckout = await standard.service!.initialize(publicIntent(), customer)
    const custom = fixture()
    const customCheckout = await custom.service!.initialize(offerIntent(), customer)
    const internal = fixture({ internalOrganizationIds: [destination.organizationId] })
    await expect(internal.service!.initialize(publicIntent(), customer)).rejects.toBeInstanceOf(PlatformCheckoutError)
    process.stdout.write(
      `[FUMA-055 demo] standard=${standardCheckout.recurring.amountMinor} customSetup=${customCheckout.setup?.amountMinor} customAnnual=${customCheckout.recurring.amountMinor} callbacksSettle=false internalDenied=true\n`,
    )
  })
})
