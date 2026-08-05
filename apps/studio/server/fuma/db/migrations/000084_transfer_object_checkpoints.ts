import type { HostedMigration } from '../migrationPolicy'

/** Finalized transfer object-checkpoint and paid-handoff authority. */
export const transferObjectCheckpointMigration: HostedMigration = Object.freeze({
  id: '000084_transfer_object_checkpoints',
  description: 'Add fenced transfer object-copy checkpoints and ownership policy authority',
  sql: `
    create table fuma_transfer_object_checkpoints_v1 (
      transfer_id text not null,
      source_platform_id text not null,
      source_organization_id text not null,
      source_workspace_id text not null,
      source_site_id text not null,
      destination_platform_id text not null,
      destination_organization_id text not null,
      destination_workspace_id text not null,
      destination_site_id text not null,
      lock_id text not null,
      fence bigint not null check (fence > 0),
      manifest_checksum_sha256 text null check (manifest_checksum_sha256 is null or manifest_checksum_sha256 ~ '^[a-f0-9]{64}$'),
      manifest_json text null check (manifest_json is null or jsonb_typeof(manifest_json::jsonb) = 'object'),
      source_prefix_frozen boolean not null default true,
      source_authorized boolean not null default true,
      copy_progress_receipt_json text null check (copy_progress_receipt_json is null or jsonb_typeof(copy_progress_receipt_json::jsonb) = 'object'),
      copy_receipt_json text null check (copy_receipt_json is null or jsonb_typeof(copy_receipt_json::jsonb) = 'object'),
      compensation_receipt_json text null check (compensation_receipt_json is null or jsonb_typeof(compensation_receipt_json::jsonb) = 'object'),
      delete_receipts_json text not null default '[]' check (jsonb_typeof(delete_receipts_json::jsonb) = 'array'),
      rebind_receipt_json text null check (rebind_receipt_json is null or jsonb_typeof(rebind_receipt_json::jsonb) = 'object'),
      version bigint not null default 1 check (version > 0),
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      primary key (source_platform_id, transfer_id),
      foreign key (source_platform_id, transfer_id)
        references fuma_site_transfer_proposals(platform_id, id) on delete restrict,
      check ((manifest_json is null) = (manifest_checksum_sha256 is null)),
      check (source_platform_id <> '' and source_organization_id <> '' and source_workspace_id <> '' and source_site_id <> ''),
      check (destination_platform_id <> '' and destination_organization_id <> '' and destination_workspace_id <> '' and destination_site_id <> '')
    );

    create table fuma_transfer_object_progress_v1 (
      platform_id text not null,
      transfer_id text not null,
      logical_key text not null,
      manifest_checksum_sha256 text not null check (manifest_checksum_sha256 ~ '^[a-f0-9]{64}$'),
      intent_json text not null check (jsonb_typeof(intent_json::jsonb) = 'object'),
      receipt_json text null check (receipt_json is null or jsonb_typeof(receipt_json::jsonb) = 'object'),
      compensated boolean not null default false,
      delete_receipt_json text null check (delete_receipt_json is null or jsonb_typeof(delete_receipt_json::jsonb) = 'object'),
      version bigint not null default 1 check (version > 0),
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      primary key (platform_id, transfer_id, logical_key),
      foreign key (platform_id, transfer_id)
        references fuma_transfer_object_checkpoints_v1(source_platform_id, transfer_id) on delete restrict,
      check (btrim(logical_key) <> ''),
      check (not compensated or receipt_json is not null),
      check (delete_receipt_json is null or compensated)
    );

    create table fuma_tenant_object_policies_v1 (
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      state text not null check (state in ('active','sealed')),
      policy_version bigint not null check (policy_version > 0),
      policy_json text not null check (jsonb_typeof(policy_json::jsonb) = 'object'),
      policy_checksum_sha256 text not null check (policy_checksum_sha256 ~ '^[a-f0-9]{64}$'),
      transfer_id text null,
      transfer_lock_id text null,
      transfer_fence bigint null check (transfer_fence is null or transfer_fence > 0),
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      primary key (platform_id, organization_id, workspace_id, site_id),
      foreign key (platform_id, transfer_id)
        references fuma_site_transfer_proposals(platform_id, id) on delete restrict,
      check (
        (transfer_id is null and transfer_lock_id is null and transfer_fence is null)
        or
        (transfer_id is not null and transfer_lock_id is not null and transfer_fence is not null)
      )
    );

    create table fuma_paid_handoff_asset_choices_v1 (
      transfer_id text not null,
      asset text not null check (asset in ('domain','ai','mcp','plugins','payments','collaborators')),
      owner_ticket text not null check (owner_ticket in ('FUMA-062','FUMA-064','FUMA-066','FUMA-067','FUMA-069','FUMA-023')),
      selection text not null,
      source_json text not null check (jsonb_typeof(source_json::jsonb)='object'),
      destination_json text not null check (jsonb_typeof(destination_json::jsonb)='object'),
      recorded_at timestamptz not null,
      primary key (transfer_id, asset)
    );

    create table fuma_paid_handoff_notifications_v1 (
      delivery_key text primary key,
      command_id text not null references fuma_paid_handoff_outbox(command_id) on delete restrict,
      transfer_id text not null,
      event text not null check (event in ('confirmation-requested','started','recovery-requested','failed','completed','refund-escalated')),
      state text not null check (state in ('pending','delivered','failed')),
      provider_message_id text null,
      attempted_at timestamptz not null,
      delivered_at timestamptz null,
      check ((state='delivered')=(delivered_at is not null))
    );

    create table fuma_paid_handoff_completions_v1 (
      command_id text primary key references fuma_paid_handoff_outbox(command_id) on delete restrict,
      transfer_id text not null,
      contract_id text not null,
      source_json text not null check (jsonb_typeof(source_json::jsonb)='object'),
      destination_json text not null check (jsonb_typeof(destination_json::jsonb)='object'),
      internal_grant_excluded boolean not null check (internal_grant_excluded),
      completed_at timestamptz not null
    );

    create table fuma_paid_handoff_refund_escalations_v1 (
      escalation_key text primary key,
      command_id text not null references fuma_paid_handoff_outbox(command_id) on delete restrict,
      transfer_id text not null,
      contract_id text not null,
      reason_code text not null,
      requested_at timestamptz not null
    );

    create table fuma_paid_handoff_audit_keys_v1 (
      event_key text primary key,
      command_id text not null references fuma_paid_handoff_outbox(command_id) on delete restrict,
      transfer_id text not null,
      action text not null check (action in ('transfer.proposed','transfer.started','transfer.resumed')),
      outcome text not null check (outcome in ('success','failure')),
      failure_code text null,
      recorded_at timestamptz not null default current_timestamp
    );

    create index fuma_transfer_object_progress_receipts_v1
      on fuma_transfer_object_progress_v1(platform_id, transfer_id, compensated, logical_key);
    create index fuma_tenant_object_policy_transfer_v1
      on fuma_tenant_object_policies_v1(transfer_id)
      where transfer_id is not null;
  `,
})
