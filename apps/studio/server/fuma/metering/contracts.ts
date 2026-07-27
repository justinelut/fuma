import { Type, type Static } from '@core/utils/typeboxHelpers'

export const METER_CLASSES = [
  'sites', 'pages', 'cms_items', 'members',
  'storage_source_bytes', 'storage_variant_bytes', 'storage_release_bytes',
  'storage_local_backup_bytes', 'storage_offsite_bytes', 'origin_bandwidth_bytes',
  'email_recipients', 'email_message_bytes', 'custom_hostnames',
  'build_publish_milliseconds', 'plugin_compute_milliseconds', 'ai_credits',
  'release_retention_bytes', 'weighted_queue_milliseconds',
] as const
export type MeterClass = (typeof METER_CLASSES)[number]
export const MeterClassSchema = Type.Union(METER_CLASSES.map((value) => Type.Literal(value)))

export const METER_PROVIDERS = Object.freeze({
  sites: 'internal', pages: 'internal', cms_items: 'internal', members: 'internal',
  storage_source_bytes: 'oracle', storage_variant_bytes: 'oracle', storage_release_bytes: 'oracle',
  storage_local_backup_bytes: 'oracle', storage_offsite_bytes: 'oracle',
  origin_bandwidth_bytes: 'cloudflare', email_recipients: 'oci-email', email_message_bytes: 'oci-email',
  custom_hostnames: 'cloudflare', build_publish_milliseconds: 'oracle',
  plugin_compute_milliseconds: 'oracle', ai_credits: 'internal', release_retention_bytes: 'oracle',
  weighted_queue_milliseconds: 'internal',
} as const satisfies Readonly<Record<MeterClass, MeterProvider>>)

export const METER_MAPPINGS = Object.freeze({
  sites: Object.freeze(['sites']), pages: Object.freeze(['pages']),
  cmsItems: Object.freeze(['cms_items']), members: Object.freeze(['members']),
  storageBytes: Object.freeze(['storage_source_bytes', 'storage_variant_bytes', 'storage_release_bytes', 'storage_local_backup_bytes', 'storage_offsite_bytes']),
  bandwidthBytes: Object.freeze(['origin_bandwidth_bytes']),
  emailRecipients: Object.freeze(['email_recipients', 'email_message_bytes']),
  customDomains: Object.freeze(['custom_hostnames']),
  buildPublishMinutes: Object.freeze(['build_publish_milliseconds', 'weighted_queue_milliseconds']),
  pluginComputeMinutes: Object.freeze(['plugin_compute_milliseconds']),
  aiCredits: Object.freeze(['ai_credits']), releaseRetentionBytes: Object.freeze(['release_retention_bytes']),
} as const)

const IdSchema = Type.String({ minLength: 1, maxLength: 512 })
const OptionalScopeIdSchema = Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()])
const UnitsSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
export const UsageCommandSchema = Type.Object({
  idempotencyKey: IdSchema,
  organizationId: Type.String({ minLength: 1, maxLength: 255 }),
  workspaceId: OptionalScopeIdSchema,
  siteId: OptionalScopeIdSchema,
  meter: MeterClassSchema,
  logicalUnits: UnitsSchema,
  physicalUnits: UnitsSchema,
  occurredAt: Type.String({ format: 'date-time' }),
  internalWorkload: Type.Boolean(),
}, { additionalProperties: false })
export type UsageCommand = Readonly<Static<typeof UsageCommandSchema>>

export type UsageLedgerEntry = Readonly<UsageCommand & {
  entryId: string
  kind: 'reservation' | 'settlement' | 'release' | 'adjustment'
  reservationId: string | null
  costCatalogVersion: string
  costMinorUsdMicros: bigint
}>

export const METER_PROVIDERS_LIST = ['oracle', 'oci-email', 'cloudflare', 'internal'] as const
export type MeterProvider = (typeof METER_PROVIDERS_LIST)[number]
export const MeterProviderSchema = Type.Union(METER_PROVIDERS_LIST.map((value) => Type.Literal(value)))

