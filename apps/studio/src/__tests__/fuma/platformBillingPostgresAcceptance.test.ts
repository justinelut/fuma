import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import {
  PlatformCheckoutMetadataSchema,
  platformCheckoutAuthorityMigration,
  type PlatformCheckoutMetadata,
} from '../../../server/fuma/checkout'
import {
  PlatformBillingReconciler,
  PostgresBillingRepository,
  platformBillingReconciliationMigrationCandidate,
} from '../../../server/fuma/billing'
import { workspacesMigration } from '../../../server/fuma/db/migrations/000005_workspaces'
import { sitesMigration } from '../../../server/fuma/db/migrations/000006_sites'
import { paystackPrimitivesMigration } from '../../../server/fuma/db/migrations/000025_paystack_primitives'
import { entitlementsMigration } from '../../../server/fuma/db/migrations/000026_entitlements'
import { checkoutMigration } from '../../../server/fuma/db/migrations/000027_checkout'
import { billingReconciliationMigration } from '../../../server/fuma/db/migrations/000028_billing_reconciliation'
import { paystackReconciliationMigration } from '../../../server/fuma/db/migrations/000045_paystack_reconciliation'
import { entitlementEvidenceMigration } from '../../../server/fuma/db/migrations/000057_entitlement_evidence'
import { PostgresPaystackLedger } from '../../../server/fuma/paystack/repository'
import {
  PaystackPurposeRegistry,
  ScopedPaystackTransport,
  signPaystackWebhook,
  type PaystackHttp,
} from '../../../server/fuma/paystack/transport'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = new Date('2026-07-29T09:00:00.000Z')
const ORIGIN = 'https://paystack.billing.postgres.test'
const SECRET = 'postgres-platform-billing-secret'
const PRIVATE_SETUP = 'pb_platform-setup_0000000000000201'
const PRIVATE_RECURRING = 'pb_platform-recurring_0000000000000201'
const PUBLIC_RECURRING = 'pb_platform-recurring_0000000000000202'

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
  metadata: Readonly<{
    payment_purpose: string
    credential_scope: 'platform_billing'
    obligation_sha256: string
  }>
}>

