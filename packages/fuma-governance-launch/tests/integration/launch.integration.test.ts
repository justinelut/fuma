import { describe, expect, it } from 'bun:test'
import { authorizePromotion, createPairedReleaseManifest, decideLaunch, tenantSafeTelemetry, validateCapacityEconomics, verifyPairedRelease, verifyPublicWebDeploymentSeam, type PairedReleaseManifest } from '../../src'

const hash = 'a'.repeat(64)
const release: PairedReleaseManifest = createPairedReleaseManifest({ schemaVersion: 3, sourceSha: hash, lockHashSha256: hash, migrationHighWaterMark: '000044_publication_lifecycle_metadata', runtimeImage: `ghcr.io/corebunch/fuma-runtime@sha256:${'b'.repeat(64)}`, runtimeImageSourceSha: hash, webImage: `ghcr.io/corebunch/fuma-web@sha256:${'c'.repeat(64)}`, webImageSourceSha: hash, architectures: ['linux/amd64', 'linux/arm64'], runtimeIndexHashSha256: '4'.repeat(64), webIndexHashSha256: '5'.repeat(64), runtimeScanReportHashSha256: '6'.repeat(64), webScanReportHashSha256: '7'.repeat(64), runtimeSbomHashSha256: 'd'.repeat(64), webSbomHashSha256: 'e'.repeat(64), runtimeProvenanceHashSha256: 'f'.repeat(64), webProvenanceHashSha256: '1'.repeat(64), runtimeSignatureVerificationHashSha256: '8'.repeat(64), webSignatureVerificationHashSha256: '9'.repeat(64), runtimeSmokeEvidenceHashSha256: '2'.repeat(64), webSmokeEvidenceHashSha256: '3'.repeat(64), publicationPlanHashSha256: 'b'.repeat(64) })
const approvalRoles = ['platform', 'security', 'finance', 'public-web', 'legal-accessibility', 'incident-command'] as const
const approvals = approvalRoles.map((role, index) => ({ role, actorId: `actor-${index}`, evidenceHashSha256: (index + 1).toString(16).repeat(64), signedAt: '2026-07-26T08:00:00Z' }))

describe('FUMA-078 immutable ARM64 paired release', () => {
  it('accepts distinct digest-only runtime and public-web images from one SHA', () => {
    expect(verifyPairedRelease(release)).toMatchObject({ architectures: ['linux/amd64', 'linux/arm64'], sourceSha: hash })
    const fortyCharacterSource = '4'.repeat(40)
    const fortyCharacterRelease = createPairedReleaseManifest({ ...release, schemaVersion: 3, sourceSha: fortyCharacterSource, runtimeImageSourceSha: fortyCharacterSource, webImageSourceSha: fortyCharacterSource })
    expect(verifyPairedRelease(fortyCharacterRelease).sourceSha).toHaveLength(40)
    expect(() => verifyPairedRelease({ ...release, runtimeImage: release.webImage })).toThrow('/runtimeImage')
    expect(() => verifyPairedRelease({ ...release, runtimeImageSourceSha: '5'.repeat(64) })).toThrow('source revisions must match')
    expect(() => verifyPairedRelease({ ...release, webSmokeEvidenceHashSha256: '6'.repeat(64) })).toThrow('manifest hash does not match')
  })
})

describe('FUMA-079/080 Oracle routing, migration, backup, restore, smoke', () => {
  it('blocks promotion without exact hosts, cookie isolation, current backup, and signed-RTO restore', () => {
    const evidence = { releaseSourceSha: hash, migrationHighWaterMark: '000044_publication_lifecycle_metadata', exactHosts: ['fuma.co.ke', 'auth.fuma.co.ke', 'app.fuma.co.ke', 'admin.fuma.co.ke', '*.fuma.co.ke'], unknownHostDenied: true, parentDomainCookieAbsent: true, backupAgeSeconds: 1_000, restoreCountsHashSha256: hash, restoreObjectsHashSha256: hash, rpoSeconds: 21_600, rtoSeconds: 7_200, observedRestoreSeconds: 3_000 }
    expect(authorizePromotion(release, evidence).sourceSha).toBe(hash)
    expect(() => authorizePromotion(release, { ...evidence, unknownHostDenied: false })).toThrow('blocks promotion')
  })
})

describe('FUMA-081 tenant-safe observability', () => {
  it('allowlists low-cardinality fields and redacts PII/secrets', () => {
    const fields = tenantSafeTelemetry({ service: 'public-web', status: 200, siteId: 'opaque-site', email: 'person@example.test', authorization: 'Bearer secret', rawBody: 'secret' }, new Set(['service', 'status', 'siteId', 'email', 'authorization', 'rawBody']))
    expect(fields).toEqual({ service: 'public-web', status: 200, siteId: 'opaque-site' })
  })
})

describe('FUMA-083 capacity and economics', () => {
  it('requires ARM64 budgets, isolation, complete cost allocation, <=30% variable COGS, and >=70% margin', () => {
    const economics = validateCapacityEconomics({ arm64: true, p95Milliseconds: 250, p99Milliseconds: 800, p95BudgetMilliseconds: 300, p99BudgetMilliseconds: 1_000, noisyNeighborRatioBasisPoints: 1_050, customerRevenueMinor: 1_000_000, variableCogsMinor: 200_000, fixedAndSharedCogsMinor: 80_000, unallocatedMaterialCostMinor: 0, internalShadowCostMinor: 0 })
    expect(economics).toEqual({ variableCogsBasisPoints: 2_000, grossMarginBasisPoints: 7_200 })
    expect(() => validateCapacityEconomics({ arm64: true, p95Milliseconds: 250, p99Milliseconds: 800, p95BudgetMilliseconds: 300, p99BudgetMilliseconds: 1_000, noisyNeighborRatioBasisPoints: 1_050, customerRevenueMinor: 1_000_000, variableCogsMinor: 200_000, fixedAndSharedCogsMinor: 80_000, unallocatedMaterialCostMinor: 1, internalShadowCostMinor: 0 })).toThrow('threshold')
  })
})

describe('FUMA-085 unified launch and TRACKER-086 public-web seam', () => {
  it('declares only with every objective gate and six independent signed roles', () => {
    const gate = { release, migrationPassed: true, restorePassed: true, hostIsolationPassed: true, publicWebPassed: true, securityPassed: true, accessibilityPassed: true, providerEvidenceCurrent: true, grossMarginBasisPoints: 7_200, variableCogsBasisPoints: 2_000, approvals }
    expect(decideLaunch(gate)).toBe('declare')
    expect(decideLaunch({ ...gate, publicWebPassed: false })).toBe('abort')
    expect(decideLaunch({ ...gate, approvals: approvals.slice(0, 5) })).toBe('abort')
  })
  it('binds private projections and independent public rollback to the paired SHA', () => {
    const seam = { releaseSourceSha: hash, runtimeProjectionVersion: 3, webContractVersion: 3, privateRuntimeAudience: 'fuma-public-web', canonicalHost: 'fuma.co.ke', canaryPercent: 10, publicRollbackIndependent: true, productTenantContinuityRequired: true }
    expect(verifyPublicWebDeploymentSeam(seam, release).canonicalHost).toBe('fuma.co.ke')
    expect(() => verifyPublicWebDeploymentSeam({ ...seam, releaseSourceSha: 'd'.repeat(64) }, release)).toThrow('incompatible')
  })
})
