import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { sha256Hex } from '../../../server/fuma/objectStorage'
import type { ArtifactInstallation, ArtifactRelease } from '../../../server/fuma/artifacts'
import {
  ArtifactReviewError,
  ArtifactReviewService,
  ArtifactScannerRegistry,
  Ed25519ArtifactReviewSigner,
  assertPrivateDeclarativeComponentPolicy,
  reviewHash,
  type ApprovedArtifactReview,
  type ArtifactReviewDecision,
  type ArtifactReviewRepository,
  type ArtifactReviewRevocation,
  type ArtifactReviewSubmission,
  type ArtifactScanReport,
  type ReviewArtifactAuthority,
  type ReviewPackageMetadata,
} from '../../../server/fuma/artifactReviews'

const NOW = '2026-07-30T09:00:00.000Z'
const LATER = '2026-07-30T10:00:00.000Z'
function pluginZip(version: string): Uint8Array {
  return zipSync({ 'plugin.json': strToU8(JSON.stringify({ id: 'fuma.customer-payments', name: 'Customer Payments', version, apiVersion: 1, permissions: ['cms.routes', 'cms.storage'], adminPages: [] })) })
}
const ZIP = pluginZip('1.0.0')
const ZIP_V2 = pluginZip('1.0.1')
const BAD = new TextEncoder().encode('not an archive')
const COMPONENT_BAD = new TextEncoder().encode('{}')

function artifact(id: string, bytes: Uint8Array, input: Partial<ArtifactRelease> = {}): ArtifactRelease {
  return {
    schemaVersion: 1, artifactId: id, kind: 'plugin', packageId: 'fuma.customer-payments', exactVersion: '1.0.0',
    executionPolicy: 'plugin-sandbox-worker', objectKey: `artifacts/plugin/fuma.customer-payments/${id}.zip`, mimeType: 'application/zip',
    contentHashSha256: sha256Hex(bytes), sizeBytes: bytes.byteLength, permissions: ['cms.routes', 'cms.storage'],
    provenance: { sourceHashSha256: 'a'.repeat(64), lockHashSha256: 'b'.repeat(64), builderId: 'fixture-builder' }, createdAt: NOW,
    ...input,
  }
}
function metadata(release: ArtifactRelease): ReviewPackageMetadata {
  return {
    dependencies: [], schemas: [],
    evidence: {
      provenanceHashSha256: reviewHash(release.provenance),
      license: { spdx: 'MIT', evidenceHashSha256: 'c'.repeat(64) },
      accessibility: { standard: release.kind === 'plugin' ? 'not-applicable' : 'WCAG2.2-AA', evidenceHashSha256: 'd'.repeat(64) },
      runtimeCompatibility: { runtime: 'fuma-site-runtime', minimumVersion: '1.0.0', evidenceHashSha256: 'e'.repeat(64) },
    },
    public: { id: release.packageId, slug: release.packageId.replaceAll('.', '-'), name: 'Customer Payments', summary: 'Reviewed customer payment collection.', categories: ['payments'], publisherName: 'Fuma', publisherVerified: true, permissionLabels: [...release.permissions], imageUrl: null },
  }
}

