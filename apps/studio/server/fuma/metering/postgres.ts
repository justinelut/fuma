import { Value } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import {
  METER_CLASSES,
  METER_PROVIDERS,
  ProviderCostInputSchema,
  ProviderUsageSnapshotSchema,
  type CostQuote,
  type MeterClass,
  type MeterProvider,
  type MeterReconciliation,
  type ProviderCostCatalog,
  type ProviderCostInput,
  type ProviderTotals,
  type ProviderUsageAuthority,
  type ProviderUsageSnapshot,
  type UsageAppendOutcome,
  type UsageLedgerEntry,
  type UsageLedgerRepository,
} from './contracts'
import { MeteringError, VersionedCostCatalog } from './service'

type UsageRow = {
  entry_id: string; idempotency_key: string; organization_id: string; workspace_id: string | null; site_id: string | null
  meter: MeterClass; kind: UsageLedgerEntry['kind']; reservation_id: string | null; logical_units: string | number
  physical_units: string | number; cost_catalog_version: string; cost_usd_micros: string | number
  internal_workload: boolean; occurred_at: string | Date
}
type CostRow = {
  version: string; meter: MeterClass; effective_at: string | Date; stale_after: string | Date
  source: ProviderCostInput['source']; unit_cost_usd_micros: string | number; fixed_cost_usd_micros: string | number
  allocation_weight: string | number
}
type SnapshotRow = {
  snapshot_id: string; provider: MeterProvider; period_start: string | Date; period_end: string | Date
  meter: MeterClass; cost_usd_micros: string | number; source_reference_sha256: string; observed_at: string | Date
}

function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString() }
function safeNumber(value: string | number, label: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) throw new MeteringError('invalid', `${label} exceeds safe integer storage.`)
  return number
}
function meter(value: string): MeterClass {
  if (!(METER_CLASSES as readonly string[]).includes(value)) throw new MeteringError('invalid', 'Stored meter is unknown.')
  return value as MeterClass
}
function mapUsage(row: UsageRow): UsageLedgerEntry {
  return Object.freeze({
    entryId: row.entry_id, idempotencyKey: row.idempotency_key, organizationId: row.organization_id,
    workspaceId: row.workspace_id, siteId: row.site_id, meter: meter(row.meter), kind: row.kind,
    reservationId: row.reservation_id, logicalUnits: safeNumber(row.logical_units, 'logical usage'),
    physicalUnits: safeNumber(row.physical_units, 'physical usage'), costCatalogVersion: row.cost_catalog_version,
    costMinorUsdMicros: BigInt(row.cost_usd_micros), internalWorkload: row.internal_workload, occurredAt: iso(row.occurred_at),
  })
}
function mapCost(row: CostRow): ProviderCostInput {
  const meterValue = meter(row.meter)
  return Object.freeze({
    version: row.version, provider: METER_PROVIDERS[meterValue], meter: meterValue,
    effectiveAt: iso(row.effective_at), staleAfter: iso(row.stale_after), source: row.source,
    unitCostMinorUsdMicros: safeNumber(row.unit_cost_usd_micros, 'unit cost'),
    fixedCostMinorUsdMicros: safeNumber(row.fixed_cost_usd_micros, 'fixed cost'),
    allocationWeight: safeNumber(row.allocation_weight, 'allocation weight'),
  })
}
function mapSnapshot(row: SnapshotRow): ProviderUsageSnapshot {
  return Object.freeze({
    snapshotId: row.snapshot_id, provider: row.provider, periodStart: iso(row.period_start), periodEnd: iso(row.period_end),
    meter: meter(row.meter), costMinorUsdMicros: safeNumber(row.cost_usd_micros, 'snapshot cost'),
    sourceReferenceSha256: row.source_reference_sha256, observedAt: iso(row.observed_at),
  })
}
function sameAttribution(left: UsageLedgerEntry, right: UsageLedgerEntry): boolean {
  return left.organizationId === right.organizationId && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId && left.meter === right.meter && left.internalWorkload === right.internalWorkload
}
function sameJson(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }

