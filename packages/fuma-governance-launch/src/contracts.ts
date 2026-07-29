import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const Id = Type.String({ minLength: 1, maxLength: 96, pattern: '^[a-z0-9](?:[a-z0-9._:-]{0,94}[a-z0-9])?$' })
const Sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' })
const SourceRevision = Type.String({ pattern: '^[a-f0-9]{40}(?:[a-f0-9]{24})?$' })
const Timestamp = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$' })
const MinorMoney = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const PositiveUnits = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
const Scope = Type.Object({
  platformId: Id,
  organizationId: Id,
  workspaceId: Id,
  siteId: Id,
  ownerKey: Id,
}, { additionalProperties: false })
const SecretReference = Type.Object({
  keyId: Id,
  ciphertextObjectKey: Type.String({ minLength: 8, maxLength: 512, pattern: '^secrets/[A-Za-z0-9._/-]+$' }),
  fingerprintSha256: Sha256,
}, { additionalProperties: false })

export const AiProviderSchema = Type.Object({
  providerId: Id,
  displayName: Type.String({ minLength: 1, maxLength: 80 }),
  enabled: Type.Boolean(),
  platformCredentialRef: Type.Union([SecretReference, Type.Null()]),
  refreshedAt: Timestamp,
  refreshSequence: PositiveUnits,
}, { additionalProperties: false })
export const AiModelSchema = Type.Object({
  modelId: Id,
  providerId: Id,
  displayName: Type.String({ minLength: 1, maxLength: 120 }),
  capabilities: Type.Array(Type.Union([
    Type.Literal('text'), Type.Literal('vision'), Type.Literal('tools'), Type.Literal('json'), Type.Literal('streaming'),
  ]), { minItems: 1, uniqueItems: true, maxItems: 5 }),
  contextTokens: Type.Integer({ minimum: 1, maximum: 10_000_000 }),
  inputMicrosPerMillion: MinorMoney,
  outputMicrosPerMillion: MinorMoney,
  markupBasisPoints: Type.Integer({ minimum: 0, maximum: 100_000 }),
  included: Type.Boolean(),
  defaultFor: Type.Array(Type.Union([Type.Literal('website'), Type.Literal('publication')]), { uniqueItems: true }),
  enabled: Type.Boolean(),
  refreshedAt: Timestamp,
}, { additionalProperties: false })
export const AiCatalogSchema = Type.Object({
  version: PositiveUnits,
  providers: Type.Array(AiProviderSchema, { maxItems: 100 }),
  models: Type.Array(AiModelSchema, { maxItems: 5_000 }),
  staleAfterSeconds: Type.Integer({ minimum: 60, maximum: 604_800 }),
}, { additionalProperties: false })

export const AiCreditAccountSchema = Type.Object({
  ...Scope.properties,
  accountId: Id,
  balanceMicros: MinorMoney,
  reservedMicros: MinorMoney,
  budgetMicros: MinorMoney,
  version: PositiveUnits,
}, { additionalProperties: false })
export const AiReservationRequestSchema = Type.Object({
  accountId: Id,
  reservationId: Id,
  siteId: Id,
  modelId: Id,
  micros: PositiveUnits,
  expiresAt: Timestamp,
}, { additionalProperties: false })
export const AiReservationSchema = Type.Object({
  reservationId: Id,
  accountId: Id,
  siteId: Id,
  modelId: Id,
  reservedMicros: PositiveUnits,
  settledMicros: Type.Union([MinorMoney, Type.Null()]),
  state: Type.Union([Type.Literal('reserved'), Type.Literal('settled'), Type.Literal('refunded')]),
  expiresAt: Timestamp,
}, { additionalProperties: false })
export const ByokCredentialSchema = Type.Object({
  ...Scope.properties,
  credentialId: Id,
  providerId: Id,
  ownerGeneration: PositiveUnits,
  secret: SecretReference,
  state: Type.Union([Type.Literal('active'), Type.Literal('detached'), Type.Literal('rekey-required')]),
}, { additionalProperties: false })