class MemoryReviewRepository implements ArtifactReviewRepository {
  readonly submissions = new Map<string, { submission: ArtifactReviewSubmission; scans: readonly ArtifactScanReport[] }>()
  readonly decisions = new Map<string, ArtifactReviewDecision>()
  readonly revocations = new Map<string, ArtifactReviewRevocation>()
  async readSubmission(id: string) { return structuredClone(this.submissions.get(id) ?? null) }
  async insertSubmission(submission: ArtifactReviewSubmission, scans: readonly ArtifactScanReport[]) { if (this.submissions.has(submission.submissionId)) return false; this.submissions.set(submission.submissionId, structuredClone({ submission, scans })); return true }
  async readDecision(submissionId: string) { return structuredClone(this.decisions.get(submissionId) ?? null) }
  async insertDecision(value: ArtifactReviewDecision) { if (this.decisions.has(value.submissionId)) return false; this.decisions.set(value.submissionId, structuredClone(value)); return true }
  async readRevocation(decisionId: string) { return structuredClone(this.revocations.get(decisionId) ?? null) }
  async insertRevocation(value: ArtifactReviewRevocation) { if (this.revocations.has(value.decisionId)) return false; this.revocations.set(value.decisionId, structuredClone(value)); return true }
  async listApproved() {
    const output: ApprovedArtifactReview[] = []
    for (const [submissionId, decision] of this.decisions) {
      const record = this.submissions.get(submissionId)
      if (record && decision.decision === 'approved' && !this.revocations.has(decision.decisionId)) output.push({ ...structuredClone(record), decision: structuredClone(decision), revocation: null })
    }
    return output
  }
}
class MemoryArtifacts implements ReviewArtifactAuthority {
  readonly releases = new Map<string, { artifact: ArtifactRelease; bytes: Uint8Array }>()
  readonly installations: ArtifactInstallation[] = []
  add(artifact: ArtifactRelease, bytes: Uint8Array) { this.releases.set(artifact.artifactId, { artifact, bytes }) }
  async readVerifiedArtifact(id: string) { const value = this.releases.get(id); if (!value) throw new ArtifactReviewError('not-found', 'Missing artifact.'); return { artifact: structuredClone(value.artifact), bytes: value.bytes.slice() } }
  async install(raw: unknown) { const value = structuredClone(raw) as ArtifactInstallation; this.installations.push(value); return value }
}
function harness() {
  const repository = new MemoryReviewRepository()
  const artifacts = new MemoryArtifacts()
  const keys = generateKeyPairSync('ed25519')
  const signer = new Ed25519ArtifactReviewSigner({ keyId: 'fixture-review-key', privateKeyPem: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), publicKeyPem: keys.publicKey.export({ format: 'pem', type: 'spki' }).toString() })
  return { repository, artifacts, service: new ArtifactReviewService({ repository, artifacts, scanners: new ArtifactScannerRegistry(), signer }) }
}
function submit(service: ArtifactReviewService, release: ArtifactRelease, submissionId: string, submitterId = 'publisher-a') {
  return service.submit({ submissionId, artifactId: release.artifactId, contentHashSha256: release.contentHashSha256, submitterId, baselineSubmissionId: null, metadata: metadata(release), submittedAt: NOW })
}
function installation(release: ArtifactRelease): ArtifactInstallation {
  return { platformId: 'fuma', organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'site-a', ownerKey: 'owner-a', ownerGeneration: 3, installationId: 'install-a', artifactId: release.artifactId, artifactKind: release.kind, packageId: release.packageId, exactVersion: release.exactVersion, contentHashSha256: release.contentHashSha256, executionPolicy: release.executionPolicy, settingsObjectKey: null, secret: null, state: 'active', workerGeneration: release.kind === 'plugin' ? 1 : null, quota: { storageBytes: 100, scheduledJobs: release.kind === 'plugin' ? 1 : 0, callsPerMinute: 10 }, previousArtifactId: null, version: 1, installedAt: LATER, updatedAt: LATER }
}

