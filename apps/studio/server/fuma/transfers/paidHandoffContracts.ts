import { Type, Value, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import { TransferOwnershipCoordinateSchema } from './contracts'

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const TimestampSchema = Type.String({ format: 'date-time' })
const MinorSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })

export const PAID_HANDOFF_ASSET_OWNERS = Object.freeze({
  domain: 'FUMA-062',
  ai: 'FUMA-064',
  mcp: 'FUMA-066',
  plugins: 'FUMA-067',
  payments: 'FUMA-069',
  collaborators: 'FUMA-023',
} as const)
export type PaidHandoffAsset = keyof typeof PAID_HANDOFF_ASSET_OWNERS

export const PaidHandoffSelectionsSchema = Type.Object({
  domain: Type.Union([Type.Literal('move-with-site'), Type.Literal('retain-with-source'), Type.Literal('detach')]),
  ai: Type.Union([Type.Literal('rekey'), Type.Literal('detach')]),
  mcp: Type.Union([Type.Literal('rescope'), Type.Literal('revoke')]),
  plugins: Type.Union([Type.Literal('rekey'), Type.Literal('remove')]),
  payments: Type.Union([Type.Literal('rekey'), Type.Literal('detach')]),
  collaborators: Type.Union([Type.Literal('preserve'), Type.Literal('remove')]),
}, { additionalProperties: false })
export type PaidHandoffSelections = Readonly<Static<typeof PaidHandoffSelectionsSchema>>

export const PaidHandoffAssetOwnersSchema = Type.Object({
  domain: Type.Literal('FUMA-062'), ai: Type.Literal('FUMA-064'), mcp: Type.Literal('FUMA-066'),
  plugins: Type.Literal('FUMA-067'), payments: Type.Literal('FUMA-069'), collaborators: Type.Literal('FUMA-023'),
}, { additionalProperties: false })

export const PaidHandoffReadinessSchema = Type.Object({
  commandId: IdSchema,
  transferId: IdSchema,
  contractId: IdSchema,
  offerId: IdSchema,
  offerVersion: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  source: TransferOwnershipCoordinateSchema,
  destination: TransferOwnershipCoordinateSchema,
  outboxState: Type.Union([Type.Literal('pending'), Type.Literal('failed'), Type.Literal('delivered')]),
  paymentState: Type.Literal('paid-transfer-pending'),
  destinationActive: Type.Boolean(),
  quotaAccepted: Type.Boolean(),
  policyAcceptanceCurrent: Type.Boolean(),
  meteringEvidenceCurrent: Type.Boolean(),
  internalGrantExcluded: Type.Literal(true),
  assetOwners: PaidHandoffAssetOwnersSchema,
  setupAmountMinor: MinorSchema,
  recurringAmountMinor: MinorSchema,
  currency: Type.Literal('KES'),
  cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
  locale: Type.Literal('en-KE'),
  timezone: Type.Literal('Africa/Nairobi'),
  activatedAt: TimestampSchema,
}, { additionalProperties: false })
export type PaidHandoffReadiness = Readonly<Static<typeof PaidHandoffReadinessSchema>>

export const PreparePaidHandoffSchema = Type.Object({
  commandId: IdSchema,
  transferId: IdSchema,
  selections: PaidHandoffSelectionsSchema,
}, { additionalProperties: false })
export type PreparePaidHandoff = Readonly<Static<typeof PreparePaidHandoffSchema>>

export const PaidHandoffConfirmCommandSchema = Type.Object({
  transferId: IdSchema,
  side: Type.Union([Type.Literal('source'), Type.Literal('destination')]),
  expectedVersion: TimestampSchema,
}, { additionalProperties: false })
export const PaidHandoffStartCommandSchema = Type.Object({
  transferId: IdSchema,
  expectedVersion: TimestampSchema,
}, { additionalProperties: false })
export const PaidHandoffRecoveryCommandSchema = Type.Object({
  transferId: IdSchema,
  expectedVersion: TimestampSchema,
  fence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  reasonCode: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$' }),
}, { additionalProperties: false })

export const PaidHandoffBlockedReasonSchema = Type.Union([
  Type.Literal('payment-state'), Type.Literal('destination-inactive'), Type.Literal('quota-unaccepted'),
  Type.Literal('policy-acceptance-stale'), Type.Literal('metering-evidence-stale'), Type.Literal('already-delivered'),
])
export type PaidHandoffBlockedReason = Static<typeof PaidHandoffBlockedReasonSchema>

