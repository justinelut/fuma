import { describe, expect, it } from 'bun:test'
import { auditHistoryMigration } from '../../../server/fuma/db/migrations/000007_audit_history'
import { hostedMigrations, HOSTED_MIGRATION_CHECKSUMS } from '../../../server/fuma/db/migrations'
import {
  assertHostedMigrationIsAdditive,
  assertHostedMigrationManifest,
  hostedMigrationChecksum,
  nextHostedMigrationId,
} from '../../../server/fuma/db/migrationPolicy'
import {
  AUDIT_ACTOR_KINDS,
  AUDIT_AUTHORITY_TABLES,
  AUDIT_HISTORY_APPEND_ONLY_POLICY,
  AUDIT_HISTORY_INDEX_NAMES,
  AUDIT_HISTORY_METADATA_POLICY,
  AUDIT_OUTCOMES,
  AUDIT_SCOPE_KINDS,
  AUDIT_TABLE_NAMES,
  HOSTED_AUDIT_SCHEMA_MANIFEST,
} from '../../../server/fuma/audit/schemaManifest'

const CHECKSUM_SENTINEL = '0000000000000000000000000000000000000000000000000000000000000000'
const normalizedSql = auditHistoryMigration.sql.replace(/\s+/g, ' ').trim()

function tableDefinition(table: string): string {
  const match = new RegExp(`create table ${table} \\((.*?)\\);`, 'i').exec(normalizedSql)
  if (!match?.[1]) throw new Error(`Missing audit migration table: ${table}`)
  return match[1]
}

function indexStatements(): string[] {
  return normalizedSql.match(/create index [a-z0-9_]+ on fuma_audit_history .*?;/gi) ?? []
}

