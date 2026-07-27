import { describe, expect, it } from 'bun:test'
import { transferSagaMigration } from '../../../server/fuma/db/migrations/000008_transfer_saga'
import {
  hostedMigrations,
  HOSTED_MIGRATION_CHECKSUMS,
  runnableHostedMigrations,
} from '../../../server/fuma/db/migrations'
import {
  assertHostedMigrationIsAdditive,
  assertHostedMigrationManifest,
  hostedMigrationChecksum,
  nextHostedMigrationId,
} from '../../../server/fuma/db/migrationPolicy'
import {
  HOSTED_TRANSFER_SCHEMA_MANIFEST,
  TRANSFER_COLLABORATOR_INTENTS,
  TRANSFER_COLLABORATOR_STATES,
  TRANSFER_CONFIRMATION_SIDES,
  TRANSFER_FENCE_POLICY,
  TRANSFER_INDEX_NAMES,
  TRANSFER_JSON_COLUMNS,
  TRANSFER_LIFECYCLE_STATES,
  TRANSFER_LOCK_STATES,
  TRANSFER_SNAPSHOT_POLICY,
  TRANSFER_STEP_KINDS,
  TRANSFER_STEP_STATES,
  TRANSFER_TABLE_NAMES,
} from '../../../server/fuma/transfers/schemaManifest'

const CHECKSUM_SENTINEL = '0000000000000000000000000000000000000000000000000000000000000000'
const normalizedSql = transferSagaMigration.sql.replace(/\s+/g, ' ').trim()

function tableDefinition(table: string): string {
  const match = new RegExp(`create table ${table} \\((.*?)\\);`, 'i').exec(normalizedSql)
  if (!match?.[1]) throw new Error(`Missing transfer migration table: ${table}`)
  return match[1]
}

function indexStatements(): string[] {
  return normalizedSql.match(/create (?:unique )?index [a-z0-9_]+ on [a-z0-9_]+ .*?;/gi) ?? []
}

function checkValues(definition: string, column: string): string[] {
  const match = new RegExp(`${column} text not null(?: default '[^']+')? check \\((${column} in \\([^)]*\\))\\)`, 'i')
    .exec(definition)
  if (!match?.[1]) throw new Error(`Missing closed state constraint for ${column}`)
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
}

