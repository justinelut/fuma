import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { workspacesMigration } from '../../../server/fuma/db/migrations/000005_workspaces'
import { sitesMigration } from '../../../server/fuma/db/migrations/000006_sites'
import { meteringMigration } from '../../../server/fuma/db/migrations/000024_metering'
import { entitlementsMigration } from '../../../server/fuma/db/migrations/000026_entitlements'
import { entitlementEvidenceMigration } from '../../../server/fuma/db/migrations/000057_entitlement_evidence'
import { PLATFORM_ORGANIZATION_ID } from '../../../server/fuma/organizations/contracts'
import { HOSTED_COST_BASELINE_V1, METER_CLASSES, PostgresProviderCostCatalog } from '../../../server/fuma/metering'
import {
  EntitlementService,
  PostgresEntitlementRepository,
  PostgresOfferDestinationAuthority,
  evidenceSha256,
  type QuotaEnvelope,
  type WorkloadAssumptions,
} from '../../../server/fuma/entitlements'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = new Date('2026-07-27T10:00:00.000Z')
const quotas: QuotaEnvelope = Object.freeze({ sites: 1, pages: 10, cmsItems: 10, members: 10, storageBytes: 10, bandwidthBytes: 10, emailRecipientsDay: 10, emailRecipientsMonth: 100, buildPublishMinutes: 10, pluginComputeMinutes: 10, aiCredits: 10, releaseRetentionBytes: 10, collaborators: 2, customDomains: 1 })
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

describe('FUMA-054 optional live PostgreSQL acceptance', () => {
  it.skipIf(postgresUrl === undefined)('persists immutable evidence and atomically creates one awaiting-payment candidate', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_entitlements_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quotedIdentifier(schema)}`)
    const db = createPostgresClient(scopedPostgresUrl(postgresUrl, schema))
    try {
      await db.unsafe('create table auth_organizations(id text primary key); create table auth_users(id text primary key)')
      await db.transaction(async (tx) => {
        await tx.unsafe(workspacesMigration.sql)
        await tx.unsafe(sitesMigration.sql)
        await tx.unsafe(meteringMigration.sql)
        await tx.unsafe(entitlementsMigration.sql)
        await tx.unsafe(entitlementEvidenceMigration.sql)
      })
      await db.unsafe("insert into auth_organizations(id) values ('org-a'),('fuma-platform'); insert into fuma_workspaces(id,organization_id,slug,name,status,is_default) values ('workspace-a','org-a','primary','Primary','active',true); insert into fuma_sites(organization_id,workspace_id,id,slug,name,status,profile_id) values ('org-a','workspace-a','site-a','site-a','Site A','active','website')")
      const catalog = new PostgresProviderCostCatalog(db, () => NOW)
      for (const input of HOSTED_COST_BASELINE_V1) await catalog.append(input)
      const siteBaseline = HOSTED_COST_BASELINE_V1.find(({ meter }) => meter === 'sites')!
      await catalog.append({ ...siteBaseline, version: 'sites-quote', source: 'quote', effectiveAt: '2026-07-25T00:00:00.000Z' })
      await catalog.append({ ...siteBaseline, version: 'sites-invoice', source: 'invoice', effectiveAt: '2026-07-10T00:00:00.000Z' })
      expect(await catalog.cost('sites', 1)).toMatchObject({ version: 'sites-invoice', source: 'invoice' })
      const repository = new PostgresEntitlementRepository(db)
      const service = new EntitlementService({ repository, catalog, destinations: new PostgresOfferDestinationAuthority(db), usdMicrosToKesMinor: (value) => Number(value / 100n), costConversionVersion: 'test-kes-fx-v1', now: () => NOW })

      const internal = await Promise.all(Array.from({ length: 8 }, () => service.ensureInternalGrant(PLATFORM_ORGANIZATION_ID, quotas)))
      expect(new Set(internal.map((value) => evidenceSha256(value)))).toHaveLength(1)
      const proposed = await service.propose({
        offerId: 'offer-postgres', version: 1, destinationOrganizationId: 'org-a', destinationWorkspaceId: 'workspace-a', siteId: 'site-a',
        currency: 'KES', recurringAmountMinor: 100_000, cadence: 'monthly', setupFeeMinor: 1_000, quotas,
        workloadAssumptions: workload, setupWorkloadAssumptions: setupWorkload, termsHash: 'a'.repeat(64),
        effectiveAt: '2026-07-27T00:00:00.000Z', expiresAt: '2026-08-27T00:00:00.000Z', renewalAt: '2026-09-27T00:00:00.000Z',
        renewalPolicy: 'same-terms', discount: null, replaces: null,
      })
      const issued = await service.issue(proposed)
      const command = { offerId: issued.offerId, version: issued.version, destinationOrganizationId: 'org-a', destinationWorkspaceId: 'workspace-a', siteId: 'site-a' }
      const accepted = await Promise.all(Array.from({ length: 8 }, () => service.accept(command)))
      expect(new Set(accepted.map(({ candidateId }) => candidateId))).toHaveLength(1)
      expect(accepted[0]).toMatchObject({ state: 'awaiting-payment', activatedAt: null, paidTransferPending: false })
      const counts = await db.unsafe<{ candidates: string | number; evidence: string | number; grants: string | number }>('select (select count(*) from fuma_contract_candidates) candidates,(select count(*) from fuma_custom_offer_evidence) evidence,(select count(*) from fuma_entitlement_grants) grants')
      expect(Number(counts.rows[0]!.candidates)).toBe(1)
      expect(Number(counts.rows[0]!.evidence)).toBe(1)
      expect(Number(counts.rows[0]!.grants)).toBe(1)
      await expect(db.unsafe("update fuma_custom_offers set recurring_amount_minor=1 where offer_id='offer-postgres'")).rejects.toThrow()
      const stored = await db.unsafe<{ state: string; setup_fee_settled: boolean; recurring_settled: boolean; activated_at: string | null; paid_transfer_pending: boolean }>("select state,setup_fee_settled,recurring_settled,activated_at,paid_transfer_pending from fuma_contract_candidates where candidate_id='candidate:offer-postgres:1'")
      expect(stored.rows[0]).toEqual({ state: 'awaiting-payment', setup_fee_settled: false, recurring_settled: false, activated_at: null, paid_transfer_pending: false })
      process.stdout.write('[FUMA-054 PostgreSQL demo] internalGrant=one offerEvidence=immutable concurrentAccept=8 candidate=awaiting-payment\n')
    } finally {
      await admin.unsafe(`drop schema if exists ${quotedIdentifier(schema)} cascade`)
    }
  }, 30_000)
})
