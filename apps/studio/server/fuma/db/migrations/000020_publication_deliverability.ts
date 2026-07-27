import type { HostedMigration } from '../migrationPolicy'

export const publicationDeliverabilityMigration: HostedMigration = {
  id: '000020_publication_deliverability',
  description: 'Create unsubscribe provider event and deliverability history',
  sql: `
    create table fuma_publication_unsubscribe_tokens (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      token_id text not null, member_id text not null, newsletter_id text, issued_at timestamptz not null, expires_at timestamptz not null, consumed_at timestamptz,
      primary key (platform_id, owner_key, owner_generation, profile_id, token_id),
      foreign key (platform_id, owner_key, owner_generation, profile_id, member_id)
        references fuma_publication_members(platform_id, owner_key, owner_generation, profile_id, member_id) on delete restrict
    );
    create table fuma_oci_email_provider_events (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      event_id text not null, event_type text not null, provider_message_id text not null, occurred_at timestamptz not null,
      recipient_email text not null, diagnostic_code text, payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
      primary key (platform_id, owner_key, owner_generation, profile_id, event_id),
      check (event_type in ('accepted','delivered','deferred','bounced','complained'))
    );
    create index fuma_oci_email_provider_events_message_idx on fuma_oci_email_provider_events
      (platform_id, owner_key, owner_generation, profile_id, provider_message_id, occurred_at);
    create table fuma_publication_deliverability_daily (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null, day date not null,
      submitted bigint not null default 0 check (submitted >= 0), delivered bigint not null default 0 check (delivered >= 0),
      deferred bigint not null default 0 check (deferred >= 0), bounced bigint not null default 0 check (bounced >= 0),
      complained bigint not null default 0 check (complained >= 0), suppressed bigint not null default 0 check (suppressed >= 0),
      primary key (platform_id, owner_key, owner_generation, profile_id, day)
    );
  `,
}
