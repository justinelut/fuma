import {
  Type,
  type Static,
} from '@core/utils/typeboxHelpers'
import {
  QUOTA_CLASSES,
  QuotaClassSchema,
  QuotaEnvelopeSchema,
  type QuotaClass,
  type QuotaEnvelope,
} from '../entitlements/contracts'

const IdSchema = Type.String({ minLength: 1, maxLength: 512 })
const TenantIdSchema = Type.String({ minLength: 1, maxLength: 255 })
const TimestampSchema = Type.String({ format: 'date-time' })
const UnitsSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const PositiveUnitsSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })

export const QuotaSourceSchema = Type.Union([
  Type.Literal('public-contract'),
  Type.Literal('private-contract'),
  Type.Literal('grandfathered'),
  Type.Literal('platform-internal'),
])
export type QuotaSource = Readonly<Static<typeof QuotaSourceSchema>>

export const QuotaUsageEnvelopeSchema = Type.Object({
  sites: UnitsSchema,
  pages: UnitsSchema,
  cmsItems: UnitsSchema,
  members: UnitsSchema,
  storageBytes: UnitsSchema,
  bandwidthBytes: UnitsSchema,
  emailRecipientsDay: UnitsSchema,
  emailRecipientsMonth: UnitsSchema,
  buildPublishMinutes: UnitsSchema,
  pluginComputeMinutes: UnitsSchema,
  aiCredits: UnitsSchema,
  releaseRetentionBytes: UnitsSchema,
  collaborators: UnitsSchema,
  customDomains: UnitsSchema,
}, { additionalProperties: false })
export type QuotaUsageEnvelope = Readonly<Static<typeof QuotaUsageEnvelopeSchema>>

export const ZERO_QUOTA_USAGE: QuotaUsageEnvelope = Object.freeze({
  sites: 0,
  pages: 0,
  cmsItems: 0,
  members: 0,
  storageBytes: 0,
  bandwidthBytes: 0,
  emailRecipientsDay: 0,
  emailRecipientsMonth: 0,
  buildPublishMinutes: 0,
  pluginComputeMinutes: 0,
  aiCredits: 0,
  releaseRetentionBytes: 0,
  collaborators: 0,
  customDomains: 0,
})

export const QuotaOperationSchema = Type.Union([
  Type.Literal('create'),
  Type.Literal('campaign'),
  Type.Literal('build'),
  Type.Literal('domain'),
  Type.Literal('import'),
  Type.Literal('publish'),
  Type.Literal('plugin'),
  Type.Literal('ai'),
  Type.Literal('storage'),
  Type.Literal('bandwidth'),
  Type.Literal('collaborator'),
])
export type QuotaOperation = Readonly<Static<typeof QuotaOperationSchema>>

export const QuotaReservationItemSchema = Type.Object({
  quotaClass: QuotaClassSchema,
  units: PositiveUnitsSchema,
}, { additionalProperties: false })
export type QuotaReservationItem = Readonly<Static<typeof QuotaReservationItemSchema>>

export const QuotaReservationSchema = Type.Object({
  idempotencyKey: IdSchema,
  organizationId: TenantIdSchema,
  workspaceId: Type.Union([TenantIdSchema, Type.Null()]),
  siteId: Type.Union([TenantIdSchema, Type.Null()]),
  operation: QuotaOperationSchema,
  items: Type.Array(QuotaReservationItemSchema, {
    minItems: 1,
    maxItems: QUOTA_CLASSES.length,
  }),
}, { additionalProperties: false })
export type QuotaReservation = Readonly<Static<typeof QuotaReservationSchema>>

/** Compatibility boundary for one-class callers. */
export const QuotaAdmissionSchema = Type.Object({
  idempotencyKey: IdSchema,
  organizationId: TenantIdSchema,
  workspaceId: Type.Union([TenantIdSchema, Type.Null()]),
  siteId: Type.Union([TenantIdSchema, Type.Null()]),
  quotaClass: QuotaClassSchema,
  units: PositiveUnitsSchema,
  operation: QuotaOperationSchema,
}, { additionalProperties: false })
export type QuotaAdmission = Readonly<Static<typeof QuotaAdmissionSchema>>

