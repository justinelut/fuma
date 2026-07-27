import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  ReleaseManifestSchema,
  assertReleaseManifest,
  createReleaseManifest,
  releaseManifestHashInput,
  releaseManifestKey,
  releaseObjectKey,
  releaseObjectPrefix,
} from '../../../server/fuma/releases'
import { sha256Hex } from '../../../server/fuma/objectStorage'
import {
  RELEASE_FIXTURE_SCOPE_A,
  RELEASE_FIXTURE_SOURCE_HASH,
  RELEASE_FIXTURE_TIME,
  createReleaseFixtureManifest,
} from '../helpers/fuma/releaseFixture'

const bytes = new TextEncoder().encode('fixture')
const hash = sha256Hex(bytes)

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    logicalPath: '/index.html',
    kind: 'html',
    contentHashSha256: hash,
    sizeBytes: bytes.byteLength,
    mimeType: 'text/html',
    references: [],
    ...overrides,
  }
}

describe('FUMA-048 release manifest and key policy', () => {
  it('builds a deeply frozen deterministic manifest independent of input order', () => {
    const first = createReleaseFixtureManifest()
    const second = createReleaseManifest({
      releaseId: first.releaseId,
      ownerKey: first.ownerKey,
      siteId: first.siteId,
      sourceSnapshotHashSha256: first.sourceSnapshotHashSha256,
      createdAt: first.createdAt,
      artifacts: [...first.artifacts].reverse().map((entry) => ({
        logicalPath: entry.logicalPath,
        kind: entry.kind,
        contentHashSha256: entry.contentHashSha256,
        sizeBytes: entry.sizeBytes,
        mimeType: entry.mimeType,
        references: [...entry.references].reverse(),
      })),
    })
    expect(first).toEqual(second)
    expect(Value.Check(ReleaseManifestSchema, first)).toBe(true)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.artifacts)).toBe(true)
    expect(Object.isFrozen(first.artifacts[0].references)).toBe(true)
    const { manifestHashSha256: _hash, ...base } = first
    expect(sha256Hex(new TextEncoder().encode(releaseManifestHashInput(base))))
      .toBe(first.manifestHashSha256)
  })

  it('verifies manifests after PostgreSQL jsonb reorders artifact object keys', () => {
    const manifest = createReleaseFixtureManifest()
    const reordered = {
      ...manifest,
      artifacts: manifest.artifacts.map((entry) => ({
        references: [...entry.references],
        mimeType: entry.mimeType,
        sizeBytes: entry.sizeBytes,
        contentHashSha256: entry.contentHashSha256,
        objectKey: entry.objectKey,
        kind: entry.kind,
        logicalPath: entry.logicalPath,
      })),
    }
    expect(() => assertReleaseManifest(reordered)).not.toThrow()
  })

  it('derives exact release-local content-addressed identities', () => {
    expect(releaseObjectPrefix('release-001')).toBe('publish/releases/release-001/objects')
    expect(releaseObjectKey('release-001', hash))
      .toBe(`publish/releases/release-001/objects/${hash}`)
    expect(releaseManifestKey('release-001', 'a'.repeat(64)))
      .toBe(`publish/releases/release-001/manifests/${'a'.repeat(64)}.json`)
    expect(releaseObjectKey('release-002', hash)).not.toBe(releaseObjectKey('release-001', hash))
    expect(() => releaseObjectKey('../foreign', hash)).toThrow()
    expect(() => releaseObjectKey('release-001', 'not-a-hash')).toThrow()
  })

  it('rejects missing references, duplicate paths, unsafe paths, and additional fields', () => {
    const base = {
      releaseId: 'release-invalid',
      ownerKey: RELEASE_FIXTURE_SCOPE_A.ownerKey,
      siteId: RELEASE_FIXTURE_SCOPE_A.siteId,
      sourceSnapshotHashSha256: RELEASE_FIXTURE_SOURCE_HASH,
      createdAt: RELEASE_FIXTURE_TIME,
    }
    expect(() => createReleaseManifest({
      ...base,
      artifacts: [artifact({ references: ['/assets/missing.css'] })],
    })).toThrow('not present in the manifest')
    expect(() => createReleaseManifest({
      ...base,
      artifacts: [artifact(), artifact()],
    })).toThrow('duplicate logical paths')
    expect(() => createReleaseManifest({
      ...base,
      artifacts: [artifact({ logicalPath: '/../secret' })],
    })).toThrow('canonical absolute release path')
    expect(() => createReleaseManifest({
      ...base,
      artifacts: [artifact({ callerOrganizationId: 'foreign' })],
    })).toThrow('strict release artifact')
  })

  it('detects descriptor, aggregate, object-key, and manifest hash tampering', () => {
    const valid = createReleaseFixtureManifest()
    const mutations = [
      { ...valid, artifactCount: valid.artifactCount + 1 },
      { ...valid, totalSizeBytes: valid.totalSizeBytes + 1 },
      { ...valid, artifactsHashSha256: 'f'.repeat(64) },
      { ...valid, manifestHashSha256: 'f'.repeat(64) },
      {
        ...valid,
        artifacts: valid.artifacts.map((entry, index) => index === 0
          ? { ...entry, objectKey: releaseObjectKey('release-foreign', entry.contentHashSha256) }
          : entry),
      },
    ]
    for (const mutation of mutations) {
      expect(() => assertReleaseManifest(mutation)).toThrow()
    }
  })
})
