import type { HostedMigration } from '../migrationPolicy'

export const sitesMigration: HostedMigration = {
  id: '000006_sites',
  description: 'Create organization and workspace-owned sites with profile assignments',
  sql: `
    alter table fuma_workspaces
      add constraint fuma_workspaces_organization_id_id_unique
      unique (organization_id, id);

    create table fuma_sites (
      organization_id text not null references auth_organizations(id) on delete restrict,
      workspace_id text not null,
      id text not null check (btrim(id) <> ''),
      slug text not null,
      name text not null check (btrim(name) <> ''),
      status text not null default 'active' check (status in ('active', 'archived')),
      profile_id text not null check (btrim(profile_id) <> ''),
      capability_overrides_json jsonb not null default '{"grant":[],"revoke":[]}'::jsonb,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      primary key (organization_id, workspace_id, id),
      constraint fuma_sites_workspace_owner_fk
        foreign key (organization_id, workspace_id)
        references fuma_workspaces(organization_id, id)
        on delete restrict,
      constraint fuma_sites_slug_lowercase_kebab
        check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
      constraint fuma_sites_slug_not_reserved
        check (slug not in ('admin', 'api', 'assets', 'health', 'instatic', 'uploads')),
      constraint fuma_sites_capability_overrides_shape check (
        jsonb_typeof(capability_overrides_json) = 'object'
        and jsonb_typeof(capability_overrides_json -> 'grant') = 'array'
        and jsonb_typeof(capability_overrides_json -> 'revoke') = 'array'
        and capability_overrides_json = jsonb_build_object(
          'grant', capability_overrides_json -> 'grant',
          'revoke', capability_overrides_json -> 'revoke'
        )
      )
    );

    create unique index fuma_sites_workspace_slug_unique
      on fuma_sites (organization_id, workspace_id, lower(slug));
  `,
}