export class PostgresUsageLedger implements UsageLedgerRepository {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new Error('Fuma metering requires PostgreSQL authority.')
    this.#db = db
  }

  append(entry: UsageLedgerEntry): Promise<UsageAppendOutcome> {
    return this.#db.transaction(async (tx) => {
      const initial = await tx<UsageRow>`select * from fuma_usage_ledger where idempotency_key = ${entry.idempotencyKey}`
      if (initial.rows[0]) return 'duplicate'
      if (entry.kind === 'settlement' || entry.kind === 'release') {
        const parent = await tx<UsageRow>`select * from fuma_usage_ledger where entry_id = ${entry.reservationId} for update`
        if (!parent.rows[0]) return 'reservation-mismatch'
        const duplicate = await tx<UsageRow>`select * from fuma_usage_ledger where idempotency_key = ${entry.idempotencyKey}`
        if (duplicate.rows[0]) return 'duplicate'
        const reservation = mapUsage(parent.rows[0])
        if (reservation.kind !== 'reservation' || !sameAttribution(reservation, entry)) return 'reservation-mismatch'
        const consumed = await tx<{ logical: string | number; physical: string | number }>`
          select coalesce(sum(logical_units),0) as logical, coalesce(sum(physical_units),0) as physical
          from fuma_usage_ledger where reservation_id = ${reservation.entryId} and kind in ('settlement','release')
        `
        const current = consumed.rows[0]!
        if (BigInt(current.logical) + BigInt(entry.logicalUnits) > BigInt(reservation.logicalUnits)
          || BigInt(current.physical) + BigInt(entry.physicalUnits) > BigInt(reservation.physicalUnits)) {
          return 'reservation-exceeded'
        }
      }
      const inserted = await tx<{ idempotency_key: string }>`
        insert into fuma_usage_ledger (
          entry_id,idempotency_key,organization_id,workspace_id,site_id,meter,kind,reservation_id,
          logical_units,physical_units,cost_catalog_version,cost_usd_micros,internal_workload,occurred_at
        ) values (
          ${entry.entryId},${entry.idempotencyKey},${entry.organizationId},${entry.workspaceId},${entry.siteId},${entry.meter},${entry.kind},${entry.reservationId},
          ${entry.logicalUnits},${entry.physicalUnits},${entry.costCatalogVersion},${entry.costMinorUsdMicros.toString()},${entry.internalWorkload},${entry.occurredAt}
        ) on conflict (idempotency_key) do nothing returning idempotency_key
      `
      return inserted.rowCount === 1 ? 'created' : 'duplicate'
    })
  }

  async findByIdempotency(key: string): Promise<UsageLedgerEntry | null> {
    const result = await this.#db<UsageRow>`select * from fuma_usage_ledger where idempotency_key = ${key}`
    return result.rows[0] ? mapUsage(result.rows[0]) : null
  }

  remainingReservation(reservationId: string): Promise<Readonly<{ logical: bigint; physical: bigint }> | null> {
    return this.#db.transaction(async (tx) => {
      const parent = await tx<UsageRow>`select * from fuma_usage_ledger where entry_id = ${reservationId} for share`
      if (!parent.rows[0] || parent.rows[0].kind !== 'reservation') return null
      const reservation = mapUsage(parent.rows[0])
      const used = await tx<{ logical: string | number; physical: string | number }>`
        select coalesce(sum(logical_units),0) as logical, coalesce(sum(physical_units),0) as physical
        from fuma_usage_ledger where reservation_id = ${reservationId} and kind in ('settlement','release')
      `
      return Object.freeze({
        logical: BigInt(reservation.logicalUnits) - BigInt(used.rows[0]!.logical),
        physical: BigInt(reservation.physicalUnits) - BigInt(used.rows[0]!.physical),
      })
    })
  }

  async entries(period?: Readonly<{ start: string; end: string }>): Promise<readonly UsageLedgerEntry[]> {
    const result = period
      ? await this.#db<UsageRow>`select * from fuma_usage_ledger where occurred_at >= ${period.start} and occurred_at < ${period.end} order by occurred_at,entry_id`
      : await this.#db<UsageRow>`select * from fuma_usage_ledger order by occurred_at,entry_id`
    return Object.freeze(result.rows.map(mapUsage))
  }
}

