import type { HostedMigration } from '../migrationPolicy'

export const organizationsMigration: HostedMigration = {
  id: '000004_organizations',
  description: 'Create organization profiles, limits, placements, and bootstrap receipts',
  sql: `
    create table fuma_organization_profiles (
      organization_id text primary key references auth_organizations(id) on delete restrict,
      kind text not null check (kind in ('platform', 'customer')),
      status text not null check (status in ('active', 'suspended', 'archived')),
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp
    );

    create table fuma_organization_limits (
      organization_id text primary key references auth_organizations(id) on delete restrict,
      max_workspaces integer not null check (max_workspaces > 0),
      max_sites integer not null check (max_sites > 0),
      max_staff integer not null check (max_staff > 0)
    );

    create table fuma_organization_placements (
      organization_id text primary key references auth_organizations(id) on delete restrict,
      placement_class text not null check (placement_class in ('shared', 'dedicated')),
      placement_key text not null check (btrim(placement_key) <> ''),
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp
    );

    create table fuma_organization_bootstrap_receipts (
      bootstrap_key text primary key,
      organization_id text not null unique references auth_organizations(id) on delete restrict,
      owner_user_id text not null references auth_users(id) on delete restrict,
      created_at timestamptz not null default current_timestamp
    );
  `,
}
