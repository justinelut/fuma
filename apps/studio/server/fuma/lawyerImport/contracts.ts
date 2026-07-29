import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import type { VerifiedPaystackTransaction } from '../paystack/transport'
import type { PublicationMembershipMetadata } from '../customerPayments/contracts'

const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' })
const Timestamp = Type.String({ format: 'date-time' })
const Route = Type.String({ minLength: 1, maxLength: 512, pattern: '^/' })
const BoundedText = Type.String({ minLength: 1, maxLength: 2_048 })

export const LawyerRouteKindSchema = Type.Union([
  Type.Literal('page'),
  Type.Literal('api'),
  Type.Literal('feed'),
  Type.Literal('system'),
])

export const LawyerRouteRecordSchema = Type.Object({
  route: Route,
  kind: LawyerRouteKindSchema,
  source: Type.String({ minLength: 1, maxLength: 1_024 }),
  access: Type.Union([
    Type.Literal('public'),
    Type.Literal('member'),
    Type.Literal('staff'),
    Type.Literal('service'),
  ]),
}, { additionalProperties: false })

const ExpectedCountsSchema = Type.Object({
  routes: Type.Integer({ minimum: 1, maximum: 10_000 }),
  posts: Type.Integer({ minimum: 0, maximum: 100_000 }),
  pages: Type.Integer({ minimum: 0, maximum: 100_000 }),
  authors: Type.Integer({ minimum: 0, maximum: 10_000 }),
  tags: Type.Integer({ minimum: 0, maximum: 100_000 }),
  relations: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
  members: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
  newsletters: Type.Integer({ minimum: 0, maximum: 10_000 }),
}, { additionalProperties: false })

export const LawyerCommitmentsSchema = Type.Object({
  storage: Type.Object({
    launchDiskGiB: Type.Integer({ minimum: 1, maximum: 100_000 }),
    backupEstimateGiBMin: Type.Number({ minimum: 0, maximum: 100_000 }),
    backupEstimateGiBMax: Type.Number({ minimum: 0, maximum: 100_000 }),
    utilizationWatchPercent: Type.Integer({ minimum: 1, maximum: 100 }),
    retention: Type.String({ minLength: 1, maxLength: 512 }),
  }, { additionalProperties: false }),
  traffic: Type.Object({
    launchTopology: Type.Literal('single-vps'),
    launchVcpu: Type.Integer({ minimum: 1, maximum: 1_024 }),
    launchMemoryGiB: Type.Integer({ minimum: 1, maximum: 100_000 }),
    horizontalScaleReady: Type.Boolean(),
    analyticsPolicy: Type.Literal('anonymous-opt-in'),
  }, { additionalProperties: false }),
  email: Type.Object({
    legacyDeliveryPaths: Type.Array(Type.Union([
      Type.Literal('resend'),
      Type.Literal('smtp'),
      Type.Literal('ghost-native'),
    ]), { minItems: 1, maxItems: 3, uniqueItems: true }),
    destinationProvider: Type.Literal('oci-email-delivery'),
    workloads: Type.Array(Type.Union([
      Type.Literal('member-reauthentication'),
      Type.Literal('transactional'),
      Type.Literal('newsletter'),
      Type.Literal('staff-notification'),
    ]), { minItems: 1, maxItems: 4, uniqueItems: true }),
  }, { additionalProperties: false }),
  support: Type.Object({
    annualMaintenanceKes: Type.Integer({ minimum: 0, maximum: 1_000_000_000 }),
    bestEffortResponseHours: Type.Integer({ minimum: 1, maximum: 720 }),
    included: Type.Array(BoundedText, { maxItems: 50 }),
    excluded: Type.Array(BoundedText, { maxItems: 50 }),
  }, { additionalProperties: false }),
}, { additionalProperties: false })

const PaymentClaimSchema = Type.Object({
  claimId: Id,
  memberSourceId: Id,
  labels: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 64, uniqueItems: true }),
  note: Type.Union([Type.String({ maxLength: 2_048 }), Type.Null()]),
  expectedTierId: Id,
  expectedCadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
  expectedAmountMinor: Type.Integer({ minimum: 1, maximum: 1_000_000_000 }),
}, { additionalProperties: false })

const MerchantScopeSchema = Type.Object({
  platformId: Id,
  organizationId: Id,
  workspaceId: Id,
  siteId: Id,
  ownerKey: Id,
  ownerGeneration: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false })
