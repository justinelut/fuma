import { Type, Value, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import { createHash } from 'node:crypto'
import { ArtifactKindSchema, ArtifactReleaseSchema } from '../artifacts/contracts'

const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Hash = Type.String({ pattern: '^[a-f0-9]{64}$' })
const Version = Type.String({ pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' })
const Timestamp = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$' })
const Spdx = Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9.+-]+$' })

export const ReviewDependencySchema = Type.Object({ packageId: Id, exactVersion: Version, contentHashSha256: Hash }, { additionalProperties: false })
export const ReviewSchemaEvidenceSchema = Type.Object({ schemaId: Id, schemaHashSha256: Hash }, { additionalProperties: false })
export const ReviewEvidenceSchema = Type.Object({
  provenanceHashSha256: Hash,
  license: Type.Object({ spdx: Spdx, evidenceHashSha256: Hash }, { additionalProperties: false }),
  accessibility: Type.Object({ standard: Type.Union([Type.Literal('WCAG2.2-A'), Type.Literal('WCAG2.2-AA'), Type.Literal('not-applicable')]), evidenceHashSha256: Hash }, { additionalProperties: false }),
  runtimeCompatibility: Type.Object({ runtime: Type.Literal('fuma-site-runtime'), minimumVersion: Version, evidenceHashSha256: Hash }, { additionalProperties: false }),
}, { additionalProperties: false })
export type ReviewEvidence = Static<typeof ReviewEvidenceSchema>

export const ReviewPublicMetadataSchema = Type.Object({
  id: Id,
  slug: Type.String({ minLength: 1, maxLength: 120, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
  name: Type.String({ minLength: 1, maxLength: 160 }),
  summary: Type.String({ minLength: 1, maxLength: 500 }),
  categories: Type.Array(Type.String({ minLength: 1, maxLength: 80, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }), { maxItems: 32, uniqueItems: true }),
  publisherName: Type.String({ minLength: 1, maxLength: 160 }),
  publisherVerified: Type.Literal(true),
  permissionLabels: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 32 }),
  imageUrl: Type.Union([Type.String({ minLength: 8, maxLength: 2_048, pattern: '^https://' }), Type.Null()]),
}, { additionalProperties: false })
export type ReviewPublicMetadata = Static<typeof ReviewPublicMetadataSchema>

export const ReviewPackageMetadataSchema = Type.Object({
  dependencies: Type.Array(ReviewDependencySchema, { maxItems: 1_000 }),
  schemas: Type.Array(ReviewSchemaEvidenceSchema, { maxItems: 1_000 }),
  evidence: ReviewEvidenceSchema,
  public: ReviewPublicMetadataSchema,
}, { additionalProperties: false })
export type ReviewPackageMetadata = Static<typeof ReviewPackageMetadataSchema>

const ReviewDiffItemSchema = Type.Object({ key: Type.String({ minLength: 1, maxLength: 512 }), before: Type.Union([Type.String({ maxLength: 512 }), Type.Null()]), after: Type.Union([Type.String({ maxLength: 512 }), Type.Null()]) }, { additionalProperties: false })
export const ReviewDiffSchema = Type.Object({
  permissions: Type.Array(ReviewDiffItemSchema, { maxItems: 1_000 }),
  dependencies: Type.Array(ReviewDiffItemSchema, { maxItems: 1_000 }),
  schemas: Type.Array(ReviewDiffItemSchema, { maxItems: 1_000 }),
}, { additionalProperties: false })
export type ReviewDiff = Static<typeof ReviewDiffSchema>

export const ArtifactScanFindingSchema = Type.Object({
  findingId: Id,
  code: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
  severity: Type.Union([Type.Literal('info'), Type.Literal('low'), Type.Literal('medium'), Type.Literal('high'), Type.Literal('critical')]),
  state: Type.Union([Type.Literal('open'), Type.Literal('accepted'), Type.Literal('fixed')]),
  evidenceHashSha256: Hash,
}, { additionalProperties: false })
export type ArtifactScanFinding = Static<typeof ArtifactScanFindingSchema>

export const ArtifactScanReportSchema = Type.Object({
  submissionId: Id,
  artifactId: Id,
  artifactKind: ArtifactKindSchema,
  contentHashSha256: Hash,
  scannerId: Id,
  scannerVersion: Version,
  state: Type.Union([Type.Literal('clean'), Type.Literal('rejected')]),
  reportHashSha256: Hash,
  findings: Type.Array(ArtifactScanFindingSchema, { maxItems: 10_000 }),
  scannedAt: Timestamp,
}, { additionalProperties: false })
export type ArtifactScanReport = Static<typeof ArtifactScanReportSchema>

export const ArtifactReviewSubmissionSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  submissionId: Id,
  artifact: ArtifactReleaseSchema,
  submitterId: Id,
  baselineSubmissionId: Type.Union([Id, Type.Null()]),
  metadata: ReviewPackageMetadataSchema,
  metadataHashSha256: Hash,
  diff: ReviewDiffSchema,
  scanState: Type.Union([Type.Literal('clean'), Type.Literal('rejected')]),
  submittedAt: Timestamp,
}, { additionalProperties: false })
export type ArtifactReviewSubmission = Static<typeof ArtifactReviewSubmissionSchema>