class LiveBillingHttp implements PaystackHttp {
  readonly initializations = new Map<string, Initialization>()

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
            authorization_url: `https://checkout.billing.postgres.test/${body.reference}`,
          },
        },
      }
    }
    const prefix = `${ORIGIN}/transaction/verify/`
    if (input.method === 'GET' && input.url.startsWith(prefix)) {
      const reference = decodeURIComponent(input.url.slice(prefix.length))
      const initialized = this.initializations.get(reference)
      if (!initialized) return { status: 404, body: { status: false } }
      return {
        status: 200,
        body: {
          status: true,
          data: {
            id: `transaction:${reference}`,
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

function metadata(
  checkoutId: string,
  candidateId: string,
  kind: 'setup' | 'recurring',
  amountMinor: number,
  sourceKind: 'public-plan' | 'private-offer',
): PlatformCheckoutMetadata {
  const privateSource = sourceKind === 'private-offer'
  return {
    checkoutId,
    candidateId,
    sourceKind,
    sourceId: privateSource ? 'offer-postgres' : 'business',
    sourceVersion: privateSource ? '1' : 'book-postgres-v1',
    organizationId: privateSource ? 'organization-private' : 'organization-public',
    workspaceId: privateSource ? 'workspace-private' : 'workspace-public',
    siteId: privateSource ? 'site-private' : 'site-public',
    customerActorId: 'staff-owner',
    payerEmailSha256: 'a'.repeat(64),
    kind,
    amountMinor,
    currency: 'KES',
    cadence: 'annual',
    callbackUrl: `https://app.fuma.test/admin/settings/billing?checkout=${checkoutId}`,
    allowedChannels: ['card'],
    evidenceSha256: privateSource ? 'b'.repeat(64) : 'c'.repeat(64),
  }
}

function webhook(
  http: LiveBillingHttp,
  event: string,
  reference: string,
  id: number,
): Uint8Array {
  const initialized = http.initializations.get(reference)
  if (!initialized) throw new Error('Reference was not initialized.')
  return new TextEncoder().encode(JSON.stringify({
    event,
    data: {
      id,
      reference,
      amount: initialized.amount,
      currency: initialized.currency,
      metadata: initialized.metadata,
      created_at: new Date(NOW.getTime() + id).toISOString(),
    },
  }))
}

async function initialize(
  transport: ScopedPaystackTransport,
  reference: string,
  value: PlatformCheckoutMetadata,
): Promise<void> {
  await transport.initialize(
    `platform-${value.kind}`,
    value,
    'owner@example.test',
    { reference },
  )
}

describe('FUMA-056 optional live PostgreSQL acceptance', () => {
  it.skipIf(postgresUrl === undefined)('converges ordered settlement, activation, and handoff without ownership mutation', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_billing_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quotedIdentifier(schema)}`)
    const db = createPostgresClient(scopedPostgresUrl(postgresUrl, schema))
    try {
      await db.unsafe('create table auth_organizations(id text primary key); create table auth_users(id text primary key)')
      await db.transaction(async (tx) => {
        for (const migration of [
          workspacesMigration,
          sitesMigration,
          paystackPrimitivesMigration,
          entitlementsMigration,
          checkoutMigration,
          billingReconciliationMigration,
          paystackReconciliationMigration,
          entitlementEvidenceMigration,
          platformCheckoutAuthorityMigration,
        ]) await tx.unsafe(migration.sql)
        await tx.unsafe(platformBillingReconciliationMigrationCandidate.sql)
      })
      await db.unsafe(`
        insert into auth_organizations(id) values ('organization-private'),('organization-public');
        insert into auth_users(id) values ('staff-owner');
        insert into fuma_workspaces(id,organization_id,slug,name,status,is_default) values
          ('workspace-private','organization-private','private','Private','active',true),
          ('workspace-public','organization-public','public','Public','active',true);
        insert into fuma_sites(organization_id,workspace_id,id,slug,name,status,profile_id) values
          ('organization-private','workspace-private','site-private','private-site','Private Site','active','website'),
          ('organization-public','workspace-public','site-public','public-site','Public Site','active','website');
        insert into fuma_custom_offers(
          offer_id,version,destination_organization_id,destination_workspace_id,site_id,currency,
          recurring_amount_minor,cadence,setup_fee_minor,assumptions_json,quota_json,terms_hash,
          cost_model_version,expected_cost_minor,margin_basis_points,state,effective_at,expires_at
        ) values (
          'offer-postgres',1,'organization-private','workspace-private','site-private','KES',
          180000,'annual',35000,'{}'::jsonb,'{}'::jsonb,'terms','cost-v1',1000,8000,
          'accepted','2026-07-01T00:00:00.000Z','2026-08-30T00:00:00.000Z'
        );
        insert into fuma_contract_candidates(
          candidate_id,offer_id,offer_version,state,setup_fee_settled,recurring_settled,
          activated_at,destination_organization_id,destination_workspace_id,site_id,
          snapshot_sha256,created_at,paid_transfer_pending
        ) values (
          'candidate-private','offer-postgres',1,'awaiting-payment',false,false,null,
          'organization-private','workspace-private','site-private',repeat('d',64),
          '2026-07-29T09:00:00.000Z',false
        );
        insert into fuma_platform_checkout_candidates_v2(
          checkout_id,candidate_id,entitlement_candidate_id,source_kind,source_id,source_version,
          organization_id,workspace_id,site_id,profile_id,customer_actor_id,payer_email_sha256,
          cadence,currency,recurring_amount_minor,setup_fee_minor,callback_url,allowed_channels,
          evidence_sha256,state,created_at,cancelled_at
        ) values
          ('checkout-private','candidate-private','candidate-private','private-offer','offer-postgres','1',
            'organization-private','workspace-private','site-private','website','staff-owner',repeat('a',64),
            'annual','KES',180000,35000,'https://app.fuma.test/admin/settings/billing?checkout=checkout-private',
            array['card'],repeat('b',64),'awaiting-payment','2026-07-29T09:00:00.000Z',null),
          ('checkout-public','candidate-public',null,'public-plan','business','book-postgres-v1',
            'organization-public','workspace-public','site-public','website','staff-owner',repeat('a',64),
            'annual','KES',120000,0,'https://app.fuma.test/admin/settings/billing?checkout=checkout-public',
            array['card'],repeat('c',64),'awaiting-payment','2026-07-29T09:00:00.000Z',null);
        insert into fuma_platform_checkout_obligations_v2(
          checkout_id,kind,reference,amount_minor,currency,state,authorization_url,claim_id,
          claim_expires_at,callback_verified_at,attempt_count,created_at,updated_at
        ) values
          ('checkout-private','setup','${PRIVATE_SETUP}',35000,'KES','ready','https://checkout.paystack.test/setup',null,null,null,1,'2026-07-29T09:00:00.000Z','2026-07-29T09:00:00.000Z'),
          ('checkout-private','recurring','${PRIVATE_RECURRING}',180000,'KES','ready','https://checkout.paystack.test/recurring',null,null,null,1,'2026-07-29T09:00:00.000Z','2026-07-29T09:00:00.000Z'),
          ('checkout-public','recurring','${PUBLIC_RECURRING}',120000,'KES','ready','https://checkout.paystack.test/public',null,null,null,1,'2026-07-29T09:00:00.000Z','2026-07-29T09:00:00.000Z');
      `)

      const privateSetup = metadata('checkout-private', 'candidate-private', 'setup', 35_000, 'private-offer')
      const privateRecurring = metadata('checkout-private', 'candidate-private', 'recurring', 180_000, 'private-offer')
      const publicRecurring = metadata('checkout-public', 'candidate-public', 'recurring', 120_000, 'public-plan')
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
      const http = new LiveBillingHttp()
      const transport = new ScopedPaystackTransport(
        { scope: 'platform_billing', publicKey: 'platform-public', secretKey: SECRET },
        http,
        new PostgresPaystackLedger(db, { now: () => NOW }),
        registry,
        { providerBaseUrl: ORIGIN },
      )
      await initialize(transport, PRIVATE_SETUP, privateSetup)
      await initialize(transport, PRIVATE_RECURRING, privateRecurring)
      await initialize(transport, PUBLIC_RECURRING, publicRecurring)

      let claim = 0
      const first = new PlatformBillingReconciler(
        transport,
        new PostgresBillingRepository(db, {
          now: () => NOW,
          claimFactory: () => `claim-a-${++claim}`,
        }),
        () => NOW,
      )
      const second = new PlatformBillingReconciler(
        transport,
        new PostgresBillingRepository(db, {
          now: () => NOW,
          claimFactory: () => `claim-b-${++claim}`,
        }),
        () => NOW,
      )
      for (const [event, reference, id] of [
        ['charge.success', PRIVATE_RECURRING, 42],
        ['charge.success', PUBLIC_RECURRING, 40],
        ['charge.success', PRIVATE_SETUP, 41],
      ] as const) {
        const raw = webhook(http, event, reference, id)
        await first.ingest(raw, signPaystackWebhook(SECRET, raw))
      }
      const reductions = await Promise.all(
        Array.from({ length: 8 }, (_, index) => (index % 2 ? first : second).reducePending()),
      )
      expect(reductions.reduce((sum, result) => sum + result.processed, 0)).toBe(3)

      const evidence = await db<{
        events: string | number
        obligations: string | number
        contracts: string | number
        active_contracts: string | number
        pending_contracts: string | number
        handoffs: string | number
        candidates: string | number
      }>`
        select
          (select count(*) from fuma_billing_events where state='reduced') events,
          (select count(*) from fuma_platform_checkout_obligations_v2 where settled_at is not null) obligations,
          (select count(*) from fuma_organization_contracts) contracts,
          (select count(*) from fuma_organization_contracts where state='active') active_contracts,
          (select count(*) from fuma_organization_contracts where state='paid-transfer-pending') pending_contracts,
          (select count(*) from fuma_paid_handoff_outbox where state='pending') handoffs,
          (select count(*) from fuma_contract_candidates where state='paid-transfer-pending'
            and setup_fee_settled and recurring_settled and paid_transfer_pending) candidates
      `
      expect(evidence.rows[0]).toEqual({
        events: '3',
        obligations: '3',
        contracts: '2',
        active_contracts: '1',
        pending_contracts: '1',
        handoffs: '1',
        candidates: '1',
      })

      await db`update fuma_paid_handoff_outbox set state='failed' where contract_id='contract:checkout-private'`
      const replay = webhook(http, 'charge.success', PRIVATE_RECURRING, 43)
      await second.ingest(replay, signPaystackWebhook(SECRET, replay))
      await expect(db`
        update fuma_platform_checkout_candidates_v2
        set state='cancelled',cancelled_at=${NOW.toISOString()}
        where checkout_id='checkout-public'
      `).rejects.toThrow('settled checkout cannot be cancelled')

      expect((await second.reducePending()).processed).toBe(1)

      const disable = webhook(http, 'subscription.disable', PUBLIC_RECURRING, 44)
      const create = webhook(http, 'subscription.create', PUBLIC_RECURRING, 44)
      await second.ingest(disable, signPaystackWebhook(SECRET, disable))
      await second.ingest(create, signPaystackWebhook(SECRET, create))
      expect((await second.reducePending()).subscriptions).toBe(2)

      const preserved = await db<{
        events: string | number
        contracts: string | number
        handoffs: string | number
        handoff_command: string
        handoff_state: string
        subscription_state: string
        subscription_event: string
        private_owner: string
        public_owner: string
      }>`
        select
          (select count(*) from fuma_billing_events where state='reduced') events,
          (select count(*) from fuma_organization_contracts) contracts,
          (select count(*) from fuma_paid_handoff_outbox) handoffs,
          (select command_id from fuma_paid_handoff_outbox
            where contract_id='contract:checkout-private') handoff_command,
          (select state from fuma_paid_handoff_outbox
            where contract_id='contract:checkout-private') handoff_state,
          (select state from fuma_platform_subscription_reductions_v2
            where reference=${PUBLIC_RECURRING}) subscription_state,
          (select last_event_id from fuma_platform_subscription_reductions_v2
            where reference=${PUBLIC_RECURRING}) subscription_event,
          (select organization_id from fuma_sites where id='site-private') private_owner,
          (select organization_id from fuma_sites where id='site-public') public_owner
      `
      expect(preserved.rows[0]).toEqual({
        events: '6',
        contracts: '2',
        handoffs: '1',
        handoff_command: 'paid-handoff:contract:checkout-private',
        handoff_state: 'failed',
        subscription_state: 'disabled',
        subscription_event: 'subscription.disable:44',
        private_owner: 'organization-private',
        public_owner: 'organization-public',
      })
      process.stdout.write(
        '[FUMA-056 PostgreSQL demo] concurrent=8 orderedEvents=6 obligations=3 contracts=2 active=1 pendingTransfer=1 handoffs=1 ownershipMutations=0\n',
      )
    } finally {
      await admin.unsafe(`drop schema if exists ${quotedIdentifier(schema)} cascade`)
    }
  }, 120_000)
})
