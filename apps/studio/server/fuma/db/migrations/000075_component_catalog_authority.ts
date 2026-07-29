import type { HostedMigration } from '../migrationPolicy'

/** FUMA-SITE-008 durable private/installed component authoring and usage authority. */
export const componentCatalogAuthorityMigration: HostedMigration = Object.freeze({
  id: '000075_component_catalog_authority',
  description: 'Add durable site component catalog authoring installation usage upgrade and audit authority',
  sql: String.raw`
create table fuma_component_catalog_releases_v1 (
  platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
  owner_key text not null, owner_generation bigint not null check(owner_generation>0), profile_id text not null check(profile_id in ('website','publication')),
  coordinate text not null, release_json jsonb not null check(jsonb_typeof(release_json)='object'), created_at timestamptz not null,
  primary key(platform_id,owner_key,owner_generation,profile_id,coordinate),
  foreign key(platform_id,owner_key,organization_id,workspace_id,site_id,owner_generation) references fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,generation) on update cascade on delete restrict
);
create index fuma_component_catalog_release_scope_v1 on fuma_component_catalog_releases_v1(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,created_at desc);

create table fuma_component_source_drafts_v1 (
  platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
  owner_key text not null, owner_generation bigint not null check(owner_generation>0), profile_id text not null check(profile_id in ('website','publication')),
  draft_id text not null, draft_json jsonb not null check(jsonb_typeof(draft_json)='object'), state text not null check(state in ('validated','confirmed')),
  created_at timestamptz not null, confirmed_at timestamptz null,
  primary key(platform_id,owner_key,owner_generation,profile_id,draft_id),
  foreign key(platform_id,owner_key,organization_id,workspace_id,site_id,owner_generation) references fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,generation) on update cascade on delete restrict,
  check((state='validated' and confirmed_at is null) or (state='confirmed' and confirmed_at is not null))
);

create table fuma_component_catalog_installations_v1 (
  platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
  owner_key text not null, owner_generation bigint not null check(owner_generation>0), profile_id text not null check(profile_id in ('website','publication')),
  installation_id text not null, installation_json jsonb not null check(jsonb_typeof(installation_json)='object'), version bigint not null check(version>0), updated_at timestamptz not null,
  primary key(platform_id,owner_key,owner_generation,profile_id,installation_id),
  foreign key(platform_id,owner_key,organization_id,workspace_id,site_id,owner_generation) references fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,generation) on update cascade on delete restrict
);
create index fuma_component_catalog_installation_scope_v1 on fuma_component_catalog_installations_v1(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,updated_at desc);

create table fuma_component_catalog_usage_v1 (
  platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
  owner_key text not null, owner_generation bigint not null check(owner_generation>0), profile_id text not null check(profile_id in ('website','publication')),
  usage_id text not null, coordinate text not null, usage_kind text not null check(usage_kind in ('page-node','visual-component','template','retained-release')),
  resource_id text not null, usage_json jsonb not null check(jsonb_typeof(usage_json)='object'), created_at timestamptz not null,
  primary key(platform_id,owner_key,owner_generation,profile_id,usage_id),
  foreign key(platform_id,owner_key,organization_id,workspace_id,site_id,owner_generation) references fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,generation) on update cascade on delete restrict
);
create index fuma_component_catalog_usage_pin_v1 on fuma_component_catalog_usage_v1(platform_id,owner_key,owner_generation,profile_id,coordinate,usage_kind);

create table fuma_component_upgrade_receipts_v1 (
  receipt_id text primary key, platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
  owner_key text not null, owner_generation bigint not null check(owner_generation>0), profile_id text not null check(profile_id in ('website','publication')),
  receipt_json jsonb not null check(jsonb_typeof(receipt_json)='object'), created_at timestamptz not null,
  foreign key(platform_id,owner_key,organization_id,workspace_id,site_id,owner_generation) references fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,generation) on update cascade on delete restrict
);

create table fuma_component_catalog_audit_v1 (
  audit_id text primary key, platform_id text not null, organization_id text not null, workspace_id text not null, site_id text not null,
  owner_key text not null, owner_generation bigint not null check(owner_generation>0), profile_id text not null check(profile_id in ('website','publication')),
  actor_id text not null, action text not null, coordinate text null, operation_id text not null,
  outcome text not null check(outcome in ('success','denied','failure')), reason_code text null, occurred_at timestamptz not null,
  foreign key(platform_id,owner_key,organization_id,workspace_id,site_id,owner_generation) references fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,generation) on update cascade on delete restrict
);
create index fuma_component_catalog_audit_scope_v1 on fuma_component_catalog_audit_v1(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,occurred_at,audit_id);
create function fuma_component_catalog_audit_immutable_v1() returns trigger language plpgsql as $component_catalog_audit_immutable$
begin
  if tg_op='UPDATE' and (to_jsonb(old)-array['platform_id','organization_id','workspace_id','site_id','owner_key','owner_generation','profile_id']) is not distinct from (to_jsonb(new)-array['platform_id','organization_id','workspace_id','site_id','owner_key','owner_generation','profile_id']) then return new; end if;
  raise exception 'component catalog audit facts are immutable' using errcode='55000';
end;
$component_catalog_audit_immutable$;
create trigger fuma_component_catalog_audit_immutable_v1 before update or delete on fuma_component_catalog_audit_v1 for each row execute function fuma_component_catalog_audit_immutable_v1();

create function fuma_component_catalog_append_only_v1() returns trigger language plpgsql as $component_catalog_append_only$
begin
  if tg_op='UPDATE' and (to_jsonb(old)-array['platform_id','organization_id','workspace_id','site_id','owner_key','owner_generation','profile_id']) is not distinct from (to_jsonb(new)-array['platform_id','organization_id','workspace_id','site_id','owner_key','owner_generation','profile_id']) then return new; end if;
  raise exception 'component catalog evidence is append-only' using errcode='55000';
end;
$component_catalog_append_only$;
create trigger fuma_component_catalog_release_append_only_v1 before update or delete on fuma_component_catalog_releases_v1 for each row execute function fuma_component_catalog_append_only_v1();
create trigger fuma_component_catalog_usage_append_only_v1 before update or delete on fuma_component_catalog_usage_v1 for each row execute function fuma_component_catalog_append_only_v1();
create trigger fuma_component_upgrade_receipt_append_only_v1 before update or delete on fuma_component_upgrade_receipts_v1 for each row execute function fuma_component_catalog_append_only_v1();

create function fuma_component_source_draft_transition_v1() returns trigger language plpgsql as $component_source_draft_transition$
begin
  if tg_op='DELETE' then raise exception 'component source drafts are append-only' using errcode='55000'; end if;
  if (to_jsonb(old)-array['platform_id','organization_id','workspace_id','site_id','owner_key','owner_generation','profile_id']) is not distinct from (to_jsonb(new)-array['platform_id','organization_id','workspace_id','site_id','owner_key','owner_generation','profile_id']) then return new; end if;
  if old.platform_id is distinct from new.platform_id or old.organization_id is distinct from new.organization_id
    or old.workspace_id is distinct from new.workspace_id or old.site_id is distinct from new.site_id
    or old.owner_key is distinct from new.owner_key or old.owner_generation is distinct from new.owner_generation
    or old.profile_id is distinct from new.profile_id or old.draft_id is distinct from new.draft_id
    or old.created_at is distinct from new.created_at
    or (old.draft_json - 'state' - 'confirmedAt') is distinct from (new.draft_json - 'state' - 'confirmedAt')
    or old.state<>'validated' or new.state<>'confirmed' or old.confirmed_at is not null or new.confirmed_at is null
    or new.draft_json->>'state'<>'confirmed' or (new.draft_json->>'confirmedAt')::timestamptz is distinct from new.confirmed_at
  then raise exception 'illegal component source draft transition' using errcode='55000'; end if;
  return new;
end;
$component_source_draft_transition$;
create trigger fuma_component_source_draft_transition_v1 before update or delete on fuma_component_source_drafts_v1 for each row execute function fuma_component_source_draft_transition_v1();
`,
})
