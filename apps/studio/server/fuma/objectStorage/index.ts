import { BunS3ObjectStorageTransport } from './bunS3Transport'
import { FumaObjectStorage } from './store'
import type { BunS3ObjectStorageOptions } from './bunS3Transport'
import type { ObjectStoragePolicy } from './types'

export { BunS3ObjectStorageTransport } from './bunS3Transport'
export type { BunS3ObjectStorageOptions } from './bunS3Transport'
export { FakeObjectStorageTransport } from './fakeTransport'
export { detectMimeType, sha256Hex } from './integrity'
export {
  assertLogicalObjectKey,
  assertObjectTenantScope,
  logicalObjectKey,
  physicalObjectKey,
  tenantObjectPrefix,
} from './keyPolicy'
export {
  FumaScopedObjectKeyResolutionError,
  createFumaScopedObjectKeyFactory,
  type FumaScopedObjectKeyFactory,
} from './scopedKeys'
export { FumaObjectStorage } from './store'
export type { FumaObjectStorageOptions } from './store'
export * from './types'

export function createMinioObjectStorage(input: Readonly<{
  config: BunS3ObjectStorageOptions
  policy: ObjectStoragePolicy
  signingSecret: string
  accessUrlBase: string
  nowMs?: () => number
}>): FumaObjectStorage {
  return new FumaObjectStorage({
    transport: new BunS3ObjectStorageTransport(input.config),
    policy: input.policy,
    signingSecret: input.signingSecret,
    accessUrlBase: input.accessUrlBase,
    nowMs: input.nowMs,
  })
}
