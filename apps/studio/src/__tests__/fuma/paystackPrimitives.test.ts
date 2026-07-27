import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Type } from '@core/utils/typeboxHelpers'
import { handleServerRequest } from '../../../server/router'
import { PaystackWebhookBoundary, PAYSTACK_WEBHOOK_PATHS } from '../../../server/fuma/paystack/boundary'
import { paystackReconciliationMigration } from '../../../server/fuma/db/migrations/000045_paystack_reconciliation'
import { hostedMigrationChecksum } from '../../../server/fuma/db/migrationPolicy'
import { MemoryPaystackLedger } from '../../../server/fuma/paystack/memoryLedger'
import {
  PaystackError,
  PaystackPurposeRegistry,
  ScopedPaystackTransport,
  signPaystackWebhook,
  type PaystackHttp,
  type PaystackScope,
} from '../../../server/fuma/paystack/transport'

const ORIGIN = 'https://paystack.fixture.test'
const PLATFORM_REFERENCE = 'pb_platform-recurring_0000000000000001'
const CUSTOMER_REFERENCE = 'cm_publication-membership_0000000000000001'
const PLATFORM_SECRET = 'fixture-platform-secret'
const CUSTOMER_SECRET = 'fixture-customer-secret'

const PlatformMetadataSchema = Type.Object({
  invoiceId: Type.Literal('platform-invoice-1'),
}, { additionalProperties: false })
const CustomerMetadataSchema = Type.Object({
  purchaseId: Type.Literal('membership-purchase-1'),
}, { additionalProperties: false })

const platformMetadata = Object.freeze({ invoiceId: 'platform-invoice-1' as const })
const customerMetadata = Object.freeze({ purchaseId: 'membership-purchase-1' as const })

function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

function labels(scope: PaystackScope, purpose: string, metadata: unknown) {
  return {
    payment_purpose: purpose,
    credential_scope: scope,
    obligation_sha256: sha256(JSON.stringify(metadata)),
  }
}

class DeterministicPaystackFixture implements PaystackHttp {
  readonly requests: Array<Readonly<{ url: string; authorization: string; body?: string }>> = []
  readonly #transactions = new Map<string, Record<string, unknown>>()
  mutateVerify: ((body: Record<string, unknown>) => Record<string, unknown>) | undefined

  seed(reference: string, transaction: Record<string, unknown>): void {
    this.#transactions.set(reference, transaction)
  }

  async request(input: Readonly<{
    url: string
    method: 'GET' | 'POST'
    headers: Readonly<Record<string, string>>
    body?: string
  }>): Promise<Readonly<{ status: number; body: unknown }>> {
    this.requests.push({
      url: input.url,
      authorization: input.headers.authorization ?? '',
      ...(input.body === undefined ? {} : { body: input.body }),
    })
    if (input.method === 'POST' && input.url === `${ORIGIN}/transaction/initialize`) {
      const body = JSON.parse(input.body ?? '{}') as { reference?: string }
      return {
        status: 200,
        body: {
          status: true,
          data: {
            reference: body.reference,
            authorization_url: `https://checkout.fixture.test/${body.reference}`,
          },
        },
      }
    }
    const prefix = `${ORIGIN}/transaction/verify/`
    if (input.method === 'GET' && input.url.startsWith(prefix)) {
      const reference = decodeURIComponent(input.url.slice(prefix.length))
      const transaction = this.#transactions.get(reference)
      if (!transaction) return { status: 404, body: { status: false } }
      const body = { status: true, data: { ...transaction } }
      return { status: 200, body: this.mutateVerify ? this.mutateVerify(body) : body }
    }
    return { status: 503, body: { status: false } }
  }
}

function registry(settlements: string[] = []): PaystackPurposeRegistry {
  return new PaystackPurposeRegistry()
    .register({
      id: 'platform-recurring',
      scope: 'platform_billing',
      metadataSchema: PlatformMetadataSchema,
      async authorize() {},
      expected() { return { amountMinor: 10_001, currency: 'KES' } },
      async settle() { settlements.push('platform') },
    })
    .register({
      id: 'publication-membership',
      scope: 'customer_merchant',
      metadataSchema: CustomerMetadataSchema,
      async authorize() {},
      expected() { return { amountMinor: 25_002, currency: 'KES' } },
      async settle() { settlements.push('customer') },
    })
}