export const ProviderCostInputSchema = Type.Object({
  version: Type.String({ minLength: 1, maxLength: 100 }),
  provider: MeterProviderSchema,
  meter: MeterClassSchema,
  effectiveAt: Type.String({ format: 'date-time' }),
  staleAfter: Type.String({ format: 'date-time' }),
  source: Type.Union([Type.Literal('quote'), Type.Literal('invoice'), Type.Literal('published-baseline')]),
  unitCostMinorUsdMicros: UnitsSchema,
  fixedCostMinorUsdMicros: UnitsSchema,
  allocationWeight: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
export type ProviderCostInput = Readonly<Static<typeof ProviderCostInputSchema>>
export type CostQuote = Readonly<{
  version: string
  provider: MeterProvider
  variable: bigint
  fixed: bigint
  allocationWeight: bigint
}>
export interface ProviderCostCatalog {
  assertComplete(required?: readonly MeterClass[]): void | Promise<void>
  cost(meter: MeterClass, physicalUnits: number): CostQuote | Promise<CostQuote>
}

export type UsageAppendOutcome = 'created' | 'duplicate' | 'reservation-exceeded' | 'reservation-mismatch'
export interface UsageLedgerRepository {
  append(entry: UsageLedgerEntry): Promise<UsageAppendOutcome>
  findByIdempotency(key: string): Promise<UsageLedgerEntry | null>
  remainingReservation(reservationId: string): Promise<Readonly<{ logical: bigint; physical: bigint }> | null>
  entries(period?: Readonly<{ start: string; end: string }>): Promise<readonly UsageLedgerEntry[]>
}

export const MeterReconcilePayloadSchema = Type.Object({
  periodStart: Type.String({ format: 'date-time' }),
  periodEnd: Type.String({ format: 'date-time' }),
}, { additionalProperties: false })
export type MeterReconcilePayload = Readonly<Static<typeof MeterReconcilePayloadSchema>>
export type ProviderTotals = Readonly<Record<MeterClass, bigint>>
export type ProviderReconciliationCommand = Readonly<MeterReconcilePayload & {
  idempotencyKey: string
  providerTotals: ProviderTotals
}>
export type MeterAllocation = Readonly<{
  organizationId: string
  workspaceId: string | null
  siteId: string | null
  meter: MeterClass
  costMinorUsdMicros: bigint
  internalWorkload: boolean
  unallocated: boolean
}>
export type MeterReconciliationLine = Readonly<{
  tenant: bigint
  internalShadow: bigint
  unallocated: bigint
  provider: bigint
  delta: bigint
}>
export type MeterReconciliation = Readonly<{
  idempotencyKey: string
  periodStart: string
  periodEnd: string
  tenant: bigint
  internalShadow: bigint
  unallocated: bigint
  provider: bigint
  discrepancy: bigint
  balanced: boolean
  byMeter: Readonly<Record<MeterClass, MeterReconciliationLine>>
  allocations: readonly MeterAllocation[]
}>

export const ProviderUsageSnapshotSchema = Type.Object({
  snapshotId: Type.String({ minLength: 1, maxLength: 255 }),
  provider: MeterProviderSchema,
  periodStart: Type.String({ format: 'date-time' }),
  periodEnd: Type.String({ format: 'date-time' }),
  meter: MeterClassSchema,
  costMinorUsdMicros: UnitsSchema,
  sourceReferenceSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  observedAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false })
export type ProviderUsageSnapshot = Readonly<Static<typeof ProviderUsageSnapshotSchema>>

const UnsignedIntegerStringSchema = Type.String({ pattern: '^[0-9]+$' })
const SignedIntegerStringSchema = Type.String({ pattern: '^-?[0-9]+$' })
const ReconciliationLineJsonSchema = Type.Object({
  tenant: UnsignedIntegerStringSchema,
  internalShadow: UnsignedIntegerStringSchema,
  unallocated: UnsignedIntegerStringSchema,
  provider: UnsignedIntegerStringSchema,
  delta: SignedIntegerStringSchema,
}, { additionalProperties: false })
const ByMeterJsonSchema = Type.Object(Object.fromEntries(
  METER_CLASSES.map((meter) => [meter, ReconciliationLineJsonSchema]),
), { additionalProperties: false })
export const MeterReconciliationJsonSchema = Type.Object({
  idempotencyKey: Type.String({ minLength: 1, maxLength: 512 }),
  periodStart: Type.String({ format: 'date-time' }),
  periodEnd: Type.String({ format: 'date-time' }),
  tenant: UnsignedIntegerStringSchema,
  internalShadow: UnsignedIntegerStringSchema,
  unallocated: UnsignedIntegerStringSchema,
  provider: UnsignedIntegerStringSchema,
  discrepancy: SignedIntegerStringSchema,
  balanced: Type.Boolean(),
  byMeter: ByMeterJsonSchema,
  allocations: Type.Array(Type.Object({
    organizationId: Type.String({ minLength: 1, maxLength: 255 }),
    workspaceId: OptionalScopeIdSchema,
    siteId: OptionalScopeIdSchema,
    meter: MeterClassSchema,
    costMinorUsdMicros: UnsignedIntegerStringSchema,
    internalWorkload: Type.Boolean(),
    unallocated: Type.Boolean(),
  }, { additionalProperties: false })),
}, { additionalProperties: false })
export type MeterReconciliationJson = Readonly<Static<typeof MeterReconciliationJsonSchema>>

export interface ProviderUsageAuthority {
  totalsForPeriod(periodStart: string, periodEnd: string): Promise<ProviderTotals>
  recordReconciliation(value: MeterReconciliation): Promise<boolean>
}
