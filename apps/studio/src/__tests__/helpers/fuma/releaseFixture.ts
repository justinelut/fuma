import { sha256Hex } from '../../../../server/fuma/objectStorage'
import { createReleaseManifest } from '../../../../server/fuma/releases'
import type { FumaRepositoryScope } from '../../../../server/fuma/tenancy'

const encoder = new TextEncoder()

export const RELEASE_FIXTURE_TIME = '2026-07-25T12:00:00.000Z'
export const RELEASE_FIXTURE_BYTES = Object.freeze({
  html: encoder.encode('<!doctype html><link rel="stylesheet" href="/assets/site.css"><h1>Fuma</h1>'),
  css: encoder.encode('h1{color:#123456}'),
})

export const RELEASE_FIXTURE_SCOPE_A: FumaRepositoryScope = Object.freeze({
  platformId: 'platform-fuma',
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  ownerKey: 'owner-a',
  generation: 3,
  state: 'active',
  transferFence: null,
})

export const RELEASE_FIXTURE_SCOPE_B: FumaRepositoryScope = Object.freeze({
  platformId: 'platform-fuma',
  organizationId: 'organization-b',
  workspaceId: 'workspace-b',
  siteId: 'site-b',
  ownerKey: 'owner-b',
  generation: 9,
  state: 'active',
  transferFence: null,
})

export const RELEASE_FIXTURE_SOURCE_HASH = 'c'.repeat(64)

export function createReleaseFixtureManifest(
  scope: FumaRepositoryScope = RELEASE_FIXTURE_SCOPE_A,
  releaseId = 'release-001',
) {
  return createReleaseManifest({
    releaseId,
    ownerKey: scope.ownerKey,
    siteId: scope.siteId,
    sourceSnapshotHashSha256: RELEASE_FIXTURE_SOURCE_HASH,
    createdAt: RELEASE_FIXTURE_TIME,
    artifacts: [
      {
        logicalPath: '/index.html',
        kind: 'html',
        contentHashSha256: sha256Hex(RELEASE_FIXTURE_BYTES.html),
        sizeBytes: RELEASE_FIXTURE_BYTES.html.byteLength,
        mimeType: 'text/html',
        references: ['/assets/site.css'],
      },
      {
        logicalPath: '/assets/site.css',
        kind: 'css',
        contentHashSha256: sha256Hex(RELEASE_FIXTURE_BYTES.css),
        sizeBytes: RELEASE_FIXTURE_BYTES.css.byteLength,
        mimeType: 'text/css',
        references: [],
      },
    ],
  })
}
