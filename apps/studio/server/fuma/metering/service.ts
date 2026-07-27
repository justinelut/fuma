import { Value } from '@core/utils/typeboxHelpers'
import {
  METER_CLASSES,
  METER_PROVIDERS,
  ProviderCostInputSchema,
  UsageCommandSchema,
  type CostQuote,
  type MeterAllocation,
  type MeterClass,
  type MeterReconciliation,
  type MeterReconciliationLine,
  type ProviderCostCatalog,
  type ProviderCostInput,
  type ProviderReconciliationCommand,
  type UsageCommand,
  type UsageLedgerEntry,
  type UsageLedgerRepository,
} from './contracts'

export * from './contracts'
export { MemoryUsageLedger } from './memory'

export const UNALLOCATED_COST_ORGANIZATION_ID = 'fuma:unallocated' as const

export class CostCompletenessError extends Error {
  readonly missingMeters: readonly string[]
  readonly staleMeters: readonly string[]

  constructor(missingMeters: readonly string[], staleMeters: readonly string[]) {
    super('Provider cost model is incomplete or stale.')
    this.missingMeters = Object.freeze([...missingMeters])
    this.staleMeters = Object.freeze([...staleMeters])
    this.name = 'CostCompletenessError'
  }
}

export class MeteringError extends Error {
  readonly code: 'invalid' | 'negative' | 'over-settlement' | 'duplicate-mismatch' | 'reservation-mismatch' | 'provider-underflow'

  constructor(code: MeteringError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'MeteringError'
  }
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new MeteringError('invalid', 'Metering timestamp is invalid.')
  return parsed
}

function sameCommand(
  left: UsageLedgerEntry,
  right: UsageCommand,
  kind: UsageLedgerEntry['kind'],
  reservationId: string | null,
): boolean {
  return left.kind === kind && left.reservationId === reservationId
    && left.organizationId === right.organizationId && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId && left.meter === right.meter
    && left.logicalUnits === right.logicalUnits && left.physicalUnits === right.physicalUnits
    && left.occurredAt === right.occurredAt && left.internalWorkload === right.internalWorkload
}

export class VersionedCostCatalog implements ProviderCostCatalog {
  readonly #byMeter = new Map<MeterClass, ProviderCostInput[]>()
  readonly #now: () => Date

  constructor(inputs: readonly unknown[], now: () => Date = () => new Date()) {
    this.#now = now
    const identities = new Set<string>()
    for (const input of inputs) {
      if (!Value.Check(ProviderCostInputSchema, input)) throw new MeteringError('invalid', 'Invalid cost input.')
      const value = Object.freeze(structuredClone(input)) as ProviderCostInput
      if (value.provider !== METER_PROVIDERS[value.meter]) throw new MeteringError('invalid', `Cost provider does not own ${value.meter}.`)
      if (timestamp(value.staleAfter) <= timestamp(value.effectiveAt)) throw new MeteringError('invalid', 'Cost input must remain fresh after it becomes effective.')
      if (value.unitCostMinorUsdMicros === 0 && value.fixedCostMinorUsdMicros === 0) throw new MeteringError('invalid', 'A provider cost cannot be silently zero.')
      const identity = `${value.version}:${value.meter}`
      if (identities.has(identity)) throw new MeteringError('invalid', 'Cost catalog version contains a duplicate meter.')
      identities.add(identity)
      const versions = this.#byMeter.get(value.meter) ?? []
      versions.push(value)
      versions.sort((left, right) => timestamp(left.effectiveAt) - timestamp(right.effectiveAt)
        || left.version.localeCompare(right.version))
      this.#byMeter.set(value.meter, versions)
    }
  }

