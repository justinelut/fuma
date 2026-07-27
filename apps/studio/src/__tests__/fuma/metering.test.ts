import { describe, expect, it } from 'bun:test'
import {
  HOSTED_COST_BASELINE_V1,
  METER_CLASSES,
  METER_MAPPINGS,
  METER_PROVIDERS,
  CostCompletenessError,
  MemoryUsageLedger,
  MeteringCollector,
  MeteringError,
  MeteringService,
  VersionedCostCatalog,
  type MeterClass,
  type ProviderCostInput,
  type ProviderTotals,
} from '../../../server/fuma/metering'

const NOW = new Date('2026-07-27T10:00:00.000Z')
const OCCURRED_AT = '2026-07-20T10:00:00.000Z'
const PERIOD = { periodStart: '2026-07-01T00:00:00.000Z', periodEnd: '2026-08-01T00:00:00.000Z' }

function harness() {
  const ledger = new MemoryUsageLedger()
  const catalog = new VersionedCostCatalog(HOSTED_COST_BASELINE_V1, () => NOW)
  return { ledger, catalog, service: new MeteringService(ledger, catalog) }
}

function usage(idempotencyKey: string, overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey, organizationId: 'organization-a', workspaceId: 'workspace-a', siteId: 'site-a',
    meter: 'storage_source_bytes', logicalUnits: 10, physicalUnits: 100,
    occurredAt: OCCURRED_AT, internalWorkload: false, ...overrides,
  }
}

async function fixedProviderTotals(catalog: VersionedCostCatalog): Promise<Record<MeterClass, bigint>> {
  return Object.fromEntries(await Promise.all(METER_CLASSES.map(async (meter) => [
    meter,
    (await catalog.cost(meter, 0)).fixed,
  ]))) as Record<MeterClass, bigint>
}