describe('FUMA-022 hosted audit history migration', () => {
  it('appends migration 000007 without changing prior hosted history', () => {
    const migrationIndex = hostedMigrations.findIndex(({ id }) => id === auditHistoryMigration.id)
    expect(migrationIndex).toBe(6)
    expect(nextHostedMigrationId(hostedMigrations.slice(0, migrationIndex), 'audit history'))
      .toBe('000007_audit_history')
    expect(hostedMigrations.slice(0, migrationIndex + 1).map(({ id }) => id)).toEqual([
      '000001_transition_bookkeeping',
      '000002_durable_jobs',
      '000003_staff_identity',
      '000004_organizations',
      '000005_workspaces',
      '000006_sites',
      '000007_audit_history',
    ])
    expect(HOSTED_MIGRATION_CHECKSUMS).toMatchObject({
      '000001_transition_bookkeeping': 'faa1fbdeb664da6ee93384e1c04ca62e166dab5a2f84cf21acca4c528bb49f5a',
      '000002_durable_jobs': '2e0ea46ac22411481a571c45eef336e7c319a39d4c71c28dc0e746702598f093',
      '000003_staff_identity': '8a80e4cd07d2a49a254d44769f466ffc014924a5377f6dd655155c11ae695221',
      '000004_organizations': '037410d0991d671c49e74acf5e04d9e98c496c6e38cff613b30db38a1c2c48b4',
      '000005_workspaces': '0d24040f7454107b1891a9fe91b44d33f08515c272b3b3a0e57ce2fa840d4ad2',
      '000006_sites': 'b767a08415ba95afb34acd0c3ff8728c027eb6ad12f1598490a05d32d98d332f',
    })
    expect(HOSTED_AUDIT_SCHEMA_MANIFEST.migrationId).toBe(auditHistoryMigration.id)
    expect(() => assertHostedMigrationIsAdditive(auditHistoryMigration)).not.toThrow()
  })

  // FINAL GATE: before validation, replace the 000007 checksum sentinel in the
  // hosted manifest with hostedMigrationChecksum(auditHistoryMigration.sql).
  it('FINAL GATE: replaces the 000007 checksum sentinel with the generated checksum', () => {
    const declaredChecksum = HOSTED_MIGRATION_CHECKSUMS[auditHistoryMigration.id]
    expect(declaredChecksum).not.toBe(CHECKSUM_SENTINEL)
    expect(declaredChecksum).toBe(hostedMigrationChecksum(auditHistoryMigration.sql))
    expect(() => assertHostedMigrationManifest(hostedMigrations, HOSTED_MIGRATION_CHECKSUMS))
      .not.toThrow()
  })

  it('adds one PostgreSQL audit table without replacing tenant authority', () => {
    expect(AUDIT_AUTHORITY_TABLES).toEqual({
      organization: 'auth_organizations',
      user: 'auth_users',
      workspace: 'fuma_workspaces',
      site: 'fuma_sites',
      job: 'fuma_jobs',
    })
    expect(AUDIT_TABLE_NAMES).toEqual({ history: 'fuma_audit_history' })
    expect(normalizedSql.match(/create table /g)).toHaveLength(1)
    expect(normalizedSql).not.toMatch(
      /create table (?:auth_organizations|auth_users|fuma_workspaces|fuma_sites|fuma_jobs)/i,
    )
    expect(normalizedSql).not.toMatch(/\b(?:drop|truncate)\b/i)
  })

  it('stores caller IDs in a platform-qualified key and rejects blank correlation ancestry IDs', () => {
    const definition = tableDefinition(AUDIT_TABLE_NAMES.history)
    expect(definition).toContain('platform_id text not null')
    expect(definition).toContain('id text not null')
    expect(definition).toContain('primary key (platform_id, id)')
    expect(definition).toContain("btrim(platform_id) <> ''")
    expect(definition).toContain("btrim(id) <> ''")
    for (const column of [
      'organization_id',
      'workspace_id',
      'site_id',
      'actor_user_id',
      'actor_session_id',
      'impersonator_user_id',
      'request_id',
      'originating_request_id',
      'job_id',
      'run_id',
    ]) {
      expect(definition).toContain(`(${column} is null or btrim(${column}) <> '')`)
    }
    expect(definition).not.toMatch(/\bid\b[^,]*(?:generated|default|uuid|serial|identity)/i)
  })

  it('enforces exact scope ancestry while preserving transfer-safe historical identities', () => {
    const definition = tableDefinition(AUDIT_TABLE_NAMES.history)
    expect(AUDIT_SCOPE_KINDS).toEqual(['platform', 'organization', 'workspace', 'site'])
    expect(definition).toContain(
      "scope_kind text not null check (scope_kind in ('platform', 'organization', 'workspace', 'site'))",
    )
    expect(definition).toContain(
      "scope_kind = 'platform' and organization_id is null and workspace_id is null and site_id is null",
    )
    expect(definition).toContain(
      "scope_kind = 'organization' and organization_id is not null and workspace_id is null and site_id is null",
    )
    expect(definition).toContain(
      "scope_kind = 'workspace' and organization_id is not null and workspace_id is not null and site_id is null",
    )
    expect(definition).toContain(
      "scope_kind = 'site' and organization_id is not null and workspace_id is not null and site_id is not null",
    )
    expect(definition).toContain('organization_id text null')
    expect(definition).toContain('workspace_id text null')
    expect(definition).toContain('site_id text null')
    expect(definition).not.toMatch(/references\s+(?:auth_organizations|fuma_workspaces|fuma_sites)/i)
  })

  it('coheres staff, impersonator, request, and internal-job identities', () => {
    const definition = tableDefinition(AUDIT_TABLE_NAMES.history)
    expect(AUDIT_ACTOR_KINDS).toEqual(['staff', 'internal-job'])
    expect(definition).toContain(
      "actor_kind text not null check (actor_kind in ('staff', 'internal-job'))",
    )
    expect(definition).toContain('actor_user_id text null')
    expect(definition).toContain('impersonator_user_id text null')
    expect(definition).toContain('job_id text null')
    expect(definition).not.toMatch(/references\s+(?:auth_users|fuma_jobs)/i)
    expect(definition).toContain('job_id is null or organization_id is not null')
    expect(definition).toContain("actor_kind = 'staff' and actor_user_id is not null and actor_session_id is not null and request_id is not null and originating_request_id is null and job_id is null and run_id is null")
    expect(definition).toContain("actor_kind = 'internal-job' and actor_user_id is null and actor_session_id is null and impersonator_user_id is null and request_id is not null and job_id is not null and run_id is not null")
    expect(definition).toContain('request_id is not null or job_id is not null')
    expect(definition).toContain('originating_request_id is null or job_id is not null')
    expect(definition).toContain("actor_kind = 'staff' and impersonator_user_id <> actor_user_id")
  })

  it('stores a constrained outcome and redacted object-only JSON metadata', () => {
    const definition = tableDefinition(AUDIT_TABLE_NAMES.history)
    expect(AUDIT_OUTCOMES).toEqual(['success', 'failure', 'denied'])
    expect(AUDIT_HISTORY_METADATA_POLICY).toEqual({
      column: 'metadata_json',
      storage: 'jsonb-object',
      content: 'redacted-only',
    })
    expect(definition).toContain("action text not null check (btrim(action) <> '')")
    expect(definition).toContain(
      "outcome text not null check (outcome in ('success', 'failure', 'denied'))",
    )
    expect(definition).toContain("metadata_json jsonb not null default '{}'::jsonb")
    expect(definition).toContain("jsonb_typeof(metadata_json) = 'object'")
    expect(definition).toContain('created_at timestamptz not null default current_timestamp')
    expect(normalizedSql).toContain(
      "comment on column fuma_audit_history.metadata_json is 'Redacted audit metadata only; secrets, credentials, and raw request bodies are forbidden.'",
    )
    expect(definition).not.toMatch(/\bmetadata\b(?!_json)/i)
  })

  it('creates only the exact scoped-recency and request/job correlation indexes', () => {
    expect(Object.values(AUDIT_HISTORY_INDEX_NAMES)).toEqual([
      'fuma_audit_history_platform_recency_idx',
      'fuma_audit_history_organization_recency_idx',
      'fuma_audit_history_workspace_recency_idx',
      'fuma_audit_history_site_recency_idx',
      'fuma_audit_history_request_correlation_idx',
      'fuma_audit_history_originating_request_correlation_idx',
      'fuma_audit_history_job_correlation_idx',
    ])
    expect(indexStatements()).toEqual([
      "create index fuma_audit_history_platform_recency_idx on fuma_audit_history (platform_id, created_at desc, id) where scope_kind = 'platform';",
      "create index fuma_audit_history_organization_recency_idx on fuma_audit_history (platform_id, organization_id, created_at desc, id) where scope_kind = 'organization';",
      "create index fuma_audit_history_workspace_recency_idx on fuma_audit_history (platform_id, organization_id, workspace_id, created_at desc, id) where scope_kind = 'workspace';",
      "create index fuma_audit_history_site_recency_idx on fuma_audit_history ( platform_id, organization_id, workspace_id, site_id, created_at desc, id ) where scope_kind = 'site';",
      'create index fuma_audit_history_request_correlation_idx on fuma_audit_history (platform_id, request_id, created_at desc, id) where request_id is not null;',
      'create index fuma_audit_history_originating_request_correlation_idx on fuma_audit_history (platform_id, originating_request_id, created_at desc, id) where originating_request_id is not null;',
      'create index fuma_audit_history_job_correlation_idx on fuma_audit_history (platform_id, organization_id, job_id, created_at desc, id) where job_id is not null;',
    ])
  })

  it('exposes insertion as the only write path and rejects every update or delete statement', () => {
    expect(AUDIT_HISTORY_APPEND_ONLY_POLICY).toEqual({
      allowedWriteOperations: ['insert'],
      immutableFunction: 'fuma_audit_history_reject_mutation',
      updateTrigger: 'fuma_audit_history_reject_update',
      deleteTrigger: 'fuma_audit_history_reject_delete',
    })
    expect(normalizedSql).toContain(
      'create function fuma_audit_history_reject_mutation() returns trigger language plpgsql as $audit_trigger$ begin',
    )
    expect(normalizedSql).toContain(
      'create trigger fuma_audit_history_reject_update before update on fuma_audit_history for each statement execute function fuma_audit_history_reject_mutation()',
    )
    expect(normalizedSql).toContain(
      'create trigger fuma_audit_history_reject_delete before delete on fuma_audit_history for each statement execute function fuma_audit_history_reject_mutation()',
    )
    expect(normalizedSql).toContain("raise exception 'fuma_audit_history is append-only: % is forbidden', tg_op")
    expect(normalizedSql).not.toMatch(/\bupdate\s+fuma_audit_history\s+set\b/i)
    expect(normalizedSql).not.toMatch(/\bdelete\s+from\s+fuma_audit_history\b/i)
  })
})