function fixture() {
  let claim = 0
  const ledger = new MemoryPaystackLedger(() => `claim-${++claim}`)
  const http = new DeterministicPaystackFixture()
  const settlements: string[] = []
  const purposes = registry(settlements)
  const platform = new ScopedPaystackTransport(
    { scope: 'platform_billing', publicKey: 'fixture-platform-public', secretKey: PLATFORM_SECRET },
    http,
    ledger,
    purposes,
    { providerBaseUrl: ORIGIN, referenceFactory: () => PLATFORM_REFERENCE },
  )
  const customer = new ScopedPaystackTransport(
    { scope: 'customer_merchant', publicKey: 'fixture-customer-public', secretKey: CUSTOMER_SECRET },
    http,
    ledger,
    purposes,
    { providerBaseUrl: ORIGIN, referenceFactory: () => CUSTOMER_REFERENCE },
  )
  http.seed(PLATFORM_REFERENCE, {
    id: 'platform-transaction-1',
    reference: PLATFORM_REFERENCE,
    status: 'success',
    amount: 10_001,
    currency: 'KES',
    channel: 'card',
    metadata: labels('platform_billing', 'platform-recurring', platformMetadata),
    authorization: { authorization_code: 'AUTH_platform', reusable: true, brand: 'visa' },
    customer: { customer_code: 'CUS_platform' },
  })
  http.seed(CUSTOMER_REFERENCE, {
    id: 'customer-transaction-1',
    reference: CUSTOMER_REFERENCE,
    status: 'success',
    amount: 25_002,
    currency: 'KES',
    channel: 'mobile_money',
    metadata: labels('customer_merchant', 'publication-membership', customerMetadata),
    authorization: { bank: 'fixture-mobile-money' },
    customer: { customer_code: 'CUS_customer' },
  })
  return { ledger, http, settlements, purposes, platform, customer }
}

function webhook(
  scope: PaystackScope,
  purpose: string,
  reference: string,
  amount: number,
  id: string,
  metadata: unknown,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    event: 'charge.success',
    data: {
      id,
      reference,
      amount,
      currency: 'KES',
      metadata: labels(scope, purpose, metadata),
    },
  }))
}

async function initializeBoth(value: ReturnType<typeof fixture>): Promise<void> {
  expect(await value.platform.initialize(
    'platform-recurring',
    platformMetadata,
    'platform@example.test',
  )).toEqual({
    reference: PLATFORM_REFERENCE,
    authorizationUrl: `https://checkout.fixture.test/${PLATFORM_REFERENCE}`,
  })
  expect(await value.customer.initialize(
    'publication-membership',
    customerMetadata,
    'member@example.test',
  )).toEqual({
    reference: CUSTOMER_REFERENCE,
    authorizationUrl: `https://checkout.fixture.test/${CUSTOMER_REFERENCE}`,
  })
}

