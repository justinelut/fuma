import type { ArtifactInstallation, ArtifactInstallationAuthority, ArtifactRelease } from '../artifacts'
import {
  ApprovedArtifactReviewSchema,
  ArtifactReviewDecisionSchema,
  ArtifactReviewInvalidationSchema,
  ArtifactReviewError,
  ArtifactReviewSignatureSchema,
  ArtifactReviewSubmissionSchema,
  DecideArtifactReviewCommandSchema,
  MarketplaceArtifactSchema,
  RevokeArtifactReviewCommandSchema,
  SubmitArtifactReviewCommandSchema,
  canonicalReviewJson,
  parseReviewContract,
  reviewHash,
  type ApprovedArtifactReview,
  type ArtifactReviewDecision,
  type ArtifactReviewInvalidation,
  type ArtifactReviewRevocation,
  type ArtifactReviewSubmission,
  type ArtifactScanReport,
  type MarketplaceArtifact,
  type ReviewDiff,
  type ReviewPackageMetadata,
} from './contracts'
import { ArtifactScannerRegistry } from './scanners'
import type { ArtifactReviewSigner } from './signing'

export interface ArtifactReviewRepository {
  readSubmission(submissionId: string): Promise<Readonly<{ submission: ArtifactReviewSubmission; scans: readonly ArtifactScanReport[] }> | null>
  insertSubmission(submission: ArtifactReviewSubmission, scans: readonly ArtifactScanReport[]): Promise<boolean>
  readDecision(submissionId: string): Promise<ArtifactReviewDecision | null>
  insertDecision(decision: ArtifactReviewDecision): Promise<boolean>
  readRevocation(decisionId: string): Promise<ArtifactReviewRevocation | null>
  insertRevocation(revocation: ArtifactReviewRevocation): Promise<boolean>
  listApproved(limit: number): Promise<readonly ApprovedArtifactReview[]>
}

export interface ReviewArtifactAuthority {
  readVerifiedArtifact(artifactId: string): Promise<Readonly<{ artifact: ArtifactRelease; bytes: Uint8Array }>>
  install(raw: unknown): Promise<ArtifactInstallation>
}

type DiffValue = Readonly<{ key: string; value: string }>

function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }
function diffRows(before: readonly DiffValue[], after: readonly DiffValue[]) {
  const previous = new Map(before.map(({ key, value }) => [key, value]))
  const current = new Map(after.map(({ key, value }) => [key, value]))
  return [...new Set([...previous.keys(), ...current.keys()])].sort(compare).flatMap((key) => {
    const oldValue = previous.get(key) ?? null
    const newValue = current.get(key) ?? null
    return oldValue === newValue ? [] : [{ key, before: oldValue, after: newValue }]
  })
}

function reviewDiff(artifact: ArtifactRelease, metadata: ReviewPackageMetadata, baseline: ArtifactReviewSubmission | null): ReviewDiff {
  return {
    permissions: diffRows((baseline?.artifact.permissions ?? []).map((value) => ({ key: value, value })), artifact.permissions.map((value) => ({ key: value, value }))),
    dependencies: diffRows((baseline?.metadata.dependencies ?? []).map((value) => ({ key: value.packageId, value: `${value.exactVersion}:${value.contentHashSha256}` })), metadata.dependencies.map((value) => ({ key: value.packageId, value: `${value.exactVersion}:${value.contentHashSha256}` }))),
    schemas: diffRows((baseline?.metadata.schemas ?? []).map((value) => ({ key: value.schemaId, value: value.schemaHashSha256 })), metadata.schemas.map((value) => ({ key: value.schemaId, value: value.schemaHashSha256 }))),
  }
}

function decisionPayload(decision: Omit<ArtifactReviewDecision, 'signature'>): string {
  return reviewHash({ domain: 'fuma-artifact-review-decision-v1', ...decision })
}

function same(left: unknown, right: unknown): boolean { return canonicalReviewJson(left) === canonicalReviewJson(right) }

