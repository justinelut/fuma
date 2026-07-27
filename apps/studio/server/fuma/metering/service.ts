import { Type, Value, type Static } from '@core/utils/typeboxHelpers'

export const METER_CLASSES = ['sites', 'pages', 'cms_items', 'members', 'storage_source_bytes', 'storage_variant_bytes', 'storage_release_bytes', 'storage_local_backup_bytes', 'storage_offsite_bytes', 'origin_bandwidth_bytes', 'email_recipients', 'email_message_bytes', 'custom_hostnames', 'build_publish_milliseconds', 'plugin_compute_milliseconds', 'ai_credits', 'release_retention_bytes', 'weighted_queue_milliseconds'] as const
const MeterClassSchema = Type.Union(METER_CLASSES.map((value) => Type.Literal(value)))
export const METER_MAPPINGS = Object.freeze({
  sites: ['sites'], pages: ['pages'], cmsItems: ['cms_items'], members: ['members'],
  storageBytes: ['storage_source_bytes', 'storage_variant_bytes', 'storage_release_bytes', 'storage_local_backup_bytes', 'storage_offsite_bytes'],
  bandwidthBytes: ['origin_bandwidth_bytes'], emailRecipients: ['email_recipients', 'email_message_bytes'], customDomains: ['custom_hostnames'],
  buildPublishMinutes: ['build_publish_milliseconds', 'weighted_queue_milliseconds'], pluginComputeMinutes: ['plugin_compute_milliseconds'],
  aiCredits: ['ai_credits'], releaseRetentionBytes: ['release_retention_bytes'],
} as const)
export const UsageCommandSchema = Type.Object({
  idempotencyKey: Type.String({ minLength: 1, maxLength: 512 }), organizationId: Type.String({ minLength: 1, maxLength: 255 }),
  workspaceId: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]), siteId: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
  meter: MeterClassSchema, logicalUnits: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), physicalUnits: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  occurredAt: Type.String({ format: 'date-time' }), internalWorkload: Type.Boolean(),
}, { additionalProperties: false })
export type UsageCommand = Static<typeof UsageCommandSchema>
export type UsageLedgerEntry = Readonly<UsageCommand & {
  entryId: string; kind: 'reservation' | 'settlement' | 'release' | 'adjustment'; reservationId: string | null; costCatalogVersion: string; costMinorUsdMicros: bigint
}>
export const ProviderCostInputSchema = Type.Object({
  version: Type.String({ minLength: 1, maxLength: 100 }), meter: MeterClassSchema,
  effectiveAt: Type.String({ format: 'date-time' }), staleAfter: Type.String({ format: 'date-time' }),
  source: Type.Union([Type.Literal('quote'), Type.Literal('invoice'), Type.Literal('published-baseline')]),
  unitCostMinorUsdMicros: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), fixedCostMinorUsdMicros: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  allocationWeight: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
export type ProviderCostInput = Static<typeof ProviderCostInputSchema>
export interface UsageLedgerRepository {
  append(entry: UsageLedgerEntry): Promise<boolean>
  findByIdempotency(key: string): Promise<UsageLedgerEntry | null>
  remainingReservation(reservationId: string): Promise<Readonly<{ logical: bigint; physical: bigint }> | null>
  entries(): Promise<readonly UsageLedgerEntry[]>
}
export class CostCompletenessError extends Error {
  readonly missingMeters: readonly string[];
  readonly staleMeters: readonly string[];
  constructor(missingMeters: readonly string[], staleMeters: readonly string[]) { super('Provider cost model is incomplete or stale.'); this.missingMeters = missingMeters; this.staleMeters = staleMeters; this.name = 'CostCompletenessError' }
}
export class MeteringError extends Error {
  readonly code: 'invalid' | 'negative' | 'over-settlement' | 'duplicate-mismatch';
  constructor(code: 'invalid' | 'negative' | 'over-settlement' | 'duplicate-mismatch', message: string) { super(message); this.code = code; this.name = 'MeteringError' }
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new MeteringError('invalid', 'Metering timestamp is invalid.')
  return parsed
}
function sameCommand(left: UsageLedgerEntry, right: UsageCommand, kind: UsageLedgerEntry['kind'], reservationId: string | null): boolean {
  return left.kind === kind && left.reservationId === reservationId && left.organizationId === right.organizationId && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId && left.meter === right.meter && left.logicalUnits === right.logicalUnits && left.physicalUnits === right.physicalUnits
    && left.occurredAt === right.occurredAt && left.internalWorkload === right.internalWorkload
}

export class VersionedCostCatalog {
  private readonly byMeter = new Map<string, ProviderCostInput[]>()
  private readonly now: () => Date;
  constructor(inputs: readonly unknown[], now: () => Date = () => new Date()) { this.now = now;
    const identities = new Set<string>()
    for (const input of inputs) {
      if (!Value.Check(ProviderCostInputSchema, input)) throw new MeteringError('invalid', 'Invalid cost input.')
      const value = Object.freeze(structuredClone(input)) as ProviderCostInput
      if (timestamp(value.staleAfter) <= timestamp(value.effectiveAt)) throw new MeteringError('invalid', 'Cost input must remain fresh after it becomes effective.')
      const identity = `${value.version}:${value.meter}`
      if (identities.has(identity)) throw new MeteringError('invalid', 'Cost catalog version contains a duplicate meter.')
      identities.add(identity)
      const versions = this.byMeter.get(value.meter) ?? []
      versions.push(value); versions.sort((left, right) => timestamp(left.effectiveAt) - timestamp(right.effectiveAt))
      this.byMeter.set(value.meter, versions)
    }
  }
  private current(meter: string): ProviderCostInput | null {
    const now = this.now().getTime()
    return [...(this.byMeter.get(meter) ?? [])].reverse().find((input) => timestamp(input.effectiveAt) <= now) ?? null
  }
  assertComplete(required: readonly (typeof METER_CLASSES)[number][] = METER_CLASSES): void {
    const missing = required.filter((meter) => !this.current(meter))
    const stale = required.filter((meter) => { const value = this.current(meter); return value ? timestamp(value.staleAfter) <= this.now().getTime() : false })
    if (missing.length || stale.length) throw new CostCompletenessError(Object.freeze(missing), Object.freeze(stale))
  }
  cost(meter: string, physicalUnits: number): Readonly<{ version: string; variable: bigint; fixed: bigint; allocationWeight: bigint }> {
    if (!Number.isSafeInteger(physicalUnits) || physicalUnits < 0) throw new MeteringError('invalid', 'Physical usage must be a non-negative safe integer.')
    const input = this.current(meter)
    if (!input || timestamp(input.staleAfter) <= this.now().getTime()) throw new CostCompletenessError(input ? [] : [meter], input ? [meter] : [])
    return Object.freeze({
      version: input.version,
      variable: BigInt(input.unitCostMinorUsdMicros) * BigInt(physicalUnits),
      fixed: BigInt(input.fixedCostMinorUsdMicros),
      allocationWeight: BigInt(input.allocationWeight),
    })
  }
}

export class MeteringService {
  private readonly ledger: UsageLedgerRepository;
  private readonly catalog: VersionedCostCatalog;
  constructor(ledger: UsageLedgerRepository, catalog: VersionedCostCatalog) { this.ledger = ledger; this.catalog = catalog;}
  private validate(raw: unknown): UsageCommand {
    if (!Value.Check(UsageCommandSchema, raw)) throw new MeteringError('invalid', 'Usage command failed strict TypeBox validation.')
    const command = Object.freeze(structuredClone(raw)) as UsageCommand
    if (command.internalWorkload && command.logicalUnits > 0 && command.physicalUnits === 0) throw new MeteringError('invalid', 'Internal usage cannot omit physical shadow-cost measurement.')
    return command
  }
  async reserve(raw: unknown) { return await this.write('reservation', this.validate(raw), null) }
  async settle(reservationId: string, raw: unknown) {
    const command = this.validate(raw)
    const remaining = await this.ledger.remainingReservation(reservationId)
    if (!remaining || BigInt(command.physicalUnits) > remaining.physical || BigInt(command.logicalUnits) > remaining.logical) throw new MeteringError('over-settlement', 'Actual settlement exceeds the remaining reservation.')
    return await this.write('settlement', command, reservationId)
  }
  async release(reservationId: string, raw: unknown) {
    const command = this.validate(raw)
    const remaining = await this.ledger.remainingReservation(reservationId)
    if (!remaining || BigInt(command.physicalUnits) > remaining.physical || BigInt(command.logicalUnits) > remaining.logical) throw new MeteringError('negative', 'Reservation release exceeds the remaining usage.')
    return await this.write('release', command, reservationId)
  }
  async adjust(raw: unknown) { return await this.write('adjustment', this.validate(raw), null) }

  private async write(kind: UsageLedgerEntry['kind'], command: UsageCommand, reservationId: string | null): Promise<UsageLedgerEntry> {
    const prior = await this.ledger.findByIdempotency(command.idempotencyKey)
    if (prior) {
      if (!sameCommand(prior, command, kind, reservationId)) throw new MeteringError('duplicate-mismatch', 'Idempotency key was reused with different immutable usage attribution.')
      return prior
    }
    const cost = this.catalog.cost(command.meter, command.physicalUnits)
    const entry: UsageLedgerEntry = Object.freeze({
      ...structuredClone(command), entryId: crypto.randomUUID(), kind, reservationId,
      costCatalogVersion: cost.version, costMinorUsdMicros: cost.variable + cost.fixed,
    })
    if (!await this.ledger.append(entry)) {
      const winner = await this.ledger.findByIdempotency(command.idempotencyKey)
      if (!winner || !sameCommand(winner, command, kind, reservationId)) throw new MeteringError('duplicate-mismatch', 'Concurrent usage write did not match the winning entry.')
      return winner
    }
    return entry
  }

  async reconcile(providerTotals: Readonly<Record<string, bigint>>): Promise<Readonly<{ tenant: bigint; unallocated: bigint; provider: bigint; discrepancy: bigint; balanced: boolean; byMeter: Readonly<Record<string, Readonly<{ tenant: bigint; provider: bigint; delta: bigint }>>> }>> {
    this.catalog.assertComplete(METER_CLASSES)
    const missing = METER_CLASSES.filter((meter) => !Object.prototype.hasOwnProperty.call(providerTotals, meter))
    if (missing.length) throw new CostCompletenessError(missing, [])
    const rows = await this.ledger.entries()
    const byMeter: Record<string, Readonly<{ tenant: bigint; provider: bigint; delta: bigint }>> = {}
    let tenant = 0n; let provider = 0n
    for (const meter of METER_CLASSES) {
      const providerValue = providerTotals[meter]
      if (typeof providerValue !== 'bigint' || providerValue < 0n) throw new MeteringError('invalid', `Provider total for ${meter} is invalid.`)
      const tenantValue = rows.filter((entry) => entry.meter === meter && (entry.kind === 'settlement' || entry.kind === 'adjustment')).reduce((sum, entry) => sum + entry.costMinorUsdMicros, 0n)
      byMeter[meter] = Object.freeze({ tenant: tenantValue, provider: providerValue, delta: providerValue - tenantValue })
      tenant += tenantValue; provider += providerValue
    }
    const unallocated = provider > tenant ? provider - tenant : 0n
    const discrepancy = provider - tenant - unallocated
    return Object.freeze({ tenant, unallocated, provider, discrepancy, balanced: discrepancy === 0n, byMeter: Object.freeze(byMeter) })
  }
}

export class MemoryUsageLedger implements UsageLedgerRepository {
  private readonly rows: UsageLedgerEntry[] = []
  async append(entry: UsageLedgerEntry) { if (this.rows.some((row) => row.idempotencyKey === entry.idempotencyKey)) return false; this.rows.push(structuredClone(entry)); return true }
  async findByIdempotency(key: string) { return structuredClone(this.rows.find((row) => row.idempotencyKey === key) ?? null) }
  async remainingReservation(id: string) {
    const reservation = this.rows.find((row) => row.entryId === id && row.kind === 'reservation')
    if (!reservation) return null
    const consumed = this.rows.filter((row) => row.reservationId === id && (row.kind === 'settlement' || row.kind === 'release')).reduce((sum, row) => ({ logical: sum.logical + BigInt(row.logicalUnits), physical: sum.physical + BigInt(row.physicalUnits) }), { logical: 0n, physical: 0n })
    return Object.freeze({ logical: BigInt(reservation.logicalUnits) - consumed.logical, physical: BigInt(reservation.physicalUnits) - consumed.physical })
  }
  async entries() { return structuredClone(this.rows) }
}
