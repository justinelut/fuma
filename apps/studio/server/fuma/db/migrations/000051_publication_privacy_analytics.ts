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
const dimensions = `
      event_kind text not null check (event_kind in ('site-read','post-read','newsletter-open','newsletter-click','newsletter-subscribe','newsletter-unsubscribe')),
      content_id text not null check (octet_length(content_id) <= 255),
      referrer_class text not null check (referrer_class in ('direct','internal','newsletter','search','social','other')),
      audience_class text not null check (audience_class in ('public','member')),
      member_source text not null check (member_source in ('none','registered','complimentary','manual','paid')),
      newsletter_id text not null check (octet_length(newsletter_id) <= 255)`

/** FUMA-040 candidate only. Primary integration owns registry/checksum finalization. */
export const publicationPrivacyAnalyticsMigration: HostedMigration = Object.freeze({
  id: '000051_publication_privacy_analytics',
  description: 'Add exact-scope privacy-minimized Publication analytics events and aggregates',
  sql: `
    create table fuma_publication_privacy_analytics_events (${scopeColumns},
      event_id text not null,
      occurred_at timestamptz not null,
      occurred_day date not null,
      ${dimensions},
      collection_basis text not null check (collection_basis='explicit-consent'),
      primary key (${scopeKeys}, event_id),
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict,
      check ((event_kind='site-read' and content_id='') or (event_kind='post-read' and content_id<>'') or (event_kind like 'newsletter-%' and content_id='')),
      check ((event_kind like 'newsletter-%')=(newsletter_id<>'')),
      check ((audience_class='public')=(member_source='none')),
      check (occurred_day=(occurred_at at time zone 'UTC')::date)
    );
    create index fuma_publication_privacy_analytics_events_retention_idx
      on fuma_publication_privacy_analytics_events (${scopeKeys}, occurred_at, event_id);

    create table fuma_publication_privacy_analytics_daily (${scopeColumns},
      metric_day date not null,
      ${dimensions},
      event_count bigint not null check (event_count > 0),
      primary key (${scopeKeys}, metric_day, event_kind, content_id, referrer_class, audience_class, member_source, newsletter_id),
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict,
      check ((event_kind='site-read' and content_id='') or (event_kind='post-read' and content_id<>'') or (event_kind like 'newsletter-%' and content_id='')),
      check ((event_kind like 'newsletter-%')=(newsletter_id<>'')),
      check ((audience_class='public')=(member_source='none'))
    );
    create index fuma_publication_privacy_analytics_daily_report_idx
      on fuma_publication_privacy_analytics_daily (${scopeKeys}, metric_day, event_kind);
  `,
})
