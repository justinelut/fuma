import type { HostedMigration } from '../migrationPolicy'

export const supportOperationsAuthorityMigration: HostedMigration = Object.freeze({
  id: '000076_support_operations_authority',
  description: 'Add immutable tenant-scoped support moderation and owner recovery evidence',
  sql: `
    create table fuma_support_sessions_v2 (
      support_session_id text primary key,
      platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
      owner_key text not null, owner_generation bigint not null check (owner_generation > 0),
      staff_actor_id text not null, target_user_id text not null, expires_at timestamptz not null,
      record_json jsonb not null check (jsonb_typeof(record_json) = 'object'), created_at timestamptz not null,
      check (staff_actor_id <> target_user_id), check (expires_at > created_at and expires_at <= created_at + interval '30 minutes')
    );
    create index fuma_support_sessions_v2_scope_idx on fuma_support_sessions_v2(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,expires_at);

    create table fuma_support_session_ends_v2 (
      support_session_id text primary key references fuma_support_sessions_v2(support_session_id) on delete restrict,
      record_json jsonb not null check (jsonb_typeof(record_json) = 'object'), ended_at timestamptz not null
    );

    create table fuma_support_actions_v2 (
      operation_id text primary key,
      support_session_id text not null references fuma_support_sessions_v2(support_session_id) on delete restrict,
      record_json jsonb not null check (jsonb_typeof(record_json) = 'object'), created_at timestamptz not null
    );
    create index fuma_support_actions_v2_session_idx on fuma_support_actions_v2(support_session_id,created_at,operation_id);

    create table fuma_moderation_evidence_v2 (
      evidence_id text primary key, case_id text not null, prior_evidence_id text null references fuma_moderation_evidence_v2(evidence_id) on delete restrict,
      platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
      owner_key text not null, owner_generation bigint not null check (owner_generation > 0),
      subject_kind text not null check (subject_kind in ('user','organization','site','expert','plugin')), subject_id text not null,
      event text not null check (event in ('opened','suspended','appealed','resolved')),
      record_json jsonb not null check (jsonb_typeof(record_json) = 'object'), created_at timestamptz not null,
      check (prior_evidence_id is null or prior_evidence_id <> evidence_id)
    );
    create unique index fuma_moderation_evidence_v2_prior_once_idx on fuma_moderation_evidence_v2(prior_evidence_id) where prior_evidence_id is not null;
    create index fuma_moderation_evidence_v2_subject_idx on fuma_moderation_evidence_v2(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,subject_kind,subject_id,created_at desc,evidence_id desc);
    create index fuma_moderation_evidence_v2_queue_idx on fuma_moderation_evidence_v2(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,event,created_at,evidence_id);

    create table fuma_break_glass_requests_v2 (
      request_id text primary key,
      platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
      owner_key text not null, owner_generation bigint not null check (owner_generation > 0),
      target_owner_id text not null, requested_by_actor_id text not null, expires_at timestamptz not null,
      record_json jsonb not null check (jsonb_typeof(record_json) = 'object'), created_at timestamptz not null,
      check (target_owner_id <> requested_by_actor_id), check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
    );
    create index fuma_break_glass_requests_v2_expiry_idx on fuma_break_glass_requests_v2(expires_at);

    create table fuma_break_glass_approvals_v2 (
      approval_id text primary key, request_id text not null references fuma_break_glass_requests_v2(request_id) on delete restrict,
      approver_id text not null, record_json jsonb not null check (jsonb_typeof(record_json) = 'object'), approved_at timestamptz not null,
      unique(request_id,approver_id)
    );
    create index fuma_break_glass_approvals_v2_request_idx on fuma_break_glass_approvals_v2(request_id,approved_at,approval_id);

    create table fuma_break_glass_executions_v2 (
      execution_id text primary key, request_id text not null unique references fuma_break_glass_requests_v2(request_id) on delete restrict,
      record_json jsonb not null check (jsonb_typeof(record_json) = 'object'), executed_at timestamptz not null
    );

    create table fuma_support_operation_effects_v2 (
      effect_key text primary key,
      kind text not null check (kind in ('support-started','support-ended','support-action-executed','moderation-applied','recovery-executed')),
      operation_id text not null,
      record_json jsonb not null check (jsonb_typeof(record_json) = 'object'), completed_at timestamptz not null,
      unique(kind,operation_id)
    );
    create table fuma_support_operation_locks_v2 (
      effect_key text primary key,
      created_at timestamptz not null default current_timestamp
    );

    create function fuma_support_operations_reject_mutation() returns trigger
    language plpgsql as $support_operations_immutable$
    begin
      raise exception 'support operations evidence is append-only' using errcode = '55000';
    end
    $support_operations_immutable$;

    create trigger fuma_support_sessions_v2_reject_update before update on fuma_support_sessions_v2 for each statement execute function fuma_support_operations_reject_mutation();
    create trigger fuma_support_sessions_v2_reject_delete before delete on fuma_support_sessions_v2 for each statement execute function fuma_support_operations_reject_mutation();
    create trigger fuma_support_session_ends_v2_reject_update before update on fuma_support_session_ends_v2 for each statement execute function fuma_support_operations_reject_mutation();
    create trigger fuma_support_session_ends_v2_reject_delete before delete on fuma_support_session_ends_v2 for each statement execute function fuma_support_operations_reject_mutation();
    create trigger fuma_support_actions_v2_reject_update before update on fuma_support_actions_v2 for each statement execute function fuma_support_operations_reject_mutation();
    create trigger fuma_support_actions_v2_reject_delete before delete on fuma_support_actions_v2 for each statement execute function fuma_support_operations_reject_mutation();
    create trigger fuma_moderation_evidence_v2_reject_update before update on fuma_moderation_evidence_v2 for each statement execute function fuma_support_operations_reject_mutation();
    create trigger fuma_moderation_evidence_v2_reject_delete before delete on fuma_moderation_evidence_v2 for each statement execute function fuma_support_operations_reject_mutation();
    create trigger fuma_break_glass_requests_v2_reject_update before update on fuma_break_glass_requests_v2 for each statement execute function fuma_support_operations_reject_mutation();
    create trigger fuma_break_glass_requests_v2_reject_delete before delete on fuma_break_glass_requests_v2 for each statement execute function fuma_support_operations_reject_mutation();
    create trigger fuma_break_glass_approvals_v2_reject_update before update on fuma_break_glass_approvals_v2 for each statement execute function fuma_support_operations_reject_mutation();
    create trigger fuma_break_glass_approvals_v2_reject_delete before delete on fuma_break_glass_approvals_v2 for each statement execute function fuma_support_operations_reject_mutation();
    create trigger fuma_break_glass_executions_v2_reject_update before update on fuma_break_glass_executions_v2 for each statement execute function fuma_support_operations_reject_mutation();
    create trigger fuma_break_glass_executions_v2_reject_delete before delete on fuma_break_glass_executions_v2 for each statement execute function fuma_support_operations_reject_mutation();
    create trigger fuma_support_operation_effects_v2_reject_update before update on fuma_support_operation_effects_v2 for each statement execute function fuma_support_operations_reject_mutation();
    create trigger fuma_support_operation_effects_v2_reject_delete before delete on fuma_support_operation_effects_v2 for each statement execute function fuma_support_operations_reject_mutation();
  `,
})
