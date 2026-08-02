import { describe, expect, test } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { PostgresPublicationDomainStore } from '../../../server/fuma/publication/postgresStore'
import {
  CanonicalProviderNeutralPublicationAdapter,
  PROVIDER_NEUTRAL_CAPABILITY_IDS,
  ReviewedBackendCapabilityRegistry,
  registerProviderNeutralPublicationCapabilities,
} from '../../../server/fuma/aiBackendCapabilities'
import { providerNeutralAuthority, PROVIDER_NEUTRAL_NOW } from './providerNeutralCapabilityFixture'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
function quote(value: string): string { if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('unsafe schema'); return `"${value}"` }
function scoped(connection: string, schema: string): string { const url = new URL(connection); url.searchParams.set('options', `-c search_path=${schema},public`); return url.toString() }

describe('FUMA-088 optional native PostgreSQL capability acceptance', () => {
  test.skipIf(!postgresUrl)('reuses the owner-generation-scoped Publication universal store without new persistence', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    expect(process.arch).toBe('arm64')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_provider_neutral_088_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await db.unsafe(`
        create table fuma_tenant_owner_keys(
          platform_id text not null,owner_key text not null,organization_id text not null,
          workspace_id text not null,site_id text not null,generation bigint not null,state text not null,
          transfer_id text null,transfer_lock_id text null,transfer_fence bigint null,
          primary key(platform_id,owner_key)
        );
        create table fuma_sites(id text primary key,organization_id text not null,workspace_id text not null,profile_id text not null);
        create table data_tables(
          id text primary key,name text not null,slug text not null,kind text not null,route_base text not null,
          singular_label text not null,plural_label text not null,primary_field_id text not null,fields_json jsonb not null,
          system boolean not null,created_by_user_id text null,updated_by_user_id text null,deleted_at timestamptz null
        );
        create table data_rows(
          id text primary key,table_id text not null,cells_json jsonb not null default '{}',slug text not null default '',
          status text not null default 'draft',created_at timestamptz not null default current_timestamp,
          updated_at timestamptz not null default current_timestamp,published_at timestamptz null,deleted_at timestamptz null
        );
        create table fuma_tenant_resource_owners(
          platform_id text not null,owner_key text not null,organization_id text not null,workspace_id text not null,
          site_id text not null,resource_kind text not null,class_id text not null,source_name text not null,
          legacy_id text not null,legacy_identity_json jsonb not null,object_key text null,content_hash text null,size_bytes bigint null,
          updated_at timestamptz not null default current_timestamp,
          unique(platform_id,owner_key,class_id,legacy_id)
        );
        create table data_row_relations(
          platform_id text not null,organization_id text not null,workspace_id text not null,site_id text not null,
          owner_key text not null,profile_id text not null,source_row_id text not null,relation_kind text not null,
          target_kind text not null,target_id text not null,target_row_id text null,position integer not null,is_primary boolean not null
        );
      `)
      await db`insert into fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,generation,state) values('fuma','owner-088','organization-088','workspace-088','site-088',8,'active')`
      await db`insert into fuma_sites(id,organization_id,workspace_id,profile_id) values('site-088','organization-088','workspace-088','publication')`

      const store = new PostgresPublicationDomainStore(db)
      const adapter = new CanonicalProviderNeutralPublicationAdapter({
        store,
        editorial: {} as never,
        identity: {} as never,
        memberAccess: {} as never,
        privacyAnalytics: {} as never,
        now: () => new Date(PROVIDER_NEUTRAL_NOW),
      })
      const registry = registerProviderNeutralPublicationCapabilities(new ReviewedBackendCapabilityRegistry(() => new Date(PROVIDER_NEUTRAL_NOW)), adapter)
      const definition = registry.definition(PROVIDER_NEUTRAL_CAPABILITY_IDS.listContent, '1.0.0')!
      const result = await registry.invoke({
        id: definition.metadata.id,
        version: definition.metadata.version,
        rawInput: { kind: 'all', status: 'all', query: '', afterId: null, limit: 25 },
        resolveAuthority: async () => providerNeutralAuthority('site-ai', definition.metadata),
        evidence: { async admit() {}, async record() { return { metered: true, audited: true } } },
      })
      expect(result.output).toEqual({ items: [], nextAfterId: null })
      expect(result.receipt).toMatchObject({ capabilityId: PROVIDER_NEUTRAL_CAPABILITY_IDS.listContent, channel: 'site-ai' })
      const tables = await db<{ count: string }>`select count(*)::text count from data_tables`
      expect(tables.rows[0]?.count).toBe('4')
      const forbidden = await db<{ count: string }>`select count(*)::text count from information_schema.tables where table_schema=${schema} and table_name like '%capability%'`
      expect(forbidden.rows[0]?.count).toBe('0')
      process.stdout.write('[FUMA-088 PostgreSQL demo] arch=arm64 capability=publication.content.list rows=0 canonical_tables=4 new_tables=0\n')
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      const leftover = await admin<{ count: string }>`select count(*)::text count from pg_namespace where nspname=${schema}`
      expect(leftover.rows[0]?.count).toBe('0')
    }
  }, 120_000)
})
