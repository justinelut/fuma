import type { HostedMigration } from '../migrationPolicy'

/** Conductor-finalized additive FUMA-061 registrar lifecycle authority. */
export const registrarLifecycleAuthorityMigration: HostedMigration = Object.freeze({
  id: '000065_registrar_lifecycle_authority',
  description: 'Add strict registrar quotes operations receipts renewals and DNS handoffs',
  sql: `
    create table fuma_registrar_quotes_v2 (
      platform_id text not null, organization_id text not null, workspace_id text not null,
      site_id text not null, owner_key text not null, owner_generation bigint not null check (owner_generation > 0),
      owner_state text not null check (owner_state in ('active','transferring')),
      transfer_fence bigint null check (transfer_fence is null or transfer_fence > 0), profile_id text not null,
      quote_id text not null, quote_json jsonb not null, quote_hash_sha256 text not null check (quote_hash_sha256 ~ '^[a-f0-9]{64}$'),
      expires_at timestamptz not null, created_at timestamptz not null,
      primary key (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, quote_id),
      check ((owner_state='active') = (transfer_fence is null))
    );
    create table fuma_registrar_operations_v2 (
      operation_id text primary key, kind text not null check (kind in ('purchase','renew')),
      platform_id text not null, organization_id text not null, workspace_id text not null,
      site_id text not null, owner_key text not null, owner_generation bigint not null check (owner_generation > 0),
      owner_state text not null check (owner_state in ('active','transferring')),
      transfer_fence bigint null check (transfer_fence is null or transfer_fence > 0), profile_id text not null,
      authority_json jsonb not null, request_hash_sha256 text not null check (request_hash_sha256 ~ '^[a-f0-9]{64}$'),
      request_json jsonb not null, quote_id text not null, registration_id text null,
      idempotency_key text not null unique, state text not null check (state in ('pending','ambiguous','succeeded')),
      attempts integer not null check (attempts between 0 and 100), created_at timestamptz not null, updated_at timestamptz not null,
      check ((owner_state='active') = (transfer_fence is null))
    );
    create index fuma_registrar_operations_scope_v2 on fuma_registrar_operations_v2
      (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, updated_at);
    create table fuma_domain_registrations_v2 (
      registration_id text primary key, platform_id text not null, organization_id text not null, workspace_id text not null,
      site_id text not null, owner_key text not null, owner_generation bigint not null check (owner_generation > 0),
      owner_state text not null check (owner_state in ('active','transferring')),
      transfer_fence bigint null check (transfer_fence is null or transfer_fence > 0), profile_id text not null,
      quote_id text not null, hostname text not null check (hostname=lower(hostname)), provider_reference text not null,
      registration_json jsonb not null, expires_at timestamptz not null, updated_at timestamptz not null,
      unique (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, quote_id),
      unique (platform_id, provider_reference),
      check ((owner_state='active') = (transfer_fence is null))
    );
    create table fuma_registrar_purchase_receipts_v2 (
      receipt_id text primary key, operation_id text not null unique references fuma_registrar_operations_v2(operation_id) on delete restrict,
      receipt_json jsonb not null, created_at timestamptz not null
    );
    create table fuma_registrar_renewal_receipts_v2 (
      receipt_id text primary key, operation_id text not null unique references fuma_registrar_operations_v2(operation_id) on delete restrict,
      registration_id text not null references fuma_domain_registrations_v2(registration_id) on delete restrict,
      previous_expires_at timestamptz not null, receipt_json jsonb not null, created_at timestamptz not null,
      unique (registration_id, previous_expires_at)
    );
    create table fuma_registrar_dns_handoffs_v2 (
      handoff_id text primary key, operation_id text not null unique references fuma_registrar_operations_v2(operation_id) on delete restrict,
      handoff_json jsonb not null, state text not null check (state in ('pending','completed')),
      created_at timestamptz not null, completed_at timestamptz null,
      check ((state='completed') = (completed_at is not null))
    );
    create function fuma_registrar_receipt_immutable_v2() returns trigger language plpgsql as $registrar_immutable$
    begin raise exception 'registrar receipt evidence is immutable' using errcode='55000'; end;
    $registrar_immutable$;
    create trigger fuma_registrar_purchase_receipt_immutable_v2 before update or delete on fuma_registrar_purchase_receipts_v2
      for each row execute function fuma_registrar_receipt_immutable_v2();
    create trigger fuma_registrar_renewal_receipt_immutable_v2 before update or delete on fuma_registrar_renewal_receipts_v2
      for each row execute function fuma_registrar_receipt_immutable_v2();
  `,
})