export interface ArtifactReviewInvalidationPort {
  publish(event: ArtifactReviewInvalidation): Promise<void>
}

export class ArtifactReviewService {
  readonly #repository: ArtifactReviewRepository
  readonly #artifacts: ReviewArtifactAuthority
  readonly #scanners: ArtifactScannerRegistry
  readonly #signer: ArtifactReviewSigner
  readonly #invalidation: ArtifactReviewInvalidationPort | null

  constructor(input: Readonly<{ repository: ArtifactReviewRepository; artifacts: ReviewArtifactAuthority; scanners: ArtifactScannerRegistry; signer: ArtifactReviewSigner; invalidation?: ArtifactReviewInvalidationPort }>) {
    this.#repository = input.repository
    this.#artifacts = input.artifacts
    this.#scanners = input.scanners
    this.#signer = input.signer
    this.#invalidation = input.invalidation ?? null
  }

  async #publishInvalidation(submission: ArtifactReviewSubmission, reason: 'approved' | 'revoked', changedAt: string): Promise<void> {
    if (!this.#invalidation) return
    const event = parseReviewContract(ArtifactReviewInvalidationSchema, {
      resource: submission.artifact.kind === 'plugin' ? 'plugins' : 'components',
      packageId: submission.artifact.packageId,
      exactVersion: submission.artifact.exactVersion,
      reason,
      changedAt,
    }, 'artifact review public invalidation') as ArtifactReviewInvalidation
    await this.#invalidation.publish(event)
  }