describe('FUMA-052 metering behavior', () => {
  it('defines immutable complete logical-to-physical mappings and provider ownership', () => {
    const mapped = Object.values(METER_MAPPINGS).flat()
    expect([...new Set(mapped)].sort()).toEqual([...METER_CLASSES].sort())
    expect(Object.isFrozen(METER_MAPPINGS)).toBe(true)
    for (const values of Object.values(METER_MAPPINGS)) expect(Object.isFrozen(values)).toBe(true)
    expect(new Set(Object.values(METER_PROVIDERS))).toEqual(new Set(['oracle', 'oci-email', 'cloudflare', 'internal']))
    const catalog = new VersionedCostCatalog(HOSTED_COST_BASELINE_V1, () => NOW)
    expect(() => catalog.assertComplete()).not.toThrow()
    for (const input of HOSTED_COST_BASELINE_V1) {
      expect(input.unitCostMinorUsdMicros + input.fixedCostMinorUsdMicros).toBeGreaterThan(0)
      expect(input.provider).toBe(METER_PROVIDERS[input.meter])
      expect(Object.isFrozen(input)).toBe(true)
    }
  })

  it('fails closed on strict TypeBox violations, provider substitution, missing, stale, and zero cost inputs', async () => {
    const { service } = harness()
    await expect(service.adjust({ ...usage('strict-extra'), extra: true })).rejects.toMatchObject({ code: 'invalid' })
    await expect(service.adjust(usage('logical-without-physical', { physicalUnits: 0 }))).rejects.toMatchObject({ code: 'invalid' })
    await expect(service.adjust(usage('empty', { logicalUnits: 0, physicalUnits: 0 }))).rejects.toMatchObject({ code: 'invalid' })

    const oracle = HOSTED_COST_BASELINE_V1.find(({ meter }) => meter === 'storage_source_bytes')!
    expect(() => new VersionedCostCatalog([{ ...oracle, provider: 'cloudflare' }], () => NOW)).toThrow(MeteringError)
    expect(() => new VersionedCostCatalog([{ ...oracle, unitCostMinorUsdMicros: 0, fixedCostMinorUsdMicros: 0 }], () => NOW)).toThrow(MeteringError)
    const incomplete = new VersionedCostCatalog([oracle], () => NOW)
    expect(() => incomplete.assertComplete()).toThrow(CostCompletenessError)
    const stale: ProviderCostInput = { ...oracle, version: 'stale', staleAfter: '2026-07-02T00:00:00.000Z' }
    expect(() => new VersionedCostCatalog([stale], () => NOW).cost(stale.meter, 1)).toThrow(CostCompletenessError)
  })

  it('serializes reservation settlement/release, deduplicates concurrent replay, and preserves immutable attribution', async () => {
    const { ledger, service } = harness()
    const reservation = await service.reserve(usage('reserve'))
    const settlements = await Promise.allSettled([
      service.settle(reservation.entryId, usage('settle-a', { logicalUnits: 6, physicalUnits: 60 })),
      service.settle(reservation.entryId, usage('settle-b', { logicalUnits: 6, physicalUnits: 60 })),
    ])
    expect(settlements.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const rejected = settlements.find(({ status }) => status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: 'over-settlement' })
    const winner = settlements.find(({ status }) => status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof service.settle>>>
    const replays = await Promise.all(Array.from({ length: 8 }, () => service.settle(
      reservation.entryId,
      usage(winner.value.idempotencyKey, { logicalUnits: 6, physicalUnits: 60 }),
    )))
    expect(new Set(replays.map(({ entryId }) => entryId))).toEqual(new Set([winner.value.entryId]))
    const release = await service.release(reservation.entryId, usage('release', { logicalUnits: 4, physicalUnits: 40 }))
    expect(await ledger.remainingReservation(reservation.entryId)).toEqual({ logical: 0n, physical: 0n })
    expect(Object.isFrozen(reservation)).toBe(true)
    expect(Object.isFrozen(release)).toBe(true)
    expect(Object.isFrozen(await ledger.entries())).toBe(true)
    await expect(service.settle(reservation.entryId, usage('wrong-scope', {
      organizationId: 'organization-b', logicalUnits: 1, physicalUnits: 1,
    }))).rejects.toMatchObject({ code: 'reservation-mismatch' })
  })

  it('collects every ticket-owned workload as logical and physical immutable evidence', async () => {
    const { service } = harness()
    const collector = new MeteringCollector(service)
    const common = {
      organizationId: 'organization-a', workspaceId: 'workspace-a', siteId: 'site-a',
      occurredAt: OCCURRED_AT, internalWorkload: false,
    }
    const measurements = [
      { ...common, idempotencyKey: 'storage', kind: 'storage', logicalBytes: 10, sourceBytes: 12, variantBytes: 30, releaseBytes: 11, localBackupBytes: 12, offsiteBytes: 12 },
      { ...common, idempotencyKey: 'bandwidth', kind: 'origin-bandwidth', responses: 2, bytes: 200 },
      { ...common, idempotencyKey: 'newsletter', kind: 'newsletter', recipients: 3, messageBytes: 600 },
      { ...common, idempotencyKey: 'hostname', kind: 'custom-hostname', hostnames: 1 },
      { ...common, idempotencyKey: 'publish', kind: 'publish', publishes: 1, buildMilliseconds: 500, weightedQueueMilliseconds: 50, releaseBytes: 11 },
      { ...common, idempotencyKey: 'plugin', kind: 'plugin-compute', invocations: 2, milliseconds: 25 },
      { ...common, idempotencyKey: 'ai', kind: 'ai', logicalCredits: 2, providerCredits: 3 },
      { ...common, idempotencyKey: 'retention', kind: 'release-retention', logicalBytes: 11, retainedBytes: 33 },
      ...(['sites', 'pages', 'cms_items', 'members'] as const).map((meter) => ({
        ...common, idempotencyKey: `entity-${meter}`, kind: 'entity-count', meter, units: 1,
      })),
    ]
    const entries = (await Promise.all(measurements.map((value) => collector.record(value)))).flat()
    expect([...new Set(entries.map(({ meter }) => meter))].sort()).toEqual([...METER_CLASSES].sort())
    expect(entries.find(({ meter }) => meter === 'storage_variant_bytes')).toMatchObject({ logicalUnits: 10, physicalUnits: 30 })
    expect(entries.find(({ meter }) => meter === 'origin_bandwidth_bytes')).toMatchObject({ logicalUnits: 2, physicalUnits: 200 })
    expect(entries.every(Object.isFrozen)).toBe(true)
    await expect(collector.record({ ...measurements[0], callerOrganizationId: 'substitute' })).rejects.toBeInstanceOf(TypeError)
  })

  it('deterministically reconciles mixed customer/internal amplification, fixed/shared costs, replay, and unallocated totals', async () => {
    const { catalog, ledger, service } = harness()
    await service.adjust(usage('customer-storage', { logicalUnits: 100, physicalUnits: 300 }))
    await service.adjust(usage('internal-storage', {
      organizationId: 'platform-internal', workspaceId: null, siteId: null,
      logicalUnits: 100, physicalUnits: 100, internalWorkload: true,
    }))
    const providerTotals = await fixedProviderTotals(catalog)
    providerTotals.storage_source_bytes = 6_000n
    const command = Object.freeze({ ...PERIOD, idempotencyKey: 'mixed-period-v1', providerTotals: Object.freeze(providerTotals) as ProviderTotals })
    const first = await service.reconcile(command)
    const replay = await service.reconcile(command)
    expect(replay).toEqual(first)
    expect(first.balanced).toBe(true)
    expect(first.discrepancy).toBe(0n)
    expect(first.internalShadow).toBe(1_500n)
    expect(first.byMeter.storage_source_bytes).toEqual({
      tenant: 6_000n, internalShadow: 1_500n, unallocated: 0n, provider: 6_000n, delta: 0n,
    })
    expect(first.unallocated).toBeGreaterThan(0n)
    expect(first.allocations.some(({ internalWorkload }) => internalWorkload)).toBe(true)
    expect(first.allocations.some(({ unallocated }) => unallocated)).toBe(true)
    expect((await ledger.entries()).filter(({ idempotencyKey }) => idempotencyKey.startsWith('meter-reconcile:')).length)
      .toBe(first.allocations.length)
    process.stdout.write(`[FUMA-052 demo] amplification=3x customer+internal tenant=${first.tenant} internalShadow=${first.internalShadow} unallocated=${first.unallocated} provider=${first.provider} balanced=${first.balanced}\n`)
  })
})
