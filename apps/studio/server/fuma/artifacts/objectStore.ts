import { ObjectStorageError, sha256Hex, type ObjectTenantScope, type TenantObjectStorage } from '../objectStorage'
import type { ArtifactRelease } from './contracts'
import type { SharedArtifactObjectStore } from './service'

export class TenantSharedArtifactObjectStore implements SharedArtifactObjectStore {
  readonly #storage: TenantObjectStorage
  readonly #scope: ObjectTenantScope

  constructor(storage: TenantObjectStorage, scope: ObjectTenantScope) {
    this.#storage = storage
    this.#scope = scope
  }

  async putIfAbsent(artifact: ArtifactRelease, bytes: Uint8Array): Promise<'inserted' | 'exists'> {
    try {
      const existing = await this.#storage.head(this.#scope, artifact.objectKey)
      this.#assert(existing, artifact)
      return 'exists'
    } catch (error) {
      if (!(error instanceof ObjectStorageError) || error.code !== 'not_found') throw error
    }
    try {
      await this.#storage.put({ scope: this.#scope, key: artifact.objectKey, bytes, mimeType: artifact.mimeType, checksumSha256: artifact.contentHashSha256 })
      return 'inserted'
    } catch (error) {
      if (!(error instanceof ObjectStorageError) || error.code !== 'already_exists') throw error
      const existing = await this.#storage.head(this.#scope, artifact.objectKey)
      this.#assert(existing, artifact)
      return 'exists'
    }
  }

  async get(artifact: ArtifactRelease): Promise<Uint8Array> {
    const bytes = await this.#storage.get(this.#scope, artifact.objectKey)
    if (bytes.byteLength !== artifact.sizeBytes || sha256Hex(bytes) !== artifact.contentHashSha256) throw new ObjectStorageError('corrupt_object', 'Immutable shared artifact failed integrity verification.')
    return bytes
  }

  #assert(metadata: Readonly<{ sizeBytes: number; mimeType: string; checksumSha256: string }>, artifact: ArtifactRelease): void {
    if (metadata.sizeBytes !== artifact.sizeBytes || metadata.mimeType !== artifact.mimeType || metadata.checksumSha256 !== artifact.contentHashSha256) {
      throw new ObjectStorageError('already_exists', 'Artifact object identity exists with different immutable metadata.')
    }
  }
}
