import { describe, expect, it } from 'bun:test'
import {
  createPairedReleaseManifest,
  pairedReleaseManifestHash,
  verifyPairedRelease,
} from '../../src'
import { pairedReleaseInput } from '../helpers/pairedRelease'

describe('FUMA-078 native ARM64 paired supply-chain manifest', () => {
  it('binds three separate digest-only images and all evidence to one source', () => {
    const input = pairedReleaseInput()
    const manifest = createPairedReleaseManifest(input)
    expect(verifyPairedRelease(manifest)).toEqual(manifest)
    expect(manifest.manifestHashSha256).toBe(pairedReleaseManifestHash(input))
    expect(manifest.architectures).toEqual(['linux/arm64'])
    expect(Object.isFrozen(manifest)).toBe(true)
    expect(Object.isFrozen(manifest.architectures)).toBe(true)
  })

  it('rejects mixed source claims and immutable field tampering', () => {
    const manifest = createPairedReleaseManifest(pairedReleaseInput())
    expect(() => verifyPairedRelease({ ...manifest, siteRuntimeImageSourceSha: '5'.repeat(40) })).toThrow('source revisions must match')
    expect(() => verifyPairedRelease({ ...manifest, migrationHighWaterMark: '000042_member_identity_realm' })).toThrow('manifest hash does not match')
    expect(() => verifyPairedRelease({ ...manifest, siteRuntimeSbomHashSha256: '6'.repeat(64) })).toThrow('manifest hash does not match')
  })

  it('rejects placeholders, mutable tags, duplicate digests, and non-ARM64 architecture claims', () => {
    const manifest = createPairedReleaseManifest(pairedReleaseInput())
    expect(() => verifyPairedRelease({ ...manifest, lockHashSha256: '0'.repeat(64) })).toThrow('Placeholder')
    expect(() => verifyPairedRelease({ ...manifest, runtimeImage: `ghcr.io/corebunch/fuma-runtime@sha256:${'0'.repeat(64)}` })).toThrow('Placeholder')
    expect(() => verifyPairedRelease({ ...manifest, runtimeImage: 'ghcr.io/corebunch/fuma-runtime:latest' })).toThrow('/runtimeImage')
    expect(() => verifyPairedRelease({ ...manifest, siteRuntimeImage: `ghcr.io/corebunch/fuma-site-runtime@sha256:${manifest.runtimeImage.slice(-64)}` })).toThrow('separate immutable images')
    expect(() => verifyPairedRelease({ ...manifest, architectures: ['linux/amd64'] })).toThrow('/architectures/0')
    expect(() => verifyPairedRelease({ ...manifest, architectures: ['linux/arm64', 'linux/amd64'] })).toThrow('/architectures')
  })
})