export const QuotaSettlementSchema = Type.Object({
  idempotencyKey: IdSchema,
  actual: Type.Array(Type.Object({
    quotaClass: QuotaClassSchema,
    units: UnitsSchema,
  }, { additionalProperties: false }), {
    minItems: 1,
    maxItems: QUOTA_CLASSES.length,
  }),
}, { additionalProperties: false })
export type QuotaSettlement = Readonly<Static<typeof QuotaSettlementSchema>>

export const QuotaActualObservationSchema = Type.Object({
  idempotencyKey: IdSchema,
  organizationId: TenantIdSchema,
  observedAt: TimestampSchema,
  usage: QuotaUsageEnvelopeSchema,
  source: Type.Union([
    Type.Literal('setup'),
    Type.Literal('import'),
    Type.Literal('continuous'),
    Type.Literal('reconciliation'),
  ]),
}, { additionalProperties: false })
export type QuotaActualObservation = Readonly<Static<typeof QuotaActualObservationSchema>>

export const QuotaForecastSchema = Type.Object({
  organizationId: TenantIdSchema,
  projected: QuotaUsageEnvelopeSchema,
  kind: Type.Union([Type.Literal('setup'), Type.Literal('import')]),
}, { additionalProperties: false })
export type QuotaForecast = Readonly<Static<typeof QuotaForecastSchema>>

export type QuotaState = Readonly<{
  limits: QuotaEnvelope
  used: QuotaUsageEnvelope
  reserved: QuotaUsageEnvelope
  topUps: QuotaUsageEnvelope
  source: QuotaSource
  sourceId?: string
  sourceVersion?: string
  entitlementSnapshotId?: string
}>

export const QuotaNoticeSchema = Type.Object({
  organizationId: TenantIdSchema,
  quotaClass: QuotaClassSchema,
  percent: Type.Union([
    Type.Literal(50),
    Type.Literal(75),
    Type.Literal(90),
    Type.Literal(100),
  ]),
  used: UnitsSchema,
  limit: PositiveUnitsSchema,
  emittedAt: Type.Optional(TimestampSchema),
}, { additionalProperties: false })
export type QuotaNotice = Readonly<Static<typeof QuotaNoticeSchema>>

export type QuotaReservationResult = Readonly<{
  duplicate: boolean
  notice: QuotaNotice | null
  notices: readonly QuotaNotice[]
}>

export const QuotaForecastResultSchema = Type.Object({
  allowed: Type.Boolean(),
  shortfalls: Type.Array(Type.Object({
    quotaClass: QuotaClassSchema,
    projected: UnitsSchema,
    available: UnitsSchema,
  }, { additionalProperties: false }), { maxItems: QUOTA_CLASSES.length }),
}, { additionalProperties: false })
export type QuotaForecastResult = Readonly<{
  allowed: boolean
  shortfalls: readonly Readonly<{
    quotaClass: QuotaClass
    projected: number
    available: number
  }>[]
}>

export const QuotaUsageItemSchema = Type.Object({
  quotaClass: QuotaClassSchema,
  limit: PositiveUnitsSchema,
  used: UnitsSchema,
  reserved: UnitsSchema,
  topUp: UnitsSchema,
  remaining: UnitsSchema,
  percent: Type.Integer({ minimum: 0, maximum: 100 }),
}, { additionalProperties: false })

