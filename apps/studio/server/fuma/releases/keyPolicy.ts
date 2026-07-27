import { assertLogicalObjectKey } from '../objectStorage'
import { TenantKeyIdSchema } from '../tenancy'
import { Value } from '@core/utils/typeboxHelpers'
import {
  ReleaseContractError,
  ReleaseHashSchema,
} from './contracts'

function assertId(value: string, path: string): void {
  if (!Value.Check(TenantKeyIdSchema, value)) {
    throw new ReleaseContractError('invalid-object-identity', `${path} is invalid.`, path)
  }
}

function assertHash(value: string, path: string): void {
  if (!Value.Check(ReleaseHashSchema, value)) {
    throw new ReleaseContractError('invalid-object-identity', `${path} is not a SHA-256 hash.`, path)
  }
}

export function releaseObjectPrefix(releaseId: string): string {
  assertId(releaseId, 'releaseId')
  return `publish/releases/${releaseId}/objects`
}

/** Content-addressed identity: the same bytes in one release have exactly one logical key. */
export function releaseObjectKey(releaseId: string, contentHashSha256: string): string {
  assertHash(contentHashSha256, 'contentHashSha256')
  const key = `${releaseObjectPrefix(releaseId)}/${contentHashSha256}`
  assertLogicalObjectKey(key)
  return key
}

export function releaseManifestKey(releaseId: string, manifestHashSha256: string): string {
  assertId(releaseId, 'releaseId')
  assertHash(manifestHashSha256, 'manifestHashSha256')
  const key = `publish/releases/${releaseId}/manifests/${manifestHashSha256}.json`
  assertLogicalObjectKey(key)
  return key
}

export function assertReleaseObjectKey(
  key: string,
  releaseId: string,
  contentHashSha256: string,
  path = 'objectKey',
): void {
  const expected = releaseObjectKey(releaseId, contentHashSha256)
  if (key !== expected) {
    throw new ReleaseContractError(
      'invalid-object-identity',
      `${path} must be the exact content-addressed key for this release.`,
      path,
    )
  }
}
