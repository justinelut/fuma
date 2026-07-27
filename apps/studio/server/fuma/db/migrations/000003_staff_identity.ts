import { LEGACY_STAFF_IDENTITY_BACKFILL_SQL } from '../../../auth/hosted/legacyIdentity'
import type { HostedMigration } from '../migrationPolicy'

export const staffIdentityMigration: HostedMigration = {
  id: '000003_staff_identity',
  description: 'Create hosted staff identity, credentials, profiles, and legacy links',
  sql: `
    create table auth_users (
      id text primary key,
      name text not null,
      email text not null unique,
      email_verified boolean not null default false,
      image text,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      role text,
      banned boolean default false,
      ban_reason text,
      ban_expires timestamptz,
      two_factor_enabled boolean default false
    );
    create unique index auth_users_email_normalized_idx on auth_users (lower(email));

    create table auth_sessions (
      id text primary key,
      expires_at timestamptz not null,
      token text not null unique,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      ip_address text,
      user_agent text,
      user_id text not null references auth_users(id) on delete cascade,
      active_organization_id text,
      impersonated_by text
    );
    create index auth_sessions_user_id_idx on auth_sessions(user_id);

    create table auth_accounts (
      id text primary key,
      account_id text not null,
      provider_id text not null,
      user_id text not null references auth_users(id) on delete cascade,
      access_token text,
      refresh_token text,
      id_token text,
      access_token_expires_at timestamptz,
      refresh_token_expires_at timestamptz,
      scope text,
      password text,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      unique (provider_id, account_id)
    );
    create index auth_accounts_user_id_idx on auth_accounts(user_id);
    create unique index auth_accounts_user_credential_idx
      on auth_accounts(user_id) where provider_id = 'credential';

    create table auth_verifications (
      id text primary key,
      identifier text not null,
      value text not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp
    );
    create index auth_verifications_identifier_idx on auth_verifications(identifier);

    create table auth_organizations (
      id text primary key,
      name text not null,
      slug text not null unique,
      logo text,
      created_at timestamptz not null,
      metadata text
    );

    create table auth_members (
      id text primary key,
      organization_id text not null references auth_organizations(id) on delete cascade,
      user_id text not null references auth_users(id) on delete cascade,
      role text not null default 'member',
      created_at timestamptz not null,
      unique (organization_id, user_id)
    );
    create index auth_members_organization_id_idx on auth_members(organization_id);
    create index auth_members_user_id_idx on auth_members(user_id);

    create table auth_invitations (
      id text primary key,
      organization_id text not null references auth_organizations(id) on delete cascade,
      email text not null,
      role text,
      status text not null default 'pending',
      expires_at timestamptz not null,
      created_at timestamptz not null default current_timestamp,
      inviter_id text not null references auth_users(id) on delete cascade
    );
    create index auth_invitations_organization_id_idx on auth_invitations(organization_id);
    create index auth_invitations_email_idx on auth_invitations(email);

    create table auth_two_factors (
      id text primary key,
      secret text not null,
      backup_codes text not null,
      user_id text not null unique references auth_users(id) on delete cascade,
      verified boolean default true,
      failed_verification_count integer default 0,
      locked_until timestamptz
    );
    create index auth_two_factors_secret_idx on auth_two_factors(secret);
    create index auth_two_factors_user_id_idx on auth_two_factors(user_id);

    create table auth_staff_profiles (
      user_id text primary key references auth_users(id) on delete restrict,
      source text not null check (source in ('native', 'legacy')),
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp
    );

    create table auth_legacy_identity_links (
      legacy_user_id text primary key references users(id) on delete restrict,
      auth_user_id text not null unique references auth_users(id) on delete restrict,
      linked_at timestamptz not null default current_timestamp
    );

    ${LEGACY_STAFF_IDENTITY_BACKFILL_SQL}
  `,
}