const MembershipMetadataSchema = Type.Object({
  purchaseId: Id,
  platformId: Id,
  organizationId: Id,
  workspaceId: Id,
  siteId: Id,
  ownerKey: Id,
  ownerGeneration: Type.Integer({ minimum: 1 }),
  memberId: Id,
  tierId: Id,
  credentialId: Id,
  credentialVersion: Type.Integer({ minimum: 1 }),
  amountMinor: Type.Integer({ minimum: 1, maximum: 1_000_000_000 }),
  currency: Type.Literal('KES'),
  periodDays: Type.Integer({ minimum: 1, maximum: 366 }),
  graceDays: Type.Integer({ minimum: 0, maximum: 31 }),
  channel: Type.Union([Type.Literal('card'), Type.Literal('mobile_money')]),
  mobileProvider: Type.Union([Type.Literal('safaricom'), Type.Literal('airtel'), Type.Null()]),
  renewalOfMembershipId: Type.Union([Id, Type.Null()]),
  renewalConfirmationId: Type.Union([Id, Type.Null()]),
}, { additionalProperties: false })
const VerifiedTransactionSchema = Type.Object({
  scope: Type.Literal('customer_merchant'),
  reference: Type.String({ minLength: 16, maxLength: 100, pattern: '^[A-Za-z0-9._-]+$' }),
  status: Type.Literal('success'),
  money: Type.Object({
    amountMinor: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    currency: Type.String({ minLength: 3, maxLength: 3, pattern: '^[A-Z]{3}$' }),
  }, { additionalProperties: false }),
  channel: Type.String({ minLength: 1, maxLength: 64 }),
  channelDetail: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
  customerCode: Type.Union([Type.String({ maxLength: 255 }), Type.Null()]),
  authorizationCode: Type.Union([Type.String({ maxLength: 512 }), Type.Null()]),
  reusableAuthorization: Type.Boolean(),
  providerTransactionId: Id,
}, { additionalProperties: false })
const VerifiedEvidenceSchema = Type.Object({
  evidenceId: Id,
  memberSourceId: Id,
  merchantScope: MerchantScopeSchema,
  metadata: MembershipMetadataSchema,
  transaction: VerifiedTransactionSchema,
}, { additionalProperties: false })

const EvidenceRecordSchema = Type.Object({
  evidenceId: Id,
  kind: Type.Union([
    Type.Literal('route-manifest'),
    Type.Literal('ghost-export'),
    Type.Literal('member-export'),
    Type.Literal('operations-document'),
    Type.Literal('provider-verification'),
  ]),
  sourceLocation: Type.String({ minLength: 1, maxLength: 1_024 }),
  sourceSha256: Sha256,
}, { additionalProperties: false })

export const LawyerSnapshotSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  snapshotId: Id,
  sourceSystem: Type.Literal('the-lawyer-ghost-next'),
  collectedAt: Timestamp,
  ghostExport: Type.Unknown(),
  memberCsv: Type.Optional(Type.String({ maxLength: 25 * 1024 * 1024 })),
  routes: Type.Array(LawyerRouteRecordSchema, { minItems: 1, maxItems: 10_000 }),
  expectedCounts: ExpectedCountsSchema,
  paymentClaims: Type.Array(PaymentClaimSchema, { maxItems: 1_000_000 }),
  verifiedPaymentEvidence: Type.Array(VerifiedEvidenceSchema, { maxItems: 1_000_000 }),
  commitments: LawyerCommitmentsSchema,
  evidence: Type.Array(EvidenceRecordSchema, { minItems: 1, maxItems: 1_000 }),
}, { additionalProperties: false })

export type LawyerSnapshot = Readonly<Static<typeof LawyerSnapshotSchema>>
export type LawyerRouteRecord = Readonly<Static<typeof LawyerRouteRecordSchema>>
export type LawyerCommitments = Readonly<Static<typeof LawyerCommitmentsSchema>>
export type LawyerPaymentClaim = LawyerSnapshot['paymentClaims'][number]
export type LawyerVerifiedPaymentEvidence = Omit<LawyerSnapshot['verifiedPaymentEvidence'][number], 'metadata' | 'transaction'> & Readonly<{
  metadata: PublicationMembershipMetadata
  transaction: VerifiedPaystackTransaction
}>

export type LawyerPaymentClassification =
  | 'verified-for-fuma-reconciliation'
  | 'no-paid-claim'
  | 'exception-missing-provider-evidence'
  | 'exception-ambiguous-provider-evidence'
  | 'exception-label-mismatch'
  | 'exception-reference-mismatch'
  | 'exception-provider-mismatch'
  | 'exception-duplicate-provider-identity'
  | 'exception-orphan-provider-evidence'

export function parseLawyerContract<T extends TSchema>(label: string, schema: T, value: unknown): Readonly<Static<T>> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new LawyerImportError('invalid-snapshot', `${label} failed its strict TypeBox contract.`)
  return Object.freeze(structuredClone(parsed.value))
}

export class LawyerImportError extends Error {
  readonly code: 'invalid-snapshot' | 'secret-detected' | 'count-mismatch' | 'reauthentication-required' | 'scope-denied'
  constructor(code: LawyerImportError['code'], message: string) {
    super(message)
    this.name = 'LawyerImportError'
    this.code = code
  }
}