describe('FUMA-053 strict shared Paystack primitives', () => {
  it('runs deterministic platform and customer fake transactions through isolated ledgers and webhooks', async () => {
    const value = fixture()
    await initializeBoth(value)
    const platformRaw = webhook(
      'platform_billing',
      'platform-recurring',
      PLATFORM_REFERENCE,
      10_001,
      'event-platform-1',
      platformMetadata,
    )
    const customerRaw = webhook(
      'customer_merchant',
      'publication-membership',
      CUSTOMER_REFERENCE,
      25_002,
      'event-customer-1',
      customerMetadata,
    )
    expect(await value.platform.ingestWebhook(
      platformRaw,
      signPaystackWebhook(PLATFORM_SECRET, platformRaw),
    )).toEqual({ duplicate: false, eventId: 'charge.success:event-platform-1' })
    expect(await value.customer.ingestWebhook(
      customerRaw,
      signPaystackWebhook(CUSTOMER_SECRET, customerRaw),
    )).toEqual({ duplicate: false, eventId: 'charge.success:event-customer-1' })
    expect((await value.platform.settle(
      'platform-recurring',
      PLATFORM_REFERENCE,
      platformMetadata,
    )).scope).toBe('platform_billing')
    expect((await value.customer.settle(
      'publication-membership',
      CUSTOMER_REFERENCE,
      customerMetadata,
    )).scope).toBe('customer_merchant')
    await value.platform.settle('platform-recurring', PLATFORM_REFERENCE, platformMetadata)
    await value.customer.settle('publication-membership', CUSTOMER_REFERENCE, customerMetadata)
    expect(value.settlements).toEqual(['platform', 'customer'])
    expect([...value.ledger.events.keys()].sort()).toEqual([
      'customer_merchant:charge.success:event-customer-1',
      'platform_billing:charge.success:event-platform-1',
    ])
    expect([...value.ledger.reconciliations.keys()].sort()).toEqual([
      `customer_merchant:${CUSTOMER_REFERENCE}:publication-membership`,
      `platform_billing:${PLATFORM_REFERENCE}:platform-recurring`,
    ])
    process.stdout.write(
      '[FUMA-053 demo] platform=verified+webhook+settled customer=verified+webhook+settled ledgers=isolated duplicates=idempotent\n',
    )
  })

  it('denies cross-scope references, signatures, and purpose labels', async () => {
    const value = fixture()
    await initializeBoth(value)
    await expect(value.customer.verify(
      'publication-membership',
      PLATFORM_REFERENCE,
      customerMetadata,
    )).rejects.toMatchObject({ code: 'verification-mismatch' })

    const platformRaw = webhook(
      'platform_billing',
      'platform-recurring',
      PLATFORM_REFERENCE,
      10_001,
      'event-platform-cross',
      platformMetadata,
    )
    await expect(value.customer.ingestWebhook(
      platformRaw,
      signPaystackWebhook(PLATFORM_SECRET, platformRaw),
    )).rejects.toMatchObject({ code: 'tampered-webhook' })

    const wrongLabelRaw = webhook(
      'customer_merchant',
      'platform-recurring',
      PLATFORM_REFERENCE,
      10_001,
      'event-wrong-label',
      platformMetadata,
    )
    await expect(value.platform.ingestWebhook(
      wrongLabelRaw,
      signPaystackWebhook(PLATFORM_SECRET, wrongLabelRaw),
    )).rejects.toMatchObject({ code: 'verification-mismatch' })
  })

  it('denies exact integer amount, currency, and provider-label mismatches', async () => {
    const value = fixture()
    await initializeBoth(value)
    for (const mutate of [
      (data: Record<string, unknown>) => ({ ...data, amount: 10_002 }),
      (data: Record<string, unknown>) => ({ ...data, currency: 'USD' }),
      (data: Record<string, unknown>) => ({
        ...data,
        metadata: { ...(data.metadata as object), obligation_sha256: '0'.repeat(64) },
      }),
    ]) {
      value.http.mutateVerify = (body) => ({
        ...body,
        data: mutate(body.data as Record<string, unknown>),
      })
      await expect(value.platform.verify(
        'platform-recurring',
        PLATFORM_REFERENCE,
        platformMetadata,
      )).rejects.toMatchObject({ code: 'verification-mismatch' })
    }
  })

  it('authenticates raw bytes before parsing and detects changed duplicate event bytes', async () => {
    const value = fixture()
    const unknown = new TextEncoder().encode(JSON.stringify({
      event: 'provider.future-event',
      data: { id: 'same-provider-event' },
    }))
    expect(await value.platform.ingestWebhook(
      unknown,
      signPaystackWebhook(PLATFORM_SECRET, unknown),
    )).toMatchObject({ duplicate: false })
    expect(await value.platform.ingestWebhook(
      unknown,
      signPaystackWebhook(PLATFORM_SECRET, unknown),
    )).toMatchObject({ duplicate: true })
    const changed = new TextEncoder().encode(JSON.stringify({
      event: 'provider.future-event',
      data: { id: 'same-provider-event', provider_field: true },
    }))
    await expect(value.platform.ingestWebhook(
      changed,
      signPaystackWebhook(PLATFORM_SECRET, changed),
    )).rejects.toMatchObject({ code: 'duplicate' })
    await expect(value.platform.ingestWebhook(
      changed,
      signPaystackWebhook(CUSTOMER_SECRET, changed),
    )).rejects.toMatchObject({ code: 'tampered-webhook' })
  })

  it('requires strict TypeBox metadata and registered exact-scope purposes', () => {
    expect(() => new PaystackPurposeRegistry().register({
      id: 'loose-purpose',
      scope: 'platform_billing',
      metadataSchema: Type.Object({ value: Type.String() }),
      async authorize() {},
      expected() { return { amountMinor: 1, currency: 'KES' } },
      async settle() {},
    })).toThrow(PaystackError)
    const purposes = registry()
    expect(() => purposes.exact('publication-membership', 'platform_billing'))
      .toThrow(PaystackError)
    expect(() => purposes.exact('commerce-order', 'customer_merchant'))
      .toThrow(PaystackError)
  })

  it('releases a failed settlement claim and retries it exactly once', async () => {
    let attempts = 0
    const purposes = new PaystackPurposeRegistry().register({
      id: 'platform-recurring',
      scope: 'platform_billing',
      metadataSchema: PlatformMetadataSchema,
      async authorize() {},
      expected() { return { amountMinor: 10_001, currency: 'KES' } },
      async settle() {
        attempts += 1
        if (attempts === 1) throw new Error('fixture settlement failure')
      },
    })
    const value = fixture()
    const transport = new ScopedPaystackTransport(
      { scope: 'platform_billing', publicKey: 'retry-public', secretKey: PLATFORM_SECRET },
      value.http,
      value.ledger,
      purposes,
      { providerBaseUrl: ORIGIN, referenceFactory: () => PLATFORM_REFERENCE },
    )
    await transport.initialize('platform-recurring', platformMetadata, 'retry@example.test')
    await expect(transport.settle(
      'platform-recurring',
      PLATFORM_REFERENCE,
      platformMetadata,
    )).rejects.toThrow('fixture settlement failure')
    await transport.settle('platform-recurring', PLATFORM_REFERENCE, platformMetadata)
    await transport.settle('platform-recurring', PLATFORM_REFERENCE, platformMetadata)
    expect(attempts).toBe(2)
  })

  it('redacts credentials from every transport and authority summary', () => {
    const value = fixture()
    const boundary = new PaystackWebhookBoundary({
      platformBilling: value.platform,
      customerMerchant: value.customer,
    })
    const summary = JSON.stringify({
      platform: value.platform.redactedSummary(),
      customer: value.customer.redactedSummary(),
      boundary: boundary.redactedSummary(),
    })
    expect(summary).toContain('[REDACTED]')
    expect(summary).not.toContain(PLATFORM_SECRET)
    expect(summary).not.toContain(CUSTOMER_SECRET)
    expect(summary).not.toContain('fixture-platform-public')
    expect(summary).not.toContain('fixture-customer-public')
  })
})