describe('FUMA-068 artifact review, signing, and marketplace authority', () => {
  test('rejects malformed plugin and SITE-007 component-pack releases before approval', async () => {
    const value = harness()
    const badPlugin = artifact('bad-plugin', BAD)
    const badComponent = artifact('bad-component', COMPONENT_BAD, { kind: 'component-pack', packageId: 'bad-components', executionPolicy: 'component-declarative', objectKey: 'artifacts/component-pack/bad-components/1.0.0.json', mimeType: 'application/json', permissions: [] })
    value.artifacts.add(badPlugin, BAD); value.artifacts.add(badComponent, COMPONENT_BAD)
    expect((await submit(value.service, badPlugin, 'submission-bad-plugin')).submission.scanState).toBe('rejected')
    expect((await submit(value.service, badComponent, 'submission-bad-component')).submission.scanState).toBe('rejected')
    await expect(value.service.decide({ decisionId: 'decision-bad', submissionId: 'submission-bad-plugin', reviewerId: 'reviewer-a', decision: 'approved', reason: 'No', decidedAt: LATER })).rejects.toMatchObject({ code: 'scan-denied' })
  })

  test('denies mutation, self-approval, unreviewed install, and permission escalation', async () => {
    const value = harness(); const release = artifact('plugin-v1', ZIP); value.artifacts.add(release, ZIP)
    await submit(value.service, release, 'submission-v1')
    await expect(value.service.submit({ submissionId: 'submission-v1', artifactId: release.artifactId, contentHashSha256: 'f'.repeat(64), submitterId: 'publisher-a', baselineSubmissionId: null, metadata: metadata(release), submittedAt: NOW })).rejects.toMatchObject({ code: 'artifact-mutated' })
    await expect(value.service.decide({ decisionId: 'decision-self', submissionId: 'submission-v1', reviewerId: 'publisher-a', decision: 'approved', reason: 'Self', decidedAt: LATER })).rejects.toMatchObject({ code: 'self-approval' })
    await expect(value.service.install({ submissionId: 'missing-review', installation: installation(release), grantedPermissions: release.permissions })).rejects.toMatchObject({ code: 'decision-denied' })
    await value.service.decide({ decisionId: 'decision-v1', submissionId: 'submission-v1', reviewerId: 'reviewer-a', decision: 'approved', reason: 'Clean evidence', decidedAt: LATER })
    await expect(value.service.install({ submissionId: 'submission-v1', installation: installation(release), grantedPermissions: ['cms.routes'] })).rejects.toMatchObject({ code: 'permission-escalation' })
  })

  test('fails, fixes, approves, signs, lists, installs, and revokes one exact release', async () => {
    const value = harness()
    const failed = artifact('plugin-failed', BAD, { exactVersion: '1.0.0' })
    const fixed = artifact('plugin-fixed', ZIP_V2, { exactVersion: '1.0.1', objectKey: 'artifacts/plugin/fuma.customer-payments/1.0.1.zip' })
    value.artifacts.add(failed, BAD); value.artifacts.add(fixed, ZIP_V2)
    expect((await submit(value.service, failed, 'submission-failed')).submission.scanState).toBe('rejected')
    await submit(value.service, fixed, 'submission-fixed')
    const decision = await value.service.decide({ decisionId: 'decision-fixed', submissionId: 'submission-fixed', reviewerId: 'reviewer-a', decision: 'approved', reason: 'All deterministic scans are clean.', decidedAt: LATER })
    expect(decision.signature?.algorithm).toBe('ed25519')
    expect((await value.service.marketplace())[0]).toMatchObject({ submissionId: 'submission-fixed', artifactId: 'plugin-fixed', reviewState: 'signed-current', signatureKeyId: 'fixture-review-key' })
    await value.service.install({ submissionId: 'submission-fixed', installation: installation(fixed), grantedPermissions: fixed.permissions })
    expect(value.artifacts.installations).toHaveLength(1)
    await value.service.revoke({ revocationId: 'revocation-fixed', decisionId: decision.decisionId, submissionId: decision.submissionId, artifactId: decision.artifactId, actorId: 'reviewer-b', reason: 'Security regression discovered.', revokedAt: '2026-07-30T11:00:00.000Z' })
    expect(await value.service.marketplace()).toEqual([])
    await expect(value.service.install({ submissionId: 'submission-fixed', installation: installation(fixed), grantedPermissions: fixed.permissions })).rejects.toMatchObject({ code: 'revoked' })
  })

  test('rejects a bad signature and permits only site-scoped unprivileged private declarative bypass', async () => {
    const value = harness(); const release = artifact('plugin-signed', ZIP); value.artifacts.add(release, ZIP)
    await submit(value.service, release, 'submission-signed')
    const decision = await value.service.decide({ decisionId: 'decision-signed', submissionId: 'submission-signed', reviewerId: 'reviewer-a', decision: 'approved', reason: 'Clean.', decidedAt: LATER })
    value.repository.decisions.set(decision.submissionId, { ...decision, signature: decision.signature ? { ...decision.signature, value: `${decision.signature.value[0] === 'A' ? 'B' : 'A'}${decision.signature.value.slice(1)}` } : null })
    await expect(value.service.verify('submission-signed')).rejects.toMatchObject({ code: 'signature-denied' })
    expect(assertPrivateDeclarativeComponentPolicy({ distribution: 'private', executionPolicy: 'component-declarative', ownerKey: 'owner-a', siteId: 'site-a', permissions: ['content.public.read'], persistedExecutableJsx: false, dynamicTenantServerImport: false }, { ownerKey: 'owner-a', siteId: 'site-a' }).distribution).toBe('private')
    expect(() => assertPrivateDeclarativeComponentPolicy({ distribution: 'private', executionPolicy: 'component-declarative', ownerKey: 'owner-a', siteId: 'site-a', permissions: ['network.fetch'], persistedExecutableJsx: false, dynamicTenantServerImport: false }, { ownerKey: 'owner-a', siteId: 'site-a' })).toThrow('privileged')
    expect(() => assertPrivateDeclarativeComponentPolicy({ distribution: 'private', executionPolicy: 'component-declarative', ownerKey: 'owner-b', siteId: 'site-a', permissions: [], persistedExecutableJsx: false, dynamicTenantServerImport: false }, { ownerKey: 'owner-a', siteId: 'site-a' })).toThrow('scope')
  })
})
