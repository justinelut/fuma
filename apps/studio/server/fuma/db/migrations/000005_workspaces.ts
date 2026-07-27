import type { HostedMigration } from '../migrationPolicy'

export const workspacesMigration: HostedMigration = {
  id: '000005_workspaces',
  description: 'Create organization-owned workspaces and membership overrides',
  sql: `
    create table fuma_workspaces (
      id text primary key,
      organization_id text not null references auth_organizations(id) on delete restrict,
      slug text not null,
      name text not null check (btrim(name) <> ''),
      status text not null default 'active' check (status in ('active', 'archived')),
      is_default boolean not null default false,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      constraint fuma_workspaces_slug_lowercase_kebab
        check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
    );

    create unique index fuma_workspaces_organization_slug_unique
      on fuma_workspaces (organization_id, lower(slug));

    create unique index fuma_workspaces_organization_default_unique
      on fuma_workspaces (organization_id)
      where is_default;

    create table fuma_workspace_membership_overrides (
      workspace_id text not null references fuma_workspaces(id) on delete restrict,
      user_id text not null references auth_users(id) on delete restrict,
      access text not null check (access in ('inherit', 'grant', 'deny')),
      role text null check (role is null or role in ('owner', 'admin', 'editor', 'viewer')),
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      primary key (workspace_id, user_id),
      constraint fuma_workspace_membership_overrides_role_matches_access check (
        (access = 'grant' and role is not null)
        or (access in ('inherit', 'deny') and role is null)
      )
    );
  `,
}
