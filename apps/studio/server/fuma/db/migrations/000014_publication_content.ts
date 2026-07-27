import type { HostedMigration } from '../migrationPolicy'

export const publicationContentMigration: HostedMigration = {
  id: '000014_publication_content',
  description: 'Create publication content metadata tags and templates',
  sql: `
    create table fuma_publication_content (
      platform_id text not null, owner_key text not null, owner_generation bigint not null check (owner_generation > 0), profile_id text not null,
      content_id text not null, kind text not null check (kind in ('post','page')), slug text not null,
      metadata_json jsonb not null, document_json jsonb not null, status text not null default 'draft', workflow_version bigint not null default 1 check (workflow_version > 0),
      scheduled_at timestamptz, published_at timestamptz, created_at timestamptz not null, updated_at timestamptz not null,
      primary key (platform_id, owner_key, owner_generation, profile_id, content_id),
      foreign key (platform_id, owner_key) references fuma_tenant_owner_keys(platform_id, owner_key) on update cascade on delete restrict,
      unique (platform_id, owner_key, owner_generation, profile_id, kind, slug),
      check (status in ('draft','in-review','approved','scheduled','published','archived'))
    );
    create table fuma_publication_tags (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      tag_id text not null, name text not null, slug text not null, description text not null default '',
      primary key (platform_id, owner_key, owner_generation, profile_id, tag_id),
      unique (platform_id, owner_key, owner_generation, profile_id, slug),
      foreign key (platform_id, owner_key) references fuma_tenant_owner_keys(platform_id, owner_key) on update cascade on delete restrict
    );
    create table fuma_publication_templates (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      template_id text not null, name text not null, applies_to text not null check (applies_to in ('post','page','newsletter')),
      document_json jsonb not null, version bigint not null check (version > 0), active boolean not null default true,
      created_at timestamptz not null, updated_at timestamptz not null,
      primary key (platform_id, owner_key, owner_generation, profile_id, template_id),
      foreign key (platform_id, owner_key) references fuma_tenant_owner_keys(platform_id, owner_key) on update cascade on delete restrict
    );
  `,
}
