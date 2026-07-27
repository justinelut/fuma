import { describe, expect, it } from 'bun:test'
import { PlatformCheckoutMetadataSchema, type PlatformCheckoutMetadata } from '../../../server/fuma/checkout'
import {
  MemoryBillingRepository,
  PlatformBillingReconciler,
  type BillingObligation,
} from '../../../server/fuma/billing'
import { PaystackWebhookBoundary, PAYSTACK_WEBHOOK_PATHS } from '../../../server/fuma/paystack/boundary'
import { MemoryPaystackLedger } from '../../../server/fuma/paystack/memoryLedger'
import {
  PaystackPurposeRegistry,
  ScopedPaystackTransport,
  signPaystackWebhook,
  type PaystackHttp,
} from '../../../server/fuma/paystack/transport'

const ORIGIN = 'https://paystack.billing.fixture.test'
const SECRET = 'platform-billing-webhook-secret'
const NOW = new Date('2026-07-29T09:00:00.000Z')
const SETUP_REFERENCE = 'pb_platform-setup_0000000000000001'
const RECURRING_REFERENCE = 'pb_platform-recurring_0000000000000001'
const PUBLIC_REFERENCE = 'pb_platform-recurring_0000000000000002'

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`
}

function sha256(value: unknown): string {
  return new Bun.CryptoHasher('sha256').update(canonical(value)).digest('hex')
}

type Initialization = Readonly<{
  reference: string
  amount: number
  currency: string
  metadata: Readonly<{
    payment_purpose: string
    credential_scope: 'platform_billing'
    obligation_sha256: string
  }>
}>

class BillingPaystackHttp implements PaystackHttp {
  readonly initializations = new Map<string, Initialization>()
  mutateVerification: ((value: Record<string, unknown>) => Record<string, unknown>) | null = null

  async request(input: Readonly<{
    url: string
    method: 'GET' | 'POST'
    headers: Readonly<Record<string, string>>
    body?: string
  }>): Promise<Readonly<{ status: number; body: unknown }>> {
    if (input.method === 'POST' && input.url === `${ORIGIN}/transaction/initialize`) {
      const body = JSON.parse(input.body ?? '{}') as Initialization
      this.initializations.set(body.reference, body)
      return {
        status: 200,
        body: {
          status: true,
          data: {
            reference: body.reference,
            authorization_url: `https://checkout.billing.fixture.test/${body.reference}`,
          },
        },
      }
    }
    const prefix = `${ORIGIN}/transaction/verify/`
    if (input.method === 'GET' && input.url.startsWith(prefix)) {
      const reference = decodeURIComponent(input.url.slice(prefix.length))
      const initialization = this.initializations.get(reference)
      if (!initialization) return { status: 404, body: { status: false } }
      const exact = {
        id: `transaction:${reference}`,
        reference,
        status: 'success',
        amount: initialization.amount,
        currency: initialization.currency,
        channel: 'card',
        metadata: initialization.metadata,
        authorization: { authorization_code: 'AUTH_private', reusable: true },
        customer: { customer_code: 'CUS_private' },
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

function metadata(
  checkoutId: string,
  candidateId: string,
  kind: 'setup' | 'recurring',
  amountMinor: number,
  sourceKind: 'public-plan' | 'private-offer' = 'private-offer',
): PlatformCheckoutMetadata {
  return {
    checkoutId,
    candidateId,
    sourceKind,
    sourceId: sourceKind === 'private-offer' ? 'offer-lawyer' : 'business',
    sourceVersion: sourceKind === 'private-offer' ? '3' : 'book-v1',
    organizationId: sourceKind === 'private-offer' ? 'organization-managed' : 'organization-public',
    workspaceId: sourceKind === 'private-offer' ? 'workspace-managed' : 'workspace-public',
    siteId: sourceKind === 'private-offer' ? 'site-managed' : 'site-public',
    customerActorId: 'staff-owner',
    payerEmailSha256: 'a'.repeat(64),
    kind,
    amountMinor,
    currency: 'KES',
    cadence: 'annual',
    callbackUrl: `https://app.fuma.test/admin/settings/billing?checkout=${checkoutId}`,
    allowedChannels: ['card'],
    evidenceSha256: 'b'.repeat(64),
  }
}

function obligation(
  value: PlatformCheckoutMetadata,
  reference: string,
  sourceKind: 'public-plan' | 'private-offer' = value.sourceKind,
): BillingObligation {
  return Object.freeze({
    checkoutId: value.checkoutId,
    candidateId: value.candidateId,
    entitlementCandidateId: sourceKind === 'private-offer' ? value.candidateId : null,
    sourceKind,
    organizationId: value.organizationId,
    workspaceId: value.workspaceId,
    siteId: value.siteId,
    profileId: 'website',
    kind: value.kind,
    reference,
    amountMinor: value.amountMinor,
    currency: 'KES',
    allowedChannels: ['card'],
    metadata: value,
    settledAt: null,
    providerTransactionId: null,
  })
}

function fixture() {
  const repository = new MemoryBillingRepository(() => NOW)
  const ledger = new MemoryPaystackLedger()
  const http = new BillingPaystackHttp()
  const registry = new PaystackPurposeRegistry()
  for (const kind of ['setup', 'recurring'] as const) {
    registry.register({
      id: `platform-${kind}`,
      scope: 'platform_billing',
      metadataSchema: PlatformCheckoutMetadataSchema,
      async authorize(value) {
        if (value.kind !== kind) throw new Error('purpose conflation')
      },
      expected(value) { return { amountMinor: value.amountMinor, currency: value.currency } },
      async settle() {},
    })
  }
  const transport = new ScopedPaystackTransport(
    { scope: 'platform_billing', publicKey: 'platform-public', secretKey: SECRET },
    http,
    ledger,
    registry,
    { providerBaseUrl: ORIGIN },
  )
  const reconciler = new PlatformBillingReconciler(transport, repository, () => NOW)
  return { repository, ledger, http, registry, transport, reconciler }
}

async function initialize(
  value: ReturnType<typeof fixture>,
  reference: string,
  item: PlatformCheckoutMetadata,
): Promise<void> {
  await value.transport.initialize(
    `platform-${item.kind}`,
    item,
    'owner@example.test',
    { reference },
  )
}

function webhook(
  value: ReturnType<typeof fixture>,
  event: string,
  reference: string,
  id: number,
  rawOverride?: (body: Record<string, unknown>) => Record<string, unknown>,
): Uint8Array {
  const initialized = value.http.initializations.get(reference)
  if (!initialized) throw new Error('Fixture reference is not initialized.')
  const body: Record<string, unknown> = {
    event,
    data: {
      id,
      reference,
      amount: initialized.amount,
      currency: initialized.currency,
      metadata: initialized.metadata,
      created_at: new Date(NOW.getTime() + id).toISOString(),
    },
  }
  return new TextEncoder().encode(JSON.stringify(rawOverride ? rawOverride(body) : body))
}

async function ingest(
  value: ReturnType<typeof fixture>,
  raw: Uint8Array,
) {
  return await value.reconciler.ingest(raw, signPaystackWebhook(SECRET, raw))
}

describe('FUMA-056 platform webhook reconciliation', () => {
  it('verifies exact raw signatures before parsing and keeps unknown events durable but unreduced', async () => {
    const value = fixture()
    const malformed = new TextEncoder().encode('{')
    await expect(value.reconciler.ingest(malformed, '0'.repeat(128)))
      .rejects.toMatchObject({ code: 'tampered-webhook' })
    expect(value.repository.events.size).toBe(0)

    const unknown = new TextEncoder().encode(JSON.stringify({
      event: 'customeridentification.failed',
      data: { id: 9 },
    }))
    expect(await ingest(value, unknown)).toMatchObject({ state: 'unknown', duplicate: false })
    expect((await value.reconciler.reducePending()).processed).toBe(0)
    expect([...value.repository.events.values()][0]?.state).toBe('unknown')
  })

  it('reduces out-of-order setup and recurring settlement into one pending handoff', async () => {
    const value = fixture()
    const setup = metadata('checkout-private', 'candidate-private', 'setup', 35_000)
    const recurring = metadata('checkout-private', 'candidate-private', 'recurring', 180_000)
    value.repository.obligations.push(
      obligation(setup, SETUP_REFERENCE),
      obligation(recurring, RECURRING_REFERENCE),
    )
    await initialize(value, SETUP_REFERENCE, setup)
    await initialize(value, RECURRING_REFERENCE, recurring)

    const setupRaw = webhook(value, 'charge.success', SETUP_REFERENCE, 2)
    const recurringRaw = webhook(value, 'charge.success', RECURRING_REFERENCE, 1)
    await ingest(value, setupRaw)
    await ingest(value, recurringRaw)
    expect((await value.reconciler.reducePending(1))).toEqual({
      processed: 1,
      partial: 1,
      activated: 0,
      handoffs: 0,
      subscriptions: 0,
    })
    expect(value.repository.obligations.find(({ kind }) => kind === 'recurring')?.settledAt)
      .toBe(NOW.toISOString())
    expect(value.repository.contracts.size).toBe(0)

    expect((await value.reconciler.reducePending())).toEqual({
      processed: 1,
      partial: 0,
      activated: 1,
      handoffs: 1,
      subscriptions: 0,
    })
    expect(value.repository.contracts.get('checkout-private')).toMatchObject({
      state: 'paid-transfer-pending',
      candidateId: 'candidate-private',
    })
    expect(value.repository.handoffs).toEqual(new Set([
      'paid-handoff:contract:checkout-private',
    ]))
  })

  it('deduplicates identical delivery and rejects mutated replay without duplicating settlement', async () => {
    const value = fixture()
    const recurring = metadata('checkout-public', 'candidate-public', 'recurring', 120_000, 'public-plan')
    value.repository.obligations.push(obligation(recurring, PUBLIC_REFERENCE, 'public-plan'))
    await initialize(value, PUBLIC_REFERENCE, recurring)
    const raw = webhook(value, 'charge.success', PUBLIC_REFERENCE, 11)
    expect(await ingest(value, raw)).toMatchObject({ duplicate: false })
    expect(await ingest(value, raw)).toMatchObject({ duplicate: true })
    const mutated = webhook(value, 'charge.success', PUBLIC_REFERENCE, 11, (body) => ({
      ...body,
      data: {
        ...(body.data as Record<string, unknown>),
        provider_note: 'different-signed-bytes',
      },
    }))
    await expect(ingest(value, mutated)).rejects.toMatchObject({ code: 'duplicate' })

    expect((await value.reconciler.reducePending()).activated).toBe(1)
    expect(value.repository.contracts.get('checkout-public')).toMatchObject({ state: 'active' })
    expect(value.repository.handoffs.size).toBe(0)
    expect(value.repository.obligations[0]?.providerTransactionId)
      .toBe(`transaction:${PUBLIC_REFERENCE}`)
  })

  it('blocks later reductions while the globally ordered head has a live lease', async () => {
    const value = fixture()
    const recurring = metadata(
      'checkout-leased-head',
      'candidate-leased-head',
      'recurring',
      120_000,
      'public-plan',
    )
    await initialize(value, PUBLIC_REFERENCE, recurring)
    await ingest(value, webhook(value, 'subscription.create', PUBLIC_REFERENCE, 41))
    await ingest(value, webhook(value, 'subscription.disable', PUBLIC_REFERENCE, 42))

    const head = await value.repository.claimNext()
    expect(head?.event.eventId).toBe('subscription.create:41')
    expect((await value.reconciler.reducePending()).processed).toBe(0)
    expect(value.repository.events.get('subscription.disable:42')?.claimId).toBeNull()

    if (!head) throw new Error('Expected the ordered billing head to be leased.')
    await value.repository.release(head, 'fixture-release')
    expect((await value.reconciler.reducePending()).subscriptions).toBe(2)
  })

  it('retains a failed event for retry when provider verification does not match', async () => {
    const value = fixture()
    const recurring = metadata('checkout-retry', 'candidate-retry', 'recurring', 120_000, 'public-plan')
    value.repository.obligations.push(obligation(recurring, PUBLIC_REFERENCE, 'public-plan'))
    await initialize(value, PUBLIC_REFERENCE, recurring)
    await ingest(value, webhook(value, 'charge.success', PUBLIC_REFERENCE, 12))
    value.http.mutateVerification = (transaction) => ({ ...transaction, amount: 120_001 })
    await expect(value.reconciler.reducePending()).rejects.toMatchObject({
      code: 'verification-mismatch',
    })
    expect([...value.repository.events.values()][0]).toMatchObject({
      state: 'stored',
      claimId: null,
      errorCode: 'verification-mismatch',
    })
    expect(value.repository.obligations[0]?.settledAt).toBeNull()

    value.http.mutateVerification = null
    expect((await value.reconciler.reducePending()).activated).toBe(1)
    expect(value.repository.contracts.size).toBe(1)
  })

  it('reduces subscription events by provider order rather than arrival order', async () => {
    const value = fixture()
    const recurring = metadata('checkout-subscription', 'candidate-subscription', 'recurring', 120_000, 'public-plan')
    await initialize(value, PUBLIC_REFERENCE, recurring)
    await ingest(value, webhook(value, 'subscription.disable', PUBLIC_REFERENCE, 22))
    await ingest(value, webhook(value, 'subscription.create', PUBLIC_REFERENCE, 21))
    expect((await value.reconciler.reducePending()).subscriptions).toBe(2)
    expect(value.repository.subscriptions.get(PUBLIC_REFERENCE)).toEqual({
      state: 'disabled',
      sequence: 22n,
      eventId: 'subscription.disable:22',
    })

    await ingest(value, webhook(value, 'subscription.disable', PUBLIC_REFERENCE, 23))
    await ingest(value, webhook(value, 'subscription.create', PUBLIC_REFERENCE, 23))
    expect((await value.reconciler.reducePending()).subscriptions).toBe(2)
    expect(value.repository.subscriptions.get(PUBLIC_REFERENCE)).toEqual({
      state: 'disabled',
      sequence: 23n,
      eventId: 'subscription.disable:23',
    })
  })

  it('mounts reconciliation on only the fixed platform raw webhook route', async () => {
    const value = fixture()
    const recurring = metadata('checkout-boundary', 'candidate-boundary', 'recurring', 120_000, 'public-plan')
    value.repository.obligations.push(obligation(recurring, PUBLIC_REFERENCE, 'public-plan'))
    await initialize(value, PUBLIC_REFERENCE, recurring)
    const customer = new ScopedPaystackTransport(
      { scope: 'customer_merchant', publicKey: 'customer-public', secretKey: 'customer-secret' },
      value.http,
      value.ledger,
      value.registry,
      { providerBaseUrl: ORIGIN },
    )
    const boundary = new PaystackWebhookBoundary({
      platformBilling: value.transport,
      customerMerchant: customer,
      platformBillingHandler: (raw, signature) => value.reconciler.ingest(raw, signature),
    })
    const raw = webhook(value, 'charge.success', PUBLIC_REFERENCE, 25)
    const response = await boundary.handle(new Request(
      `https://app.fuma.test${PAYSTACK_WEBHOOK_PATHS.platform_billing}`,
      {
        method: 'POST',
        headers: { 'x-paystack-signature': signPaystackWebhook(SECRET, raw) },
        body: new TextDecoder().decode(raw),
      },
    ))
    expect(response?.status).toBe(202)
    expect(value.repository.events.has('charge.success:25')).toBe(true)
    expect([...value.ledger.events.keys()]).toEqual([
      'platform_billing:charge.success:25',
    ])
  })

  it('denies customer-merchant credentials before webhook or provider access', () => {
    const value = fixture()
    const customer = new ScopedPaystackTransport(
      { scope: 'customer_merchant', publicKey: 'customer-public', secretKey: 'customer-secret' },
      value.http,
      value.ledger,
      value.registry,
      { providerBaseUrl: ORIGIN },
    )
    expect(() => new PlatformBillingReconciler(customer, value.repository))
      .toThrow('Platform webhook cannot use customer merchant credentials.')
  })

  it('prints standard/custom reconciliation evidence without ownership mutation', async () => {
    const value = fixture()
    const setup = metadata('checkout-demo-private', 'candidate-demo-private', 'setup', 35_000)
    const recurring = metadata('checkout-demo-private', 'candidate-demo-private', 'recurring', 180_000)
    const standard = metadata('checkout-demo-public', 'candidate-demo-public', 'recurring', 120_000, 'public-plan')
    const demoSetup = SETUP_REFERENCE.replace('0001', '0101')
    const demoRecurring = RECURRING_REFERENCE.replace('0001', '0101')
    const demoPublic = PUBLIC_REFERENCE.replace('0002', '0102')
    value.repository.obligations.push(
      obligation(setup, demoSetup),
      obligation(recurring, demoRecurring),
      obligation(standard, demoPublic, 'public-plan'),
    )
    await initialize(value, demoSetup, setup)
    await initialize(value, demoRecurring, recurring)
    await initialize(value, demoPublic, standard)
    await ingest(value, webhook(value, 'charge.success', demoRecurring, 31))
    await ingest(value, webhook(value, 'charge.success', demoPublic, 30))
    await ingest(value, webhook(value, 'charge.success', demoSetup, 32))
    const result = await value.reconciler.reducePending()
    expect(result).toMatchObject({ processed: 3, activated: 2, handoffs: 1 })
    process.stdout.write(
      `[FUMA-056 demo] events=${result.processed} contracts=${value.repository.contracts.size} pendingHandoffs=${value.repository.handoffs.size} ownershipMutations=0\n`,
    )
  })
})
