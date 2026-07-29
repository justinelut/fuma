#!/usr/bin/env bun
import { createPairedReleaseManifest, verifyPairedRelease } from '../src'

const sourceSha = '1'.repeat(40)
const hash = (value: string) => value.repeat(64)

export function runPairedReleaseRepositoryDemo() {
  const manifest = createPairedReleaseManifest({
    schemaVersion: 4,
    sourceSha,
    lockHashSha256: hash('2'),
    migrationHighWaterMark: '000044_publication_lifecycle_metadata',
    runtimeImage: `ghcr.io/corebunch/fuma-runtime@sha256:${hash('3')}`,
    runtimeImageSourceSha: sourceSha,
    webImage: `ghcr.io/corebunch/fuma-web@sha256:${hash('4')}`,
    webImageSourceSha: sourceSha,
    siteRuntimeImage: `ghcr.io/corebunch/fuma-site-runtime@sha256:${hash('5')}`,
    siteRuntimeImageSourceSha: sourceSha,
    architectures: ['linux/arm64'],
    runtimeIndexHashSha256: hash('6'),
    webIndexHashSha256: hash('7'),
    siteRuntimeIndexHashSha256: hash('8'),
    runtimeScanReportHashSha256: hash('9'),
    webScanReportHashSha256: hash('a'),
    siteRuntimeScanReportHashSha256: hash('b'),
    runtimeSbomHashSha256: hash('c'),
    webSbomHashSha256: hash('d'),
    siteRuntimeSbomHashSha256: hash('e'),
    runtimeProvenanceHashSha256: hash('f'),
    webProvenanceHashSha256: hash('1'),
    siteRuntimeProvenanceHashSha256: hash('2'),
    runtimeSignatureVerificationHashSha256: hash('3'),
    webSignatureVerificationHashSha256: hash('4'),
    siteRuntimeSignatureVerificationHashSha256: hash('5'),
    runtimeSmokeEvidenceHashSha256: hash('6'),
    webSmokeEvidenceHashSha256: hash('7'),
    siteRuntimeSmokeEvidenceHashSha256: hash('8'),
    publicationPlanHashSha256: hash('9'),
  })
  verifyPairedRelease(manifest)

  const rejected = {
    mixedSha: rejects(() => verifyPairedRelease({ ...manifest, siteRuntimeImageSourceSha: 'a'.repeat(40) })),
    duplicateDigest: rejects(() => verifyPairedRelease({ ...manifest, siteRuntimeImage: `ghcr.io/corebunch/fuma-site-runtime@sha256:${hash('3')}` })),
    wrongArchitecture: rejects(() => verifyPairedRelease({ ...manifest, architectures: ['linux/amd64'] })),
    tamper: rejects(() => verifyPairedRelease({ ...manifest, migrationHighWaterMark: '000043_tampered' })),
  }
  if (Object.values(rejected).some((value) => !value)) throw new Error('Repository rejection demo did not fail closed')
  return Object.freeze({
    mode: 'deterministic-repository-only',
    externalEvidence: false,
    sourceSha: manifest.sourceSha,
    architecture: manifest.architectures[0],
    imageCount: 3,
    manifestHashSha256: manifest.manifestHashSha256,
    rejected: Object.freeze(rejected),
  })
}

function rejects(operation: () => unknown): boolean {
  try {
    operation()
    return false
  } catch {
    return true
  }
}

if (import.meta.main) process.stdout.write(`${JSON.stringify(runPairedReleaseRepositoryDemo())}\n`)
