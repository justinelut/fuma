import type { HostedMigration } from '../migrationPolicy'

/** Candidate only: the conductor owns registry insertion and checksum finalization. */
export const publicationDeliverabilityControlMigration: HostedMigration = Object.freeze({
  id: '000054_publication_deliverability_control',
  description: 'Add scoped suppressions, sender-domain health, first-party engagement, and complete OCI logs',
  sql: `
    create table fuma_oci_email_delivery_logs (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      event_id text not null, event_type text not null check (event_type in ('accepted','relayed','delivered','deferred','bounced','complained','unsubscribed')),
      provider_message_id text not null, occurred_at timestamptz not null, recipient_email text not null,
      diagnostic_code text, payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
      primary key (platform_id,owner_key,owner_generation,profile_id,event_id)
    );
    create index fuma_oci_email_delivery_logs_message_idx on fuma_oci_email_delivery_logs(platform_id,owner_key,owner_generation,profile_id,provider_message_id,occurred_at);
    insert into fuma_oci_email_delivery_logs (platform_id,owner_key,owner_generation,profile_id,event_id,event_type,provider_message_id,occurred_at,recipient_email,diagnostic_code,payload_sha256)
      select platform_id,owner_key,owner_generation,profile_id,event_id,event_type,provider_message_id,occurred_at,recipient_email,diagnostic_code,payload_sha256
      from fuma_oci_email_provider_events on conflict do nothing;

    create table fuma_publication_scoped_suppressions (
      platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
      owner_key text not null, owner_generation bigint not null, profile_id text not null,
      suppression_id text not null, level_kind text not null check (level_kind in ('global','site','newsletter')),
      newsletter_id text, email_hash_sha256 text not null check (email_hash_sha256 ~ '^[a-f0-9]{64}$'),
      reason text not null check (reason in ('unsubscribe','hard-bounce','complaint','manual')),
      source_id text not null, created_at timestamptz not null,
      primary key (platform_id, owner_key, owner_generation, profile_id, suppression_id),
      check ((level_kind='newsletter') = (newsletter_id is not null))
    );
    create unique index fuma_publication_global_suppression_unique on fuma_publication_scoped_suppressions(platform_id,email_hash_sha256) where level_kind='global';
    create unique index fuma_publication_site_suppression_unique on fuma_publication_scoped_suppressions(platform_id,organization_id,workspace_id,site_id,email_hash_sha256) where level_kind='site';
    create unique index fuma_publication_newsletter_suppression_unique on fuma_publication_scoped_suppressions(platform_id,organization_id,workspace_id,site_id,newsletter_id,email_hash_sha256) where level_kind='newsletter';

    create table fuma_publication_sender_domain_health (
      platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
      owner_key text not null, owner_generation bigint not null, profile_id text not null,
      domain_id text not null, domain_name text not null, approved_sender_emails_json jsonb not null check (jsonb_typeof(approved_sender_emails_json)='array'),
      spf_status text not null check (spf_status in ('pending','verified','failed')),
      dkim_status text not null check (dkim_status in ('pending','verified','failed')),
      dmarc_status text not null check (dmarc_status in ('pending','verified','failed')),
      production_ready boolean not null, diagnostics_json jsonb not null check (jsonb_typeof(diagnostics_json)='array'), checked_at timestamptz not null,
      primary key (platform_id,owner_key,owner_generation,profile_id,domain_id),
      unique (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,domain_name)
    );

    create table fuma_publication_engagement_consents (
      platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
      owner_key text not null, owner_generation bigint not null, profile_id text not null,
      member_id text not null, state text not null check (state in ('opted-in','opted-out')),
      consent_version bigint not null check (consent_version > 0), retention_days integer not null check (retention_days between 1 and 400), updated_at timestamptz not null,
      primary key (platform_id,owner_key,owner_generation,profile_id,member_id)
    );
    create table fuma_publication_engagement_events (
      platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
      owner_key text not null, owner_generation bigint not null, profile_id text not null,
      event_id text not null, event_kind text not null check (event_kind in ('open','click')),
      campaign_id text not null, member_id text not null, target_url_hash_sha256 text, occurred_at timestamptz not null, expires_at timestamptz not null,
      primary key (platform_id,owner_key,owner_generation,profile_id,event_id),
      check ((event_kind='open' and target_url_hash_sha256 is null) or (event_kind='click' and target_url_hash_sha256 ~ '^[a-f0-9]{64}$')),
      check (expires_at > occurred_at)
    );
    create index fuma_publication_engagement_expiry_idx on fuma_publication_engagement_events(platform_id,owner_key,owner_generation,profile_id,expires_at);
    create index fuma_publication_engagement_campaign_idx on fuma_publication_engagement_events(platform_id,owner_key,owner_generation,profile_id,campaign_id,occurred_at);
  `,
})
