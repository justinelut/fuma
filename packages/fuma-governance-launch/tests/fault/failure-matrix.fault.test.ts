import { describe, expect, it } from 'bun:test'
import { authorizePromotion, createPairedReleaseManifest, decideLaunch, verifyPublicWebDeploymentSeam, type PairedReleaseManifest } from '../../src'
import { pairedReleaseInput } from '../helpers/pairedRelease'

const hash = 'a'.repeat(64)
const release: PairedReleaseManifest = createPairedReleaseManifest(pairedReleaseInput(hash))
const smoke = { releaseSourceSha: hash, migrationHighWaterMark: '000044_publication_lifecycle_metadata', exactHosts: ['trimly.co.ke', 'auth.trimly.co.ke', 'app.trimly.co.ke', 'admin.trimly.co.ke', '*.trimly.co.ke'], unknownHostDenied: true, parentDomainCookieAbsent: true, backupAgeSeconds: 1_000, restoreCountsHashSha256: hash, restoreObjectsHashSha256: hash, rpoSeconds: 21_600, rtoSeconds: 7_200, observedRestoreSeconds: 3_000 }
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
    const seam = { releaseSourceSha: hash, runtimeProjectionVersion: 2, webContractVersion: 2, privateRuntimeAudience: 'fuma-public-web', canonicalHost: 'trimly.co.ke', canaryPercent: 10, publicRollbackIndependent: true, productTenantContinuityRequired: true }
    expect(verifyPublicWebDeploymentSeam(seam, release).publicRollbackIndependent).toBe(true)
    const gate = { release, migrationPassed: true, restorePassed: true, hostIsolationPassed: true, publicWebPassed: false, securityPassed: true, accessibilityPassed: true, providerEvidenceCurrent: true, grossMarginBasisPoints: 7_200, variableCogsBasisPoints: 2_000, approvals }
    expect(decideLaunch(gate)).toBe('abort')
  })
})
