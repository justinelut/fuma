import { createPostgresClient } from '../../../server/db/postgres'
import { PostgresPaidHandoffOutboxAuthority, PostgresPaidHandoffReadinessAuthority } from '../../../server/fuma/transfers'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const source = { platformId: 'platform-ke', organizationId: 'org-source', workspaceId: 'workspace-source', siteId: 'site-ke' }
const destination = { platformId: 'platform-ke', organizationId: 'org-destination', workspaceId: 'workspace-destination', siteId: 'site-ke' }
function quote(value: string): string { if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.'); return `"${value}"` }
function scoped(connection: string, schema: string): string { const url = new URL(connection); url.searchParams.set('options', `-c search_path=${schema},public`); return url.toString() }

describe('FUMA-074 optional native PostgreSQL acceptance', () => {
  test.skipIf(!postgresUrl)('serializes exact paid handoff delivery, replay, and recovery on PostgreSQL', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_paid_handoff_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await db.unsafe(`
        create table fuma_custom_offers(offer_id text not null,version bigint not null,destination_organization_id text not null,destination_workspace_id text not null,site_id text not null,setup_fee_minor bigint not null,recurring_amount_minor bigint not null,currency text not null,cadence text not null,state text not null,primary key(offer_id,version));
        create table fuma_custom_offer_evidence(offer_id text not null,offer_version bigint not null,accepted_at timestamptz null,primary key(offer_id,offer_version));
        create table fuma_contract_candidates(candidate_id text primary key,offer_id text not null,offer_version bigint not null);
        create table fuma_organization_contracts(contract_id text primary key,candidate_id text null,organization_id text not null,workspace_id text not null,site_id text not null,state text not null,activated_at timestamptz not null,source_kind text null,source_id text null,source_version text null);
        create table fuma_paid_handoff_outbox(command_id text primary key,contract_id text not null,state text not null,created_at timestamptz not null,delivered_at timestamptz null);
        create table fuma_site_transfer_proposals(platform_id text not null,id text not null,source_site_id text not null,destination_organization_id text not null,destination_workspace_id text not null,destination_site_id text not null,primary key(platform_id,id));
        insert into fuma_custom_offers values('offer-ke',4,'org-destination','workspace-destination','site-ke',125000,75000,'KES','monthly','accepted');
        insert into fuma_custom_offer_evidence values('offer-ke',4,'2026-07-31T06:00:00Z');
        insert into fuma_contract_candidates values('candidate-ke','offer-ke',4);
        insert into fuma_organization_contracts values('contract-ke','candidate-ke','org-destination','workspace-destination','site-ke','paid-transfer-pending','2026-07-31T06:00:00Z',null,null,null);
        insert into fuma_paid_handoff_outbox values('command-ke','contract-ke','pending','2026-07-31T06:00:00Z',null);
        insert into fuma_site_transfer_proposals values('platform-ke','transfer-ke','site-ke','org-destination','workspace-destination','site-ke');
      `)
      const readiness = new PostgresPaidHandoffReadinessAuthority({
        db,
        identity: { resolve: async () => ({ transferId: 'transfer-ke', source, destination }) },
        current: { resolve: async () => ({ destinationActive: true, quotaAccepted: true, policyAcceptanceCurrent: true, meteringEvidenceCurrent: true }) },
      })
      expect(await readiness.resolve('command-ke')).toMatchObject({ transferId: 'transfer-ke', contractId: 'contract-ke', offerVersion: 4, paymentState: 'paid-transfer-pending', internalGrantExcluded: true, currency: 'KES', locale: 'en-KE', timezone: 'Africa/Nairobi', destination })
      const outbox = new PostgresPaidHandoffOutboxAuthority(db)
      const transition = { commandId: 'command-ke', from: 'pending' as const, to: 'delivered' as const, transferId: 'transfer-ke', occurredAt: '2026-07-31T06:05:00.000Z' }
      await Promise.all(Array.from({ length: 8 }, () => outbox.transition(transition)))
      const delivered = await db<{ state: string; delivered_at: Date | string | null }>`select state,delivered_at from fuma_paid_handoff_outbox where command_id='command-ke'`
      expect(delivered.rows[0]?.state).toBe('delivered'); expect(delivered.rows[0]?.delivered_at).not.toBeNull()
      await expect(outbox.transition({ ...transition, transferId: 'transfer-substitution' })).rejects.toThrow('transfer identity')
      await db`update fuma_paid_handoff_outbox set state='failed',delivered_at=null where command_id='command-ke'`
      const recover = { commandId: 'command-ke', from: 'failed' as const, to: 'pending' as const, transferId: 'transfer-ke', occurredAt: '2026-07-31T06:10:00.000Z' }
      await Promise.all(Array.from({ length: 8 }, () => outbox.transition(recover)))
      const recovered = await readiness.resolve('command-ke')
      expect(recovered).toMatchObject({ outboxState: 'pending', transferId: 'transfer-ke', destination })
      process.stdout.write('[FUMA-074 PostgreSQL] contention=8 delivery=converged recovery=converged exactTransfer=true exactDestination=true internalGrantExcluded=true currency=KES locale=en-KE timezone=Africa/Nairobi\n')
    } finally {
      await db.close?.()
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      const leftovers = await admin<{ count: string }>`select count(*)::text count from pg_namespace where nspname=${schema}`
      expect(leftovers.rows[0]?.count).toBe('0')
      await admin.close?.()
    }
  }, 120_000)
})
