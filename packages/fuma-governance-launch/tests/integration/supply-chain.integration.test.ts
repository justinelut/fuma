import { describe, expect, it } from 'bun:test'
import {
  createPairedReleaseManifest,
  pairedReleaseManifestHash,
  verifyPairedRelease,
} from '../../src'

const sourceSha = 'a'.repeat(40)
const hash = 'b'.repeat(64)

function candidate() {
  return {
    schemaVersion: 3 as const,
    sourceSha,
    lockHashSha256: hash,
    migrationHighWaterMark: '000044_publication_lifecycle_metadata',
    runtimeImage: `ghcr.io/corebunch/fuma-runtime@sha256:${'c'.repeat(64)}`,
    runtimeImageSourceSha: sourceSha,
    webImage: `ghcr.io/corebunch/fuma-web@sha256:${'d'.repeat(64)}`,
    webImageSourceSha: sourceSha,
    architectures: ['linux/amd64', 'linux/arm64'] as const,
    runtimeIndexHashSha256: '5'.repeat(64),
    webIndexHashSha256: '6'.repeat(64),
    runtimeScanReportHashSha256: '7'.repeat(64),
    webScanReportHashSha256: '8'.repeat(64),
    runtimeSbomHashSha256: 'e'.repeat(64),
    webSbomHashSha256: 'f'.repeat(64),
    runtimeProvenanceHashSha256: '1'.repeat(64),
    webProvenanceHashSha256: '2'.repeat(64),
    runtimeSignatureVerificationHashSha256: '9'.repeat(64),
    webSignatureVerificationHashSha256: 'a'.repeat(64),
    runtimeSmokeEvidenceHashSha256: '3'.repeat(64),
    webSmokeEvidenceHashSha256: '4'.repeat(64),
    publicationPlanHashSha256: 'b'.repeat(64),
  }
}

describe('FUMA-078 paired supply-chain manifest', () => {
  it('binds separate digest-only images and all evidence to one source', () => {
    const manifest = createPairedReleaseManifest(candidate())
    expect(verifyPairedRelease(manifest)).toEqual(manifest)
    expect(manifest.manifestHashSha256).toBe(pairedReleaseManifestHash(candidate()))
    expect(Object.isFrozen(manifest)).toBe(true)
    expect(Object.isFrozen(manifest.architectures)).toBe(true)
  })

  it('rejects mixed source claims and any immutable field tampering', () => {
    const manifest = createPairedReleaseManifest(candidate())
    expect(() => verifyPairedRelease({ ...manifest, webImageSourceSha: '5'.repeat(40) })).toThrow('source revisions must match')
    expect(() => verifyPairedRelease({ ...manifest, migrationHighWaterMark: '000042_member_identity_realm' })).toThrow('manifest hash does not match')
    expect(() => verifyPairedRelease({ ...manifest, runtimeSbomHashSha256: '6'.repeat(64) })).toThrow('manifest hash does not match')
  })

  it('rejects placeholders, mutable tags, and same-image substitution', () => {
    const manifest = createPairedReleaseManifest(candidate())
    expect(() => verifyPairedRelease({ ...manifest, lockHashSha256: '0'.repeat(64) })).toThrow('Placeholder')
    expect(() => verifyPairedRelease({ ...manifest, runtimeImage: `ghcr.io/corebunch/fuma-runtime@sha256:${'0'.repeat(64)}` })).toThrow('Placeholder')
    expect(() => verifyPairedRelease({ ...manifest, runtimeImage: 'ghcr.io/corebunch/fuma-runtime:latest' })).toThrow('/runtimeImage')
    expect(() => verifyPairedRelease({ ...manifest, webImage: manifest.runtimeImage })).toThrow('/webImage')
    expect(() => verifyPairedRelease({ ...manifest, webImage: `ghcr.io/corebunch/fuma-web@sha256:${'c'.repeat(64)}` })).toThrow('separate immutable images')
  })
})