export const SiteAiInvocationSchema = Type.Object({
  ...Scope.properties,
  actorId: Id,
  profileId: Type.Union([Type.Literal('website'), Type.Literal('publication')]),
  conversationId: Id,
  modelId: Id,
  snapshotHashSha256: Sha256,
  capability: Type.Union([Type.Literal('ai.read'), Type.Literal('ai.write'), Type.Literal('ai.publish')]),
  expectedOwnerGeneration: PositiveUnits,
}, { additionalProperties: false })
export const McpConnectorSchema = Type.Object({
  ...Scope.properties,
  connectorId: Id,
  tokenHashSha256: Sha256,
  capabilities: Type.Array(Type.Union([Type.Literal('read'), Type.Literal('write'), Type.Literal('publish')]), { minItems: 1, uniqueItems: true }),
  requestsPerMinute: Type.Integer({ minimum: 1, maximum: 10_000 }),
  expiresAt: Timestamp,
  revokedAt: Type.Union([Timestamp, Type.Null()]),
}, { additionalProperties: false })

export const PluginArtifactSchema = Type.Object({
  artifactId: Id,
  pluginId: Id,
  version: Type.String({ minLength: 1, maxLength: 64, pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-z0-9.-]+)?$' }),
  objectKey: Type.String({ minLength: 8, maxLength: 512, pattern: '^plugins/artifacts/[A-Za-z0-9._/-]+$' }),
  packageHashSha256: Sha256,
  permissions: Type.Array(Type.String({ minLength: 1, maxLength: 96, pattern: '^[a-z][a-z0-9.:-]+$' }), { uniqueItems: true, maxItems: 100 }),
  provenance: Type.Object({ sourceSha: SourceRevision, lockHashSha256: Sha256, builderId: Id }, { additionalProperties: false }),
}, { additionalProperties: false })
export const PluginInstallationSchema = Type.Object({
  ...Scope.properties,
  installationId: Id,
  artifactId: Id,
  settingsObjectKey: Type.String({ minLength: 8, maxLength: 512, pattern: '^plugins/installations/[A-Za-z0-9._/-]+$' }),
  secret: Type.Union([SecretReference, Type.Null()]),
  state: Type.Union([Type.Literal('active'), Type.Literal('suspended'), Type.Literal('crashed'), Type.Literal('transferring')]),
  quotaUnits: PositiveUnits,
  ownerGeneration: PositiveUnits,
}, { additionalProperties: false })
export const PluginReviewSchema = Type.Object({
  submissionId: Id,
  artifactId: Id,
  packageHashSha256: Sha256,
  submitterId: Id,
  reviewerId: Type.Union([Id, Type.Null()]),
  scanState: Type.Union([Type.Literal('pending'), Type.Literal('clean'), Type.Literal('rejected')]),
  decision: Type.Union([Type.Literal('pending'), Type.Literal('approved'), Type.Literal('rejected'), Type.Literal('revoked')]),
  permissionDiff: Type.Array(Type.String({ minLength: 1, maxLength: 96 }), { uniqueItems: true }),
  signature: Type.Union([Type.String({ minLength: 64, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' }), Type.Null()]),
}, { additionalProperties: false })

export const PaymentPurposeSchema = Type.Union([Type.Literal('deposit'), Type.Literal('donation'), Type.Literal('checkout')])
export const CustomerPaymentRequestSchema = Type.Object({
  ...Scope.properties,
  installationId: Id,
  purpose: PaymentPurposeSchema,
  amountMinor: Type.Integer({ minimum: 100, maximum: 100_000_000 }),
  currency: Type.Literal('KES'),
  idempotencyKey: Id,
  returnPath: Type.String({ minLength: 1, maxLength: 256, pattern: '^/[A-Za-z0-9/_-]*$' }),
}, { additionalProperties: false })
export const ConsoleQuerySchema = Type.Object({
  view: Type.Union([Type.Literal('users'), Type.Literal('organizations'), Type.Literal('clients'), Type.Literal('sites'), Type.Literal('subscriptions'), Type.Literal('offers'), Type.Literal('invoices'), Type.Literal('economics'), Type.Literal('usage'), Type.Literal('domains'), Type.Literal('email'), Type.Literal('jobs'), Type.Literal('releases'), Type.Literal('ai'), Type.Literal('audit')]),
  filter: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9_-]+$' })),
  limit: Type.Integer({ minimum: 1, maximum: 100 }),
}, { additionalProperties: false })
export const ConsoleContributionSchema = Type.Object({
  contributionId: Id,
  ownerTicket: Type.String({ pattern: '^FUMA-(068|072|073|074)$' }),
  routes: Type.Array(Type.String({ pattern: '^/internal/[a-z0-9/-]+$' }), { minItems: 1, uniqueItems: true }),
  requiredAuthorities: Type.Array(Type.String({ pattern: '^internal\\.[a-z0-9.:-]+$' }), { minItems: 1, uniqueItems: true }),
}, { additionalProperties: false })
export const SupportSessionSchema = Type.Object({
  sessionId: Id,
  staffActorId: Id,
  targetUserId: Id,
  reason: Type.String({ minLength: 10, maxLength: 500 }),
  stepUpAt: Timestamp,
  startedAt: Timestamp,
  expiresAt: Timestamp,
  evidenceHashSha256: Sha256,
  targetProtected: Type.Literal(false),
  nested: Type.Literal(false),
}, { additionalProperties: false })
export const BreakGlassRequestSchema = Type.Object({
  requestId: Id,
  targetOwnerId: Id,
  reason: Type.String({ minLength: 20, maxLength: 1_000 }),
  approverIds: Type.Tuple([Id, Id]),
  evidenceHashSha256: Sha256,
  expiresAt: Timestamp,
}, { additionalProperties: false })

export const ExpertReleaseApprovalSchema = Type.Object({
  releaseId: Id,
  expertId: Id,
  submittedByActorId: Id,
  approvedByActorId: Id,
  artifactHashSha256: Sha256,
  expertConsentVersion: PositiveUnits,
  siteOwnerConsentVersion: PositiveUnits,
}, { additionalProperties: false })
export const ExpertProfileSchema = Type.Object({
  expertId: Id,
  organizationId: Id,
  kind: Type.Union([Type.Literal('designer'), Type.Literal('developer'), Type.Literal('studio'), Type.Literal('agency')]),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  skills: Type.Array(Type.String({ minLength: 1, maxLength: 40 }), { maxItems: 20, uniqueItems: true }),
  county: Type.String({ minLength: 2, maxLength: 40 }),
  availability: Type.Union([Type.Literal('available'), Type.Literal('limited'), Type.Literal('unavailable')]),
  approvedReleaseId: Id,
  optedIn: Type.Boolean(),
  suspended: Type.Boolean(),
  consentVersion: PositiveUnits,
  publicRevision: PositiveUnits,
}, { additionalProperties: false })
export const ExpertInquirySchema = Type.Object({
  inquiryId: Id,
  expertId: Id,
  senderFingerprintSha256: Sha256,
  encryptedObjectKey: Type.String({ minLength: 8, maxLength: 512, pattern: '^experts/inquiries/[A-Za-z0-9._/-]+$' }),
  consentVersion: PositiveUnits,
  messageBytes: Type.Integer({ minimum: 1, maximum: 16_384 }),
  state: Type.Union([Type.Literal('queued'), Type.Literal('blocked')]),
  createdAt: Timestamp,
  expiresAt: Timestamp,
}, { additionalProperties: false })
export const TransferHandoffSchema = Type.Object({
  ...Scope.properties,
  transferId: Id,
  commandIdempotencyKey: Id,
  contractId: Id,
  offerVersion: PositiveUnits,
  paymentState: Type.Literal('paid-transfer-pending'),
  destinationOrganizationId: Id,
  locale: Type.Literal('en-KE'),
  currency: Type.Literal('KES'),
  timezone: Type.Literal('Africa/Nairobi'),
  selectedAssets: Type.Array(Type.Union([Type.Literal('domain'), Type.Literal('ai'), Type.Literal('mcp'), Type.Literal('plugins'), Type.Literal('payments'), Type.Literal('collaborators')]), { minItems: 1, uniqueItems: true }),
}, { additionalProperties: false })

export const GhostImportManifestSchema = Type.Object({
  importId: Id,
  sourceVersion: Type.String({ pattern: '^5\\.[0-9]+(?:\\.[0-9]+)?$' }),
  sourceHashSha256: Sha256,
  counts: Type.Record(Type.String({ pattern: '^[a-z_]+$' }), Type.Integer({ minimum: 0 })),
  relationHashSha256: Sha256,
  mediaHashSha256: Sha256,
  dryRun: Type.Boolean(),
  resumableCursor: Type.Union([Type.String({ maxLength: 512 }), Type.Null()]),
  excludedKinds: Type.Array(Type.Union([Type.Literal('passwords'), Type.Literal('sessions'), Type.Literal('provider-secrets')]), { minItems: 3, maxItems: 3, uniqueItems: true }),
}, { additionalProperties: false })
export const LawyerReconciliationSchema = Type.Object({
  inventoryHashSha256: Sha256,
  routeCount: Type.Integer({ minimum: 1 }),
  memberCount: Type.Integer({ minimum: 0 }),
  paymentRows: Type.Array(Type.Object({
    sourceId: Id,
    state: Type.Union([Type.Literal('provider-verified'), Type.Literal('exception')]),
    providerReferenceHashSha256: Type.Union([Sha256, Type.Null()]),
  }, { additionalProperties: false })),
  emailMigration: Type.Literal('oci-email-delivery'),
  requiresStaffReauth: Type.Literal(true),
  requiresMemberReauth: Type.Literal(true),
}, { additionalProperties: false })
export const DesignConversionManifestSchema = Type.Object({
  inventoryHashSha256: Sha256,
  routeBindings: Type.Array(Type.Object({ route: Type.String({ pattern: '^/' }), templateId: Id, loopIds: Type.Array(Id), accessBinding: Type.Union([Type.Literal('public'), Type.Literal('member'), Type.Literal('paid')]) }, { additionalProperties: false }), { minItems: 1 }),
  templateIds: Type.Array(Id, { minItems: 1, uniqueItems: true }),
  tokenHashSha256: Sha256,
  assetHashSha256: Sha256,
  flattenedCopies: Type.Literal(0),
}, { additionalProperties: false })

export const PairedReleaseManifestSchema = Type.Object({
  schemaVersion: Type.Literal(3),
  sourceSha: SourceRevision,
  lockHashSha256: Sha256,
  migrationHighWaterMark: Type.String({ pattern: '^000[0-9]{3}_[a-z0-9_]+$' }),
  runtimeImage: Type.String({ pattern: '^ghcr\\.io/corebunch/fuma-runtime@sha256:[a-f0-9]{64}$' }),
  runtimeImageSourceSha: SourceRevision,
  webImage: Type.String({ pattern: '^ghcr\\.io/corebunch/fuma-web@sha256:[a-f0-9]{64}$' }),
  webImageSourceSha: SourceRevision,
  architectures: Type.Tuple([Type.Literal('linux/amd64'), Type.Literal('linux/arm64')]),
  runtimeIndexHashSha256: Sha256,
  webIndexHashSha256: Sha256,
  runtimeScanReportHashSha256: Sha256,
  webScanReportHashSha256: Sha256,
  runtimeSbomHashSha256: Sha256,
  webSbomHashSha256: Sha256,
  runtimeProvenanceHashSha256: Sha256,
  webProvenanceHashSha256: Sha256,
  runtimeSignatureVerificationHashSha256: Sha256,
  webSignatureVerificationHashSha256: Sha256,
  runtimeSmokeEvidenceHashSha256: Sha256,
  webSmokeEvidenceHashSha256: Sha256,
  publicationPlanHashSha256: Sha256,
  manifestHashSha256: Sha256,
}, { additionalProperties: false })
export const LaunchGateSchema = Type.Object({
  release: PairedReleaseManifestSchema,
  migrationPassed: Type.Boolean(),
  restorePassed: Type.Boolean(),
  hostIsolationPassed: Type.Boolean(),
  publicWebPassed: Type.Boolean(),
  securityPassed: Type.Boolean(),
  accessibilityPassed: Type.Boolean(),
  providerEvidenceCurrent: Type.Boolean(),
  grossMarginBasisPoints: Type.Integer({ minimum: 0, maximum: 10_000 }),
  variableCogsBasisPoints: Type.Integer({ minimum: 0, maximum: 10_000 }),
  approvals: Type.Array(Type.Object({ role: Id, actorId: Id, evidenceHashSha256: Sha256, signedAt: Timestamp }, { additionalProperties: false }), { uniqueItems: true }),
}, { additionalProperties: false })
export const PublicWebDeploymentSeamSchema = Type.Object({
  releaseSourceSha: SourceRevision,
  runtimeProjectionVersion: PositiveUnits,
  webContractVersion: PositiveUnits,
  privateRuntimeAudience: Type.Literal('fuma-public-web'),
  canonicalHost: Type.Literal('fuma.co.ke'),
  canaryPercent: Type.Integer({ minimum: 0, maximum: 100 }),
  publicRollbackIndependent: Type.Literal(true),
  productTenantContinuityRequired: Type.Literal(true),
}, { additionalProperties: false })

export type AiCatalog = Static<typeof AiCatalogSchema>
export type AiCreditAccount = Static<typeof AiCreditAccountSchema>
export type AiReservation = Static<typeof AiReservationSchema>
export type SiteAiInvocation = Static<typeof SiteAiInvocationSchema>
export type McpConnector = Static<typeof McpConnectorSchema>
export type PluginArtifact = Static<typeof PluginArtifactSchema>
export type PluginInstallation = Static<typeof PluginInstallationSchema>
export type PluginReview = Static<typeof PluginReviewSchema>
export type CustomerPaymentRequest = Static<typeof CustomerPaymentRequestSchema>
export type ConsoleQuery = Static<typeof ConsoleQuerySchema>
export type ConsoleContribution = Static<typeof ConsoleContributionSchema>
export type SupportSession = Static<typeof SupportSessionSchema>
export type BreakGlassRequest = Static<typeof BreakGlassRequestSchema>
export type ExpertReleaseApproval = Static<typeof ExpertReleaseApprovalSchema>
export type ExpertProfile = Static<typeof ExpertProfileSchema>
export type ExpertInquiry = Static<typeof ExpertInquirySchema>
export type TransferHandoff = Static<typeof TransferHandoffSchema>
export type GhostImportManifest = Static<typeof GhostImportManifestSchema>
export type LawyerReconciliation = Static<typeof LawyerReconciliationSchema>
export type DesignConversionManifest = Static<typeof DesignConversionManifestSchema>
export type PairedReleaseManifest = Static<typeof PairedReleaseManifestSchema>
export type LaunchGate = Static<typeof LaunchGateSchema>
export type PublicWebDeploymentSeam = Static<typeof PublicWebDeploymentSeamSchema>

export class PhaseContractError extends Error {
  readonly boundary: string
  readonly detail: string
  constructor(boundary: string, detail: string) {
    super(`${boundary}: ${detail}`)
    this.name = 'PhaseContractError'
    this.boundary = boundary
    this.detail = detail
  }
}

export function parseStrict<T extends TSchema>(schema: T, value: unknown, boundary: string): Static<T> {
  if (Value.Check(schema, value)) return structuredClone(value) as Static<T>
  const first = Value.Errors(schema, value).First()
  throw new PhaseContractError(boundary, `${first?.path || '/'} ${first?.message || 'invalid value'}`)
}
