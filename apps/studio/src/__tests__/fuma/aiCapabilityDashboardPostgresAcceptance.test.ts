import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { meteringMigration } from '../../../server/fuma/db/migrations/000024_metering'
import { siteAiScopeAuthorityMigration } from '../../../server/fuma/db/migrations/000068_site_ai_scope_authority'
import { mcpConnectorAuthorityMigration } from '../../../server/fuma/db/migrations/000069_mcp_connector_authority'
import { componentCatalogAuthorityMigration } from '../../../server/fuma/db/migrations/000075_component_catalog_authority'
import { PostgresCapabilityDashboardReadModel } from '../../../server/fuma/aiCapabilityDashboard'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = '2026-07-31T09:40:00.000Z'
const HASH = 'd'.repeat(64)
const RECEIPT_A = 'a'.repeat(64)
const RECEIPT_B = 'b'.repeat(64)
const scopeA = Object.freeze({
  platformId: 'platform-pg', organizationId: 'organization-a', workspaceId: 'workspace-a', siteId: 'site-a',
  ownerKey: 'owner-a', ownerGeneration: 3, profileId: 'website' as const,
})

function quote(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}
function scoped(connection: string, schema: string): string {
  const url = new URL(connection)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}
function receipt(receiptId: string, version: string, channel: 'site-ai'|'mcp', operationId: string) {
  return {
    receiptId,
    capabilityId: 'site.component-usage.insert',
    capabilityVersion: version,
    channel,
    operationId,
    outerReceiptId: `outer-${operationId}`,
    inputHashSha256: '1'.repeat(64),
    outputHashSha256: '2'.repeat(64),
    outcome: 'succeeded',
    metered: true,
    audited: true,
    occurredAt: NOW,
  }
}

