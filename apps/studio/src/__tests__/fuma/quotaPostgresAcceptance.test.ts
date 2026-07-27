import { createPostgresClient } from '../../../server/db/postgres'
import { workspacesMigration } from '../../../server/fuma/db/migrations/000005_workspaces'
import { sitesMigration } from '../../../server/fuma/db/migrations/000006_sites'
import { meteringMigration } from '../../../server/fuma/db/migrations/000024_metering'
import { paystackPrimitivesMigration } from '../../../server/fuma/db/migrations/000025_paystack_primitives'
import { entitlementsMigration } from '../../../server/fuma/db/migrations/000026_entitlements'
import { checkoutMigration } from '../../../server/fuma/db/migrations/000027_checkout'
import { billingReconciliationMigration } from '../../../server/fuma/db/migrations/000028_billing_reconciliation'
import { quotaEnforcementMigration } from '../../../server/fuma/db/migrations/000029_quota_enforcement'
import { paystackReconciliationMigration } from '../../../server/fuma/db/migrations/000045_paystack_reconciliation'
import { entitlementEvidenceMigration } from '../../../server/fuma/db/migrations/000057_entitlement_evidence'
import { platformCheckoutAuthorityMigration } from '../../../server/fuma/db/migrations/000058_platform_checkout_authority'
import { platformBillingReconciliationMigration } from '../../../server/fuma/db/migrations/000059_platform_billing_reconciliation'
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
import { PLATFORM_ORGANIZATION_ID } from '../../../server/fuma/organizations/contracts'
import {
  quotaSelfServiceMigrationCandidate,
  createQuotaRuntime,
} from '../../../server/fuma/quotas'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const START = new Date('2026-07-29T09:00:00.000Z')
const quotas: QuotaEnvelope = Object.freeze({
  sites: 4,
  pages: 4,
  cmsItems: 10,
  members: 10,
  storageBytes: 10_000,
  bandwidthBytes: 10_000,
  emailRecipientsDay: 10,
  emailRecipientsMonth: 100,
  buildPublishMinutes: 10,
  pluginComputeMinutes: 10,
  aiCredits: 10,
  releaseRetentionBytes: 10_000,
  collaborators: 4,
  customDomains: 4,
})
const workload = Object.freeze(Object.fromEntries(METER_CLASSES.map((meter) => [meter, 1]))) as WorkloadAssumptions
const setupWorkload = Object.freeze(Object.fromEntries(METER_CLASSES.map((meter) => [meter, 0]))) as WorkloadAssumptions

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}

function scopedPostgresUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