  #current(meter: MeterClass): ProviderCostInput | null {
    const now = this.#now().getTime()
    return [...(this.#byMeter.get(meter) ?? [])].reverse()
      .find((input) => timestamp(input.effectiveAt) <= now) ?? null
  }

  assertComplete(required: readonly MeterClass[] = METER_CLASSES): void {
    const missing = required.filter((meter) => !this.#current(meter))
    const stale = required.filter((meter) => {
      const value = this.#current(meter)
      return value ? timestamp(value.staleAfter) <= this.#now().getTime() : false
    })
    if (missing.length || stale.length) throw new CostCompletenessError(missing, stale)
  }

  cost(meterValue: string, physicalUnits: number): CostQuote {
    if (!(METER_CLASSES as readonly string[]).includes(meterValue)) throw new MeteringError('invalid', 'Cost meter is unknown.')
    const meter = meterValue as MeterClass
    if (!Number.isSafeInteger(physicalUnits) || physicalUnits < 0) throw new MeteringError('invalid', 'Physical usage must be a non-negative safe integer.')
    const input = this.#current(meter)
    if (!input || timestamp(input.staleAfter) <= this.#now().getTime()) {
      throw new CostCompletenessError(input ? [] : [meter], input ? [meter] : [])
    }
    return Object.freeze({
      version: input.version,
      provider: input.provider,
      variable: BigInt(input.unitCostMinorUsdMicros) * BigInt(physicalUnits),
      fixed: BigInt(input.fixedCostMinorUsdMicros),
      allocationWeight: BigInt(input.allocationWeight),
    })
  }
}

type UsageGroup = {
  organizationId: string
  workspaceId: string | null
  siteId: string | null
  internalWorkload: boolean
  physical: bigint
  cost: bigint
}

function groupKey(row: Pick<UsageLedgerEntry, 'organizationId' | 'workspaceId' | 'siteId' | 'internalWorkload'>): string {
  return JSON.stringify([row.organizationId, row.workspaceId, row.siteId, row.internalWorkload])
}

function allocationKey(command: ProviderReconciliationCommand, meter: MeterClass, group: UsageGroup | null): string {
  const identity = JSON.stringify([
    command.idempotencyKey,
    meter,
    group?.organizationId ?? UNALLOCATED_COST_ORGANIZATION_ID,
    group?.workspaceId ?? null,
    group?.siteId ?? null,
    group?.internalWorkload ?? false,
  ])
  return `meter-reconcile:${new Bun.CryptoHasher('sha256').update(identity).digest('hex')}`
}

function assertReconciliationCommand(command: ProviderReconciliationCommand): void {
  const exact = ['idempotencyKey', 'periodEnd', 'periodStart', 'providerTotals']
  if (Object.keys(command).sort().join('|') !== exact.join('|') || typeof command.idempotencyKey !== 'string'
    || command.idempotencyKey.length < 1 || command.idempotencyKey.length > 512
    || timestamp(command.periodEnd) <= timestamp(command.periodStart)
    || !command.providerTotals || typeof command.providerTotals !== 'object') {
    throw new MeteringError('invalid', 'Reconciliation command is invalid.')
  }
  const totalKeys = Object.keys(command.providerTotals).sort()
  if (totalKeys.join('|') !== [...METER_CLASSES].sort().join('|')) throw new MeteringError('invalid', 'Provider totals must contain exactly every meter.')
  for (const meter of METER_CLASSES) {
    if (typeof command.providerTotals[meter] !== 'bigint' || command.providerTotals[meter] < 0n) {
      throw new MeteringError('invalid', `Provider total for ${meter} is invalid.`)
    }
  }
}

export class MeteringService {
  readonly #ledger: UsageLedgerRepository
  readonly #catalog: ProviderCostCatalog

  constructor(ledger: UsageLedgerRepository, catalog: ProviderCostCatalog) {
    this.#ledger = ledger
    this.#catalog = catalog
  }

  #validate(raw: unknown): UsageCommand {
    if (!Value.Check(UsageCommandSchema, raw)) throw new MeteringError('invalid', 'Usage command failed strict TypeBox validation.')
    const command = Object.freeze(structuredClone(raw)) as UsageCommand
    if (command.logicalUnits === 0 && command.physicalUnits === 0) throw new MeteringError('invalid', 'Usage command cannot be empty.')
    if (command.logicalUnits > 0 && command.physicalUnits === 0) throw new MeteringError('invalid', 'Logical usage cannot omit physical measurement.')
    return command
  }

  async reserve(raw: unknown): Promise<UsageLedgerEntry> { return await this.#write('reservation', this.#validate(raw), null) }
  async settle(reservationId: string, raw: unknown): Promise<UsageLedgerEntry> { return await this.#write('settlement', this.#validate(raw), reservationId) }
  async release(reservationId: string, raw: unknown): Promise<UsageLedgerEntry> { return await this.#write('release', this.#validate(raw), reservationId) }
  async adjust(raw: unknown): Promise<UsageLedgerEntry> { return await this.#write('adjustment', this.#validate(raw), null) }

  async #write(kind: UsageLedgerEntry['kind'], command: UsageCommand, reservationId: string | null): Promise<UsageLedgerEntry> {
    if ((kind === 'settlement' || kind === 'release') && (!reservationId || reservationId.length > 255)) {
      throw new MeteringError('reservation-mismatch', 'Reservation authority is invalid.')
    }
    const prior = await this.#ledger.findByIdempotency(command.idempotencyKey)
    if (prior) {
      if (!sameCommand(prior, command, kind, reservationId)) throw new MeteringError('duplicate-mismatch', 'Idempotency key was reused with different immutable usage attribution.')
      return prior
    }
    const cost = await this.#catalog.cost(command.meter, command.physicalUnits)
    const entry: UsageLedgerEntry = Object.freeze({
      ...structuredClone(command), entryId: crypto.randomUUID(), kind, reservationId,
      costCatalogVersion: cost.version, costMinorUsdMicros: cost.variable,
    })
    const outcome = await this.#ledger.append(entry)
    if (outcome === 'created') return entry
    if (outcome === 'reservation-exceeded') throw new MeteringError(kind === 'release' ? 'negative' : 'over-settlement', 'Reservation consumption exceeds remaining usage.')
    if (outcome === 'reservation-mismatch') throw new MeteringError('reservation-mismatch', 'Reservation scope or meter does not match settlement authority.')
    const winner = await this.#ledger.findByIdempotency(command.idempotencyKey)
    if (!winner || !sameCommand(winner, command, kind, reservationId)) throw new MeteringError('duplicate-mismatch', 'Concurrent usage write did not match the winning entry.')
    return winner
  }

  async #appendAllocation(
    command: ProviderReconciliationCommand,
    meter: MeterClass,
    group: UsageGroup | null,
    amount: bigint,
    version: string,
  ): Promise<MeterAllocation> {
    const idempotencyKey = allocationKey(command, meter, group)
    const entry: UsageLedgerEntry = Object.freeze({
      entryId: crypto.randomUUID(), idempotencyKey,
      organizationId: group?.organizationId ?? UNALLOCATED_COST_ORGANIZATION_ID,
      workspaceId: group?.workspaceId ?? null, siteId: group?.siteId ?? null,
      meter, logicalUnits: 0, physicalUnits: 0, occurredAt: command.periodEnd,
      internalWorkload: group?.internalWorkload ?? false, kind: 'adjustment', reservationId: null,
      costCatalogVersion: version, costMinorUsdMicros: amount,
    })
    const outcome = await this.#ledger.append(entry)
    if (outcome === 'duplicate') {
      const prior = await this.#ledger.findByIdempotency(idempotencyKey)
      if (!prior || prior.costMinorUsdMicros !== amount || prior.organizationId !== entry.organizationId
        || prior.workspaceId !== entry.workspaceId || prior.siteId !== entry.siteId || prior.meter !== meter
        || prior.internalWorkload !== entry.internalWorkload || prior.costCatalogVersion !== version) {
        throw new MeteringError('duplicate-mismatch', 'Reconciliation allocation replay did not match immutable evidence.')
      }
    } else if (outcome !== 'created') {
      throw new MeteringError('reservation-mismatch', 'Reconciliation allocation was rejected.')
    }
    return Object.freeze({
      organizationId: entry.organizationId, workspaceId: entry.workspaceId, siteId: entry.siteId,
      meter, costMinorUsdMicros: amount, internalWorkload: entry.internalWorkload, unallocated: group === null,
    })
  }

  async reconcile(command: ProviderReconciliationCommand): Promise<MeterReconciliation> {
    assertReconciliationCommand(command)
    await this.#catalog.assertComplete(METER_CLASSES)
    const rows = await this.#ledger.entries({ start: command.periodStart, end: command.periodEnd })
    const byMeter = {} as Record<MeterClass, MeterReconciliationLine>
    const allocations: MeterAllocation[] = []
    let tenant = 0n
    let internalShadow = 0n
    let unallocated = 0n
    let provider = 0n

    for (const meter of METER_CLASSES) {
      const providerValue = command.providerTotals[meter]
      const quote = await this.#catalog.cost(meter, 0)
      const grouped = new Map<string, UsageGroup>()
      for (const row of rows.filter((value) => value.meter === meter && value.physicalUnits > 0
        && (value.kind === 'settlement' || value.kind === 'adjustment')
        && !value.idempotencyKey.startsWith('meter-reconcile:'))) {
        const key = groupKey(row)
        const current = grouped.get(key) ?? {
          organizationId: row.organizationId, workspaceId: row.workspaceId, siteId: row.siteId,
          internalWorkload: row.internalWorkload, physical: 0n, cost: 0n,
        }
        current.physical += BigInt(row.physicalUnits)
        current.cost += row.costMinorUsdMicros
        grouped.set(key, current)
      }
      const groups = [...grouped.values()].sort((left, right) => groupKey(left).localeCompare(groupKey(right)))
      const base = groups.reduce((sum, value) => sum + value.cost, 0n)
      if (providerValue < base + quote.fixed) throw new MeteringError('provider-underflow', `Provider total for ${meter} is below variable plus fixed cost evidence.`)
      const shared = providerValue - base
      let allocatedTenant = 0n
      let allocatedInternal = groups.filter((group) => group.internalWorkload).reduce((sum, group) => sum + group.cost, 0n)
      let allocatedUnassigned = 0n

      if (shared > 0n && groups.length > 0) {
        const totalWeight = groups.reduce((sum, value) => sum + value.physical * quote.allocationWeight, 0n)
        let assigned = 0n
        for (const [index, group] of groups.entries()) {
          const amount = index === groups.length - 1
            ? shared - assigned
            : shared * group.physical * quote.allocationWeight / totalWeight
          assigned += amount
          allocatedTenant += amount
          if (group.internalWorkload) allocatedInternal += amount
          if (amount > 0n) allocations.push(await this.#appendAllocation(command, meter, group, amount, quote.version))
        }
      } else if (shared > 0n) {
        allocatedUnassigned = shared
        allocations.push(await this.#appendAllocation(command, meter, null, shared, quote.version))
      }

      const tenantMeter = base + allocatedTenant
      const delta = providerValue - tenantMeter - allocatedUnassigned
      byMeter[meter] = Object.freeze({
        tenant: tenantMeter, internalShadow: allocatedInternal, unallocated: allocatedUnassigned,
        provider: providerValue, delta,
      })
      tenant += tenantMeter
      internalShadow += allocatedInternal
      unallocated += allocatedUnassigned
      provider += providerValue
    }
    const discrepancy = provider - tenant - unallocated
    return Object.freeze({
      idempotencyKey: command.idempotencyKey, periodStart: command.periodStart, periodEnd: command.periodEnd,
      tenant, internalShadow, unallocated, provider, discrepancy, balanced: discrepancy === 0n,
      byMeter: Object.freeze(byMeter), allocations: Object.freeze(allocations),
    })
  }
}