describe('FUMA-087 optional native PostgreSQL acceptance', () => {
  it.skipIf(!postgresUrl)('isolates current-owner evidence and derives aggregate health from canonical receipts, audit, and metering', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_capability_dashboard_087_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await db.unsafe(`
        create table ai_conversations(id text primary key);
        create table ai_mcp_connectors(
          id text primary key,user_id text not null,label text not null,type text not null,
          auth_mode text not null,token_hash text unique,capabilities_json jsonb not null,
          created_at timestamptz not null,last_used_at timestamptz null,
          revoked_at timestamptz null,expires_at timestamptz null
        );
        create table fuma_tenant_owner_keys(
          platform_id text not null,owner_key text not null,organization_id text not null,
          workspace_id text not null,site_id text not null,generation bigint not null,
          state text not null,transfer_id text null,transfer_lock_id text null,
          transfer_fence bigint null,created_at timestamptz not null,updated_at timestamptz not null,
          primary key(platform_id,owner_key),
          unique(platform_id,owner_key,organization_id,workspace_id,site_id)
        );
      `)
      await db.unsafe(meteringMigration.sql)
      await db.unsafe(siteAiScopeAuthorityMigration.sql)
      await db.unsafe(mcpConnectorAuthorityMigration.sql)
      await db.unsafe(componentCatalogAuthorityMigration.sql)

      await db.unsafe(`insert into fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,generation,state,created_at,updated_at) values
        ('platform-pg','owner-a','organization-a','workspace-a','site-a',3,'active',$1,$1),
        ('platform-pg','owner-b','organization-b','workspace-b','site-b',5,'active',$1,$1)`, [NOW])
      await db.unsafe(`insert into ai_conversations(id) values ('conversation-a')`)
      await db.unsafe(`insert into fuma_site_ai_conversation_bindings(
        conversation_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,
        actor_id,session_id,editor_session_id,created_at
      ) values ('conversation-a','platform-pg','organization-a','workspace-a','site-a','owner-a',3,'website','actor-a','session-a','editor-a',$1)`, [NOW])
      await db.unsafe(`insert into fuma_site_ai_snapshot_bindings(
        snapshot_id,conversation_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,
        actor_id,sequence,snapshot_hash_sha256,created_at
      ) values ('snapshot-a','conversation-a','platform-pg','organization-a','workspace-a','site-a','owner-a',3,'website','actor-a',0,$2,$1)`, [NOW, HASH])
      await db.unsafe(`insert into fuma_site_ai_turn_jobs(
        job_id,conversation_id,snapshot_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,
        actor_id,session_id,editor_session_id,authority_revision,provider_id,model_id,required_capability,reservation_id,state,attempt,
        created_at,updated_at
      ) values
        ('job-success','conversation-a','snapshot-a','platform-pg','organization-a','workspace-a','site-a','owner-a',3,'website','actor-a','session-a','editor-a',3,'provider','model','ai.chat','reservation-success','succeeded',1,$1,$1),
        ('job-failed','conversation-a','snapshot-a','platform-pg','organization-a','workspace-a','site-a','owner-a',3,'website','actor-a','session-a','editor-a',3,'provider','model','ai.chat','reservation-failed','failed',1,$1,$1)`, [NOW])
      await db.unsafe(`
        insert into fuma_site_ai_tool_receipts(job_id,tool_call_id,tool_name,input_hash_sha256,mutates,state,attempt,output_json,created_at,completed_at) values
          ('job-success','operation-a','site_insert_component',$1,true,'completed',1,$2::text::jsonb,$3,$3),
          ('job-failed','operation-failed','site_insert_component',$1,true,'failed',1,$4::text::jsonb,$3,$3)
      `, [HASH, JSON.stringify({ ok: true, data: { receipt: receipt(RECEIPT_A, '1.0.0', 'site-ai', 'operation-a') } }), NOW, JSON.stringify({ ok: false, error: 'Capability execution failed.' })])

      await db.unsafe(`insert into ai_mcp_connectors(id,user_id,label,type,auth_mode,token_hash,capabilities_json,created_at) values
        ('connector-a','actor-a','Current owner connector','remote','bearer',$1,'[]'::jsonb,$3),
        ('connector-b','actor-b','Revoked tenant connector','remote','bearer',$2,'[]'::jsonb,$3)`, ['3'.repeat(64), '4'.repeat(64), NOW])
      await db.unsafe(`insert into fuma_mcp_connector_bindings_v2(
        connector_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,actor_id,
        connector_capabilities_json,rate_policy_json,state,version
      ) values
        ('connector-a','platform-pg','organization-a','workspace-a','site-a','owner-a',3,'website','actor-a','["component.mutate"]'::jsonb,'{}'::jsonb,'active',1),
        ('connector-b','platform-pg','organization-b','workspace-b','site-b','owner-b',5,'website','actor-b','["component.mutate"]'::jsonb,'{}'::jsonb,'revoked',2)`)
      await db.unsafe(`insert into fuma_mcp_sessions_v2(
        session_id,connector_id,actor_id,scope_json,connector_version,state,opened_at,expires_at,last_validated_at,closed_at
      ) values ('session-b','connector-b','actor-b','{}'::jsonb,2,'active',$1,'2026-08-01T09:40:00.000Z',$1,null)`, [NOW])
      await db.unsafe(`insert into fuma_mcp_tool_receipts_v2(
        operation_id,session_id,connector_id,tool_name,capability,input_hash_sha256,reservation_id,state,output_json,created_at,completed_at
      ) values ('operation-b','session-b','connector-b','site_insert_component','mutate',$1,'reservation-b','completed',$2::text::jsonb,$3,$3)`, [HASH, JSON.stringify({ ok: true, data: { receipt: receipt(RECEIPT_B, '0.9.0', 'mcp', 'operation-b') } }), NOW])

      await db.unsafe(`insert into fuma_component_catalog_audit_v1(
        audit_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,
        actor_id,action,coordinate,operation_id,outcome,reason_code,occurred_at
      ) values
        ('audit-a','platform-pg','organization-a','workspace-a','site-a','owner-a',3,'website','actor-a','component.inserted',null,'operation-a','success',null,$1),
        ('audit-b','platform-pg','organization-b','workspace-b','site-b','owner-b',5,'website','actor-b','component.inserted',null,'operation-b','success',null,$1)`, [NOW])
      await db.unsafe(`insert into fuma_usage_ledger(
        entry_id,idempotency_key,organization_id,workspace_id,site_id,meter,kind,reservation_id,logical_units,physical_units,
        cost_catalog_version,cost_usd_micros,internal_workload,occurred_at
      ) values ('meter-a',$2,'organization-a','workspace-a','site-a','ai_credits','settlement',null,2,2,'dashboard-test',250000,false,$1)`, [NOW, `backend-capability:${RECEIPT_A}:ai_credits`])


      const extracted = await db.unsafe<{ receipt_id: string; capability_version: string }>(`
        select jsonb_extract_path_text(output_json,'data','receipt','receiptId') receipt_id,
          jsonb_extract_path_text(output_json,'data','receipt','capabilityVersion') capability_version
        from fuma_site_ai_tool_receipts where tool_call_id='operation-a'
      `)
      expect(extracted.rows[0]).toEqual({ receipt_id: RECEIPT_A, capability_version: '1.0.0' })
      const readModel = new PostgresCapabilityDashboardReadModel(db)
      const site = await readModel.site(scopeA, 1, 0)
      expect(site).toMatchObject({
        hasMore: true,
        connectors: [{ connectorId: 'connector-a', label: 'Current owner connector', actorId: 'actor-a', state: 'active' }],
        usage: { logicalCredits: 2, providerCredits: 2, spendUsdMicros: '250000' },
        totalSuccessful: 1,
        totalFailed: 1,
        totalMetered: 1,
        totalAudited: 1,
        driftedReceipts: 0,
      })
      expect(site.receipts).toHaveLength(1)
      expect(JSON.stringify(site)).not.toContain('organization-b')
      expect((await readModel.site(scopeA, 10, 1)).receipts).toHaveLength(1)

      const platform = await readModel.platform('1.0.0', 2, 0)
      expect(platform).toMatchObject({
        hasMore: true,
        tenantCount: 2,
        successful: 2,
        failed: 1,
        metered: 1,
        audited: 2,
        logicalCredits: 2,
        providerCredits: 2,
        spendUsdMicros: '250000',
        activeMcpGrants: 1,
        revokedMcpGrants: 1,
        currentVersionOperations: 1,
        driftedReceipts: 1,
      })
      const serializedPlatform = JSON.stringify(platform)
      for (const coordinate of ['organization-a', 'organization-b', 'workspace-a', 'workspace-b', 'site-a', 'site-b', 'owner-a', 'owner-b']) {
        expect(serializedPlatform).not.toContain(`"${coordinate}"`)
      }
      process.stdout.write('[FUMA-087 PostgreSQL] tenants=2 site-isolated=true success=2 failed=1 metered=1 audited=2 drifted=1 grants=1/1 pagination=bounded\n')
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      const leftovers = await admin<{ count: string }>`select count(*)::text count from pg_namespace where nspname=${schema}`
      expect(leftovers.rows[0]?.count).toBe('0')
    }
  }, 120_000)
})
