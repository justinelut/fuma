import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const Strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' })
const CapabilityId = Type.String({ minLength: 3, maxLength: 160, pattern: '^[a-z][a-z0-9.-]*$' })
const Version = Type.String({ minLength: 5, maxLength: 64, pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' })
const Timestamp = Type.String({ format: 'date-time' })
const NullableId = Type.Union([Id, Type.Null()])
const Count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const Channel = Type.Union([Type.Literal('site-ai'), Type.Literal('mcp'), Type.Literal('imported-runtime'), Type.Literal('export-adapter')])

export const CapabilityDashboardQuerySchema = Type.Object({
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9_-]+$' })),
  limit: Type.Integer({ minimum: 1, maximum: 50 }),
}, Strict)
export type CapabilityDashboardQuery = Readonly<Static<typeof CapabilityDashboardQuerySchema>>

export const CapabilityGrantSchema = Type.Object({
  grantId: Id,
  label: Type.String({ minLength: 1, maxLength: 160 }),
  channel: Channel,
  state: Type.Union([Type.Literal('active'), Type.Literal('revoked')]),
  canRevoke: Type.Boolean(),
}, Strict)

export const CapabilityChannelViewSchema = Type.Object({
  channel: Channel,
  availability: Type.Union([
    Type.Literal('enabled'), Type.Literal('unavailable'), Type.Literal('revoked'), Type.Literal('degraded'),
  ]),
  requiredGrant: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  grants: Type.Array(CapabilityGrantSchema, { maxItems: 100 }),
  reason: Type.String({ minLength: 1, maxLength: 500 }),
  canGrant: Type.Literal(false),
}, Strict)

export const CapabilityReceiptViewSchema = Type.Object({
  receiptId: Type.Union([Type.String({ pattern: '^[a-f0-9]{64}$' }), Type.Null()]),
  capabilityId: CapabilityId,
  capabilityVersion: Version,
  channel: Type.Union([Type.Literal('site-ai'), Type.Literal('mcp')]),
  operationId: Id,
  outcome: Type.Union([Type.Literal('succeeded'), Type.Literal('failed'), Type.Literal('denied'), Type.Literal('started')]),
  metered: Type.Boolean(),
  audited: Type.Boolean(),
  auditId: NullableId,
  occurredAt: Timestamp,
}, Strict)

export const CapabilityGapSchema = Type.Object({
  gapId: Id,
  channel: Channel,
  title: Type.String({ minLength: 1, maxLength: 160 }),
  reason: Type.String({ minLength: 1, maxLength: 500 }),
  state: Type.Literal('blocked'),
}, Strict)

const LimitsSchema = Type.Object({
  inputBytes: Count,
  outputBytes: Count,
  resultItems: Count,
  requestsPerMinute: Count,
  timeoutMs: Count,
}, Strict)
const UsageSchema = Type.Object({
  successfulOperations: Count,
  failedOperations: Count,
  logicalCredits: Count,
  providerCredits: Count,
  spendUsdMicros: Type.String({ pattern: '^[0-9]+$' }),
}, Strict)
const HealthSchema = Type.Object({
  state: Type.Union([Type.Literal('healthy'), Type.Literal('degraded'), Type.Literal('unavailable')]),
  checkedAt: Timestamp,
  detail: Type.String({ minLength: 1, maxLength: 500 }),
}, Strict)
const DeprecationSchema = Type.Object({
  state: Type.Union([Type.Literal('current'), Type.Literal('deprecated'), Type.Literal('unavailable')]),
  replacement: Type.Union([Type.String({ minLength: 1, maxLength: 225 }), Type.Null()]),
  detail: Type.String({ minLength: 1, maxLength: 500 }),
}, Strict)

export const SiteCapabilityViewSchema = Type.Object({
  id: CapabilityId,
  version: Version,
  title: Type.String({ minLength: 1, maxLength: 160 }),
  description: Type.String({ minLength: 1, maxLength: 1_000 }),
  class: Type.Union([Type.Literal('read'), Type.Literal('mutate'), Type.Literal('confirm')]),
  profileAvailable: Type.Boolean(),
  state: Type.Union([Type.Literal('enabled'), Type.Literal('unavailable'), Type.Literal('deprecated'), Type.Literal('revoked'), Type.Literal('degraded')]),
  requiredPermission: Type.String({ minLength: 1, maxLength: 128 }),
  permissionGranted: Type.Boolean(),
  confirmation: Type.Union([Type.Literal('none'), Type.Literal('owner')]),
  dataClassification: Type.Union([Type.Literal('public'), Type.Literal('customer'), Type.Literal('internal'), Type.Literal('sensitive')]),
  exportAdapter: Type.Object({ id: CapabilityId, version: Version, available: Type.Boolean() }, Strict),
  channels: Type.Array(CapabilityChannelViewSchema, { minItems: 4, maxItems: 4 }),
  limits: LimitsSchema,
  usage: UsageSchema,
  health: HealthSchema,
  deprecation: DeprecationSchema,
}, Strict)

export const SiteCapabilityDashboardSchema = Type.Object({
  kind: Type.Literal('site'),
  capabilities: Type.Array(SiteCapabilityViewSchema, { maxItems: 100 }),
  recentReceipts: Type.Array(CapabilityReceiptViewSchema, { maxItems: 50 }),
  nextCursor: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
  unsupportedGaps: Type.Array(CapabilityGapSchema, { maxItems: 100 }),
  generatedAt: Timestamp,
}, Strict)
export type SiteCapabilityDashboard = Readonly<Static<typeof SiteCapabilityDashboardSchema>>

export const PlatformCapabilityInventoryItemSchema = Type.Object({
  id: CapabilityId,
  version: Version,
  title: Type.String({ minLength: 1, maxLength: 160 }),
  registryState: Type.Union([Type.Literal('active'), Type.Literal('deprecated'), Type.Literal('unavailable')]),
  health: HealthSchema,
  adoption: Type.Object({ currentVersionOperations: Count, driftedReceipts: Count }, Strict),
  aggregate: Type.Object({
    tenantCount: Count,
    successfulOperations: Count,
    failedOperations: Count,
    meteredOperations: Count,
    auditedOperations: Count,
    logicalCredits: Count,
    providerCredits: Count,
    spendUsdMicros: Type.String({ pattern: '^[0-9]+$' }),
    activeMcpGrants: Count,
    revokedMcpGrants: Count,
  }, Strict),
  controls: Type.Array(Type.Object({
    kind: Type.Union([Type.Literal('deprecate'), Type.Literal('revoke'), Type.Literal('incident')]),
    state: Type.Literal('blocked'),
    reason: Type.String({ minLength: 1, maxLength: 500 }),
  }, Strict), { minItems: 3, maxItems: 3 }),
}, Strict)

export const PlatformCapabilityReceiptSummarySchema = Type.Object({
  capabilityVersion: Version,
  channel: Type.Union([Type.Literal('site-ai'), Type.Literal('mcp')]),
  outcome: Type.Union([Type.Literal('succeeded'), Type.Literal('failed'), Type.Literal('denied'), Type.Literal('started')]),
  metered: Type.Boolean(),
  audited: Type.Boolean(),
  occurredAt: Timestamp,
}, Strict)

export const PlatformCapabilityDashboardSchema = Type.Object({
  kind: Type.Literal('platform'),
  inventory: Type.Array(PlatformCapabilityInventoryItemSchema, { maxItems: 100 }),
  recentEvidence: Type.Array(PlatformCapabilityReceiptSummarySchema, { maxItems: 50 }),
  nextCursor: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
  unsupportedGaps: Type.Array(CapabilityGapSchema, { maxItems: 100 }),
  generatedAt: Timestamp,
}, Strict)
export type PlatformCapabilityDashboard = Readonly<Static<typeof PlatformCapabilityDashboardSchema>>

export const RevokeCapabilityGrantCommandSchema = Type.Object({
  capabilityId: CapabilityId,
  capabilityVersion: Version,
  channel: Type.Literal('mcp'),
  grantId: Id,
}, Strict)
export type RevokeCapabilityGrantCommand = Readonly<Static<typeof RevokeCapabilityGrantCommandSchema>>
export const RevokeCapabilityGrantResultSchema = Type.Object({
  capabilityId: CapabilityId,
  capabilityVersion: Version,
  channel: Type.Literal('mcp'),
  grantId: Id,
  state: Type.Literal('revoked'),
}, Strict)

export class CapabilityDashboardError extends Error {
  override readonly name = 'CapabilityDashboardError'
  readonly code: 'invalid-contract'|'authority-denied'|'not-found'|'conflict'|'unavailable'
  constructor(code: CapabilityDashboardError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export function parseCapabilityDashboard<T extends TSchema>(schema: T, value: unknown, boundary: string): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new CapabilityDashboardError('invalid-contract', `${boundary} failed strict TypeBox validation.`)
  return structuredClone(parsed.value)
}
