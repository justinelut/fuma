import { describe, expect, it } from 'bun:test'
import { tenantKeysMigration } from '../../../server/fuma/db/migrations/000009_tenant_keys'
import {
  HOSTED_MIGRATION_CHECKSUMS,
  hostedMigrations,
  runnableHostedMigrations,
} from '../../../server/fuma/db/migrations'
import {
  assertHostedMigrationIsAdditive,
  hostedMigrationChecksum,
  nextHostedMigrationId,
} from '../../../server/fuma/db/migrationPolicy'
import {
  HOSTED_TENANT_KEY_SCHEMA_MANIFEST,
  TENANT_KEY_INDEX_NAMES,
  TENANT_KEY_TABLE_NAMES,
} from '../../../server/fuma/tenancy'

const TENANT_KEYS_CHECKSUM = '43e27fb6a3d46bb76e9e47be448fa58a6bada9aad86e7a4451f49daec566964a'
const normalizedSql = tenantKeysMigration.sql.replace(/\s+/g, ' ').trim()

function tableDefinition(table: string): string {
  const match = new RegExp(`create table ${table} \\((.*?)\\);`, 'i').exec(normalizedSql)
  if (!match?.[1]) throw new Error(`Missing tenant-key migration table: ${table}`)
  return match[1]
}

