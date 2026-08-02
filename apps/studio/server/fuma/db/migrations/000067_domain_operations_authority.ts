import type { HostedMigration } from '../migrationPolicy'

/** Conductor-finalized additive FUMA-062 customer-DNS and registrar-transfer authority. */
export const domainOperationsAuthorityMigration: HostedMigration = Object.freeze({
  id: '000067_domain_operations_authority',
  description: 'Add strict customer DNS registrar transfer and domain outcome authority',
  sql: `
    create table fuma_domain_operation_settings_v2 (
      platform_id text not null, organization_id text not null, workspace_id text not null,
      site_id text not null, owner_key text not null, owner_generation bigint not null check (owner_generation > 0),
      owner_state text not null check (owner_state in ('active','transferring')),
      transfer_fence bigint null check (transfer_fence is null or transfer_fence > 0), profile_id text not null,
      domain_id text not null, settings_json jsonb not null, version bigint not null check (version > 0),
      operation_fence bigint not null check (operation_fence > 0), updated_at timestamptz not null,
      primary key (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,domain_id),
      check ((owner_state='active') = (transfer_fence is null))
    );
    create table fuma_registrar_transfer_authority_v2 (
      transfer_operation_id text primary key, platform_id text not null, organization_id text not null,
      workspace_id text not null, site_id text not null, owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0), owner_state text not null check (owner_state in ('active','transferring')),
      transfer_fence bigint null check (transfer_fence is null or transfer_fence > 0), profile_id text not null,
      domain_id text not null, hostname text not null check (hostname=lower(hostname)), direction text not null check (direction in ('inbound','outbound')),
      state text not null check (state in ('requested','awaiting-unlock','awaiting-auth-code','submitted','completed','failed','rolling-back','rolled-back','detached')),
      transfer_json jsonb not null, version bigint not null check (version > 0), fence bigint not null check (fence > 0),
      operation_sha256 text not null check (operation_sha256 ~ '^[a-f0-9]{64}$'), created_at timestamptz not null, updated_at timestamptz not null,
      check ((owner_state='active') = (transfer_fence is null))
    );
    create index fuma_registrar_transfer_scope_v2 on fuma_registrar_transfer_authority_v2
      (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,updated_at);
    create table fuma_site_transfer_domain_choices_v2 (
      transfer_id text not null, domain_id text not null, choice_json jsonb not null,
      source_settings_json jsonb not null, current_settings_json jsonb not null,
      applied_fence bigint null check (applied_fence is null or applied_fence > 0), apply_receipt_json jsonb null,
      compensated_fence bigint null check (compensated_fence is null or compensated_fence > 0), compensation_receipt_json jsonb null,
      decided_at timestamptz not null, primary key(transfer_id,domain_id),
      check ((applied_fence is null) = (apply_receipt_json is null)),
      check ((compensated_fence is null) = (compensation_receipt_json is null))
    );
    create table fuma_domain_operation_evidence_v2 (
      evidence_id text primary key, domain_id text not null, operation_kind text not null,
      evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'), evidence_json jsonb not null,
      occurred_at timestamptz not null
    );
    create function fuma_domain_operation_evidence_immutable_v2() returns trigger language plpgsql as $domain_operation_immutable$
    begin raise exception 'domain operation evidence is immutable' using errcode='55000'; end;
    $domain_operation_immutable$;
    create trigger fuma_domain_operation_evidence_immutable_v2 before update or delete on fuma_domain_operation_evidence_v2
      for each row execute function fuma_domain_operation_evidence_immutable_v2();
  `,
})