const BillingAccountSchema = Type.Object({
  paymentState: Type.Union([
    Type.Literal('current'),
    Type.Literal('past-due'),
    Type.Literal('grace'),
    Type.Literal('cancelled'),
  ]),
  graceEndsAt: Type.Union([TimestampSchema, Type.Null()]),
  cancellationRequestedAt: Type.Union([TimestampSchema, Type.Null()]),
}, { additionalProperties: false })
const ContractSchema = Type.Object({
  contractId: TenantIdSchema,
  source: Type.Union([Type.Literal('public-contract'), Type.Literal('private-contract')]),
  sourceId: TenantIdSchema,
  sourceVersion: Type.String({ minLength: 1, maxLength: 255 }),
  cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
  state: Type.Union([Type.Literal('active'), Type.Literal('paid-transfer-pending')]),
  activatedAt: TimestampSchema,
}, { additionalProperties: false })
const InvoiceSchema = Type.Object({
  invoiceId: IdSchema,
  contractId: TenantIdSchema,
  kind: Type.Union([Type.Literal('setup'), Type.Literal('recurring')]),
  amountMinor: PositiveUnitsSchema,
  currency: Type.Literal('KES'),
  state: Type.Union([Type.Literal('open'), Type.Literal('paid')]),
  issuedAt: TimestampSchema,
  paidAt: Type.Union([TimestampSchema, Type.Null()]),
}, { additionalProperties: false })
const TransactionSchema = Type.Object({
  transactionId: IdSchema,
  invoiceId: IdSchema,
  amountMinor: PositiveUnitsSchema,
  currency: Type.Literal('KES'),
  settledAt: TimestampSchema,
}, { additionalProperties: false })
const ReceiptSchema = Type.Object({
  receiptId: IdSchema,
  transactionId: IdSchema,
  issuedAt: TimestampSchema,
}, { additionalProperties: false })
const AdjustmentSchema = Type.Object({
  adjustmentId: TenantIdSchema,
  quotaClass: QuotaClassSchema,
  units: PositiveUnitsSchema,
  kind: Type.Union([
    Type.Literal('top-up'),
    Type.Literal('overage'),
    Type.Literal('grant'),
    Type.Literal('promotion'),
    Type.Literal('grace'),
  ]),
  state: Type.Union([Type.Literal('active'), Type.Literal('expired'), Type.Literal('revoked')]),
  effectiveAt: TimestampSchema,
  expiresAt: TimestampSchema,
  approvedBy: TenantIdSchema,
}, { additionalProperties: false })

export const QuotaSelfServiceSchema = Type.Object({
  organizationId: TenantIdSchema,
  source: QuotaSourceSchema,
  sourceId: TenantIdSchema,
  sourceVersion: Type.String({ minLength: 1, maxLength: 255 }),
  usage: Type.Array(QuotaUsageItemSchema, {
    minItems: QUOTA_CLASSES.length,
    maxItems: QUOTA_CLASSES.length,
  }),
  notices: Type.Array(QuotaNoticeSchema),
  billing: Type.Union([
    Type.Null(),
    Type.Object({
      account: BillingAccountSchema,
      contracts: Type.Array(ContractSchema),
      invoices: Type.Array(InvoiceSchema),
      transactions: Type.Array(TransactionSchema),
      receipts: Type.Array(ReceiptSchema),
      adjustments: Type.Array(AdjustmentSchema),
      actions: Type.Object({
        planChanges: Type.Literal(true),
        cancellation: Type.Boolean(),
        topUpRequest: Type.Literal(true),
      }, { additionalProperties: false }),
    }, { additionalProperties: false }),
  ]),
}, { additionalProperties: false })
export type QuotaSelfService = Readonly<Static<typeof QuotaSelfServiceSchema>>

export const TopUpRequestSchema = Type.Object({
  idempotencyKey: IdSchema,
  quotaClass: QuotaClassSchema,
  units: PositiveUnitsSchema,
  reason: Type.String({ minLength: 1, maxLength: 1_000 }),
}, { additionalProperties: false })
export type TopUpRequest = Readonly<Static<typeof TopUpRequestSchema>>

export type DunningAccount = Readonly<{
  organizationId: string
  source: QuotaSource
  paymentState: 'current' | 'past-due' | 'grace' | 'cancelled'
  graceEndsAt: string | null
  version?: number
}>

export type VerifiedQuotaSource = Readonly<{
  organizationId: string
  source: QuotaSource
  sourceId: string
  sourceVersion: string
  entitlementSnapshotId: string
  evidenceSha256: string
  quotas: QuotaEnvelope
  activatedAt: string
  contractId: string | null
}>

export type { QuotaClass, QuotaEnvelope }
export { QUOTA_CLASSES, QuotaClassSchema, QuotaEnvelopeSchema }
