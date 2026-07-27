import { createPostgresClient } from '../../../server/db/postgres'
import { workspacesMigration } from '../../../server/fuma/db/migrations/000005_workspaces'
import { sitesMigration } from '../../../server/fuma/db/migrations/000006_sites'
import { meteringMigration } from '../../../server/fuma/db/migrations/000024_metering'
import { paystackPrimitivesMigration } from '../../../server/fuma/db/migrations/000025_paystack_primitives'
import { entitlementsMigration } from '../../../server/fuma/db/migrations/000026_entitlements'
import { checkoutMigration } from '../../../server/fuma/db/migrations/000027_checkout'
import { billingReconciliationMigration } from '../../../server/fuma/db/migrations/000028_billing_reconciliation'
import { paystackReconciliationMigration } from '../../../server/fuma/db/migrations/000045_paystack_reconciliation'
import { entitlementEvidenceMigration } from '../../../server/fuma/db/migrations/000057_entitlement_evidence'
import {
  PlatformCheckoutService,
  PostgresPlatformCheckoutRepository,
  platformCheckoutAuthorityMigrationCandidate,
  registerPlatformCheckoutPurposes,
} from '../../../server/fuma/checkout'
import {
  EntitlementService,
  PostgresEntitlementRepository,
  PostgresOfferDestinationAuthority,
  type QuotaEnvelope,
  type WorkloadAssumptions,
} from '../../../server/fuma/entitlements'
import {
  HOSTED_COST_BASELINE_V1,
  METER_CLASSES,
  PostgresProviderCostCatalog,
} from '../../../server/fuma/metering'
import { PostgresPaystackLedger } from '../../../server/fuma/paystack/repository'
import {
  PaystackPurposeRegistry,
  ScopedPaystackTransport,
  type PaystackHttp,
} from '../../../server/fuma/paystack/transport'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = new Date('2026-07-28T09:00:00.000Z')
const PROVIDER_ORIGIN = 'https://api.paystack.postgres.test'
const quotas: QuotaEnvelope = Object.freeze({
  sites: 1, pages: 10, cmsItems: 10, members: 10, storageBytes: 10,
  bandwidthBytes: 10, emailRecipientsDay: 10, emailRecipientsMonth: 100,
  buildPublishMinutes: 10, pluginComputeMinutes: 10, aiCredits: 10,
  releaseRetentionBytes: 10, collaborators: 2, customDomains: 1,
})
const workload = Object.freeze(Object.fromEntries(
  METER_CLASSES.map((meter) => [meter, 1]),
)) as WorkloadAssumptions
const setupWorkload = Object.freeze(Object.fromEntries(
  METER_CLASSES.map((meter) => [meter, 0]),
)) as WorkloadAssumptions

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}
function scopedPostgresUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

type Initialization = Readonly<{
  reference: string
  amount: number
  currency: string
  metadata: Record<string, unknown>
}>
class LiveCheckoutHttp implements PaystackHttp {
  readonly initializations = new Map<string, Initialization>()
  initializeCalls = 0
  async request(input: Readonly<{
    url: string
    method: 'GET' | 'POST'
    headers: Readonly<Record<string, string>>
    body?: string
  }>): Promise<Readonly<{ status: number; body: unknown }>> {
    if (input.method === 'POST' && input.url === `${PROVIDER_ORIGIN}/transaction/initialize`) {
      const body = JSON.parse(input.body ?? '{}') as Initialization
      this.initializeCalls += 1
      this.initializations.set(body.reference, body)
      await Bun.sleep(15)
      return {
        status: 200,
        body: {
          status: true,
          data: {
            reference: body.reference,
            authorization_url: `https://checkout.postgres.test/pay/${body.reference}`,
          },
        },
      }
    }
    const prefix = `${PROVIDER_ORIGIN}/transaction/verify/`
    if (input.method === 'GET' && input.url.startsWith(prefix)) {
      const reference = decodeURIComponent(input.url.slice(prefix.length))
      const initialized = this.initializations.get(reference)
      if (!initialized) return { status: 404, body: { status: false } }
      return {
        status: 200,
        body: {
          status: true,
          data: {
            id: `txn-${reference}`,
            reference,
            status: 'success',
            amount: initialized.amount,
            currency: initialized.currency,
            channel: 'card',
            metadata: initialized.metadata,
            authorization: { authorization_code: 'AUTH_private', reusable: true },
            customer: { customer_code: 'CUS_private' },
          },
        },
      }
    }
    return { status: 503, body: { status: false } }
  }
}

