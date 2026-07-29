import type { DbClient } from '../../db/client'
import {
  ApprovedArtifactReviewSchema,
  ArtifactReviewDecisionSchema,
  ArtifactReviewRevocationSchema,
  ArtifactReviewSubmissionSchema,
  ArtifactScanReportSchema,
  parseReviewContract,
  type ApprovedArtifactReview,
  type ArtifactReviewDecision,
  type ArtifactReviewRevocation,
  type ArtifactReviewSubmission,
  type ArtifactScanReport,
} from './contracts'
import type { ArtifactReviewRepository } from './service'

interface JsonRow { value_json: unknown }
interface SubmissionIdRow { submission_id: string }

function json(value: unknown): string { return JSON.stringify(value) }
function value(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) as unknown } catch { return null }
}
function parse<T>(schema: Parameters<typeof parseReviewContract>[0], raw: unknown, label: string): T | null {
  try { return parseReviewContract(schema, value(raw), label) as T } catch { return null }
}

export class PostgresArtifactReviewRepository implements ArtifactReviewRepository {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Hosted artifact review authority requires PostgreSQL.')
    this.#db = db
  }

  async readSubmission(submissionId: string): Promise<Readonly<{ submission: ArtifactReviewSubmission; scans: readonly ArtifactScanReport[] }> | null> {
    const result = await this.#db<JsonRow>`select submission_json as value_json from fuma_artifact_review_submissions_v2 where submission_id=${submissionId}`
    if (!result.rows[0]) return null
    const submission = parse<ArtifactReviewSubmission>(ArtifactReviewSubmissionSchema, result.rows[0].value_json, 'stored artifact review submission')
    if (!submission) return null
    const scanRows = await this.#db<JsonRow>`select report_json as value_json from fuma_artifact_scan_reports_v2 where submission_id=${submissionId} order by scanner_id,scanner_version`
    const scans = scanRows.rows.map((row) => parse<ArtifactScanReport>(ArtifactScanReportSchema, row.value_json, 'stored artifact scan report'))
    if (scans.some((scan) => scan === null)) return null
    return Object.freeze({ submission, scans: Object.freeze(scans as ArtifactScanReport[]) })
  }

  async insertSubmission(submission: ArtifactReviewSubmission, scans: readonly ArtifactScanReport[]): Promise<boolean> {
    return await this.#db.transaction(async (db) => {
      const inserted = await db`
        insert into fuma_artifact_review_submissions_v2 (
          submission_id,artifact_id,artifact_kind,package_id,exact_version,content_hash_sha256,submitter_id,
          baseline_submission_id,metadata_hash_sha256,scan_state,submission_json,submitted_at
        ) values (
          ${submission.submissionId},${submission.artifact.artifactId},${submission.artifact.kind},${submission.artifact.packageId},${submission.artifact.exactVersion},${submission.artifact.contentHashSha256},${submission.submitterId},
          ${submission.baselineSubmissionId},${submission.metadataHashSha256},${submission.scanState},${json(submission)}::text::jsonb,${submission.submittedAt}
        ) on conflict do nothing
      `
      if (inserted.rowCount !== 1) return false
      for (const scan of scans) {
        const scanResult = await db`
          insert into fuma_artifact_scan_reports_v2 (
            scan_id,submission_id,artifact_id,artifact_kind,content_hash_sha256,scanner_id,scanner_version,state,report_json,scanned_at
          ) values (
            ${scan.reportHashSha256},${scan.submissionId},${scan.artifactId},${scan.artifactKind},${scan.contentHashSha256},${scan.scannerId},${scan.scannerVersion},${scan.state},${json(scan)}::text::jsonb,${scan.scannedAt}
          )
        `
        if (scanResult.rowCount !== 1) throw new Error('Artifact scan report insertion failed.')
        for (const finding of scan.findings) {
          await db`insert into fuma_artifact_scan_findings_v2 (scan_id,finding_id,severity,code,finding_json) values (${scan.reportHashSha256},${finding.findingId},${finding.severity},${finding.code},${json(finding)}::text::jsonb)`
        }
      }
      return true
    })
  }

  async readDecision(submissionId: string): Promise<ArtifactReviewDecision | null> {
    const result = await this.#db<JsonRow>`select decision_json as value_json from fuma_artifact_review_decisions_v2 where submission_id=${submissionId}`
    return result.rows[0] ? parse<ArtifactReviewDecision>(ArtifactReviewDecisionSchema, result.rows[0].value_json, 'stored artifact review decision') : null
  }

  async insertDecision(decision: ArtifactReviewDecision): Promise<boolean> {
    const signature = decision.signature
    const result = await this.#db`
      insert into fuma_artifact_review_decisions_v2 (
        decision_id,submission_id,artifact_id,content_hash_sha256,reviewer_id,decision,reason,
        signature_key_id,signature_payload_hash_sha256,signature_value,decision_json,decided_at
      ) values (
        ${decision.decisionId},${decision.submissionId},${decision.artifactId},${decision.contentHashSha256},${decision.reviewerId},${decision.decision},${decision.reason},
        ${signature?.keyId ?? null},${signature?.payloadHashSha256 ?? null},${signature?.value ?? null},${json(decision)}::text::jsonb,${decision.decidedAt}
      ) on conflict do nothing
    `
    return result.rowCount === 1
  }

  async readRevocation(decisionId: string): Promise<ArtifactReviewRevocation | null> {
    const result = await this.#db<JsonRow>`select revocation_json as value_json from fuma_artifact_review_revocations_v2 where decision_id=${decisionId}`
    return result.rows[0] ? parse<ArtifactReviewRevocation>(ArtifactReviewRevocationSchema, result.rows[0].value_json, 'stored artifact review revocation') : null
  }

  async insertRevocation(revocation: ArtifactReviewRevocation): Promise<boolean> {
    const result = await this.#db`
      insert into fuma_artifact_review_revocations_v2 (revocation_id,decision_id,submission_id,artifact_id,actor_id,reason,revocation_json,revoked_at)
      values (${revocation.revocationId},${revocation.decisionId},${revocation.submissionId},${revocation.artifactId},${revocation.actorId},${revocation.reason},${json(revocation)}::text::jsonb,${revocation.revokedAt})
      on conflict do nothing
    `
    return result.rowCount === 1
  }

  async listApproved(limit: number): Promise<readonly ApprovedArtifactReview[]> {
    const result = await this.#db<SubmissionIdRow>`
      select decision.submission_id
      from fuma_artifact_review_decisions_v2 decision
      left join fuma_artifact_review_revocations_v2 revocation on revocation.decision_id=decision.decision_id
      where decision.decision='approved' and revocation.decision_id is null
      order by decision.decided_at desc,decision.submission_id
      limit ${limit}
    `
    const output: ApprovedArtifactReview[] = []
    for (const row of result.rows) {
      const record = await this.readSubmission(row.submission_id)
      const decision = await this.readDecision(row.submission_id)
      if (!record || !decision) continue
      const approved = parse<ApprovedArtifactReview>(ApprovedArtifactReviewSchema, { submission: record.submission, scans: record.scans, decision, revocation: null }, 'stored approved artifact review')
      if (approved) output.push(approved)
    }
    return Object.freeze(output)
  }
}
