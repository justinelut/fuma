import type { HostedMigration } from '../migrationPolicy'

/** Added by FUMA-052; the conductor owns ordered registration and checksum finalization. */
export const meteringReconciliationControlMigration: HostedMigration = Object.freeze({
  id: '000055_metering_reconciliation_control',
  description: 'Add provider-bound usage snapshots and immutable cost reconciliation evidence',
  sql: `
    alter table fuma_provider_cost_catalog
      add column provider text generated always as (
        case
          when meter in ('storage_source_bytes','storage_variant_bytes','storage_release_bytes','storage_local_backup_bytes','storage_offsite_bytes','build_publish_milliseconds','plugin_compute_milliseconds','release_retention_bytes') then 'oracle'
          when meter in ('email_recipients','email_message_bytes') then 'oci-email'
          when meter in ('origin_bandwidth_bytes','custom_hostnames') then 'cloudflare'
          else 'internal'
        end
      ) stored;
    alter table fuma_provider_cost_catalog
      add constraint fuma_provider_cost_meter_known check (meter in (
        'sites','pages','cms_items','members','storage_source_bytes','storage_variant_bytes','storage_release_bytes',
        'storage_local_backup_bytes','storage_offsite_bytes','origin_bandwidth_bytes','email_recipients','email_message_bytes',
        'custom_hostnames','build_publish_milliseconds','plugin_compute_milliseconds','ai_credits','release_retention_bytes','weighted_queue_milliseconds'
      )),
      add constraint fuma_provider_cost_nonzero check (unit_cost_usd_micros > 0 or fixed_cost_usd_micros > 0),
      add constraint fuma_provider_cost_provider_known check (provider in ('oracle','oci-email','cloudflare','internal'));
    alter table fuma_usage_ledger
      add constraint fuma_usage_meter_known check (meter in (
        'sites','pages','cms_items','members','storage_source_bytes','storage_variant_bytes','storage_release_bytes',
        'storage_local_backup_bytes','storage_offsite_bytes','origin_bandwidth_bytes','email_recipients','email_message_bytes',
        'custom_hostnames','build_publish_milliseconds','plugin_compute_milliseconds','ai_credits','release_retention_bytes','weighted_queue_milliseconds'
      )),
      add constraint fuma_usage_physical_required check (logical_units = 0 or physical_units > 0);

    create table fuma_provider_usage_snapshots (
      snapshot_id text not null,
      provider text not null check (provider in ('oracle','oci-email','cloudflare','internal')),
      period_start timestamptz not null,
      period_end timestamptz not null,
      meter text not null check (meter in (
        'sites','pages','cms_items','members','storage_source_bytes','storage_variant_bytes','storage_release_bytes',
        'storage_local_backup_bytes','storage_offsite_bytes','origin_bandwidth_bytes','email_recipients','email_message_bytes',
        'custom_hostnames','build_publish_milliseconds','plugin_compute_milliseconds','ai_credits','release_retention_bytes','weighted_queue_milliseconds'
      )),
      cost_usd_micros numeric(39,0) not null check (cost_usd_micros >= 0),
      source_reference_sha256 text not null check (source_reference_sha256 ~ '^[a-f0-9]{64}$'),
      observed_at timestamptz not null,
      primary key (snapshot_id, provider, meter),
      unique (provider, period_start, period_end, meter),
      check (period_end > period_start),
      check (observed_at >= period_end),
      check (
        (provider = 'oracle' and meter in ('storage_source_bytes','storage_variant_bytes','storage_release_bytes','storage_local_backup_bytes','storage_offsite_bytes','build_publish_milliseconds','plugin_compute_milliseconds','release_retention_bytes'))
        or (provider = 'oci-email' and meter in ('email_recipients','email_message_bytes'))
        or (provider = 'cloudflare' and meter in ('origin_bandwidth_bytes','custom_hostnames'))
        or (provider = 'internal' and meter in ('sites','pages','cms_items','members','ai_credits','weighted_queue_milliseconds'))
      )
    );
    create index fuma_provider_usage_period_idx on fuma_provider_usage_snapshots(period_start, period_end, meter);

    create table fuma_meter_reconciliations (
      reconciliation_id text primary key,
      idempotency_key text not null unique,
      period_start timestamptz not null,
      period_end timestamptz not null,
      tenant_cost_usd_micros numeric(39,0) not null check (tenant_cost_usd_micros >= 0),
      internal_shadow_cost_usd_micros numeric(39,0) not null check (internal_shadow_cost_usd_micros >= 0),
      unallocated_cost_usd_micros numeric(39,0) not null check (unallocated_cost_usd_micros >= 0),
      provider_cost_usd_micros numeric(39,0) not null check (provider_cost_usd_micros >= 0),
      discrepancy_usd_micros numeric(39,0) not null,
      balanced boolean not null,
      by_meter_json jsonb not null check (jsonb_typeof(by_meter_json) = 'object'),
      allocations_json jsonb not null check (jsonb_typeof(allocations_json) = 'array'),
      evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
      created_at timestamptz not null,
      check (period_end > period_start),
      check (internal_shadow_cost_usd_micros <= tenant_cost_usd_micros),
      check (not balanced or discrepancy_usd_micros = 0)
    );

    create trigger fuma_provider_usage_immutable before update or delete on fuma_provider_usage_snapshots
      for each row execute function fuma_usage_immutable();
    create trigger fuma_meter_reconciliation_immutable before update or delete on fuma_meter_reconciliations
      for each row execute function fuma_usage_immutable();
  `,
})
