import type { HostedMigration } from '../migrationPolicy'

/**
 * Candidate only: primary integration must register and checksum-finalize this migration.
 * 000048 is reserved by the concurrent release/template follow-up stream.
 */
export const emailSettingsVersionsMigration: HostedMigration = Object.freeze({
  id: '000049_email_settings_versions',
  description: 'Add immutable hierarchical email settings versions and current heads',
  sql: `
    create table fuma_email_settings_versions (
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      profile_id text not null,
      level_kind text not null check (level_kind in ('platform','organization','workspace','site','newsletter')),
      level_id text not null,
      version_id text not null,
      ordinal bigint not null check (ordinal > 0),
      parent_version_id text,
      overrides_json jsonb not null check (jsonb_typeof(overrides_json) = 'array'),
      mutation_json jsonb not null check (jsonb_typeof(mutation_json) = 'object'),
      actor_id text not null,
      created_at timestamptz not null,
      primary key (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, level_kind, level_id, version_id),
      unique (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, level_kind, level_id, ordinal),
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict,
      foreign key (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, level_kind, level_id, parent_version_id)
        references fuma_email_settings_versions(platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, level_kind, level_id, version_id)
        on update cascade on delete restrict,
      check ((ordinal = 1 and parent_version_id is null) or (ordinal > 1 and parent_version_id is not null))
    );

    create table fuma_email_settings_version_heads (
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      profile_id text not null,
      level_kind text not null check (level_kind in ('platform','organization','workspace','site','newsletter')),
      level_id text not null,
      version_id text not null,
      ordinal bigint not null check (ordinal > 0),
      updated_at timestamptz not null,
      primary key (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, level_kind, level_id),
      foreign key (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, level_kind, level_id, version_id)
        references fuma_email_settings_versions(platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, level_kind, level_id, version_id)
        on update cascade on delete restrict
    );

    create function fuma_email_settings_versions_deny_mutation() returns trigger language plpgsql as $$
    begin
      raise exception 'email settings versions are immutable';
    end;
    $$;
    create trigger fuma_email_settings_versions_immutable
      before update or delete on fuma_email_settings_versions
      for each row execute function fuma_email_settings_versions_deny_mutation();
  `,
})