describe('FUMA-057 optional live PostgreSQL acceptance', () => {
  it.skipIf(postgresUrl === undefined)('enforces verified quotas and restores writes after approved allowance and payment recovery', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_quotas_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quotedIdentifier(schema)}`)
    const db = createPostgresClient(scopedPostgresUrl(postgresUrl, schema))
    let now = START
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
          quotaEnforcementMigration,
          paystackReconciliationMigration,
          entitlementEvidenceMigration,
          platformCheckoutAuthorityMigration,
          platformBillingReconciliationMigration,
          quotaSelfServiceMigrationCandidate,
        ]) await tx.unsafe(migration.sql)
      })
      await db.unsafe(`
        insert into auth_organizations(id) values
          ('organization-public'),('organization-private'),('organization-grandfathered'),
          ('${PLATFORM_ORGANIZATION_ID}'),('organization-unknown');
        insert into auth_users(id) values ('staff-owner');
        insert into fuma_workspaces(id,organization_id,slug,name,status,is_default) values
          ('workspace-public','organization-public','public','Public','active',true),
          ('workspace-private','organization-private','private','Private','active',true),
          ('workspace-grandfathered','organization-grandfathered','grandfathered','Grandfathered','active',true),
          ('workspace-internal','${PLATFORM_ORGANIZATION_ID}','internal','Internal','active',true);
        insert into fuma_sites(organization_id,workspace_id,id,slug,name,status,profile_id) values
          ('organization-public','workspace-public','site-public','public-site','Public Site','active','publication'),
          ('organization-private','workspace-private','site-private','private-site','Private Site','active','website'),
          ('organization-grandfathered','workspace-grandfathered','site-grandfathered','grandfathered-site','Grandfathered Site','active','website'),
          ('${PLATFORM_ORGANIZATION_ID}','workspace-internal','site-internal','internal-site','Internal Site','active','website');
      `)
      const catalog = new PostgresProviderCostCatalog(db, () => now)
      for (const input of HOSTED_COST_BASELINE_V1) await catalog.append(input)
      const entitlementRepository = new PostgresEntitlementRepository(db)
      const entitlements = new EntitlementService({
        repository: entitlementRepository,
        destinations: new PostgresOfferDestinationAuthority(db),
        catalog,
        usdMicrosToKesMinor: (value) => Number(value / 100n),
        costConversionVersion: 'test-kes-fx-v1',
        now: () => now,
      })
      await entitlements.ensureInternalGrant(PLATFORM_ORGANIZATION_ID, quotas)
      const plan = {
        planId: 'business',
        slug: 'business',
        name: 'Business',
        summary: 'A complete paid plan for quota acceptance.',
        profile: 'publication' as const,
        offeringClass: 'paid' as const,
        quotas,
        workloadAssumptions: workload,
        featureKeys: ['publishing'],
        promotion: null,
        checkoutAvailable: true,
        expiresAt: null,
      }
      await entitlements.publishPriceBook({
        version: 'book-quota-v1',
        currency: 'KES',
        effectiveAt: '2026-07-01T00:00:00.000Z',
        plans: [
          { ...plan, cadence: 'monthly', amountMinor: 100_000_000 },
          { ...plan, cadence: 'annual', amountMinor: 1_000_000_000 },
        ],
      })
      const privateOffer = await entitlements.propose({
        offerId: 'offer-quota',
        version: 1,
        destinationOrganizationId: 'organization-private',
        destinationWorkspaceId: 'workspace-private',
        siteId: 'site-private',
        currency: 'KES',
        recurringAmountMinor: 500_000_000,
        cadence: 'annual',
        setupFeeMinor: 100_000_000,
        quotas,
        workloadAssumptions: workload,
        setupWorkloadAssumptions: setupWorkload,
        termsHash: 'd'.repeat(64),
        effectiveAt: '2026-07-01T00:00:00.000Z',
        expiresAt: '2026-08-15T00:00:00.000Z',
        renewalAt: '2027-07-01T00:00:00.000Z',
        renewalPolicy: 'same-terms',
        discount: null,
        replaces: null,
      })
      await entitlements.issue(privateOffer)
      await entitlements.accept({
        offerId: 'offer-quota',
        version: 1,
        destinationOrganizationId: 'organization-private',
        destinationWorkspaceId: 'workspace-private',
        siteId: 'site-private',
      })
      await entitlements.assignGrandfathered({
        assignmentId: 'grandfathered-quota',
        organizationId: 'organization-grandfathered',
        priceBookVersion: 'book-quota-v1',
        planId: 'business',
        cadence: 'annual',
        quotas,
        termsHash: 'e'.repeat(64),
        effectiveAt: '2026-07-01T00:00:00.000Z',
        renewalAt: '2027-07-01T00:00:00.000Z',
        source: 'legacy-customer',
        lawyerInventory: null,
      })
      await db.unsafe(`
        insert into fuma_platform_checkout_candidates_v2(
          checkout_id,candidate_id,entitlement_candidate_id,source_kind,source_id,source_version,
          organization_id,workspace_id,site_id,profile_id,customer_actor_id,payer_email_sha256,
          cadence,currency,recurring_amount_minor,setup_fee_minor,callback_url,allowed_channels,
          evidence_sha256,state,created_at,cancelled_at
        ) values (
          'checkout-public','candidate-public',null,'public-plan','business','book-quota-v1',
          'organization-public','workspace-public','site-public','publication','staff-owner',repeat('a',64),
          'annual','KES',1000000000,0,'https://app.fuma.test/admin/settings/billing',array['card'],
          repeat('b',64),'awaiting-payment','2026-07-29T09:00:00.000Z',null
        );
        insert into fuma_platform_checkout_obligations_v2(
          checkout_id,kind,reference,amount_minor,currency,state,authorization_url,claim_id,
          claim_expires_at,callback_verified_at,attempt_count,created_at,updated_at,
          provider_transaction_id,settled_at
        ) values (
          'checkout-public','recurring','pb_platform-recurring_quota0001',1000000000,'KES','ready',
          'https://checkout.fuma.test/quota',null,null,null,1,
          '2026-07-29T09:00:00.000Z','2026-07-29T09:00:00.000Z',
          'transaction-quota-1','2026-07-29T09:00:00.000Z'
        );
        insert into fuma_organization_contracts(
          contract_id,candidate_id,organization_id,workspace_id,site_id,state,activated_at,
          checkout_id,source_kind,source_id,source_version,cadence,evidence_sha256
        ) values (
          'contract-public',null,'organization-public','workspace-public','site-public','active',
          '2026-07-29T09:00:00.000Z','checkout-public','public-plan','business','book-quota-v1',
          'annual',repeat('b',64)
        );
      `)

      await db.unsafe(`
        update fuma_contract_candidates set state='paid-transfer-pending',
          setup_fee_settled=true,recurring_settled=true,
          activated_at='2026-07-29T09:00:00.000Z',paid_transfer_pending=true
        where candidate_id='candidate:offer-quota:1';
        insert into fuma_platform_checkout_candidates_v2(
          checkout_id,candidate_id,entitlement_candidate_id,source_kind,source_id,source_version,
          organization_id,workspace_id,site_id,profile_id,customer_actor_id,payer_email_sha256,
          cadence,currency,recurring_amount_minor,setup_fee_minor,callback_url,allowed_channels,
          evidence_sha256,state,created_at,cancelled_at
        ) values (
          'checkout-private','checkout-candidate-private','candidate:offer-quota:1',
          'private-offer','offer-quota','1','organization-private','workspace-private','site-private',
          'website','staff-owner',repeat('a',64),'annual','KES',500000000,100000000,
          'https://app.fuma.test/admin/settings/billing',array['card'],repeat('f',64),
          'awaiting-payment','2026-07-29T09:00:00.000Z',null
        );
        insert into fuma_organization_contracts(
          contract_id,candidate_id,organization_id,workspace_id,site_id,state,activated_at,
          checkout_id,source_kind,source_id,source_version,cadence,evidence_sha256
        ) values (
          'contract-private','candidate:offer-quota:1','organization-private','workspace-private',
          'site-private','paid-transfer-pending','2026-07-29T09:00:00.000Z','checkout-private',
          'private-offer','offer-quota','1','annual',repeat('f',64)
        );
      `)

      const runtime = createQuotaRuntime({ db, now: () => now })
      expect(await runtime.service.state('organization-public')).toMatchObject({
        source: 'public-contract',
        sourceId: 'contract-public',
      })
      expect(await runtime.service.state(PLATFORM_ORGANIZATION_ID)).toMatchObject({
        source: 'platform-internal',
        sourceId: 'platform-internal',
      })
      expect(await runtime.service.state('organization-private')).toMatchObject({
        source: 'private-contract',
        sourceId: 'contract-private',
      })
      expect(await runtime.service.state('organization-grandfathered')).toMatchObject({
        source: 'grandfathered',
        sourceId: 'grandfathered-quota',
      })
      await runtime.service.admit({
        idempotencyKey: 'private:threshold',
        organizationId: 'organization-private',
        workspaceId: 'workspace-private',
        siteId: 'site-private',
        quotaClass: 'pages',
        units: 2,
        operation: 'create',
      })
      await runtime.service.admit({
        idempotencyKey: 'internal:threshold',
        organizationId: PLATFORM_ORGANIZATION_ID,
        workspaceId: null,
        siteId: null,
        quotaClass: 'pages',
        units: 2,
        operation: 'create',
      })
      const sourceNotices = await db<{ organization_id: string; threshold: string | number }>`
        select organization_id,threshold from fuma_quota_notices_v2
        where quota_class='pages' and organization_id in ('organization-private',${PLATFORM_ORGANIZATION_ID})
        order by organization_id
      `
      expect(sourceNotices.rows.map((row) => [row.organization_id, Number(row.threshold)])).toEqual([
        [PLATFORM_ORGANIZATION_ID, 50],
        ['organization-private', 50],
      ])
      await expect(runtime.service.state('organization-unknown')).rejects.toMatchObject({
        code: 'unverified-contract',
      })

      const attempts = await Promise.allSettled(Array.from({ length: 8 }, async (_, index) => {
        const idempotencyKey = `page:${index}`
        await runtime.service.admit({
          idempotencyKey,
          organizationId: 'organization-public',
          workspaceId: 'workspace-public',
          siteId: 'site-public',
          quotaClass: 'pages',
          units: 1,
          operation: 'create',
        })
        return idempotencyKey
      }))
      const admitted = attempts.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
      expect(admitted).toHaveLength(4)
      expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(4)
      for (const idempotencyKey of admitted) {
        await runtime.service.settleReservation({
          idempotencyKey,
          actual: [{ quotaClass: 'pages', units: 1 }],
        })
      }
      const thresholds = await db<{ threshold: string | number }>`
        select threshold from fuma_quota_notices_v2
        where organization_id='organization-public' and quota_class='pages'
        order by threshold
      `
      expect(thresholds.rows.map(({ threshold }) => Number(threshold))).toEqual([50, 75, 90, 100])

      await entitlements.saveAdjustment({
        adjustmentId: 'grant-pages-demo',
        organizationId: 'organization-public',
        quotaClass: 'pages',
        units: 2,
        kind: 'grant',
        effectiveAt: '2026-07-29T00:00:00.000Z',
        expiresAt: '2026-07-30T00:00:00.000Z',
        approvedBy: 'staff-owner',
        state: 'active',
      })
      await runtime.service.admit({
        idempotencyKey: 'page:grant',
        organizationId: 'organization-public',
        workspaceId: 'workspace-public',
        siteId: 'site-public',
        quotaClass: 'pages',
        units: 2,
        operation: 'create',
      })
      await runtime.service.settleReservation({
        idempotencyKey: 'page:grant',
        actual: [{ quotaClass: 'pages', units: 2 }],
      })
      now = new Date('2026-07-31T09:00:00.000Z')
      await entitlements.saveAdjustment({
        adjustmentId: 'grant-pages-demo',
        organizationId: 'organization-public',
        quotaClass: 'pages',
        units: 2,
        kind: 'grant',
        effectiveAt: '2026-07-29T00:00:00.000Z',
        expiresAt: '2026-07-30T00:00:00.000Z',
        approvedBy: 'staff-owner',
        state: 'expired',
      })
      await expect(runtime.service.admit({
        idempotencyKey: 'page:expired-grant',
        organizationId: 'organization-public',
        workspaceId: 'workspace-public',
        siteId: 'site-public',
        quotaClass: 'pages',
        units: 1,
        operation: 'create',
      })).rejects.toMatchObject({ code: 'exhausted', preserveExisting: true })
      expect((await runtime.service.state('organization-public')).used.pages).toBe(6)

      const campaignScope = {
        organizationId: 'organization-public',
        workspaceId: 'workspace-public',
        siteId: 'site-public',
      }
      await runtime.campaign.reserve(campaignScope, 'campaign-a', 'c'.repeat(64), 3)
      await runtime.campaign.settle(campaignScope, 'campaign-a', 'c'.repeat(64), 2)
      expect(await runtime.service.state('organization-public')).toMatchObject({
        used: { emailRecipientsDay: 2, emailRecipientsMonth: 2 },
        reserved: { emailRecipientsDay: 0, emailRecipientsMonth: 0 },
      })

      await runtime.accounts.markPastDue('organization-public', 'contract-public')
      expect(await runtime.dunning.run()).toEqual({ transitioned: 1, notified: 1 })
      expect((await runtime.accounts.selfService('organization-public')).billing?.account.paymentState).toBe('grace')
      await runtime.service.admit({
        idempotencyKey: 'site:during-grace',
        organizationId: 'organization-public',
        workspaceId: 'workspace-public',
        siteId: 'site-public',
        quotaClass: 'sites',
        units: 1,
        operation: 'create',
      })
      now = new Date('2026-08-08T09:00:00.000Z')
      expect(await runtime.dunning.run()).toEqual({ transitioned: 1, notified: 1 })
      await expect(runtime.service.admit({
        idempotencyKey: 'domain:cancelled',
        organizationId: 'organization-public',
        workspaceId: 'workspace-public',
        siteId: 'site-public',
        quotaClass: 'customDomains',
        units: 1,
        operation: 'domain',
      })).rejects.toMatchObject({ code: 'payment-required', preserveExisting: true })
      const preserved = await runtime.accounts.selfService('organization-public')
      expect(preserved.usage.find(({ quotaClass }) => quotaClass === 'pages')?.used).toBe(6)
      expect(preserved.billing?.account.paymentState).toBe('cancelled')
      expect(preserved.billing?.invoices).toHaveLength(1)
      expect(preserved.billing?.transactions).toHaveLength(1)
      expect(preserved.billing?.receipts).toHaveLength(1)

      await runtime.accounts.recordVerifiedPayment('organization-public', 'contract-public')
      await runtime.service.admit({
        idempotencyKey: 'domain:recovered',
        organizationId: 'organization-public',
        workspaceId: 'workspace-public',
        siteId: 'site-public',
        quotaClass: 'customDomains',
        units: 1,
        operation: 'domain',
      })
      expect((await runtime.accounts.selfService('organization-public')).billing?.account.paymentState).toBe('current')

      const internalUsage = Object.freeze(Object.fromEntries(Object.keys(quotas).map((key) => [key, 1])))
      await runtime.collector.collect({
        idempotencyKey: 'internal:all-classes',
        organizationId: PLATFORM_ORGANIZATION_ID,
        observedAt: now.toISOString(),
        usage: internalUsage,
      })
      const internal = await runtime.accounts.selfService(PLATFORM_ORGANIZATION_ID)
      expect(internal.usage).toHaveLength(14)
      expect(internal.billing).toBeNull()
      expect(JSON.stringify(internal)).not.toContain('provider')
      expect(JSON.stringify(internal)).not.toContain('shadowCost')

      const evidence = await db<{
        snapshots: string | number
        observations: string | number
        reservations: string | number
        transitions: string | number
      }>`
        select
          (select count(*) from fuma_quota_entitlement_snapshots_v2) snapshots,
          (select count(*) from fuma_quota_usage_observations_v2) observations,
          (select count(*) from fuma_quota_reservations_v2) reservations,
          (select count(*) from fuma_billing_account_transitions_v2) transitions
      `
      expect(Number(evidence.rows[0]?.snapshots)).toBe(4)
      expect(Number(evidence.rows[0]?.observations)).toBe(1)
      expect(Number(evidence.rows[0]?.reservations)).toBeGreaterThanOrEqual(8)
      expect(Number(evidence.rows[0]?.transitions)).toBeGreaterThanOrEqual(5)
      process.stdout.write('[FUMA-057 PostgreSQL demo] freeLimit=blocked grant=applied+expired campaign=reserved+settled dunning=cancelled payment=recovered internal=redacted data=preserved\n')
    } finally {
      await admin.unsafe(`drop schema if exists ${quotedIdentifier(schema)} cascade`)
    }
  }, 45_000)
})
