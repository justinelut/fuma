import type { HostedMigration } from '../migrationPolicy'

export const publicationAnalyticsMigration: HostedMigration = {
  id: '000017_publication_analytics',
  description: 'Create publication analytics events and daily rollups',
  sql: `
    create table fuma_publication_analytics_events (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      event_id text not null, occurred_at timestamptz not null, kind text not null, content_id text, campaign_id text,
      member_id text, anonymous_visitor_hash_sha256 text, referrer_origin text,
      primary key (platform_id, owner_key, owner_generation, profile_id, event_id),
      foreign key (platform_id, owner_key) references fuma_tenant_owner_keys(platform_id, owner_key) on update cascade on delete restrict,
      check (kind in ('page-view','post-view','member-signup','newsletter-open','newsletter-click')),
      check (anonymous_visitor_hash_sha256 is null or anonymous_visitor_hash_sha256 ~ '^[a-f0-9]{64}$')
    );
    create index fuma_publication_analytics_events_range_idx on fuma_publication_analytics_events
      (platform_id, owner_key, owner_generation, profile_id, occurred_at, kind);
    create table fuma_publication_analytics_daily (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      day date not null, content_id text not null default '', views bigint not null default 0 check (views >= 0),
      unique_visitors bigint not null default 0 check (unique_visitors >= 0), member_signups bigint not null default 0 check (member_signups >= 0),
      newsletter_opens bigint not null default 0 check (newsletter_opens >= 0), newsletter_clicks bigint not null default 0 check (newsletter_clicks >= 0),
      primary key (platform_id, owner_key, owner_generation, profile_id, day, content_id),
      foreign key (platform_id, owner_key) references fuma_tenant_owner_keys(platform_id, owner_key) on update cascade on delete restrict
    );
  `,
}