export class PostgresProviderCostCatalog implements ProviderCostCatalog {
  readonly #db: DbClient
  readonly #now: () => Date

  constructor(db: DbClient, now: () => Date = () => new Date()) {
    if (db.dialect !== 'postgres') throw new Error('Fuma provider costs require PostgreSQL authority.')
    this.#db = db
    this.#now = now
  }

  async append(raw: unknown): Promise<boolean> {
    if (!Value.Check(ProviderCostInputSchema, raw)) throw new MeteringError('invalid', 'Provider cost input failed strict TypeBox validation.')
    const value = Object.freeze(structuredClone(raw)) as ProviderCostInput
    new VersionedCostCatalog([value], this.#now)
    const result = await this.#db<{ version: string }>`
      insert into fuma_provider_cost_catalog (version,meter,effective_at,stale_after,source,unit_cost_usd_micros,fixed_cost_usd_micros,allocation_weight)
      values (${value.version},${value.meter},${value.effectiveAt},${value.staleAfter},${value.source},${value.unitCostMinorUsdMicros},${value.fixedCostMinorUsdMicros},${value.allocationWeight})
      on conflict (version,meter) do nothing returning version
    `
    if (result.rowCount === 1) return true
    const prior = await this.#db<CostRow>`select * from fuma_provider_cost_catalog where version = ${value.version} and meter = ${value.meter}`
    if (!prior.rows[0] || !sameJson(mapCost(prior.rows[0]), value)) throw new MeteringError('duplicate-mismatch', 'Cost input replay differs from immutable evidence.')
    return false
  }

  async #current(meterValue?: MeterClass): Promise<readonly ProviderCostInput[]> {
    const now = this.#now().toISOString()
    const result = meterValue
      ? await this.#db<CostRow>`select * from fuma_provider_cost_catalog where meter = ${meterValue} and effective_at <= ${now} order by case source when 'invoice' then 2 when 'quote' then 1 else 0 end desc,effective_at desc,version desc limit 1`
      : await this.#db.unsafe<CostRow>("select distinct on (meter) * from fuma_provider_cost_catalog where effective_at <= $1 order by meter,case source when 'invoice' then 2 when 'quote' then 1 else 0 end desc,effective_at desc,version desc", [now])
    return Object.freeze(result.rows.map(mapCost))
  }

  async assertComplete(required: readonly MeterClass[] = METER_CLASSES): Promise<void> {
    new VersionedCostCatalog(await this.#current(), this.#now).assertComplete(required)
  }

  async cost(meterValue: MeterClass, physicalUnits: number): Promise<CostQuote> {
    return new VersionedCostCatalog(await this.#current(meterValue), this.#now).cost(meterValue, physicalUnits)
  }
}

function reconciliationJson(value: MeterReconciliation): string {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)
}

export class PostgresProviderUsageAuthority implements ProviderUsageAuthority {
  readonly #db: DbClient
  readonly #now: () => Date

  constructor(db: DbClient, now: () => Date = () => new Date()) {
    if (db.dialect !== 'postgres') throw new Error('Fuma provider usage requires PostgreSQL authority.')
    this.#db = db
    this.#now = now
  }

  async appendSnapshot(raw: unknown): Promise<boolean> {
    if (!Value.Check(ProviderUsageSnapshotSchema, raw)) throw new MeteringError('invalid', 'Provider usage snapshot failed strict TypeBox validation.')
    const value = Object.freeze(structuredClone(raw)) as ProviderUsageSnapshot
    if (value.provider !== METER_PROVIDERS[value.meter]) throw new MeteringError('invalid', `Snapshot provider does not own ${value.meter}.`)
    if (Date.parse(value.periodEnd) <= Date.parse(value.periodStart) || Date.parse(value.observedAt) < Date.parse(value.periodEnd)) {
      throw new MeteringError('invalid', 'Provider usage period or observation time is invalid.')
    }
    const result = await this.#db<{ snapshot_id: string }>`
      insert into fuma_provider_usage_snapshots (snapshot_id,provider,period_start,period_end,meter,cost_usd_micros,source_reference_sha256,observed_at)
      values (${value.snapshotId},${value.provider},${value.periodStart},${value.periodEnd},${value.meter},${value.costMinorUsdMicros},${value.sourceReferenceSha256},${value.observedAt})
      on conflict do nothing returning snapshot_id
    `
    if (result.rowCount === 1) return true
    const prior = await this.#db<SnapshotRow>`
      select * from fuma_provider_usage_snapshots
      where (snapshot_id = ${value.snapshotId} and provider = ${value.provider} and meter = ${value.meter})
         or (provider = ${value.provider} and period_start = ${value.periodStart} and period_end = ${value.periodEnd} and meter = ${value.meter})
      order by snapshot_id limit 1
    `
    if (!prior.rows[0] || !sameJson(mapSnapshot(prior.rows[0]), value)) throw new MeteringError('duplicate-mismatch', 'Provider snapshot replay differs from immutable evidence.')
    return false
  }

  async totalsForPeriod(periodStart: string, periodEnd: string): Promise<ProviderTotals> {
    const result = await this.#db<{ provider: MeterProvider; meter: MeterClass; cost: string | number }>`
      select provider,meter,sum(cost_usd_micros) as cost from fuma_provider_usage_snapshots
      where period_start = ${periodStart} and period_end = ${periodEnd} group by provider,meter order by meter
    `
    const found = new Map<MeterClass, bigint>()
    for (const row of result.rows) {
      const meterValue = meter(row.meter)
      if (row.provider !== METER_PROVIDERS[meterValue] || found.has(meterValue)) throw new MeteringError('invalid', 'Provider snapshot authority is ambiguous.')
      found.set(meterValue, BigInt(row.cost))
    }
    const missing = METER_CLASSES.filter((meterValue) => !found.has(meterValue))
    if (missing.length) throw new MeteringError('invalid', `Provider snapshot is incomplete: ${missing.join(',')}.`)
    return Object.freeze(Object.fromEntries(METER_CLASSES.map((meterValue) => [meterValue, found.get(meterValue)!])) as Record<MeterClass, bigint>)
  }

  async recordReconciliation(value: MeterReconciliation): Promise<boolean> {
    const json = reconciliationJson(value)
    const parsed = JSON.parse(json) as Record<string, unknown>
    const evidence = new Bun.CryptoHasher('sha256').update(json).digest('hex')
    const result = await this.#db<{ reconciliation_id: string }>`
      insert into fuma_meter_reconciliations (
        reconciliation_id,idempotency_key,period_start,period_end,tenant_cost_usd_micros,internal_shadow_cost_usd_micros,
        unallocated_cost_usd_micros,provider_cost_usd_micros,discrepancy_usd_micros,balanced,
        by_meter_json,allocations_json,evidence_sha256,created_at
      ) values (
        ${crypto.randomUUID()},${value.idempotencyKey},${value.periodStart},${value.periodEnd},${value.tenant.toString()},${value.internalShadow.toString()},
        ${value.unallocated.toString()},${value.provider.toString()},${value.discrepancy.toString()},${value.balanced},
        ${JSON.stringify(parsed.byMeter)}::text::jsonb,${JSON.stringify(parsed.allocations)}::text::jsonb,${evidence},${this.#now().toISOString()}
      ) on conflict (idempotency_key) do nothing returning reconciliation_id
    `
    if (result.rowCount === 1) return true
    const prior = await this.#db<{ evidence_sha256: string }>`select evidence_sha256 from fuma_meter_reconciliations where idempotency_key = ${value.idempotencyKey}`
    if (prior.rows[0]?.evidence_sha256 !== evidence) throw new MeteringError('duplicate-mismatch', 'Reconciliation replay differs from immutable evidence.')
    return false
  }
}