  async submit(raw: unknown): Promise<Readonly<{ submission: ArtifactReviewSubmission; scans: readonly ArtifactScanReport[] }>> {
    const command = parseReviewContract(SubmitArtifactReviewCommandSchema, raw, 'artifact review submission command')
    const existing = await this.#repository.readSubmission(command.submissionId)
    if (existing) {
      if (existing.submission.artifact.artifactId !== command.artifactId || existing.submission.artifact.contentHashSha256 !== command.contentHashSha256
        || existing.submission.submitterId !== command.submitterId || existing.submission.baselineSubmissionId !== command.baselineSubmissionId
        || existing.submission.submittedAt !== command.submittedAt || existing.submission.metadataHashSha256 !== reviewHash(command.metadata)) {
        throw new ArtifactReviewError('artifact-mutated', 'Review submission identity was reused with different hash-bound evidence.')
      }
      return existing
    }
    const verified = await this.#artifacts.readVerifiedArtifact(command.artifactId)
    if (verified.artifact.contentHashSha256 !== command.contentHashSha256) throw new ArtifactReviewError('artifact-mutated', 'Submission hash does not match immutable artifact bytes.')
    const baselineRecord = command.baselineSubmissionId ? await this.#repository.readSubmission(command.baselineSubmissionId) : null
    if (command.baselineSubmissionId && (!baselineRecord || baselineRecord.submission.artifact.packageId !== verified.artifact.packageId || baselineRecord.submission.artifact.kind !== verified.artifact.kind)) {
      throw new ArtifactReviewError('not-found', 'Review baseline is not an earlier release of this package.')
    }
    const metadata = command.metadata as ReviewPackageMetadata
    const scans = await this.#scanners.scan({ submissionId: command.submissionId, artifact: verified.artifact, bytes: verified.bytes, metadata, scannedAt: command.submittedAt })
    const submission = parseReviewContract(ArtifactReviewSubmissionSchema, {
      schemaVersion: 1,
      submissionId: command.submissionId,
      artifact: verified.artifact,
      submitterId: command.submitterId,
      baselineSubmissionId: command.baselineSubmissionId,
      metadata,
      metadataHashSha256: reviewHash(metadata),
      diff: reviewDiff(verified.artifact, metadata, baselineRecord?.submission ?? null),
      scanState: scans.every(({ state }) => state === 'clean') ? 'clean' : 'rejected',
      submittedAt: command.submittedAt,
    }, 'artifact review submission') as ArtifactReviewSubmission
    if (!await this.#repository.insertSubmission(submission, scans)) return await this.submit(command)
    return Object.freeze({ submission, scans })
  }

  async decide(raw: unknown): Promise<ArtifactReviewDecision> {
    const command = parseReviewContract(DecideArtifactReviewCommandSchema, raw, 'artifact review decision command')
    const record = await this.#repository.readSubmission(command.submissionId)
    if (!record) throw new ArtifactReviewError('not-found', 'Artifact review submission is unavailable.')
    if (record.submission.submitterId === command.reviewerId) throw new ArtifactReviewError('self-approval', 'Artifact submitters cannot decide their own review.')
    const existing = await this.#repository.readDecision(command.submissionId)
    if (existing) {
      const expected = { ...existing, decisionId: command.decisionId, reviewerId: command.reviewerId, decision: command.decision, reason: command.reason, decidedAt: command.decidedAt }
      if (!same(existing, expected)) throw new ArtifactReviewError('conflict', 'Artifact review already has an immutable decision.')
      return existing
    }
    if (command.decision === 'approved' && (record.submission.scanState !== 'clean' || record.scans.some(({ state }) => state !== 'clean'))) {
      throw new ArtifactReviewError('scan-denied', 'Approval requires every artifact-specific scan to be clean.')
    }
    const unsigned = {
      decisionId: command.decisionId,
      submissionId: command.submissionId,
      artifactId: record.submission.artifact.artifactId,
      contentHashSha256: record.submission.artifact.contentHashSha256,
      reviewerId: command.reviewerId,
      decision: command.decision,
      reason: command.reason,
      decidedAt: command.decidedAt,
    }
    let signature = null
    if (command.decision === 'approved') {
      const payloadHashSha256 = decisionPayload(unsigned)
      const signed = await this.#signer.sign(payloadHashSha256)
      signature = parseReviewContract(ArtifactReviewSignatureSchema, { algorithm: 'ed25519', keyId: signed.keyId, payloadHashSha256, value: signed.value }, 'artifact review signature')
    }
    const decision = parseReviewContract(ArtifactReviewDecisionSchema, { ...unsigned, signature }, 'artifact review decision') as ArtifactReviewDecision
    if (!await this.#repository.insertDecision(decision)) return await this.decide(command)
    if (decision.decision === 'approved') await this.#publishInvalidation(record.submission, 'approved', decision.decidedAt)
    return decision
  }

  async revoke(raw: unknown): Promise<ArtifactReviewRevocation> {
    const command = parseReviewContract(RevokeArtifactReviewCommandSchema, raw, 'artifact review revocation command') as ArtifactReviewRevocation
    const record = await this.#repository.readSubmission(command.submissionId)
    const decision = await this.#repository.readDecision(command.submissionId)
    if (!record || !decision || decision.decisionId !== command.decisionId || decision.artifactId !== command.artifactId || decision.decision !== 'approved') throw new ArtifactReviewError('decision-denied', 'Only an approved exact release can be revoked.')
    if (record.submission.submitterId === command.actorId) throw new ArtifactReviewError('self-approval', 'Artifact submitters cannot revoke their own release review.')
    const existing = await this.#repository.readRevocation(command.decisionId)
    if (existing) {
      if (!same(existing, command)) throw new ArtifactReviewError('conflict', 'Artifact review already has an immutable revocation.')
      return existing
    }
    if (!await this.#repository.insertRevocation(command)) return await this.revoke(command)
    await this.#publishInvalidation(record.submission, 'revoked', command.revokedAt)
    return command
  }

  async verify(submissionId: string): Promise<ApprovedArtifactReview> {
    const record = await this.#repository.readSubmission(submissionId)
    const decision = await this.#repository.readDecision(submissionId)
    if (!record || !decision || decision.decision !== 'approved' || !decision.signature || decision.artifactId !== record.submission.artifact.artifactId
      || decision.contentHashSha256 !== record.submission.artifact.contentHashSha256 || record.submission.scanState !== 'clean') {
      throw new ArtifactReviewError('decision-denied', 'Artifact release is not currently approved.')
    }
    if (record.scans.length < 2 || record.scans.some((scan) => {
      const { reportHashSha256, ...body } = scan
      return scan.state !== 'clean' || scan.submissionId !== record.submission.submissionId
        || scan.artifactId !== record.submission.artifact.artifactId || scan.artifactKind !== record.submission.artifact.kind
        || scan.contentHashSha256 !== record.submission.artifact.contentHashSha256 || reportHashSha256 !== reviewHash(body)
    })) throw new ArtifactReviewError('scan-denied', 'Persisted artifact scan evidence is incomplete or invalid.')
    const revocation = await this.#repository.readRevocation(decision.decisionId)
    if (revocation) throw new ArtifactReviewError('revoked', 'Artifact review signature is revoked.')
    const { signature, ...unsigned } = decision
    const payloadHashSha256 = decisionPayload(unsigned)
    if (signature.payloadHashSha256 !== payloadHashSha256 || !await this.#signer.verify(signature.keyId, payloadHashSha256, signature.value)) {
      throw new ArtifactReviewError('signature-denied', 'Artifact review signature is invalid.')
    }
    return parseReviewContract(ApprovedArtifactReviewSchema, { submission: record.submission, scans: record.scans, decision, revocation: null }, 'approved artifact review') as ApprovedArtifactReview
  }

  async marketplace(limit = 100): Promise<readonly MarketplaceArtifact[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ArtifactReviewError('invalid-contract', 'Marketplace limit must be between 1 and 100.')
    const approved = await this.#repository.listApproved(limit)
    const visible: MarketplaceArtifact[] = []
    for (const item of approved) {
      try {
        const verified = await this.verify(item.submission.submissionId)
        const value = verified.submission
        visible.push(parseReviewContract(MarketplaceArtifactSchema, {
          submissionId: value.submissionId,
          decisionId: verified.decision.decisionId,
          signatureKeyId: verified.decision.signature!.keyId,
          reviewState: 'signed-current',
          artifactId: value.artifact.artifactId,
          kind: value.artifact.kind,
          packageId: value.artifact.packageId,
          exactVersion: value.artifact.exactVersion,
          contentHashSha256: value.artifact.contentHashSha256,
          permissions: value.artifact.permissions,
          provenanceHashSha256: value.metadata.evidence.provenanceHashSha256,
          licenseSpdx: value.metadata.evidence.license.spdx,
          accessibilityStandard: value.metadata.evidence.accessibility.standard,
          minimumRuntimeVersion: value.metadata.evidence.runtimeCompatibility.minimumVersion,
          reviewedAt: verified.decision.decidedAt,
        }, 'marketplace artifact') as MarketplaceArtifact)
      } catch (error) {
        if (!(error instanceof ArtifactReviewError) || !['revoked', 'signature-denied', 'decision-denied'].includes(error.code)) throw error
      }
    }
    return Object.freeze(visible)
  }

  async install(input: Readonly<{ submissionId: string; installation: unknown; grantedPermissions: readonly string[] }>): Promise<ArtifactInstallation> {
    const approved = await this.verify(input.submissionId)
    const artifact = approved.submission.artifact
    const granted = [...new Set(input.grantedPermissions)].sort(compare)
    const requested = [...artifact.permissions].sort(compare)
    if (!same(granted, requested)) throw new ArtifactReviewError('permission-escalation', 'Install permission grant must exactly match the reviewed release.')
    const installation = input.installation as Partial<ArtifactInstallation>
    if (installation.artifactId !== artifact.artifactId || installation.artifactKind !== artifact.kind || installation.packageId !== artifact.packageId
      || installation.exactVersion !== artifact.exactVersion || installation.contentHashSha256 !== artifact.contentHashSha256 || installation.executionPolicy !== artifact.executionPolicy) {
      throw new ArtifactReviewError('artifact-mutated', 'Install command changed the reviewed immutable release.')
    }
    return await this.#artifacts.install(input.installation)
  }
}

export function reviewArtifactAuthority(authority: ArtifactInstallationAuthority): ReviewArtifactAuthority { return authority }