export const PaidHandoffReviewSchema = Type.Object({
  ...PaidHandoffReadinessSchema.properties,
  setupAmount: Type.String({ minLength: 1, maxLength: 64 }),
  recurringAmount: Type.String({ minLength: 1, maxLength: 64 }),
  activatedAtLocal: Type.String({ minLength: 1, maxLength: 128 }),
  canPrepare: Type.Boolean(),
  canRecover: Type.Boolean(),
  blockedReasons: Type.Array(PaidHandoffBlockedReasonSchema, { maxItems: 6, uniqueItems: true }),
}, { additionalProperties: false })
export type PaidHandoffReview = Readonly<Static<typeof PaidHandoffReviewSchema>>

export class PaidHandoffContractError extends Error {
  readonly path: string
  constructor(label: string, path: string) {
    super(`${label} failed strict validation at ${path || '/'}.`)
    this.name = 'PaidHandoffContractError'
    this.path = path || '/'
  }
}

export function parsePaidHandoff<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  if (Value.Check(schema, value)) return structuredClone(value) as Static<T>
  const first = Value.Errors(schema, value).First()
  throw new PaidHandoffContractError(label, first?.path ?? '/')
}

export const PaidHandoffTransferStateSchema = Type.Union([
  Type.Literal('proposed'), Type.Literal('awaiting-confirmations'), Type.Literal('ready'),
  Type.Literal('running'), Type.Literal('resume-requested'), Type.Literal('completed'),
  Type.Literal('compensating'), Type.Literal('failed'), Type.Literal('cancelled'),
])
export type PaidHandoffTransferState = Static<typeof PaidHandoffTransferStateSchema>

export const PaidHandoffOperationReceiptSchema = Type.Object({
  commandId: IdSchema,
  transferId: IdSchema,
  state: PaidHandoffTransferStateSchema,
  version: TimestampSchema,
}, { additionalProperties: false })
export type PaidHandoffOperationReceipt = Readonly<Static<typeof PaidHandoffOperationReceiptSchema>>

export const PaidHandoffProgressStepSchema = Type.Object({
  definitionId: IdSchema,
  sequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  state: Type.Union([
    Type.Literal('pending'), Type.Literal('running'), Type.Literal('succeeded'),
    Type.Literal('skipped'), Type.Literal('failed'),
  ]),
}, { additionalProperties: false })

export const PaidHandoffDashboardSchema = Type.Object({
  review: PaidHandoffReviewSchema,
  transfer: Type.Union([
    Type.Object({
      state: PaidHandoffTransferStateSchema,
      version: TimestampSchema,
      confirmationStatus: Type.Union([
        Type.Literal('unconfirmed'), Type.Literal('partially-confirmed'), Type.Literal('confirmed'),
      ]),
      fence: Type.Union([Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), Type.Null()]),
      failureCode: Type.Union([IdSchema, Type.Null()]),
      steps: Type.Array(PaidHandoffProgressStepSchema, { maxItems: 128 }),
    }, { additionalProperties: false }),
    Type.Null(),
  ]),
  progressPercent: Type.Integer({ minimum: 0, maximum: 100 }),
  nextAction: Type.Union([
    Type.Literal('choose-assets'), Type.Literal('confirm-source'), Type.Literal('confirm-destination'),
    Type.Literal('start'), Type.Literal('wait'), Type.Literal('recover'), Type.Literal('complete'),
    Type.Literal('blocked'),
  ]),
  managedOwnership: Type.Union([Type.Literal('retained'), Type.Literal('removed')]),
  customerQuotaApplication: Type.Union([Type.Literal('pending'), Type.Literal('applied-once')]),
  internalGrantExcluded: Type.Literal(true),
}, { additionalProperties: false })
export type PaidHandoffDashboard = Readonly<Static<typeof PaidHandoffDashboardSchema>>

export const PaidHandoffReconcileCommandSchema = Type.Object({
  transferId: IdSchema,
  expectedVersion: TimestampSchema,
}, { additionalProperties: false })

export const PaidHandoffRefundEscalationCommandSchema = Type.Object({
  transferId: IdSchema,
  expectedVersion: TimestampSchema,
  reasonCode: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$' }),
}, { additionalProperties: false })

export const PaidHandoffAdminReceiptSchema = Type.Object({
  commandId: IdSchema,
  transferId: IdSchema,
  action: Type.Union([Type.Literal('reconciled'), Type.Literal('refund-escalated')]),
  transferState: PaidHandoffTransferStateSchema,
  outboxState: Type.Union([Type.Literal('pending'), Type.Literal('failed'), Type.Literal('delivered')]),
  occurredAt: TimestampSchema,
}, { additionalProperties: false })
export type PaidHandoffAdminReceipt = Readonly<Static<typeof PaidHandoffAdminReceiptSchema>>
