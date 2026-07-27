import type { HostedMigration } from '../migrationPolicy'

export const editorResourcesMigration: HostedMigration = {
  id: '000010_editor_resources',
  description: 'Create owner-generation-scoped editor resource storage',
  sql: `
    create table fuma_editor_resources (
      platform_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      resource_kind text not null check (
        resource_kind in ('site-shell', 'page', 'component', 'layout')
      ),
      logical_id text not null,
      value_json jsonb not null,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      primary key (
        platform_id,
        owner_key,
        owner_generation,
        resource_kind,
        logical_id
      ),
      constraint fuma_editor_resources_owner_fk
        foreign key (platform_id, owner_key)
        references fuma_tenant_owner_keys(platform_id, owner_key)
        on update cascade
        on delete restrict,
      constraint fuma_editor_resources_identity_nonempty check (
        btrim(platform_id) <> ''
        and char_length(platform_id) <= 255
        and btrim(owner_key) <> ''
        and char_length(owner_key) <= 255
        and btrim(logical_id) <> ''
        and char_length(logical_id) <= 255
      ),
      constraint fuma_editor_resources_value_object check (
        jsonb_typeof(value_json) = 'object'
      )
    );

    create index fuma_editor_resources_logical_identity_idx
      on fuma_editor_resources (
        platform_id,
        owner_key,
        logical_id,
        resource_kind,
        owner_generation
      );
  `,
}
