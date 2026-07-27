import type { HostedMigration } from '../migrationPolicy'

export const publicationNewslettersMigration: HostedMigration = {
  id: '000018_publication_newsletters',
  description: 'Create hierarchical email settings newsletters and immutable versions',
  sql: `
    create table fuma_email_settings_layers (
      platform_id text not null, organization_id text not null default '', workspace_id text not null default '',
      owner_key text not null default '', owner_generation bigint not null default 1 check (owner_generation > 0), profile_id text not null default '',
      scope_kind text not null check (scope_kind in ('platform','organization','workspace','site','newsletter')), scope_id text not null,
      values_json jsonb not null, version bigint not null check (version > 0), updated_at timestamptz not null,
      primary key (platform_id, organization_id, workspace_id, owner_key, owner_generation, profile_id, scope_kind, scope_id)
    );
    create table fuma_publication_newsletters (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      newsletter_id text not null, name text not null, slug text not null, description text not null default '', default_segment_id text,
      status text not null check (status in ('active','paused','archived')), created_at timestamptz not null, updated_at timestamptz not null,
      primary key (platform_id, owner_key, owner_generation, profile_id, newsletter_id),
      unique (platform_id, owner_key, owner_generation, profile_id, slug),
      foreign key (platform_id, owner_key) references fuma_tenant_owner_keys(platform_id, owner_key) on update cascade on delete restrict
    );
    create table fuma_publication_newsletter_versions (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      version_id text not null, newsletter_id text not null, ordinal bigint not null check (ordinal > 0), subject text not null,
      preview_text text not null default '', document_json jsonb not null, created_by text not null, created_at timestamptz not null, locked_at timestamptz,
      primary key (platform_id, owner_key, owner_generation, profile_id, version_id),
      unique (platform_id, owner_key, owner_generation, profile_id, newsletter_id, ordinal),
      foreign key (platform_id, owner_key, owner_generation, profile_id, newsletter_id)
        references fuma_publication_newsletters(platform_id, owner_key, owner_generation, profile_id, newsletter_id) on delete restrict
    );
  `,
}