describe('FUMA-053 centrally mounted bounded webhook authority', () => {
  it('keeps explicit platform/customer routes non-oracular and scope isolated', async () => {
    const value = fixture()
    const boundary = new PaystackWebhookBoundary({
      platformBilling: value.platform,
      customerMerchant: value.customer,
    })
    const raw = new TextEncoder().encode(JSON.stringify({
      event: 'provider.future-event',
      data: { id: 'boundary-event-1' },
    }))
    const runtime = { db: {} as never, paystackWebhooks: boundary }
    const valid = await handleServerRequest(new Request(
      `https://app.fuma.co.ke${PAYSTACK_WEBHOOK_PATHS.platform_billing}`,
      {
        method: 'POST',
        headers: { 'x-paystack-signature': signPaystackWebhook(PLATFORM_SECRET, raw) },
        body: raw,
      },
    ), runtime)
    const wrongScope = await handleServerRequest(new Request(
      `https://app.fuma.co.ke${PAYSTACK_WEBHOOK_PATHS.customer_merchant}`,
      {
        method: 'POST',
        headers: { 'x-paystack-signature': signPaystackWebhook(PLATFORM_SECRET, raw) },
        body: raw,
      },
    ), runtime)
    expect(valid.status).toBe(202)
    expect(wrongScope.status).toBe(202)
    expect(await valid.text()).toBe(await wrongScope.text())
    expect([...value.ledger.events.keys()]).toEqual([
      'platform_billing:provider.future-event:boundary-event-1',
    ])
  })

  it('is mounted before hosted/CMS routing and reserves only additive migration 000045', () => {
    const root = join(import.meta.dir, '../../..')
    const router = readFileSync(join(root, 'server/router.ts'), 'utf8')
    const startup = readFileSync(join(root, 'server/index.ts'), 'utf8')
    const migrationIndex = readFileSync(join(root, 'server/fuma/db/migrations/index.ts'), 'utf8')
    expect(router).toContain('tryServePaystackWebhooks')
    expect(router.indexOf('tryServePaystackWebhooks')).toBeLessThan(router.indexOf('tryServeFumaScopedApi'))
    expect(startup).toContain('createHostedPaystackRuntime')
    expect(startup).toContain('paystackWebhooks: platformBillingRuntime?.webhooks ?? paystackRuntime?.webhooks')
    expect(migrationIndex).toContain('000045_paystack_reconciliation')
    expect(paystackReconciliationMigration.id).toBe('000045_paystack_reconciliation')
    expect(paystackReconciliationMigration.sql).not.toMatch(/\b(?:drop|truncate|delete\s+from|alter\s+table)\b/i)
    expect(hostedMigrationChecksum(paystackReconciliationMigration.sql)).toMatch(/^[a-f0-9]{64}$/)
  })
})
