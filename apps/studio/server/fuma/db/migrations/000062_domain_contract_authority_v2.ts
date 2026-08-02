import type { HostedMigration } from '../migrationPolicy'

/** Conductor-finalized additive FUMA-059 domain contract authority. */
export const domainContractAuthorityV2Migration: HostedMigration = Object.freeze({
  id: '000062_domain_contract_authority_v2',
  description: 'Add strict domain desired observed credential operation and immutable transition authority',
  sql: `
    create table fuma_domain_records_v2 (
      domain_id text not null,
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      owner_state text not null check (owner_state in ('active','transferring')),
      transfer_fence bigint null check (transfer_fence is null or transfer_fence > 0),
      profile_id text not null,
      hostname_ascii text not null check (hostname_ascii = lower(hostname_ascii)),
      hostname_unicode text not null,
      kind text not null check (kind in ('customer-dns','fuma-registered')),
      desired_state text not null check (desired_state in ('detached','validating','active','suspended','deleted')),
      observed_state text not null check (observed_state in (
        'unknown','dns-pending','dns-valid','tls-pending','active','degraded','detached','deleted'
      )),
      certificate_state text not null check (certificate_state in (
        'none','provisioning','active','expiring','expired','failed','revoked'
      )),
      credential_id text null,
      credential_scope text null check (credential_scope is null or credential_scope in ('fuma-platform','customer-automation')),
      version bigint not null check (version > 0),
      operation_fence bigint not null check (operation_fence > 0),
      created_at timestamptz not null,
      updated_at timestamptz not null,
      primary key (
        platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, domain_id
      ),
      check ((owner_state = 'active') = (transfer_fence is null)),
      check ((credential_id is null) = (credential_scope is null)),
      check (kind <> 'fuma-registered' or credential_scope = 'fuma-platform'),
      check (observed_state <> 'active' or (desired_state = 'active' and certificate_state = 'active')),
      check (desired_state <> 'deleted' or (
        observed_state = 'deleted' and certificate_state in ('none','revoked') and credential_id is null
      ))
    );
    create unique index fuma_domain_records_owner_hostname_v2
      on fuma_domain_records_v2 (platform_id, hostname_ascii);
    create index fuma_domain_records_scope_v2
      on fuma_domain_records_v2 (
        platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, hostname_ascii
      );

    create table fuma_domain_credential_versions_v2 (
      authority_sha256 text not null check (authority_sha256 ~ '^[a-f0-9]{64}$'),
      credential_id text not null,
      credential_version bigint not null check (credential_version > 0),
      scope text not null check (scope in ('fuma-platform','customer-automation')),
      platform_id text not null,
      organization_id text null,
      workspace_id text null,
      site_id text null,
      owner_key text null,
      owner_generation bigint null check (owner_generation is null or owner_generation > 0),
      profile_id text null,
      ciphertext text not null check (ciphertext ~ '^v1\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{22,}$'),
      key_id text not null,
      algorithm text not null check (algorithm = 'AES-256-GCM'),
      fingerprint_sha256 text not null check (fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
      state text not null check (state in ('active','revoked')),
      fence bigint not null check (fence > 0),
      created_at timestamptz not null,
      rotated_at timestamptz null,
      revoked_at timestamptz null,
      rotated_from_fingerprint_sha256 text null check (
        rotated_from_fingerprint_sha256 is null or rotated_from_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
      ),
      primary key (authority_sha256, credential_id, credential_version),
      check (
        (scope = 'fuma-platform' and organization_id is null and workspace_id is null and site_id is null
          and owner_key is null and owner_generation is null and profile_id is null)
        or
        (scope = 'customer-automation' and organization_id is not null and workspace_id is not null
          and site_id is not null and owner_key is not null and owner_generation is not null and profile_id is not null)
      ),
      check ((state = 'revoked') = (revoked_at is not null))
    );

    create table fuma_domain_credential_heads_v2 (
      authority_sha256 text not null,
      credential_id text not null,
      credential_version bigint not null,
      fence bigint not null check (fence > 0),
      state text not null check (state in ('active','revoked')),
      updated_at timestamptz not null,
      primary key (authority_sha256, credential_id),
      foreign key (authority_sha256, credential_id, credential_version)
        references fuma_domain_credential_versions_v2(authority_sha256, credential_id, credential_version)
        on delete restrict
    );

    create table fuma_domain_transitions_v2 (
      transition_id text primary key,
      operation_id text not null unique,
      domain_id text not null,
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      owner_state text not null check (owner_state in ('active','transferring')),
      transfer_fence bigint null check (transfer_fence is null or transfer_fence > 0),
      profile_id text not null,
      expected_version bigint not null check (expected_version > 0),
      from_desired text not null,
      to_desired text not null,
      from_observed text not null,
      to_observed text not null,
      from_certificate text not null,
      to_certificate text not null,
      from_fence bigint not null check (from_fence > 0),
      to_fence bigint not null check (to_fence = from_fence + 1),
      actor_id text not null,
      reason_code text not null,
      evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
      occurred_at timestamptz not null,
      check ((owner_state = 'active') = (transfer_fence is null)),
      foreign key (
        platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, domain_id
      ) references fuma_domain_records_v2 (
        platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, domain_id
      ) on delete restrict
    );
    create index fuma_domain_transitions_scope_v2
      on fuma_domain_transitions_v2 (platform_id, organization_id, workspace_id, site_id, domain_id, occurred_at);

    create table fuma_domain_provider_operations_v2 (
      idempotency_key text primary key,
      operation_id text not null unique,
      command_sha256 text not null check (command_sha256 ~ '^[a-f0-9]{64}$'),
      command_json jsonb not null,
      state text not null check (state in ('claimed','retryable','succeeded')),
      attempt integer not null check (attempt between 1 and 100),
      result_json jsonb null,
      failure_code text null,
      updated_at timestamptz not null,
      check ((state = 'succeeded') = (result_json is not null))
    );

    create function fuma_domain_immutable_evidence_v2()
    returns trigger language plpgsql as $domain_immutable$
    begin
      raise exception 'domain evidence is immutable' using errcode = '55000';
    end;
    $domain_immutable$;
    create trigger fuma_domain_credential_version_immutable_v2
      before update or delete on fuma_domain_credential_versions_v2
      for each row execute function fuma_domain_immutable_evidence_v2();
    create trigger fuma_domain_transition_immutable_v2
      before update or delete on fuma_domain_transitions_v2
      for each row execute function fuma_domain_immutable_evidence_v2();

    create function fuma_domain_credential_head_guard_v2()
    returns trigger language plpgsql as $domain_head_guard$
    begin
      if tg_op = 'DELETE'
        or new.authority_sha256 <> old.authority_sha256
        or new.credential_id <> old.credential_id
        or new.credential_version <> old.credential_version + 1
        or new.fence <> old.fence + 1
        or old.state = 'revoked' then
        raise exception 'domain credential head transition is stale or immutable' using errcode = '55000';
      end if;
      return new;
    end;
    $domain_head_guard$;
    create trigger fuma_domain_credential_head_guard_v2
      before update or delete on fuma_domain_credential_heads_v2
      for each row execute function fuma_domain_credential_head_guard_v2();
  `,
})
