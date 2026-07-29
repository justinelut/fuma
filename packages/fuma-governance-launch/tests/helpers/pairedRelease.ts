import type { PairedReleaseManifestInput } from '../../src'

export const TEST_SOURCE_SHA = 'a'.repeat(40)
const hash = (character: string) => character.repeat(64)

export function pairedReleaseInput(sourceSha = TEST_SOURCE_SHA): PairedReleaseManifestInput {
  return {
    schemaVersion: 4,
    sourceSha,
    lockHashSha256: hash('b'),
    migrationHighWaterMark: '000044_publication_lifecycle_metadata',
    runtimeImage: `ghcr.io/corebunch/fuma-runtime@sha256:${hash('c')}`,
    runtimeImageSourceSha: sourceSha,
    webImage: `ghcr.io/corebunch/fuma-web@sha256:${hash('d')}`,
    webImageSourceSha: sourceSha,
    siteRuntimeImage: `ghcr.io/corebunch/fuma-site-runtime@sha256:${hash('e')}`,
    siteRuntimeImageSourceSha: sourceSha,
    architectures: ['linux/arm64'],
    runtimeIndexHashSha256: hash('1'),
    webIndexHashSha256: hash('2'),
    siteRuntimeIndexHashSha256: hash('3'),
    runtimeScanReportHashSha256: hash('4'),
    webScanReportHashSha256: hash('5'),
    siteRuntimeScanReportHashSha256: hash('6'),
    runtimeSbomHashSha256: hash('7'),
    webSbomHashSha256: hash('8'),
    siteRuntimeSbomHashSha256: hash('9'),
    runtimeProvenanceHashSha256: hash('a'),
    webProvenanceHashSha256: hash('b'),
    siteRuntimeProvenanceHashSha256: hash('c'),
    runtimeSignatureVerificationHashSha256: hash('d'),
    webSignatureVerificationHashSha256: hash('e'),
    siteRuntimeSignatureVerificationHashSha256: hash('f'),
    runtimeSmokeEvidenceHashSha256: hash('1'),
    webSmokeEvidenceHashSha256: hash('2'),
    siteRuntimeSmokeEvidenceHashSha256: hash('3'),
    publicationPlanHashSha256: hash('4'),
  }
}