export const ArtifactReviewSignatureSchema = Type.Object({
  algorithm: Type.Literal('ed25519'),
  keyId: Id,
  payloadHashSha256: Hash,
  value: Type.String({ minLength: 32, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' }),
}, { additionalProperties: false })
export type ArtifactReviewSignature = Static<typeof ArtifactReviewSignatureSchema>

export const ArtifactReviewDecisionSchema = Type.Object({
  decisionId: Id,
  submissionId: Id,
  artifactId: Id,
  contentHashSha256: Hash,
  reviewerId: Id,
  decision: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]),
  reason: Type.String({ minLength: 1, maxLength: 2_000 }),
  signature: Type.Union([ArtifactReviewSignatureSchema, Type.Null()]),
  decidedAt: Timestamp,
}, { additionalProperties: false })
export type ArtifactReviewDecision = Static<typeof ArtifactReviewDecisionSchema>

export const ArtifactReviewRevocationSchema = Type.Object({
  revocationId: Id,
  decisionId: Id,
  submissionId: Id,
  artifactId: Id,
  actorId: Id,
  reason: Type.String({ minLength: 1, maxLength: 2_000 }),
  revokedAt: Timestamp,
}, { additionalProperties: false })
export type ArtifactReviewRevocation = Static<typeof ArtifactReviewRevocationSchema>

export const ApprovedArtifactReviewSchema = Type.Object({
  submission: ArtifactReviewSubmissionSchema,
  scans: Type.Array(ArtifactScanReportSchema, { minItems: 1, maxItems: 100 }),
  decision: ArtifactReviewDecisionSchema,
  revocation: Type.Union([ArtifactReviewRevocationSchema, Type.Null()]),
}, { additionalProperties: false })
export type ApprovedArtifactReview = Static<typeof ApprovedArtifactReviewSchema>

export const MarketplaceArtifactSchema = Type.Object({
  submissionId: Id,
  decisionId: Id,
  signatureKeyId: Id,
  reviewState: Type.Literal('signed-current'),
  artifactId: Id,
  kind: ArtifactKindSchema,
  packageId: Id,
  exactVersion: Version,
  contentHashSha256: Hash,
  permissions: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 128, uniqueItems: true }),
  provenanceHashSha256: Hash,
  licenseSpdx: Spdx,
  accessibilityStandard: Type.String({ minLength: 1, maxLength: 64 }),
  minimumRuntimeVersion: Version,
  reviewedAt: Timestamp,
}, { additionalProperties: false })
export type MarketplaceArtifact = Static<typeof MarketplaceArtifactSchema>

export const SubmitArtifactReviewCommandSchema = Type.Object({
  submissionId: Id,
  artifactId: Id,
  contentHashSha256: Hash,
  submitterId: Id,
  baselineSubmissionId: Type.Union([Id, Type.Null()]),
  metadata: ReviewPackageMetadataSchema,
  submittedAt: Timestamp,
}, { additionalProperties: false })
export const DecideArtifactReviewCommandSchema = Type.Object({
  decisionId: Id,
  submissionId: Id,
  reviewerId: Id,
  decision: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]),
  reason: Type.String({ minLength: 1, maxLength: 2_000 }),
  decidedAt: Timestamp,
}, { additionalProperties: false })
export const RevokeArtifactReviewCommandSchema = ArtifactReviewRevocationSchema

export const PrivateDeclarativeComponentPolicySchema = Type.Object({
  distribution: Type.Literal('private'),
  executionPolicy: Type.Literal('component-declarative'),
  ownerKey: Id,
  siteId: Id,
  permissions: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 128, uniqueItems: true }),
  persistedExecutableJsx: Type.Literal(false),
  dynamicTenantServerImport: Type.Literal(false),
}, { additionalProperties: false })
export type PrivateDeclarativeComponentPolicy = Static<typeof PrivateDeclarativeComponentPolicySchema>

export type ArtifactReviewErrorCode = 'invalid-contract' | 'artifact-mutated' | 'not-found' | 'scan-denied' | 'self-approval' | 'decision-denied' | 'signature-denied' | 'revoked' | 'permission-escalation' | 'conflict'
export class ArtifactReviewError extends Error {
  readonly code: ArtifactReviewErrorCode
  constructor(code: ArtifactReviewErrorCode, message: string) {
    super(message)
    this.name = 'ArtifactReviewError'
    this.code = code
  }
}

export function parseReviewContract<T extends TSchema>(schema: T, value: unknown, label: string): Readonly<Static<T>> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) {
    const first = Value.Errors(schema, value).First()
    throw new ArtifactReviewError('invalid-contract', `${label} failed strict TypeBox validation${first ? ` at ${first.path || '/'}: ${first.message}` : ''}.`)
  }
  return deepFreeze(parsed.value)
}

export function canonicalReviewJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalReviewJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${canonicalReviewJson(nested)}`).join(',')}}`
}
export function reviewHash(value: unknown): string { return createHash('sha256').update(canonicalReviewJson(value)).digest('hex') }

export function assertPrivateDeclarativeComponentPolicy(raw: unknown, scope: Readonly<{ ownerKey: string; siteId: string }>): Readonly<PrivateDeclarativeComponentPolicy> {
  const policy = parseReviewContract(PrivateDeclarativeComponentPolicySchema, raw, 'private declarative component policy') as PrivateDeclarativeComponentPolicy
  if (policy.ownerKey !== scope.ownerKey || policy.siteId !== scope.siteId) throw new ArtifactReviewError('decision-denied', 'Private declarative component scope changed.')
  if (policy.permissions.some((permission) => /(?:server|network|payment|provider|secret|worker|schedule)/.test(permission))) throw new ArtifactReviewError('permission-escalation', 'Private declarative component requests privileged authority.')
  return policy
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const nested of Object.values(value)) deepFreeze(nested); Object.freeze(value) }
  return value
}
