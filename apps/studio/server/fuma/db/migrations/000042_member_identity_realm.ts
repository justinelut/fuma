import type { HostedMigration } from '../migrationPolicy'

/** FUMA-038: a site-member credential/session realm with no Better Auth foreign keys. */
export const memberIdentityRealmMigration: HostedMigration = Object.freeze({
  id: '000042_member_identity_realm',
  description: 'Add isolated site member identities sessions consent and imports',
  sql: `
    create table fuma_member_identities (
      platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
      owner_key text not null, owner_generation bigint not null check (owner_generation > 0), profile_id text not null,
      member_identity_id text not null, normalized_email text not null check (normalized_email = lower(btrim(normalized_email))),
      display_name text not null default '', password_hash text null,
      state text not null check (state in ('active','disabled','activation-required')),
      origin text not null check (origin in ('self-signup','staff-import')), import_receipt_id text null,
      created_at timestamptz not null, updated_at timestamptz not null,
      primary key (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, member_identity_id),
      unique (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, normalized_email),
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict,
      check ((origin='self-signup' and password_hash is not null and import_receipt_id is null)
        or (origin='staff-import' and password_hash is null and import_receipt_id is not null and state='activation-required'))
    );

    create table fuma_member_sessions (
      platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
      owner_key text not null, owner_generation bigint not null, profile_id text not null,
      session_id text not null, member_identity_id text not null,
      token_hash_sha256 text not null unique check (token_hash_sha256 ~ '^[a-f0-9]{64}$'),
      created_at timestamptz not null, last_seen_at timestamptz not null, expires_at timestamptz not null,
      idle_expires_at timestamptz not null, reauthenticated_at timestamptz null, revoked_at timestamptz null,
      user_agent_hash_sha256 text null check (user_agent_hash_sha256 is null or user_agent_hash_sha256 ~ '^[a-f0-9]{64}$'),
      ip_hash_sha256 text null check (ip_hash_sha256 is null or ip_hash_sha256 ~ '^[a-f0-9]{64}$'),
      primary key (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, session_id),
      foreign key (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, member_identity_id)
        references fuma_member_identities(platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, member_identity_id)
        on delete restrict,
      check (created_at <= last_seen_at and last_seen_at <= idle_expires_at and idle_expires_at <= expires_at)
    );
    create index fuma_member_sessions_active_lookup_idx on fuma_member_sessions
      (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, member_identity_id, expires_at)
      where revoked_at is null;

    create table fuma_member_consent_events (
      platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
      owner_key text not null, owner_generation bigint not null, profile_id text not null,
      event_id text not null, member_identity_id text not null,
      purpose text not null check (purpose in ('terms','privacy','newsletter','analytics')),
      action text not null check (action in ('granted','withdrawn')), notice_version text not null,
      source text not null check (source in ('member-signup','member-profile','staff-import')),
      source_receipt_id text null, occurred_at timestamptz not null,
      primary key (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, event_id),
      foreign key (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, member_identity_id)
        references fuma_member_identities(platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, member_identity_id)
        on delete restrict
    );
    create function fuma_member_consent_events_immutable() returns trigger language plpgsql as $body$
      begin raise exception 'member consent provenance is append-only' using errcode='55000'; end;
    $body$;
    create trigger fuma_member_consent_events_immutable before update or delete on fuma_member_consent_events
      for each row execute function fuma_member_consent_events_immutable();

    create table fuma_member_import_receipts (
      platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
      owner_key text not null, owner_generation bigint not null, profile_id text not null,
      import_id text not null, source text not null check (source in ('ghost','csv','manual')),
      source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
      staff_user_id text not null, staff_session_id text not null, reauthentication_proof_id text not null,
      reauthenticated_at timestamptz not null, reauthentication_expires_at timestamptz not null,
      imported_count integer not null check (imported_count >= 0), skipped_count integer not null check (skipped_count >= 0),
      created_at timestamptz not null,
      primary key (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, import_id),
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict,
      check (reauthenticated_at <= created_at and created_at < reauthentication_expires_at)
    );
  `,
})
