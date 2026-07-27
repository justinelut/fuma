import type { HostedMigration } from '../migrationPolicy'

export const publicationAudienceMigration: HostedMigration = {
  id: '000016_publication_audience',
  description: 'Create publication members reader accounts segments and access grants',
  sql: `
    create table fuma_publication_reader_accounts (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      account_id text not null, normalized_email_hash_sha256 text not null check (normalized_email_hash_sha256 ~ '^[a-f0-9]{64}$'),
      verified_at timestamptz, last_authenticated_at timestamptz, disabled_at timestamptz,
      primary key (platform_id, owner_key, owner_generation, profile_id, account_id),
      unique (platform_id, owner_key, owner_generation, profile_id, normalized_email_hash_sha256),
      foreign key (platform_id, owner_key) references fuma_tenant_owner_keys(platform_id, owner_key) on update cascade on delete restrict
    );
    create table fuma_publication_members (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      member_id text not null, normalized_email text not null, name text not null default '', status text not null,
      account_id text, attributes_json jsonb not null default '{}'::jsonb, created_at timestamptz not null, updated_at timestamptz not null,
      primary key (platform_id, owner_key, owner_generation, profile_id, member_id),
      unique (platform_id, owner_key, owner_generation, profile_id, normalized_email),
      foreign key (platform_id, owner_key, owner_generation, profile_id, account_id)
        references fuma_publication_reader_accounts(platform_id, owner_key, owner_generation, profile_id, account_id) on delete restrict,
      check (status in ('active','complimentary','blocked','unsubscribed'))
    );
    create table fuma_publication_segments (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      segment_id text not null, name text not null, match_kind text not null check (match_kind in ('all','any')),
      rules_json jsonb not null, version bigint not null check (version > 0), created_at timestamptz not null, updated_at timestamptz not null,
      primary key (platform_id, owner_key, owner_generation, profile_id, segment_id),
      foreign key (platform_id, owner_key) references fuma_tenant_owner_keys(platform_id, owner_key) on update cascade on delete restrict
    );
    create table fuma_publication_access_grants (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      grant_id text not null, member_id text not null, resource_kind text not null check (resource_kind in ('publication','post','tag')),
      resource_id text not null, access text not null check (access in ('read','premium')), expires_at timestamptz, created_at timestamptz not null,
      primary key (platform_id, owner_key, owner_generation, profile_id, grant_id),
      foreign key (platform_id, owner_key, owner_generation, profile_id, member_id)
        references fuma_publication_members(platform_id, owner_key, owner_generation, profile_id, member_id) on delete restrict
    );
  `,
}
