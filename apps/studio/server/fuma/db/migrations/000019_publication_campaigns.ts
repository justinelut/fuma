import type { HostedMigration } from '../migrationPolicy'

export const publicationCampaignsMigration: HostedMigration = {
  id: '000019_publication_campaigns',
  description: 'Create immutable publication campaigns deliveries and suppressions',
  sql: `
    create table fuma_publication_campaigns (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      campaign_id text not null, newsletter_id text not null, version_id text not null, segment_id text not null,
      status text not null, audience_member_ids_json jsonb not null, subject text not null, html text not null, plaintext text not null,
      sender_json jsonb not null, snapshot_sha256 text not null check (snapshot_sha256 ~ '^[a-f0-9]{64}$'), scheduled_at timestamptz, created_at timestamptz not null,
      primary key (platform_id, owner_key, owner_generation, profile_id, campaign_id),
      foreign key (platform_id, owner_key, owner_generation, profile_id, version_id)
        references fuma_publication_newsletter_versions(platform_id, owner_key, owner_generation, profile_id, version_id) on delete restrict,
      check (status in ('draft','scheduled','sending','sent','cancelled','failed'))
    );
    create table fuma_publication_campaign_deliveries (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      delivery_id text not null, campaign_id text not null, member_id text not null, recipient_email text not null,
      status text not null, provider_message_id text, attempt integer not null default 0 check (attempt between 0 and 20), updated_at timestamptz not null,
      primary key (platform_id, owner_key, owner_generation, profile_id, delivery_id),
      unique (platform_id, owner_key, owner_generation, profile_id, campaign_id, member_id),
      foreign key (platform_id, owner_key, owner_generation, profile_id, campaign_id)
        references fuma_publication_campaigns(platform_id, owner_key, owner_generation, profile_id, campaign_id) on delete restrict
    );
    create table fuma_publication_suppressions (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      suppression_id text not null, email_hash_sha256 text not null check (email_hash_sha256 ~ '^[a-f0-9]{64}$'),
      reason text not null check (reason in ('unsubscribe','hard-bounce','complaint','manual')), source_id text not null, created_at timestamptz not null,
      primary key (platform_id, owner_key, owner_generation, profile_id, suppression_id),
      unique (platform_id, owner_key, owner_generation, profile_id, email_hash_sha256)
    );
  `,
}