describe('FUMA-055 optional live PostgreSQL acceptance', () => {
  it.skipIf(postgresUrl === undefined)('converges checkout and verifies callbacks without settlement or activation', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_checkout_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quotedIdentifier(schema)}`)
    const db = createPostgresClient(scopedPostgresUrl(postgresUrl, schema))
    try {
      await db.unsafe('create table auth_organizations(id text primary key); create table auth_users(id text primary key)')
      await db.transaction(async (tx) => {
        for (const migration of [
          workspacesMigration,
          sitesMigration,
          meteringMigration,
          paystackPrimitivesMigration,
          entitlementsMigration,
          checkoutMigration,
          billingReconciliationMigration,
          paystackReconciliationMigration,
          entitlementEvidenceMigration,
        ]) await tx.unsafe(migration.sql)
        await tx.unsafe(platformCheckoutAuthorityMigrationCandidate.sql)
      })
      await db.unsafe("insert into auth_organizations(id) values ('org-a'); insert into auth_users(id) values ('user-a'); insert into fuma_workspaces(id,organization_id,slug,name,status,is_default) values ('workspace-a','org-a','primary','Primary','active',true); insert into fuma_sites(organization_id,workspace_id,id,slug,name,status,profile_id) values ('org-a','workspace-a','site-a','site-a','Site A','active','website')")
      const catalog = new PostgresProviderCostCatalog(db, () => NOW)
      for (const input of HOSTED_COST_BASELINE_V1) await catalog.append(input)
      const entitlementRepository = new PostgresEntitlementRepository(db)
      const entitlements = new EntitlementService({
        repository: entitlementRepository,
        destinations: new PostgresOfferDestinationAuthority(db),
        catalog,
        usdMicrosToKesMinor: (value) => Number(value / 100n),
        costConversionVersion: 'test-kes-fx-v1',
        now: () => NOW,
      })
      const planBase = {
        planId: 'business',
        slug: 'business',
        name: 'Business',
        summary: 'A complete paid website plan for PostgreSQL checkout acceptance.',
        profile: 'website' as const,
        amountMinor: 120_000,
        offeringClass: 'paid' as const,
        quotas,
        workloadAssumptions: workload,
        featureKeys: ['publishing'],
        promotion: null,
        checkoutAvailable: true,
        expiresAt: null,
      }
      await entitlements.publishPriceBook({
        version: 'book-postgres-v1',
        currency: 'KES',
        effectiveAt: '2026-07-01T00:00:00.000Z',
        plans: [
          { ...planBase, cadence: 'monthly' },
          { ...planBase, cadence: 'annual' },
        ],
      })
      const proposed = await entitlements.propose({
        offerId: 'offer-postgres-checkout',
        version: 1,
        destinationOrganizationId: 'org-a',
        destinationWorkspaceId: 'workspace-a',
        siteId: 'site-a',
        currency: 'KES',
        recurringAmountMinor: 180_000,
        cadence: 'annual',
        setupFeeMinor: 35_000,
        quotas,
        workloadAssumptions: workload,
        setupWorkloadAssumptions: setupWorkload,
        termsHash: 'a'.repeat(64),
        effectiveAt: '2026-07-01T00:00:00.000Z',
        expiresAt: '2026-08-15T00:00:00.000Z',
        renewalAt: '2027-07-01T00:00:00.000Z',
        renewalPolicy: 'same-terms',
        discount: null,
        replaces: null,
      })
      await entitlements.issue(proposed)

      let reference = 0
      const checkoutRepository = new PostgresPlatformCheckoutRepository(db, {
        now: () => NOW,
        claimFactory: () => crypto.randomUUID(),
      })
      const registry = new PaystackPurposeRegistry()
      registerPlatformCheckoutPurposes(registry, checkoutRepository)
      const http = new LiveCheckoutHttp()
      const transport = new ScopedPaystackTransport(
        { scope: 'platform_billing', publicKey: 'pk_live_test', secretKey: 'sk_live_test' },
        http,
        new PostgresPaystackLedger(db, { now: () => NOW }),
        registry,
        { providerBaseUrl: PROVIDER_ORIGIN },
      )
      const service = new PlatformCheckoutService(
        transport,
        checkoutRepository,
        {
          async acceptExactIssuedOffer(input) {
            await entitlements.accept({
              offerId: input.offerId,
              version: input.offerVersion,
              destinationOrganizationId: input.destination.organizationId,
              destinationWorkspaceId: input.destination.workspaceId,
              siteId: input.destination.siteId,
            })
          },
        },
        {
          callbackOrigin: 'https://app.postgres.test',
          allowedChannels: ['card'],
          allowedAuthorizationOrigins: ['https://checkout.postgres.test'],
          referenceFactory: (kind) => `pb_platform-${kind}_${String(++reference).padStart(20, '0')}`,
        },
      )
      const authority = {
        destination: {
          organizationId: 'org-a',
          workspaceId: 'workspace-a',
          siteId: 'site-a',
          profileId: 'website',
        },
        customerActorId: 'user-a',
        payerEmail: 'owner@example.test',
      }
      const standard = await service.initialize({
        source: {
          kind: 'public-plan',
          planId: 'business',
          priceBookVersion: 'book-postgres-v1',
          cadence: 'annual',
        },
      }, authority)
      expect(standard).toMatchObject({
        state: 'awaiting-payment',
        setup: null,
        recurring: { amountMinor: 120_000, state: 'ready' },
      })
      const intent = {
        source: {
          kind: 'private-offer' as const,
          offerId: 'offer-postgres-checkout',
          offerVersion: 1,
        },
      }
      const concurrent = await Promise.all(
        Array.from({ length: 8 }, () => service.initialize(intent, authority)),
      )
      expect(new Set(concurrent.map(({ checkoutId }) => checkoutId))).toHaveLength(1)
      expect(new Set(concurrent.map(({ setup }) => setup?.reference))).toHaveLength(1)
      expect(new Set(concurrent.map(({ recurring }) => recurring.reference))).toHaveLength(1)
      expect(http.initializeCalls).toBe(3)
      const checkout = concurrent[0]!
      expect(checkout).toMatchObject({
        state: 'awaiting-payment',
        setup: { amountMinor: 35_000, state: 'ready' },
        recurring: { amountMinor: 180_000, state: 'ready' },
      })
      const callback = await service.verifyCallback(
        authority.destination,
        checkout.checkoutId,
        checkout.recurring.reference!,
      )
      expect(callback.recurring.state).toBe('callback-verified')
      expect(callback.state).toBe('awaiting-payment')
      const counts = await db.unsafe<{
        checkouts: string | number
        obligations: string | number
        candidates: string | number
        contracts: string | number
        reconciliations: string | number
      }>('select (select count(*) from fuma_platform_checkout_candidates_v2) checkouts,(select count(*) from fuma_platform_checkout_obligations_v2) obligations,(select count(*) from fuma_contract_candidates) candidates,(select count(*) from fuma_organization_contracts) contracts,(select count(*) from fuma_paystack_reconciliations) reconciliations')
      expect(counts.rows[0]).toEqual({
        checkouts: '2',
        obligations: '3',
        candidates: '1',
        contracts: '0',
        reconciliations: '0',
      })
      process.stdout.write('[FUMA-055 PostgreSQL demo] standard=1 customConcurrent=8 checkouts=2 obligations=3 callbackVerified=true settled=0 contracts=0\n')
    } finally {
      await admin.unsafe(`drop schema if exists ${quotedIdentifier(schema)} cascade`)
    }
  }, 30_000)
})
