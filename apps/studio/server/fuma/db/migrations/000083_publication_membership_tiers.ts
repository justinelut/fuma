import type { HostedMigration } from '../migrationPolicy'
/** Finalized paid Publication membership tier authority. */
export const publicationMembershipTiersMigration: HostedMigration = Object.freeze({
  id: '000083_publication_membership_tiers',
  description: 'Add owner-generation scoped versioned Publication membership tiers',
  sql: `
create table if not exists fuma_publication_membership_tiers_v1 (
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  owner_generation bigint not null check (owner_generation > 0),
  profile_id text not null check (profile_id = 'publication'),
  tier_id text not null,
  version bigint not null check (version > 0),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 1000000000),
  currency char(3) not null check (currency = 'KES'),
  period_days integer not null check (period_days between 1 and 366),
  grace_days integer not null check (grace_days between 0 and 31),
  state text not null check (state in ('active','retired')),
  updated_by text not null,
  updated_at timestamptz not null,
  primary key (platform_id, owner_key, owner_generation, tier_id),
  unique (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, tier_id),
  foreign key (platform_id, owner_key, organization_id, workspace_id, site_id, owner_generation)
    references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id, generation)
    on update cascade on delete restrict,
  check (btrim(tier_id) <> '' and btrim(updated_by) <> '')
);
create index if not exists fuma_publication_membership_tiers_scope_v1
  on fuma_publication_membership_tiers_v1
  (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, state, tier_id);

create table if not exists fuma_publication_membership_tier_events_v1 (
  event_id text primary key,
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  owner_generation bigint not null check (owner_generation > 0),
  tier_id text not null,
  version bigint not null check (version > 0),
  state text not null check (state in ('active','retired')),
  snapshot_json jsonb not null check (jsonb_typeof(snapshot_json) = 'object'),
  actor_id text not null,
  occurred_at timestamptz not null,
  unique (platform_id, owner_key, owner_generation, tier_id, version),
  foreign key (platform_id, owner_key, owner_generation, tier_id)
    references fuma_publication_membership_tiers_v1(platform_id, owner_key, owner_generation, tier_id)
    on update cascade on delete restrict
);
create function fuma_publication_membership_tier_events_immutable_v1()
returns trigger language plpgsql as $$ begin
  raise exception 'Publication membership tier events are append-only' using errcode='55000';
end $$;
create trigger fuma_publication_membership_tier_events_immutable_v1
  before update or delete on fuma_publication_membership_tier_events_v1
  for each row execute function fuma_publication_membership_tier_events_immutable_v1();
`,
})
