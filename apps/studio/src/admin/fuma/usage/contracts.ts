import {
  Type,
  safeParseValue,
  type Static,
} from '@core/utils/typeboxHelpers'

const IdSchema = Type.String({ minLength: 1, maxLength: 512 })
const TimestampSchema = Type.String({ format: 'date-time' })
const UnitsSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const PositiveUnitsSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })

export const QUOTA_CLASS_NAMES = [
  'sites',
  'pages',
  'cmsItems',
  'members',
  'storageBytes',
  'bandwidthBytes',
  'emailRecipientsDay',
  'emailRecipientsMonth',
  'buildPublishMinutes',
  'pluginComputeMinutes',
  'aiCredits',
  'releaseRetentionBytes',
  'collaborators',
  'customDomains',
] as const
const QuotaClassSchema = Type.Union(QUOTA_CLASS_NAMES.map((value) => Type.Literal(value)))

const SourceSchema = Type.Union([
  Type.Literal('public-contract'),
  Type.Literal('private-contract'),
  Type.Literal('grandfathered'),
  Type.Literal('platform-internal'),
])
const NoticeSchema = Type.Object({
  organizationId: IdSchema,
  quotaClass: QuotaClassSchema,
  percent: Type.Union([Type.Literal(50), Type.Literal(75), Type.Literal(90), Type.Literal(100)]),
  used: UnitsSchema,
  limit: PositiveUnitsSchema,
  emittedAt: Type.Optional(TimestampSchema),
}, { additionalProperties: false })
const UsageSchema = Type.Object({
  quotaClass: QuotaClassSchema,
  limit: PositiveUnitsSchema,
  used: UnitsSchema,
  reserved: UnitsSchema,
  topUp: UnitsSchema,
  remaining: UnitsSchema,
  percent: Type.Integer({ minimum: 0, maximum: 100 }),
}, { additionalProperties: false })
const AccountSchema = Type.Object({
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
  contractId: IdSchema,
  source: Type.Union([Type.Literal('public-contract'), Type.Literal('private-contract')]),
  sourceId: IdSchema,
  sourceVersion: Type.String({ minLength: 1, maxLength: 255 }),
  cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
  state: Type.Union([Type.Literal('active'), Type.Literal('paid-transfer-pending')]),
  activatedAt: TimestampSchema,
}, { additionalProperties: false })
const InvoiceSchema = Type.Object({
  invoiceId: IdSchema,
  contractId: IdSchema,
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
  adjustmentId: IdSchema,
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
  approvedBy: IdSchema,
}, { additionalProperties: false })

export const QuotaSelfServiceWireSchema = Type.Object({
  organizationId: IdSchema,
  source: SourceSchema,
  sourceId: IdSchema,
  sourceVersion: Type.String({ minLength: 1, maxLength: 255 }),
  usage: Type.Array(UsageSchema, {
    minItems: QUOTA_CLASS_NAMES.length,
    maxItems: QUOTA_CLASS_NAMES.length,
  }),
  notices: Type.Array(NoticeSchema),
  billing: Type.Union([
    Type.Null(),
    Type.Object({
      account: AccountSchema,
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
export type QuotaSelfServiceWire = Readonly<Static<typeof QuotaSelfServiceWireSchema>>

export const TopUpRequestWireSchema = Type.Object({
  idempotencyKey: IdSchema,
  quotaClass: QuotaClassSchema,
  units: PositiveUnitsSchema,
  reason: Type.String({ minLength: 1, maxLength: 1_000 }),
}, { additionalProperties: false })
export type TopUpRequestWire = Readonly<Static<typeof TopUpRequestWireSchema>>

export const TopUpResponseWireSchema = Type.Object({
  requestId: IdSchema,
  state: Type.Literal('requested'),
}, { additionalProperties: false })
export const CancellationResponseWireSchema = Type.Object({
  requested: Type.Literal(true),
}, { additionalProperties: false })

export function parseQuotaSelfServiceWire(value: unknown): QuotaSelfServiceWire {
  const parsed = safeParseValue(QuotaSelfServiceWireSchema, value)
  if (!parsed.ok) throw new Error('Usage response did not match its strict app contract.')
  return Object.freeze(parsed.value)
}
