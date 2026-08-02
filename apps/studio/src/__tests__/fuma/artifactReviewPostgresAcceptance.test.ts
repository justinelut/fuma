import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { createPostgresClient } from '../../../server/db/postgres'
import { artifactReviewMarketplaceMigration } from '../../../server/fuma/db/migrations/000071_artifact_review_marketplace'
import { sha256Hex } from '../../../server/fuma/objectStorage'
import type { ArtifactInstallation, ArtifactRelease } from '../../../server/fuma/artifacts'
import {
  ArtifactReviewError,
  ArtifactReviewService,
  ArtifactScannerRegistry,
  Ed25519ArtifactReviewSigner,
  PostgresArtifactReviewRepository,
  reviewHash,
  type ReviewArtifactAuthority,
  type ReviewPackageMetadata,
} from '../../../server/fuma/artifactReviews'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = '2026-07-30T09:00:00.000Z'
const LATER = '2026-07-30T10:00:00.000Z'
const ZIP = zipSync({ 'plugin.json': strToU8(JSON.stringify({ id: 'fuma.customer-payments', name: 'Customer Payments', version: '1.0.0', apiVersion: 1, permissions: ['cms.routes', 'cms.storage'], adminPages: [] })) })
const BAD = new TextEncoder().encode('not-a-plugin-archive')
const quote = (value: string) => { if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe schema.'); return `"${value}"` }
const scoped = (connection: string, schema: string) => { const url = new URL(connection); url.searchParams.set('options', `-c search_path=${schema},public`); return url.toString() }

const release: ArtifactRelease = {
  schemaVersion: 1, artifactId: 'artifact-pg-v1', kind: 'plugin', packageId: 'fuma.customer-payments', exactVersion: '1.0.0',
  executionPolicy: 'plugin-sandbox-worker', objectKey: 'artifacts/plugin/fuma.customer-payments/1.0.0.zip', mimeType: 'application/zip',
  contentHashSha256: sha256Hex(ZIP), sizeBytes: ZIP.byteLength, permissions: ['cms.routes', 'cms.storage'],
  provenance: { sourceHashSha256: 'a'.repeat(64), lockHashSha256: 'b'.repeat(64), builderId: 'native-pg' }, createdAt: NOW,
}
const badRelease: ArtifactRelease = {
  ...release,
  artifactId: 'artifact-pg-bad',
  exactVersion: '0.9.0',
  objectKey: 'artifacts/plugin/fuma.customer-payments/0.9.0.zip',
  contentHashSha256: sha256Hex(BAD),
  sizeBytes: BAD.byteLength,
}
const metadata: ReviewPackageMetadata = {
  dependencies: [], schemas: [], evidence: {
    provenanceHashSha256: reviewHash(release.provenance), license: { spdx: 'MIT', evidenceHashSha256: 'c'.repeat(64) },
    accessibility: { standard: 'not-applicable', evidenceHashSha256: 'd'.repeat(64) },
    runtimeCompatibility: { runtime: 'fuma-site-runtime', minimumVersion: '1.0.0', evidenceHashSha256: 'e'.repeat(64) },
  },
  public: { id: 'customer-payments', slug: 'customer-payments', name: 'Customer Payments', summary: 'Reviewed customer payments.', categories: ['payments'], publisherName: 'Fuma', publisherVerified: true, permissionLabels: ['Collect payments'], imageUrl: null },
}
class Artifacts implements ReviewArtifactAuthority {
  readonly installations: ArtifactInstallation[] = []
  async readVerifiedArtifact(id: string) {
    if (id === release.artifactId) return { artifact: release, bytes: ZIP }
    if (id === badRelease.artifactId) return { artifact: badRelease, bytes: BAD }
    throw new ArtifactReviewError('not-found', 'Missing artifact.')
  }
  async install(raw: unknown) { const value = raw as ArtifactInstallation; this.installations.push(value); return value }
}

async function createPrerequisite(db: ReturnType<typeof createPostgresClient>) {
  await db.unsafe(`
    create table fuma_artifact_releases_v2 (
      artifact_id text primary key, artifact_kind text not null check (artifact_kind in ('plugin','component-pack')),
      package_id text not null, exact_version text not null, execution_policy text not null,
      object_key text not null unique, mime_type text not null, content_hash_sha256 text not null,
      size_bytes bigint not null, permissions_json jsonb not null, provenance_json jsonb not null,
      artifact_json jsonb not null, created_at timestamptz not null
    );
  `)
  for (const artifact of [release, badRelease]) await db`insert into fuma_artifact_releases_v2 (
    artifact_id,artifact_kind,package_id,exact_version,execution_policy,object_key,mime_type,content_hash_sha256,
    size_bytes,permissions_json,provenance_json,artifact_json,created_at
  ) values (
    ${artifact.artifactId},${artifact.kind},${artifact.packageId},${artifact.exactVersion},${artifact.executionPolicy},${artifact.objectKey},${artifact.mimeType},${artifact.contentHashSha256},
    ${artifact.sizeBytes},${JSON.stringify(artifact.permissions)}::text::jsonb,${JSON.stringify(artifact.provenance)}::text::jsonb,${JSON.stringify(artifact)}::text::jsonb,${artifact.createdAt}
  )`
}

describe('FUMA-068 optional native PostgreSQL acceptance', () => {
  test.skipIf(!postgresUrl)('applies 000071 and preserves immutable signed review and revocation evidence', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_reviews_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await createPrerequisite(db)
      await db.unsafe(artifactReviewMarketplaceMigration.sql)
      const repository = new PostgresArtifactReviewRepository(db)
      const keys = generateKeyPairSync('ed25519')
      const service = new ArtifactReviewService({
        repository, artifacts: new Artifacts(), scanners: new ArtifactScannerRegistry(),
        signer: new Ed25519ArtifactReviewSigner({ keyId: 'native-pg-key', privateKeyPem: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), publicKeyPem: keys.publicKey.export({ format: 'pem', type: 'spki' }).toString() }),
      })
      const rejected = await service.submit({ submissionId: 'submission-pg-bad', artifactId: badRelease.artifactId, contentHashSha256: badRelease.contentHashSha256, submitterId: 'publisher-pg', baselineSubmissionId: null, metadata, submittedAt: NOW })
      expect(rejected.submission.scanState).toBe('rejected')
      expect(rejected.scans.flatMap(({ findings }) => findings).some(({ severity }) => severity === 'critical')).toBe(true)
      const submitted = await service.submit({ submissionId: 'submission-pg', artifactId: release.artifactId, contentHashSha256: release.contentHashSha256, submitterId: 'publisher-pg', baselineSubmissionId: null, metadata, submittedAt: NOW })
      expect(submitted.submission.scanState).toBe('clean')
      expect(submitted.scans).toHaveLength(2)
      const decision = await service.decide({ decisionId: 'decision-pg', submissionId: 'submission-pg', reviewerId: 'reviewer-pg', decision: 'approved', reason: 'Native PostgreSQL evidence is clean.', decidedAt: LATER })
      expect((await service.verify('submission-pg')).decision.signature?.keyId).toBe('native-pg-key')
      expect(await service.marketplace()).toHaveLength(1)
      await expect(db`update fuma_artifact_review_submissions_v2 set scan_state='rejected' where submission_id='submission-pg'`).rejects.toThrow('append-only')
      await expect(db`delete from fuma_artifact_scan_reports_v2 where submission_id='submission-pg'`).rejects.toThrow('append-only')
      await expect(db`insert into fuma_artifact_review_decisions_v2 (decision_id,submission_id,artifact_id,content_hash_sha256,reviewer_id,decision,reason,decision_json,decided_at) values ('unsigned','submission-pg',${release.artifactId},${release.contentHashSha256},'other','approved','bad','{}'::jsonb,${LATER})`).rejects.toThrow()
      await service.revoke({ revocationId: 'revocation-pg', decisionId: decision.decisionId, submissionId: decision.submissionId, artifactId: decision.artifactId, actorId: 'security-pg', reason: 'Native revocation fixture.', revokedAt: '2026-07-30T11:00:00.000Z' })
      await expect(service.verify('submission-pg')).rejects.toMatchObject({ code: 'revoked' })
      expect(await service.marketplace()).toEqual([])
      const counts = await db<{ submissions: string | number | bigint; scans: string | number | bigint; findings: string | number | bigint; decisions: string | number | bigint; revocations: string | number | bigint }>`
        select (select count(*) from fuma_artifact_review_submissions_v2) as submissions,
          (select count(*) from fuma_artifact_scan_reports_v2) as scans,
          (select count(*) from fuma_artifact_scan_findings_v2) as findings,
          (select count(*) from fuma_artifact_review_decisions_v2) as decisions,
          (select count(*) from fuma_artifact_review_revocations_v2) as revocations
      `
      expect(counts.rows[0] && Object.fromEntries(Object.entries(counts.rows[0]).map(([key, value]) => [key, Number(value)]))).toEqual({ submissions: 2, scans: 4, findings: 1, decisions: 1, revocations: 1 })
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      const leftover = await admin<{ count: string | number | bigint }>`select count(*) as count from pg_namespace where nspname=${schema}`
      expect(Number(leftover.rows[0]?.count ?? 0)).toBe(0)
    }
  }, 120_000)
})