describe('FUMA-023 hosted site-transfer saga migration', () => {
  it('appends migration 000008 and preserves every prior checksum exactly', () => {
    const migrationIndex = hostedMigrations.findIndex(({ id }) => id === transferSagaMigration.id)
    expect(migrationIndex).toBe(7)
    expect(nextHostedMigrationId(hostedMigrations.slice(0, migrationIndex), 'transfer saga'))
      .toBe('000008_transfer_saga')
    expect(hostedMigrations.slice(0, migrationIndex + 1).map(({ id }) => id)).toEqual([
      '000001_transition_bookkeeping',
      '000002_durable_jobs',
      '000003_staff_identity',
      '000004_organizations',
      '000005_workspaces',
      '000006_sites',
      '000007_audit_history',
      '000008_transfer_saga',
    ])
    expect(HOSTED_MIGRATION_CHECKSUMS).toMatchObject({
      '000001_transition_bookkeeping': 'faa1fbdeb664da6ee93384e1c04ca62e166dab5a2f84cf21acca4c528bb49f5a',
      '000002_durable_jobs': '2e0ea46ac22411481a571c45eef336e7c319a39d4c71c28dc0e746702598f093',
      '000003_staff_identity': '8a80e4cd07d2a49a254d44769f466ffc014924a5377f6dd655155c11ae695221',
      '000004_organizations': '037410d0991d671c49e74acf5e04d9e98c496c6e38cff613b30db38a1c2c48b4',
      '000005_workspaces': '0d24040f7454107b1891a9fe91b44d33f08515c272b3b3a0e57ce2fa840d4ad2',
      '000006_sites': 'b767a08415ba95afb34acd0c3ff8728c027eb6ad12f1598490a05d32d98d332f',
      '000007_audit_history': '0823e4e3592bb5b6347d85e04cab85367c313a9753aea4fb7bc0e7753bc1d07e',
    })
    expect(HOSTED_MIGRATION_CHECKSUMS['000009_tenant_keys'])
      .toBe('43e27fb6a3d46bb76e9e47be448fa58a6bada9aad86e7a4451f49daec566964a')
    expect(HOSTED_TRANSFER_SCHEMA_MANIFEST.migrationId).toBe(transferSagaMigration.id)
    expect(() => assertHostedMigrationIsAdditive(transferSagaMigration)).not.toThrow()
  })

  it('keeps finalized 000008 derived from its SQL after later migrations become runnable', () => {
    const declaredChecksum = HOSTED_MIGRATION_CHECKSUMS[transferSagaMigration.id]
    expect(declaredChecksum).not.toBe(CHECKSUM_SENTINEL)
    expect(declaredChecksum).toBe(hostedMigrationChecksum(transferSagaMigration.sql))
    expect(runnableHostedMigrations.map(({ id }) => id)).toContain(transferSagaMigration.id)
    expect(() => assertHostedMigrationManifest(hostedMigrations, HOSTED_MIGRATION_CHECKSUMS))
      .not.toThrow()
  })

  it('adds only the five transfer tables and contains no destructive SQL', () => {
    expect(TRANSFER_TABLE_NAMES).toEqual({
      proposal: 'fuma_site_transfer_proposals',
      confirmation: 'fuma_site_transfer_confirmations',
      lock: 'fuma_site_transfer_locks',
      step: 'fuma_site_transfer_steps',
      collaboratorIntent: 'fuma_site_transfer_collaborator_intents',
    })
    expect(normalizedSql.match(/create table /g)).toHaveLength(5)
    expect(normalizedSql).not.toMatch(/create table (?:auth_|fuma_(?:workspaces|sites|jobs|audit_history))/i)
    expect(normalizedSql).not.toMatch(/\b(?:drop|truncate)\b/i)
    expect(normalizedSql).not.toMatch(/\bdelete\s+from\b/i)
    expect(normalizedSql).not.toMatch(/alter\s+table/i)
  })

  it('persists immutable source and destination ancestry snapshots for one logical site', () => {
    const definition = tableDefinition(TRANSFER_TABLE_NAMES.proposal)
    for (const column of [
      'platform_id',
      'source_organization_id',
      'source_workspace_id',
      'source_site_id',
      'destination_organization_id',
      'destination_workspace_id',
      'destination_site_id',
    ]) {
      expect(definition).toContain(`${column} text not null`)
    }
    expect(definition).toContain('source_site_id = destination_site_id')
    expect(definition).toContain(
      'source_organization_id <> destination_organization_id or source_workspace_id <> destination_workspace_id',
    )
    expect(definition).not.toMatch(/references\s+(?:auth_organizations|fuma_workspaces|fuma_sites)/i)
    expect(TRANSFER_SNAPSHOT_POLICY.authorityForeignKeys).toBe(false)
    expect(TRANSFER_SNAPSHOT_POLICY.auditHistoryForeignKey).toBe(false)
    expect(normalizedSql).not.toMatch(/references\s+fuma_audit_history/i)
    expect(normalizedSql).toContain(
      'create trigger fuma_site_transfer_proposals_preserve_snapshot before update on fuma_site_transfer_proposals for each row execute function fuma_site_transfer_proposals_preserve_snapshot()',
    )
    expect(normalizedSql).toContain(
      'create trigger fuma_site_transfer_proposals_reject_delete before delete on fuma_site_transfer_proposals for each statement execute function fuma_site_transfer_proposals_reject_delete()',
    )
    for (const immutableColumn of [
      'platform_id',
      'id',
      'source_organization_id',
      'source_workspace_id',
      'source_site_id',
      'destination_organization_id',
      'destination_workspace_id',
      'destination_site_id',
      'manifest_json',
      'proposed_by_user_id',
      'proposed_by_session_id',
      'proposed_request_id',
      'created_at',
    ]) {
      expect(normalizedSql).toContain(`new.${immutableColumn} is distinct from old.${immutableColumn}`)
    }
  })

  it('closes lifecycle, cancellation, compensation, and resume persistence states', () => {
    const definition = tableDefinition(TRANSFER_TABLE_NAMES.proposal)
    expect(TRANSFER_LIFECYCLE_STATES).toEqual([
      'proposed',
      'awaiting-confirmations',
      'ready',
      'running',
      'resume-requested',
      'cancellation-requested',
      'compensating',
      'failed',
      'completed',
      'cancelled',
    ])
    expect(checkValues(definition, 'state')).toEqual(TRANSFER_LIFECYCLE_STATES)
    expect(definition).toContain('resume_count integer not null default 0 check (resume_count >= 0)')
    expect(definition).toContain('cancellation_requested_by_user_id text null')
    expect(definition).toContain('cancellation_reason_code text null')
    expect(definition).toContain('resume_requested_by_user_id text null')
    expect(definition).toContain('resume_reason_code text null')
    expect(definition).toContain('compensation_started_at timestamptz null')
    expect(definition).toContain('compensation_completed_at timestamptz null')
    expect(definition).toContain('constraint fuma_site_transfer_proposals_lifecycle_shape check')
    expect(definition).toContain("state in ('proposed', 'awaiting-confirmations') and (state <> 'proposed' or updated_at = created_at)")
    expect(definition).toContain("and ready_at is null and started_at is null")
    expect(definition).toContain("state = 'ready' and ready_at is not null and started_at is null")
    expect(definition).toContain("state = 'running' and ready_at is not null and started_at is not null")
    expect(definition).toContain("state = 'resume-requested' and ready_at is not null and started_at is not null")
    expect(definition).toContain("state = 'cancellation-requested' and (started_at is null or ready_at is not null)")
    expect(definition).toContain("state = 'compensating' and ready_at is not null and started_at is not null and compensation_started_at is not null and compensation_completed_at is null")
    expect(definition).toContain("state = 'failed' and ready_at is not null and started_at is not null and compensation_started_at is not null and compensation_completed_at is not null")
    expect(definition).toContain("state = 'completed' and ready_at is not null and started_at is not null")
    expect(definition).toContain("state = 'cancelled' and (started_at is null or ready_at is not null)")
    expect(definition).toContain('constraint fuma_site_transfer_proposals_time_order check')
    expect(definition).toContain('updated_at >= created_at')
    expect(definition).toContain('started_at >= ready_at and started_at <= updated_at')
    expect(definition).toContain('compensation_completed_at >= compensation_started_at')
    expect(definition).toContain('cancelled_at >= coalesce(started_at, ready_at, created_at)')
    expect(definition).toContain('resume_count = 0 or started_at is not null')
    expect(definition).toContain('cancellation_requested_by_user_id is not null and cancellation_request_id is not null and cancellation_reason_code is not null')
    expect(definition).toContain('resume_requested_by_user_id is not null and resume_request_id is not null and resume_reason_code is not null')
    expect(normalizedSql).toContain(
      'create trigger fuma_site_transfer_proposals_validate_lifecycle before insert or update on fuma_site_transfer_proposals for each row execute function fuma_site_transfer_proposals_validate_lifecycle()',
    )
    expect(normalizedSql).toContain('site transfer proposal updated_at must advance monotonically')
    expect(normalizedSql).toContain('site transfer lifecycle fact timestamps are immutable once recorded')
    expect(normalizedSql).toContain('illegal site transfer proposal transition: % -> %')
    expect(normalizedSql).toContain('ready_at may only be recorded while becoming ready')
    expect(normalizedSql).toContain('started_at may only be recorded while starting a ready transfer')
    expect(normalizedSql).toContain('compensation_started_at may only be recorded while entering compensation')
    expect(normalizedSql).toContain('compensation_completed_at may only be recorded while becoming failed')
    expect(normalizedSql).toContain('cancellation request fields may only be recorded while requesting cancellation')
    expect(normalizedSql).toContain('resume request fields may only advance while requesting resume')
    expect(normalizedSql).toContain('failure snapshot may only be recorded while entering compensation')
  })

  it('stores an object-only manifest and failure/receipt/error JSON in correctly named columns', () => {
    expect(TRANSFER_JSON_COLUMNS).toEqual({
      proposalManifest: 'manifest_json',
      proposalFailure: 'failure_json',
      stepReceipt: 'receipt_json',
      stepError: 'error_json',
      collaboratorReceipt: 'receipt_json',
      collaboratorError: 'error_json',
    })
    expect(tableDefinition(TRANSFER_TABLE_NAMES.proposal)).toContain('manifest_json jsonb not null')
    expect(tableDefinition(TRANSFER_TABLE_NAMES.proposal)).toContain(
      "jsonb_typeof(manifest_json) = 'object'",
    )
    expect(tableDefinition(TRANSFER_TABLE_NAMES.proposal)).toContain(
      "failure_json is null or jsonb_typeof(failure_json) = 'object'",
    )
    for (const table of [TRANSFER_TABLE_NAMES.step, TRANSFER_TABLE_NAMES.collaboratorIntent]) {
      const definition = tableDefinition(table)
      expect(definition).toContain("receipt_json is null or jsonb_typeof(receipt_json) = 'object'")
      expect(definition).toContain("error_json is null or jsonb_typeof(error_json) = 'object'")
    }
    expect(normalizedSql).not.toMatch(/\b(?:manifest|failure|receipt|error)\b\s+jsonb/i)
  })

  it('requires exactly one immutable confirmation per source and destination side', () => {
    const definition = tableDefinition(TRANSFER_TABLE_NAMES.confirmation)
    expect(TRANSFER_CONFIRMATION_SIDES).toEqual(['source', 'destination'])
    expect(definition).toContain("side text not null check (side in ('source', 'destination'))")
    expect(definition).toContain('primary key (platform_id, transfer_id, side)')
    expect(definition).toContain('organization_id text not null')
    expect(definition).toContain('workspace_id text not null')
    expect(definition).toContain('site_id text not null')
    expect(definition).not.toMatch(/references\s+(?:auth_users|auth_organizations|fuma_workspaces|fuma_sites)/i)
    expect(normalizedSql).toContain(
      'create trigger fuma_site_transfer_confirmations_validate_insert before insert on fuma_site_transfer_confirmations for each row execute function fuma_site_transfer_confirmations_validate_insert()',
    )
    expect(normalizedSql).toContain(
      'select * into proposal from fuma_site_transfer_proposals where platform_id = new.platform_id and id = new.transfer_id for update',
    )
    expect(normalizedSql).toContain(
      'new.organization_id is distinct from proposal.source_organization_id or new.workspace_id is distinct from proposal.source_workspace_id or new.site_id is distinct from proposal.source_site_id',
    )
    expect(normalizedSql).toContain(
      'new.organization_id is distinct from proposal.destination_organization_id or new.workspace_id is distinct from proposal.destination_workspace_id or new.site_id is distinct from proposal.destination_site_id',
    )
    expect(normalizedSql).toContain('site transfer confirmation timestamp must advance monotonically')
    expect(normalizedSql).toContain('opposite.side <> new.side and opposite.confirmed_by_user_id = new.confirmed_by_user_id')
    expect(normalizedSql).toContain('ready site transfer proposal requires two distinct exact-side confirmations')
    expect(normalizedSql).toContain('ready_at must equal the latest exact-side confirmation timestamp')
    expect(normalizedSql).toContain('awaiting-confirmations requires exactly one exact-side confirmation')
    expect(normalizedSql).toContain(
      'create trigger fuma_site_transfer_confirmations_reject_update before update on fuma_site_transfer_confirmations for each statement execute function fuma_site_transfer_confirmations_reject_mutation()',
    )
    expect(normalizedSql).toContain(
      'create trigger fuma_site_transfer_confirmations_reject_delete before delete on fuma_site_transfer_confirmations for each statement execute function fuma_site_transfer_confirmations_reject_mutation()',
    )
  })

  it('provides an exclusive durable site lock and carries its positive fence into every step', () => {
    const lock = tableDefinition(TRANSFER_TABLE_NAMES.lock)
    const step = tableDefinition(TRANSFER_TABLE_NAMES.step)
    expect(TRANSFER_LOCK_STATES).toEqual(['active', 'released'])
    expect(lock).toContain("state text not null check (state in ('active', 'released'))")
    expect(lock).toContain('fence bigint not null check (fence > 0)')
    expect(lock).toContain(
      "state = 'active' and released_at is null and release_reason_code is null",
    )
    expect(lock).toContain(
      "state = 'released' and released_at is not null and btrim(release_reason_code) <> ''",
    )
    expect(TRANSFER_FENCE_POLICY).toEqual({
      type: 'positive-bigint',
      exclusiveBy: ['platform_id', 'organization_id', 'workspace_id', 'site_id'],
      stepForeignKey: ['platform_id', 'lock_id', 'fence'],
    })
    expect(normalizedSql).toContain(
      "create unique index fuma_site_transfer_locks_active_site_unique on fuma_site_transfer_locks (platform_id, organization_id, workspace_id, site_id) where state = 'active'",
    )
    expect(normalizedSql).toContain(
      "create unique index fuma_site_transfer_locks_active_transfer_unique on fuma_site_transfer_locks (platform_id, transfer_id) where state = 'active'",
    )
    expect(normalizedSql).toContain(
      'create unique index fuma_site_transfer_locks_site_fence_unique on fuma_site_transfer_locks ( platform_id, organization_id, workspace_id, site_id, fence )',
    )
    expect(normalizedSql).toContain(
      'create unique index fuma_site_transfer_locks_identity_fence_unique on fuma_site_transfer_locks (platform_id, id, fence)',
    )
    expect(step).toContain('fence bigint not null check (fence > 0)')
    expect(step).toContain('foreign key (platform_id, lock_id, fence)')
    expect(step).toContain('references fuma_site_transfer_locks(platform_id, id, fence) on delete restrict')
    expect(normalizedSql).toContain(
      'create trigger fuma_site_transfer_locks_validate_update before update on fuma_site_transfer_locks for each row execute function fuma_site_transfer_locks_validate_update()',
    )
    expect(normalizedSql).toContain('site transfer lock identity, ancestry, fence, and acquisition facts are immutable')
    expect(normalizedSql).toContain('released site transfer lock % is immutable')
    expect(normalizedSql).toContain(
      'create trigger fuma_site_transfer_locks_reject_delete before delete on fuma_site_transfer_locks for each statement execute function fuma_site_transfer_locks_reject_delete()',
    )
  })

  it('retains definition-qualified forward and compensation attempts at arbitrary positive sequences', () => {
    const definition = tableDefinition(TRANSFER_TABLE_NAMES.step)
    const definitionAttemptIndex = indexStatements().find((statement) =>
      statement.includes('fuma_site_transfer_steps_definition_attempt_unique'))

    expect(TRANSFER_STEP_KINDS).toEqual(['forward', 'compensation'])
    expect(checkValues(definition, 'kind')).toEqual(TRANSFER_STEP_KINDS)
    expect(definition).toContain('definition_id text not null')
    expect(definition).toContain("btrim(definition_id) <> ''")
    expect(definition).toContain('sequence bigint not null check ( sequence > 0 and sequence <= 9007199254740991 )')
    expect(definition).not.toMatch(/kind\s*=.*sequence\s*=/i)
    expect(definitionAttemptIndex).toBe(
      'create unique index fuma_site_transfer_steps_definition_attempt_unique on fuma_site_transfer_steps ( platform_id, transfer_id, kind, definition_id, attempt );',
    )
    expect(definitionAttemptIndex).not.toContain('sequence')
    expect(TRANSFER_STEP_STATES).toEqual(['pending', 'running', 'succeeded', 'failed', 'skipped'])
    expect(checkValues(definition, 'state')).toEqual(TRANSFER_STEP_STATES)
    expect(definition).toContain('attempt integer not null check (attempt > 0)')
    expect(definition).toContain("state in ('succeeded', 'skipped') and started_at is not null and finished_at is not null and receipt_json is not null and error_json is null")
    expect(definition).toContain("state = 'failed' and started_at is not null and finished_at is not null and receipt_json is null and error_json is not null")
    expect(definition).toContain('updated_at >= created_at')
    expect(definition).toContain('started_at >= created_at and started_at <= updated_at')
    expect(definition).toContain('finished_at >= started_at and finished_at <= updated_at')
    expect(normalizedSql).toContain(
      'create trigger fuma_site_transfer_steps_validate_mutation before insert or update on fuma_site_transfer_steps for each row execute function fuma_site_transfer_steps_validate_mutation()',
    )
    expect(normalizedSql).toContain("new.kind = 'forward' and new.state <> 'pending'")
    expect(normalizedSql).toContain("new.kind = 'compensation' and new.state not in ('succeeded', 'skipped')")
    expect(normalizedSql).toContain("old.state = 'pending' and new.state = 'running'")
    expect(normalizedSql).toContain("old.state = 'running' and new.state in ('succeeded', 'failed')")
    expect(normalizedSql).toContain("old.state in ('succeeded', 'failed', 'skipped')")
    expect(normalizedSql).toContain(
      'create trigger fuma_site_transfer_steps_reject_delete before delete on fuma_site_transfer_steps for each statement execute function fuma_site_transfer_steps_reject_delete()',
    )
  })

  it('records collaborator intent without mutable user authority foreign keys', () => {
    const definition = tableDefinition(TRANSFER_TABLE_NAMES.collaboratorIntent)
    expect(TRANSFER_COLLABORATOR_INTENTS).toEqual(['preserve', 'remove'])
    expect(TRANSFER_COLLABORATOR_STATES).toEqual([
      'pending', 'applying', 'applied', 'skipped', 'failed',
    ])
    expect(definition).toContain("intent text not null check (intent in ('preserve', 'remove'))")
    expect(checkValues(definition, 'state')).toEqual(TRANSFER_COLLABORATOR_STATES)
    expect(definition).toContain("intent = 'preserve' and destination_role is not null")
    expect(definition).toContain("intent = 'remove' and destination_role is null")
    expect(definition).not.toMatch(/references\s+auth_users/i)
  })

  it('creates only the exact transfer query, uniqueness, and fencing indexes', () => {
    expect(Object.values(TRANSFER_INDEX_NAMES)).toEqual([
      'fuma_site_transfer_proposals_source_recency_idx',
      'fuma_site_transfer_proposals_destination_recency_idx',
      'fuma_site_transfer_proposals_state_recency_idx',
      'fuma_site_transfer_locks_active_site_unique',
      'fuma_site_transfer_locks_active_transfer_unique',
      'fuma_site_transfer_locks_site_fence_unique',
      'fuma_site_transfer_locks_identity_fence_unique',
      'fuma_site_transfer_steps_definition_attempt_unique',
      'fuma_site_transfer_steps_runnable_idx',
      'fuma_site_transfer_collaborator_intents_user_unique',
      'fuma_site_transfer_collaborator_intents_state_idx',
    ])
    expect(indexStatements()).toEqual([
      'create index fuma_site_transfer_proposals_source_recency_idx on fuma_site_transfer_proposals ( platform_id, source_organization_id, source_workspace_id, source_site_id, created_at desc, id );',
      'create index fuma_site_transfer_proposals_destination_recency_idx on fuma_site_transfer_proposals ( platform_id, destination_organization_id, destination_workspace_id, destination_site_id, created_at desc, id );',
      "create index fuma_site_transfer_proposals_state_recency_idx on fuma_site_transfer_proposals (platform_id, state, updated_at, id) where state not in ('completed', 'cancelled');",
      "create unique index fuma_site_transfer_locks_active_site_unique on fuma_site_transfer_locks (platform_id, organization_id, workspace_id, site_id) where state = 'active';",
      "create unique index fuma_site_transfer_locks_active_transfer_unique on fuma_site_transfer_locks (platform_id, transfer_id) where state = 'active';",
      'create unique index fuma_site_transfer_locks_site_fence_unique on fuma_site_transfer_locks ( platform_id, organization_id, workspace_id, site_id, fence );',
      'create unique index fuma_site_transfer_locks_identity_fence_unique on fuma_site_transfer_locks (platform_id, id, fence);',
      'create unique index fuma_site_transfer_steps_definition_attempt_unique on fuma_site_transfer_steps ( platform_id, transfer_id, kind, definition_id, attempt );',
      "create index fuma_site_transfer_steps_runnable_idx on fuma_site_transfer_steps ( platform_id, transfer_id, sequence, kind, definition_id, attempt, updated_at, id ) where state in ('pending', 'running', 'failed');",
      'create unique index fuma_site_transfer_collaborator_intents_user_unique on fuma_site_transfer_collaborator_intents (platform_id, transfer_id, user_id);',
      'create index fuma_site_transfer_collaborator_intents_state_idx on fuma_site_transfer_collaborator_intents ( platform_id, transfer_id, state, updated_at, id );',
    ])
  })

  it('timestamps proposal, confirmation, lock, step, and collaborator lifecycle facts', () => {
    const expectedByTable = {
      [TRANSFER_TABLE_NAMES.proposal]: [
        'created_at', 'updated_at', 'ready_at', 'started_at', 'compensation_started_at',
        'compensation_completed_at', 'completed_at', 'cancelled_at',
      ],
      [TRANSFER_TABLE_NAMES.confirmation]: ['confirmed_at'],
      [TRANSFER_TABLE_NAMES.lock]: ['acquired_at', 'heartbeat_at', 'released_at'],
      [TRANSFER_TABLE_NAMES.step]: ['created_at', 'updated_at', 'started_at', 'finished_at'],
      [TRANSFER_TABLE_NAMES.collaboratorIntent]: ['created_at', 'updated_at', 'applied_at'],
    }
    for (const [table, columns] of Object.entries(expectedByTable)) {
      const definition = tableDefinition(table)
      for (const column of columns) expect(definition).toContain(`${column} timestamptz`)
    }
  })
})
