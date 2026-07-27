import {
  ObjectStorageError,
  type ObjectStorageTransport,
  type RawMultipartUpload,
  type RawObjectHead,
  type RawObjectListEntry,
} from './types'

const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

type StoredObject = {
  bytes: Uint8Array
  mimeType: string
  createdAtMs: number
  etag: string
}

export class FakeObjectStorageTransport implements ObjectStorageTransport {
  readonly #objects = new Map<string, StoredObject>()
  readonly #nowMs: () => number

  constructor(nowMs: () => number = () => Date.now()) {
    this.#nowMs = nowMs
  }

  physicalKeys(): readonly string[] {
    return [...this.#objects.keys()].sort()
  }

  async putImmutable(key: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    if (this.#objects.has(key)) {
      throw new ObjectStorageError('already_exists', 'Object is immutable and already exists.', 'key')
    }
    const copy = bytes.slice()
    this.#objects.set(key, {
      bytes: copy,
      mimeType,
      createdAtMs: this.#nowMs(),
      etag: new Bun.CryptoHasher('sha256').update(copy).digest('hex'),
    })
  }

  async get(key: string): Promise<Uint8Array> {
    const object = this.#objects.get(key)
    if (!object) throw new ObjectStorageError('not_found', 'Object was not found.', 'key')
    return object.bytes.slice()
  }

  async head(key: string): Promise<RawObjectHead> {
    const object = this.#objects.get(key)
    if (!object) throw new ObjectStorageError('not_found', 'Object was not found.', 'key')
    return {
      sizeBytes: object.bytes.byteLength,
      mimeType: object.mimeType,
      lastModified: new Date(object.createdAtMs),
      etag: object.etag,
    }
  }

  async list(prefix: string): Promise<readonly RawObjectListEntry[]> {
    return [...this.#objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, object]) => ({
        key,
        sizeBytes: object.bytes.byteLength,
        lastModified: new Date(object.createdAtMs),
        etag: object.etag,
      }))
  }

  async delete(key: string): Promise<void> {
    this.#objects.delete(key)
  }

  async beginMultipart(key: string, mimeType: string): Promise<RawMultipartUpload> {
    const parts = new Map<number, Uint8Array>()
    let closed = false
    return {
      uploadPart: async (partNumber, bytes) => {
        if (closed) throw new ObjectStorageError('invalid_multipart', 'Multipart upload is closed.')
        parts.set(partNumber, bytes.slice())
      },
      completeImmutable: async () => {
        if (closed) throw new ObjectStorageError('invalid_multipart', 'Multipart upload is closed.')
        const ordered = [...parts.entries()].sort(([left], [right]) => left - right)
        await this.putImmutable(key, concatBytes(ordered.map(([, bytes]) => bytes)), mimeType)
        closed = true
      },
      abort: async () => {
        parts.clear()
        closed = true
      },
    }
  }

  presign(key: string, method: 'GET' | 'HEAD', ttlSeconds: number): string {
    const query = new URLSearchParams({ key, method, ttl: String(ttlSeconds) })
    return `https://fake-s3.fuma.invalid/object?${query.toString()}`
  }
}
