import type { HostedMigration } from '../migrationPolicy'

const scopeColumns = `
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      profile_id text not null`
const scopeKeys = 'platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id'

/** FUMA-037 candidate only. Primary integration owns registry/checksum finalization. */
export const dynamicPublicationTemplatesMigration: HostedMigration = Object.freeze({
  id: '000050_dynamic_publication_templates',
  description: 'Add exact-scope reusable Publication detail and archive templates',
  sql: `
    create table fuma_dynamic_publication_templates (${scopeColumns},
      template_id text not null,
      name text not null,
      target_kind text not null check (target_kind in ('post','page','author','tag','date','collection')),
      target_id text not null default '*',
      document_json jsonb not null,
      empty_state text not null,
      version bigint not null check (version > 0),
      active boolean not null default true,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      primary key (${scopeKeys}, template_id),
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict
    );
    create unique index fuma_dynamic_publication_template_active_target
      on fuma_dynamic_publication_templates (${scopeKeys}, target_kind, target_id)
      where active;
    create index fuma_dynamic_publication_template_lookup
      on fuma_dynamic_publication_templates (${scopeKeys}, target_kind, target_id, active, updated_at desc);
  `,
})
