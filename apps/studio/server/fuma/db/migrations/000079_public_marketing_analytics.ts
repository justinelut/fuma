import type { HostedMigration } from '../migrationPolicy'

/** FUMA-WEB-016 candidate. Intentionally unregistered until candidate 000078 is finalized. */
export const publicMarketingAnalyticsMigration: HostedMigration = Object.freeze({
  id: '000079_public_marketing_analytics',
  description: 'Add privacy-minimized public marketing events and aggregates',
  sql: String.raw`
create table fuma_public_marketing_events_v1 (
  event_id_sha256 text primary key check(event_id_sha256 ~ '^[a-f0-9]{64}$'),
  event_kind text not null check(event_kind in ('page-view','cta-selected','handoff','signup','site','publish','paid')),
  route_class text null check(route_class is null or route_class in ('home','product','solution','pricing','template','showcase','expert','plugin','resource','company','legal')),
  campaign_source text null check(campaign_source is null or campaign_source in ('direct','organic','referral','campaign')),
  correlation_sha256 text null check(correlation_sha256 is null or correlation_sha256 ~ '^[a-f0-9]{64}$'),
  collection_basis text not null check(collection_basis in ('cookieless-baseline','explicit-consent','product-authority')),
  occurred_at timestamptz not null,
  received_at timestamptz not null,
  occurred_day date not null,
  check((event_kind='page-view' and collection_basis='cookieless-baseline' and correlation_sha256 is null)
    or (event_kind in ('cta-selected','handoff') and collection_basis='explicit-consent')
    or (event_kind in ('signup','site','publish','paid') and collection_basis='product-authority' and correlation_sha256 is not null)),
  check((event_kind in ('page-view','cta-selected','handoff'))=(route_class is not null)),
  check(event_kind not in ('signup','site','publish','paid') or campaign_source is null),
  check((event_kind in ('handoff','signup','site','publish','paid'))=(correlation_sha256 is not null))
);
create index fuma_public_marketing_events_retention_v1 on fuma_public_marketing_events_v1(occurred_at,event_id_sha256);
create index fuma_public_marketing_events_funnel_v1 on fuma_public_marketing_events_v1(correlation_sha256,event_kind,occurred_at) where correlation_sha256 is not null;

create table fuma_public_marketing_daily_v1 (
  metric_day date not null,
  event_kind text not null check(event_kind in ('page-view','cta-selected','handoff','signup','site','publish','paid')),
  route_class text not null default '',
  campaign_source text not null default '',
  collection_basis text not null check(collection_basis in ('cookieless-baseline','explicit-consent','product-authority')),
  event_count bigint not null check(event_count>0),
  primary key(metric_day,event_kind,route_class,campaign_source,collection_basis),
  check(route_class='' or route_class in ('home','product','solution','pricing','template','showcase','expert','plugin','resource','company','legal')),
  check(campaign_source='' or campaign_source in ('direct','organic','referral','campaign')),
  check((event_kind in ('page-view','cta-selected','handoff'))=(route_class<>'')),
  check(event_kind not in ('signup','site','publish','paid') or campaign_source=''),
  check((event_kind='page-view' and collection_basis='cookieless-baseline')
    or (event_kind in ('cta-selected','handoff') and collection_basis='explicit-consent')
    or (event_kind in ('signup','site','publish','paid') and collection_basis='product-authority'))
);
create index fuma_public_marketing_daily_retention_v1 on fuma_public_marketing_daily_v1(metric_day);
`,
})