describe('FUMA-024 tenant-key hosted migration', () => {
  it('appends and finalizes migration 000009 after immutable 000007 and 000008 history', () => {
    const migrationIndex = hostedMigrations.findIndex(({ id }) => id === tenantKeysMigration.id)
    expect(migrationIndex).toBe(8)
    expect(nextHostedMigrationId(hostedMigrations.slice(0, migrationIndex), 'tenant keys'))
      .toBe('000009_tenant_keys')
    expect(hostedMigrations.slice(0, migrationIndex + 1).map(({ id }) => id)).toEqual([
      '000001_transition_bookkeeping',
      '000002_durable_jobs',
      '000003_staff_identity',
      '000004_organizations',
      '000005_workspaces',
      '000006_sites',
      '000007_audit_history',
      '000008_transfer_saga',
      '000009_tenant_keys',
    ])
    expect(HOSTED_MIGRATION_CHECKSUMS['000007_audit_history'])
      .toBe('0823e4e3592bb5b6347d85e04cab85367c313a9753aea4fb7bc0e7753bc1d07e')
    expect(HOSTED_MIGRATION_CHECKSUMS['000008_transfer_saga'])
      .toBe('04ab1226ce0010a06183847d6feec927ab4d583fcafdf69321d70bab1686e852')
    expect(HOSTED_MIGRATION_CHECKSUMS[tenantKeysMigration.id]).toBe(TENANT_KEYS_CHECKSUM)
    expect(hostedMigrationChecksum(tenantKeysMigration.sql)).toBe(TENANT_KEYS_CHECKSUM)
    expect(runnableHostedMigrations.map(({ id }) => id)).toEqual(
      hostedMigrations.map(({ id }) => id),
    )
    expect(HOSTED_TENANT_KEY_SCHEMA_MANIFEST.migrationId).toBe(tenantKeysMigration.id)
    expect(() => assertHostedMigrationIsAdditive(tenantKeysMigration)).not.toThrow()
  })

  it('adds only owner directory, mapping, run, and receipt sidecars', () => {
    expect(Object.values(TENANT_KEY_TABLE_NAMES)).toEqual([
      'fuma_tenant_owner_keys',
      'fuma_tenant_resource_owners',
      'fuma_tenant_key_backfills',
      'fuma_tenant_key_backfill_receipts',
    ])
    expect(normalizedSql.match(/create table /g)).toHaveLength(4)
    expect(normalizedSql).not.toMatch(/\balter\s+table\b/i)
    expect(normalizedSql).not.toMatch(/\b(?:drop|truncate)\b/i)
    expect(normalizedSql).not.toMatch(/\bdelete\s+from\b/i)
    expect(normalizedSql).not.toMatch(/create table (?:site|data_|media_|installed_|plugin_|ai_)/i)
  })

  it('uses one stable owner key with complete mutable tenant ancestry', () => {
    const definition = tableDefinition(TENANT_KEY_TABLE_NAMES.ownerKey)
    expect(definition).toContain('primary key (platform_id, owner_key)')
    expect(definition).toContain(
      'unique (platform_id, organization_id, workspace_id, site_id)',
    )
    expect(definition).toContain(
      'unique (platform_id, owner_key, organization_id, workspace_id, site_id)',
    )
    expect(definition).toContain("state text not null default 'active' check (state in ('active', 'transferring'))")
    expect(definition).toContain("state = 'active' and transfer_id is null")
    expect(definition).toContain("state = 'transferring' and transfer_id is not null")
    expect(definition).toContain('generation bigint not null default 1 check (generation > 0)')
  })

  it('preserves legacy row and object identities without changing source tables', () => {
    const definition = tableDefinition(TENANT_KEY_TABLE_NAMES.resourceOwner)
    expect(definition).toContain("resource_kind text not null check (resource_kind in ('table-row', 'object'))")
    expect(definition).toContain('legacy_id text not null')
    expect(definition).toContain('legacy_identity_json jsonb not null')
    expect(definition).toContain("jsonb_typeof(legacy_identity_json) = 'object'")
    expect(definition).toContain('primary key (platform_id, owner_key, class_id, legacy_id)')
    expect(definition).toContain(
      'foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)',
    )
    expect(definition).toContain('references fuma_tenant_owner_keys(')
    expect(definition).toContain('on update cascade')
    expect(definition).toContain('on delete restrict')
    expect(definition).toContain("content_hash is null or content_hash ~ '^[a-f0-9]{64}$'")
    expect(definition).toContain("resource_kind = 'object' and object_key is not null")
    expect(definition).toContain('and content_hash is not null')
    expect(definition).toContain('and size_bytes >= 0')
  })

  it('adds explicit organization, workspace, site, and object-key indexes', () => {
    expect(Object.values(TENANT_KEY_INDEX_NAMES)).toEqual([
      'fuma_tenant_owner_keys_transfer_fence_unique',
      'fuma_tenant_resource_owners_organization_idx',
      'fuma_tenant_resource_owners_workspace_idx',
      'fuma_tenant_resource_owners_site_idx',
      'fuma_tenant_resource_owners_object_key_unique',
      'fuma_tenant_key_backfills_site_state_idx',
      'fuma_tenant_key_backfill_receipts_resume_idx',
    ])
    expect(normalizedSql).toContain(
      'create unique index fuma_tenant_owner_keys_transfer_fence_unique on fuma_tenant_owner_keys ( platform_id, transfer_id, transfer_lock_id, transfer_fence, owner_key ) where state = \'transferring\'',
    )
    expect(normalizedSql).toContain(
      'create index fuma_tenant_resource_owners_organization_idx on fuma_tenant_resource_owners ( platform_id, organization_id, owner_key, resource_kind, class_id, legacy_id )',
    )
    expect(normalizedSql).toContain(
      'create index fuma_tenant_resource_owners_workspace_idx on fuma_tenant_resource_owners ( platform_id, organization_id, workspace_id, owner_key, resource_kind, class_id, legacy_id )',
    )
    expect(normalizedSql).toContain(
      'create index fuma_tenant_resource_owners_site_idx on fuma_tenant_resource_owners ( platform_id, organization_id, workspace_id, site_id, owner_key, resource_kind, class_id, legacy_id )',
    )
    expect(normalizedSql).toContain(
      "create unique index fuma_tenant_resource_owners_object_key_unique on fuma_tenant_resource_owners ( platform_id, organization_id, workspace_id, site_id, owner_key, object_key ) where resource_kind = 'object'",
    )
  })

  it('requires resumable completion receipts to reconcile counts, hashes, and FKs', () => {
    const run = tableDefinition(TENANT_KEY_TABLE_NAMES.backfill)
    const receipt = tableDefinition(TENANT_KEY_TABLE_NAMES.backfillReceipt)
    expect(run).toContain(
      'unique (platform_id, owner_key, source_fingerprint, inventory_version)',
    )
    expect(run).toContain('on update cascade')
    expect(run).toContain('on delete restrict')
    expect(run).toContain('completed_class_count = expected_class_count')
    expect(run).toContain('mapped_resource_count = expected_resource_count')
    expect(receipt).toContain('resume_cursor_json jsonb null')
    expect(receipt).toContain('source_count = mapped_count')
    expect(receipt).toContain('source_content_hash = mapped_content_hash')
    expect(receipt).toContain('source_foreign_key_count = valid_foreign_key_count')
    expect(receipt).toContain("jsonb_typeof(foreign_key_evidence_json) = 'array'")
    expect(normalizedSql).toContain(
      "create index fuma_tenant_key_backfill_receipts_resume_idx on fuma_tenant_key_backfill_receipts ( platform_id, backfill_id, state, updated_at, class_id ) where state <> 'complete'",
    )
  })
})
