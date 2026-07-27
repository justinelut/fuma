import { describe, expect, it } from 'bun:test'
import { authorizePromotion, createPairedReleaseManifest, decideLaunch, verifyPublicWebDeploymentSeam, type PairedReleaseManifest } from '../../src'

const hash = 'a'.repeat(64)
const release: PairedReleaseManifest = createPairedReleaseManifest({ schemaVersion: 3, sourceSha: hash, lockHashSha256: hash, migrationHighWaterMark: '000044_publication_lifecycle_metadata', runtimeImage: `ghcr.io/corebunch/fuma-runtime@sha256:${'b'.repeat(64)}`, runtimeImageSourceSha: hash, webImage: `ghcr.io/corebunch/fuma-web@sha256:${'c'.repeat(64)}`, webImageSourceSha: hash, architectures: ['linux/amd64', 'linux/arm64'], runtimeIndexHashSha256: '4'.repeat(64), webIndexHashSha256: '5'.repeat(64), runtimeScanReportHashSha256: '6'.repeat(64), webScanReportHashSha256: '7'.repeat(64), runtimeSbomHashSha256: 'd'.repeat(64), webSbomHashSha256: 'e'.repeat(64), runtimeProvenanceHashSha256: 'f'.repeat(64), webProvenanceHashSha256: '1'.repeat(64), runtimeSignatureVerificationHashSha256: '8'.repeat(64), webSignatureVerificationHashSha256: '9'.repeat(64), runtimeSmokeEvidenceHashSha256: '2'.repeat(64), webSmokeEvidenceHashSha256: '3'.repeat(64), publicationPlanHashSha256: 'b'.repeat(64) })
const smoke = { releaseSourceSha: hash, migrationHighWaterMark: '000044_publication_lifecycle_metadata', exactHosts: ['fuma.co.ke', 'auth.fuma.co.ke', 'app.fuma.co.ke', 'admin.fuma.co.ke', '*.fuma.co.ke'], unknownHostDenied: true, parentDomainCookieAbsent: true, backupAgeSeconds: 1_000, restoreCountsHashSha256: hash, restoreObjectsHashSha256: hash, rpoSeconds: 21_600, rtoSeconds: 7_200, observedRestoreSeconds: 3_000 }
const approvals = ['platform', 'security', 'finance', 'public-web', 'legal-accessibility', 'incident-command'].map((role, index) => ({ role, actorId: `actor-${index}`, evidenceHashSha256: (index + 1).toString(16).repeat(64), signedAt: '2026-07-26T08:00:00Z' }))

describe('FUMA-064/067/074 fault containment contracts', () => {
  it('documents independent failure domains and idempotent recovery keys', () => {
    const faults = [
      { fault: 'ai-provider-abort', recovery: 'refund-reservation', idempotency: 'reservation-id' },
      { fault: 'plugin-worker-crash', recovery: 'suspend-installation-only', idempotency: 'installation-generation' },
      { fault: 'transfer-crash-before-saga', recovery: 'reuse-command', idempotency: 'handoff-command-key' },
      { fault: 'transfer-crash-after-saga', recovery: 'resume-existing-saga', idempotency: 'transfer-id' },
    ]
    expect(new Set(faults.map(({ idempotency }) => idempotency)).size).toBe(faults.length)
    expect(faults.find(({ fault }) => fault === 'plugin-worker-crash')?.recovery).not.toContain('all-sites')
  })
})

describe('FUMA-080/081/085 deployment and DR faults', () => {
  it('blocks mixed migration, stale backup, failed restore, unknown host, and shared-cookie promotion', () => {
    const failures = [
      { ...smoke, migrationHighWaterMark: '000016_structured_imports' },
      { ...smoke, backupAgeSeconds: 30_000 },
      { ...smoke, observedRestoreSeconds: 8_000 },
      { ...smoke, unknownHostDenied: false },
      { ...smoke, parentDomainCookieAbsent: false },
    ]
    failures.forEach((failure) => expect(() => authorizePromotion(release, failure)).toThrow('blocks promotion'))
  })

  it('aborts launch on public canary failure while preserving independent product continuity', () => {
    const seam = { releaseSourceSha: hash, runtimeProjectionVersion: 2, webContractVersion: 2, privateRuntimeAudience: 'fuma-public-web', canonicalHost: 'fuma.co.ke', canaryPercent: 10, publicRollbackIndependent: true, productTenantContinuityRequired: true }
    expect(verifyPublicWebDeploymentSeam(seam, release).publicRollbackIndependent).toBe(true)
    const gate = { release, migrationPassed: true, restorePassed: true, hostIsolationPassed: true, publicWebPassed: false, securityPassed: true, accessibilityPassed: true, providerEvidenceCurrent: true, grossMarginBasisPoints: 7_200, variableCogsBasisPoints: 2_000, approvals }
    expect(decideLaunch(gate)).toBe('abort')
  })
})
