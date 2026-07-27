import {
  METER_CLASSES,
  METER_PROVIDERS,
  type MeterClass,
  type ProviderCostInput,
} from './contracts'

export const HOSTED_COST_BASELINE_VERSION = 'hosted-ke-2026-07-v1' as const

const UNIT_COSTS = Object.freeze({
  sites: 2, pages: 1, cms_items: 1, members: 1,
  storage_source_bytes: 2, storage_variant_bytes: 2, storage_release_bytes: 2,
  storage_local_backup_bytes: 1, storage_offsite_bytes: 2, origin_bandwidth_bytes: 2,
  email_recipients: 25, email_message_bytes: 1, custom_hostnames: 1_000,
  build_publish_milliseconds: 1, plugin_compute_milliseconds: 1, ai_credits: 100,
  release_retention_bytes: 1, weighted_queue_milliseconds: 1,
} as const satisfies Readonly<Record<MeterClass, number>>)

const FIXED_COSTS = Object.freeze({
  sites: 1_000, pages: 0, cms_items: 0, members: 0,
  storage_source_bytes: 5_000, storage_variant_bytes: 0, storage_release_bytes: 0,
  storage_local_backup_bytes: 0, storage_offsite_bytes: 2_000, origin_bandwidth_bytes: 3_000,
  email_recipients: 4_000, email_message_bytes: 0, custom_hostnames: 2_000,
  build_publish_milliseconds: 5_000, plugin_compute_milliseconds: 0, ai_credits: 1_000,
  release_retention_bytes: 0, weighted_queue_milliseconds: 1_000,
} as const satisfies Readonly<Record<MeterClass, number>>)

/**
 * Versioned planning inputs in minor-USD micros. These are deliberately
 * nonzero fail-closed launch assumptions, not invoice claims. Provider
 * snapshots replace assumptions during period reconciliation.
 */
export const HOSTED_COST_BASELINE_V1: readonly Readonly<ProviderCostInput>[] = Object.freeze(
  METER_CLASSES.map((meter) => Object.freeze({
    version: HOSTED_COST_BASELINE_VERSION,
    provider: METER_PROVIDERS[meter],
    meter,
    effectiveAt: '2026-07-01T00:00:00.000Z',
    staleAfter: '2027-01-01T00:00:00.000Z',
    source: 'published-baseline' as const,
    unitCostMinorUsdMicros: UNIT_COSTS[meter],
    fixedCostMinorUsdMicros: FIXED_COSTS[meter],
    allocationWeight: 1,
  })),
)
