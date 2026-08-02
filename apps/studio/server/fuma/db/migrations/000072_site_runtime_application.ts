import type { HostedMigration } from '../migrationPolicy'

export const siteRuntimeApplicationMigration: HostedMigration = Object.freeze({
  id: '000072_site_runtime_application',
  description: 'Add route rollout controls and immutable site application mutation receipts',
  sql: `
    create table fuma_site_runtime_route_policies_v2 (
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      route text not null check (route ~ '^/(?:[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._~-]+)*)?$'),
      target text not null check (target in ('react','legacy')),
      shadow text not null check (shadow in ('off','compare')),
      fallback text not null check (fallback in ('deny','legacy')),
      legacy_release_id text null,
      policy_version bigint not null check (policy_version > 0),
      updated_at timestamptz not null,
      primary key (platform_id,owner_key,owner_generation,site_id,route),
      foreign key (platform_id,owner_key,organization_id,workspace_id,site_id,owner_generation)
        references fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,generation) on delete restrict,
      foreign key (platform_id,owner_key,organization_id,workspace_id,site_id,legacy_release_id)
        references fuma_releases(platform_id,owner_key,organization_id,workspace_id,site_id,release_id) on delete restrict,
      check ((target='react' and shadow='off' and fallback='deny') or legacy_release_id is not null)
    );

    create table fuma_site_runtime_mutation_receipts_v2 (
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      release_id text not null,
      release_hash_sha256 text not null check (release_hash_sha256 ~ '^[a-f0-9]{64}$'),
      member_id text not null,
      idempotency_key text not null,
      request_hash_sha256 text not null check (request_hash_sha256 ~ '^[a-f0-9]{64}$'),
      response_json jsonb not null check (jsonb_typeof(response_json)='object'),
      created_at timestamptz not null,
      primary key (platform_id,owner_key,owner_generation,site_id,member_id,idempotency_key),
      foreign key (platform_id,owner_key,organization_id,workspace_id,site_id,owner_generation)
        references fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,generation) on delete restrict,
      foreign key (platform_id,owner_key,organization_id,workspace_id,site_id,release_id)
        references fuma_releases(platform_id,owner_key,organization_id,workspace_id,site_id,release_id) on delete restrict
    );

    create function fuma_site_runtime_receipt_immutable_v2() returns trigger language plpgsql as $site_runtime_receipt_immutable$
    begin raise exception 'Site application mutation receipts are append-only'; end;
    $site_runtime_receipt_immutable$;
    create trigger fuma_site_runtime_receipt_immutable_v2 before update or delete on fuma_site_runtime_mutation_receipts_v2
      for each row execute function fuma_site_runtime_receipt_immutable_v2();

    create index fuma_site_runtime_policy_legacy_release_v2 on fuma_site_runtime_route_policies_v2
      (platform_id,owner_key,organization_id,workspace_id,site_id,legacy_release_id) where legacy_release_id is not null;
    create index fuma_site_runtime_receipt_retention_v2 on fuma_site_runtime_mutation_receipts_v2 (created_at,site_id);
  `,
})
