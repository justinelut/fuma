const SAFE_SCHEMA = /^[a-z][a-z0-9_]*$/

function quotedSchema(schema: string): string {
  if (!SAFE_SCHEMA.test(schema)) {
    throw new Error('FUMA-010 PostgreSQL gate schema must be a safe identifier')
  }
  return `"${schema}"`
}

/**
 * Test-only DDL mirroring generatedSchema.ts. This never runs from a Fuma
 * composition root and deliberately does not enter the FUMA-006 migration stream.
 */
export function compatibilitySchemaStatements(schema: string): readonly string[] {
  const namespace = quotedSchema(schema)
  return [
    `create table ${namespace}.auth_users (
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
    )`,
    `create table ${namespace}.auth_sessions (
      id text primary key,
      expires_at timestamptz not null,
      token text not null unique,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      ip_address text,
      user_agent text,
      user_id text not null references ${namespace}.auth_users(id) on delete cascade,
      active_organization_id text,
      impersonated_by text
    )`,
    `create index auth_sessions_user_id_idx on ${namespace}.auth_sessions(user_id)`,
    `create table ${namespace}.auth_accounts (
      id text primary key,
      account_id text not null,
      provider_id text not null,
      user_id text not null references ${namespace}.auth_users(id) on delete cascade,
      access_token text,
      refresh_token text,
      id_token text,
      access_token_expires_at timestamptz,
      refresh_token_expires_at timestamptz,
      scope text,
      password text,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp
    )`,
    `create index auth_accounts_user_id_idx on ${namespace}.auth_accounts(user_id)`,
    `create table ${namespace}.auth_verifications (
      id text primary key,
      identifier text not null,
      value text not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp
    )`,
    `create index auth_verifications_identifier_idx on ${namespace}.auth_verifications(identifier)`,
    `create table ${namespace}.auth_organizations (
      id text primary key,
      name text not null,
      slug text not null unique,
      logo text,
      created_at timestamptz not null,
      metadata text
    )`,
    `create table ${namespace}.auth_members (
      id text primary key,
      organization_id text not null references ${namespace}.auth_organizations(id) on delete cascade,
      user_id text not null references ${namespace}.auth_users(id) on delete cascade,
      role text not null default 'member',
      created_at timestamptz not null
    )`,
    `create index auth_members_organization_id_idx on ${namespace}.auth_members(organization_id)`,
    `create index auth_members_user_id_idx on ${namespace}.auth_members(user_id)`,
    `create table ${namespace}.auth_invitations (
      id text primary key,
      organization_id text not null references ${namespace}.auth_organizations(id) on delete cascade,
      email text not null,
      role text,
      status text not null default 'pending',
      expires_at timestamptz not null,
      created_at timestamptz not null default current_timestamp,
      inviter_id text not null references ${namespace}.auth_users(id) on delete cascade
    )`,
    `create index auth_invitations_organization_id_idx on ${namespace}.auth_invitations(organization_id)`,
    `create index auth_invitations_email_idx on ${namespace}.auth_invitations(email)`,
    `create table ${namespace}.auth_two_factors (
      id text primary key,
      secret text not null,
      backup_codes text not null,
      user_id text not null references ${namespace}.auth_users(id) on delete cascade,
      verified boolean default true,
      failed_verification_count integer default 0,
      locked_until timestamptz
    )`,
    `create index auth_two_factors_secret_idx on ${namespace}.auth_two_factors(secret)`,
    `create index auth_two_factors_user_id_idx on ${namespace}.auth_two_factors(user_id)`,
    `create table ${namespace}.auth_staff_profiles (
      user_id text primary key references ${namespace}.auth_users(id) on delete restrict,
      source text not null check (source in ('native', 'legacy')),
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp
    )`,
  ]
}

export async function installCompatibilitySchema(
  schema: string,
  execute: (statement: string) => Promise<unknown>,
): Promise<void> {
  await execute(`create schema ${quotedSchema(schema)}`)
  for (const statement of compatibilitySchemaStatements(schema)) await execute(statement)
}
