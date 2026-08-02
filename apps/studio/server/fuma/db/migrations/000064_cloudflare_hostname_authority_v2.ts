import type { HostedMigration } from '../migrationPolicy'

/** Conductor-finalized additive FUMA-060 Cloudflare hostname authority. */
export const cloudflareHostnameAuthorityV2Migration: HostedMigration = Object.freeze({
  id: '000064_cloudflare_hostname_authority_v2',
  description: 'Add strict Cloudflare SaaS hostname reconciliation authority',
  sql: `
    create table fuma_cloudflare_hostname_authority_v2 (
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      owner_state text not null check (owner_state in ('active','transferring')),
      transfer_fence bigint null check (transfer_fence is null or transfer_fence > 0),
      profile_id text not null,
      domain_id text not null,
      hostname text not null check (hostname = lower(hostname)),
      provider_hostname_id text not null,
      lifecycle text not null check (lifecycle in (
        'prevalidating','awaiting-dns','awaiting-tls','ready','active',
        'rolling-back','detached','deleting','deleted','failed'
      )),
      provider_status text not null check (provider_status in ('pending','active','blocked','deleted')),
      ssl_status text not null check (ssl_status in ('pending','active','failed')),
      ownership_verified boolean not null,
      instructions_json jsonb not null,
      diagnostics_json jsonb not null,
      version bigint not null check (version > 0),
      reconcile_fence bigint not null check (reconcile_fence > 0),
      last_event_sequence numeric(39,0) not null check (last_event_sequence >= 0),
      last_operation_id text not null,
      last_operation_sha256 text not null check (last_operation_sha256 ~ '^[a-f0-9]{64}$'),
      created_at timestamptz not null,
      updated_at timestamptz not null,
      primary key (
        platform_id, organization_id, workspace_id, site_id, owner_key,
        owner_generation, profile_id, domain_id
      ),
      unique (platform_id, provider_hostname_id),
      unique (platform_id, hostname),
      check ((owner_state = 'active') = (transfer_fence is null)),
      check (lifecycle <> 'active' or (
        provider_status = 'active' and ssl_status = 'active' and ownership_verified
      )),
      check (lifecycle <> 'deleted' or provider_status = 'deleted'),
      foreign key (
        platform_id, organization_id, workspace_id, site_id, owner_key,
        owner_generation, profile_id, domain_id
      ) references fuma_domain_records_v2 (
        platform_id, organization_id, workspace_id, site_id, owner_key,
        owner_generation, profile_id, domain_id
      ) on delete restrict
    );
    create index fuma_cloudflare_hostname_reconcile_v2
      on fuma_cloudflare_hostname_authority_v2 (lifecycle, updated_at, platform_id, domain_id);

    create table fuma_cloudflare_hostname_operations_v2 (
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      profile_id text not null,
      operation_id text not null,
      operation_sha256 text not null check (operation_sha256 ~ '^[a-f0-9]{64}$'),
      domain_id text not null,
      resulting_version bigint not null check (resulting_version > 0),
      result_json jsonb not null,
      occurred_at timestamptz not null,
      primary key (
        platform_id, organization_id, workspace_id, site_id, owner_key,
        owner_generation, profile_id, operation_id
      )
    );
    create index fuma_cloudflare_hostname_operations_domain_v2
      on fuma_cloudflare_hostname_operations_v2 (
        platform_id, organization_id, workspace_id, site_id, owner_key,
        owner_generation, profile_id, domain_id, resulting_version
      );

    create table fuma_cloudflare_hostname_meter_reconciliations_v2 (
      reconciliation_id text primary key,
      observed_hostnames integer not null check (observed_hostnames between 0 and 50000),
      ledger_hostnames integer not null check (ledger_hostnames between 0 and 50000),
      delta integer not null,
      included integer not null default 100 check (included = 100),
      payg_maximum integer not null default 50000 check (payg_maximum = 50000),
      unit_usd_cents integer not null default 10 check (unit_usd_cents = 10),
      total_usd_cents bigint not null check (total_usd_cents >= 0),
      baseline_date date not null check (baseline_date = date '2026-07-23'),
      observed_at timestamptz not null,
      check (delta = observed_hostnames - ledger_hostnames),
      check (total_usd_cents = greatest(0, observed_hostnames - included) * unit_usd_cents)
    );

    create function fuma_cloudflare_operation_immutable_v2()
    returns trigger language plpgsql as $cloudflare_operation_immutable$
    begin
      raise exception 'Cloudflare reconciliation evidence is immutable' using errcode = '55000';
    end;
    $cloudflare_operation_immutable$;
    create trigger fuma_cloudflare_operation_immutable_v2
      before update or delete on fuma_cloudflare_hostname_operations_v2
      for each row execute function fuma_cloudflare_operation_immutable_v2();
    create trigger fuma_cloudflare_meter_immutable_v2
      before update or delete on fuma_cloudflare_hostname_meter_reconciliations_v2
      for each row execute function fuma_cloudflare_operation_immutable_v2();
  `,
})
