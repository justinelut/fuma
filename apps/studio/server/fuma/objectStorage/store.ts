import { createHmac, timingSafeEqual } from 'node:crypto'
import { Type, type Static } from '@sinclair/typebox'
import { safeParseJson } from '@core/utils/jsonValidate'
import { assertChecksum, assertMimeType, sha256Hex, SHA256_HEX_PATTERN } from './integrity'
import {
  OBJECT_METADATA_SUFFIX,
  assertLogicalObjectKey,
  physicalObjectKey,
  tenantObjectPrefix,
} from './keyPolicy'
import {
  OBJECT_URL_PURPOSES,
  ObjectStorageError,
  type BeginMultipartInput,
  type ObjectList,
  type ObjectMetadata,
  type ObjectStoragePolicy,
  type ObjectStorageTransport,
  type ObjectTenantScope,
  type ObjectUrlPurpose,
  type PutObjectInput,
  type RedeemedObjectUrl,
  type SignedObjectUrl,
  type TenantMultipartUpload,
  type TenantObjectStorage,
  type UploadPartInput,
} from './types'

const ObjectMetadataSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  sizeBytes: Type.Integer({ minimum: 0 }),
  mimeType: Type.String({ minLength: 1 }),
  checksumSha256: Type.String({ pattern: SHA256_HEX_PATTERN.source }),
  createdAt: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' }),
}, { additionalProperties: false })

const SignedPayloadSchema = Type.Object({
  version: Type.Literal(1),
  scope: Type.Object({
    organizationId: Type.String({ minLength: 1 }),
    workspaceId: Type.String({ minLength: 1 }),
    siteId: Type.String({ minLength: 1 }),
  }, { additionalProperties: false }),
  key: Type.String({ minLength: 1 }),
  purpose: Type.Union(OBJECT_URL_PURPOSES.map((purpose) => Type.Literal(purpose))),
  issuedAt: Type.Integer({ minimum: 0 }),
  expiresAt: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false })

type SignedPayload = Static<typeof SignedPayloadSchema>

export type FumaObjectStorageOptions = Readonly<{
  transport: ObjectStorageTransport
  policy: ObjectStoragePolicy
  signingSecret: string
  accessUrlBase: string
  nowMs?: () => number
}>

const METADATA_MIME = 'application/vnd.fuma.object-metadata+json'
const DEFAULT_MULTIPART_PART_BYTES = 5 * 1024 * 1024
const DEFAULT_SIGNED_URL_TTL_SECONDS = 300

function metadataKey(dataKey: string): string {
  return `${dataKey}${OBJECT_METADATA_SUFFIX}`
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return bytes
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decodeBase64Url(value: string): string {
  try {
    return Buffer.from(value, 'base64url').toString('utf8')
  } catch (error) {
    throw new ObjectStorageError('invalid_signed_url', 'Signed object URL payload is invalid.', 'url', error)
  }
}

function methodForPurpose(purpose: ObjectUrlPurpose): 'GET' | 'HEAD' {
  return purpose === 'metadata' ? 'HEAD' : 'GET'
}

function validatePolicy(policy: ObjectStoragePolicy): void {
  if (policy.allowedMimeTypes.length === 0 || new Set(policy.allowedMimeTypes).size !== policy.allowedMimeTypes.length) {
    throw new ObjectStorageError('transport_error', 'Object storage policy must declare unique allowed MIME types.')
  }
  for (const [name, value] of [
    ['maxObjectBytes', policy.maxObjectBytes],
    ['maxTenantBytes', policy.maxTenantBytes],
    ['multipartPartBytes', policy.multipartPartBytes ?? DEFAULT_MULTIPART_PART_BYTES],
    ['maxSignedUrlTtlSeconds', policy.maxSignedUrlTtlSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ObjectStorageError('transport_error', `${name} must be a positive safe integer.`)
    }
  }
  if (policy.maxObjectBytes > policy.maxTenantBytes) {
    throw new ObjectStorageError('transport_error', 'maxObjectBytes cannot exceed maxTenantBytes.')
  }
}

export class FumaObjectStorage implements TenantObjectStorage {
  readonly #transport: ObjectStorageTransport
  readonly #policy: ObjectStoragePolicy
  readonly #signingSecret: string
  readonly #accessUrlBase: URL
  readonly #nowMs: () => number
  readonly #reservations = new Map<string, Map<number, number>>()
  readonly #scopeLocks = new Map<string, Promise<void>>()
  #nextReservationId = 1

  constructor(options: FumaObjectStorageOptions) {
    validatePolicy(options.policy)
    if (Buffer.byteLength(options.signingSecret, 'utf8') < 32) {
      throw new ObjectStorageError('transport_error', 'Object signed-URL secret must contain at least 32 bytes.')
    }
    this.#accessUrlBase = new URL(options.accessUrlBase)
    if (!['http:', 'https:'].includes(this.#accessUrlBase.protocol) || this.#accessUrlBase.username || this.#accessUrlBase.password || this.#accessUrlBase.hash) {
      throw new ObjectStorageError('transport_error', 'Object access URL base must be a credential-free HTTP(S) URL.')
    }
    this.#transport = options.transport
    this.#policy = options.policy
    this.#signingSecret = options.signingSecret
    this.#nowMs = options.nowMs ?? (() => Date.now())
  }

  async #withScopeLock<T>(prefix: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#scopeLocks.get(prefix) ?? Promise.resolve()
    let release = (): void => {}
    const current = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.then(() => current)
    this.#scopeLocks.set(prefix, queued)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.#scopeLocks.get(prefix) === queued) this.#scopeLocks.delete(prefix)
    }
  }

  async #reserve(scope: ObjectTenantScope, sizeBytes: number): Promise<() => void> {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw new ObjectStorageError('object_too_large', 'Object size must be a non-negative safe integer.', 'sizeBytes')
    }
    if (sizeBytes > this.#policy.maxObjectBytes) {
      throw new ObjectStorageError('object_too_large', 'Object exceeds the per-object size limit.', 'sizeBytes')
    }
    const prefix = tenantObjectPrefix(scope)
    const reservationId = this.#nextReservationId++
    await this.#withScopeLock(prefix, async () => {
      const current = await this.list(scope)
      const reservations = this.#reservations.get(prefix) ?? new Map<number, number>()
      const reservedBytes = [...reservations.values()].reduce((total, value) => total + value, 0)
      if (current.totalBytes + reservedBytes + sizeBytes > this.#policy.maxTenantBytes) {
        throw new ObjectStorageError('quota_exceeded', 'Object would exceed the tenant storage quota.', 'sizeBytes')
      }
      reservations.set(reservationId, sizeBytes)
      this.#reservations.set(prefix, reservations)
    })
    let released = false
    return () => {
      if (released) return
      const reservations = this.#reservations.get(prefix)
      reservations?.delete(reservationId)
      if (reservations?.size === 0) this.#reservations.delete(prefix)
      released = true
    }
  }

  #newMetadata(input: Readonly<{ key: string; sizeBytes: number; mimeType: string; checksumSha256: string }>): ObjectMetadata {
    return { ...input, createdAt: new Date(this.#nowMs()).toISOString() }
  }

  async #writeMetadata(dataKey: string, metadata: ObjectMetadata): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(metadata))
    await this.#transport.putImmutable(metadataKey(dataKey), bytes, METADATA_MIME)
  }

  async #readMetadata(dataKey: string): Promise<ObjectMetadata> {
    let bytes: Uint8Array
    try {
      bytes = await this.#transport.get(metadataKey(dataKey))
    } catch (error) {
      if (error instanceof ObjectStorageError && error.code === 'not_found') {
        throw new ObjectStorageError('not_found', 'Object was not found.', 'key')
      }
      throw error
    }
    const parsed = safeParseJson(new TextDecoder().decode(bytes), ObjectMetadataSchema)
    if (!parsed.ok) {
      throw new ObjectStorageError('corrupt_object', 'Object integrity metadata is invalid.', 'key', parsed.error)
    }
    return parsed.value
  }

  async put(input: PutObjectInput): Promise<ObjectMetadata> {
    const dataKey = physicalObjectKey(input.scope, input.key)
    assertChecksum(sha256Hex(input.bytes), input.checksumSha256)
    assertMimeType(input.bytes, input.mimeType, this.#policy.allowedMimeTypes)
    const release = await this.#reserve(input.scope, input.bytes.byteLength)
    try {
      const metadata = this.#newMetadata({
        key: input.key,
        sizeBytes: input.bytes.byteLength,
        mimeType: input.mimeType,
        checksumSha256: input.checksumSha256,
      })
      await this.#transport.putImmutable(dataKey, input.bytes, input.mimeType)
      try {
        await this.#writeMetadata(dataKey, metadata)
      } catch (error) {
        await this.#transport.delete(dataKey)
        throw error
      }
      return metadata
    } finally {
      release()
    }
  }

  async beginMultipart(input: BeginMultipartInput): Promise<TenantMultipartUpload> {
    const dataKey = physicalObjectKey(input.scope, input.key)
    if (!this.#policy.allowedMimeTypes.includes(input.mimeType)) {
      throw new ObjectStorageError('mime_not_allowed', `MIME type ${input.mimeType} is not allowed.`, 'mimeType')
    }
    if (!SHA256_HEX_PATTERN.test(input.checksumSha256)) {
      throw new ObjectStorageError('checksum_mismatch', 'Multipart SHA-256 checksum is invalid.', 'checksumSha256')
    }
    const release = await this.#reserve(input.scope, input.sizeBytes)
    let rawUpload
    try {
      rawUpload = await this.#transport.beginMultipart(dataKey, input.mimeType)
    } catch (error) {
      release()
      throw error
    }

    const parts: Uint8Array[] = []
    const hasher = new Bun.CryptoHasher('sha256')
    const minimumPartBytes = this.#policy.multipartPartBytes ?? DEFAULT_MULTIPART_PART_BYTES
    let uploadedBytes = 0
    let nextPartNumber = 1
    let closed = false

    const abort = async (): Promise<void> => {
      if (closed) return
      closed = true
      try {
        await rawUpload.abort()
      } finally {
        release()
      }
    }

    return {
      uploadPart: async (part: UploadPartInput) => {
        if (closed) throw new ObjectStorageError('invalid_multipart', 'Multipart upload is closed.')
        if (part.partNumber !== nextPartNumber || part.partNumber > 10_000) {
          throw new ObjectStorageError('invalid_multipart', 'Multipart parts must be uploaded once in contiguous order.', 'partNumber')
        }
        const previous = parts.at(-1)
        if (previous && previous.byteLength < minimumPartBytes) {
          throw new ObjectStorageError('invalid_multipart', 'Only the final multipart part may be smaller than the configured part size.', 'bytes')
        }
        assertChecksum(sha256Hex(part.bytes), part.checksumSha256, 'part.checksumSha256')
        if (uploadedBytes + part.bytes.byteLength > input.sizeBytes) {
          throw new ObjectStorageError('invalid_multipart', 'Multipart bytes exceed the declared object size.', 'bytes')
        }
        await rawUpload.uploadPart(part.partNumber, part.bytes)
        const copy = part.bytes.slice()
        parts.push(copy)
        hasher.update(copy)
        uploadedBytes += copy.byteLength
        nextPartNumber += 1
      },
      complete: async () => {
        if (closed) throw new ObjectStorageError('invalid_multipart', 'Multipart upload is closed.')
        try {
          if (parts.length === 0 || uploadedBytes !== input.sizeBytes) {
            throw new ObjectStorageError('invalid_multipart', 'Multipart bytes do not match the declared object size.', 'sizeBytes')
          }
          assertChecksum(hasher.digest('hex'), input.checksumSha256)
          assertMimeType(concatenate(parts), input.mimeType, this.#policy.allowedMimeTypes)
          await rawUpload.completeImmutable()
          const metadata = this.#newMetadata({
            key: input.key,
            sizeBytes: input.sizeBytes,
            mimeType: input.mimeType,
            checksumSha256: input.checksumSha256,
          })
          try {
            await this.#writeMetadata(dataKey, metadata)
          } catch (error) {
            await this.#transport.delete(dataKey)
            throw error
          }
          closed = true
          release()
          return metadata
        } catch (error) {
          await abort()
          throw error
        }
      },
      abort,
    }
  }

  async get(scope: ObjectTenantScope, key: string): Promise<Uint8Array> {
    const dataKey = physicalObjectKey(scope, key)
    const metadata = await this.#readMetadata(dataKey)
    const bytes = await this.#transport.get(dataKey)
    if (bytes.byteLength !== metadata.sizeBytes || sha256Hex(bytes) !== metadata.checksumSha256) {
      throw new ObjectStorageError('corrupt_object', 'Object bytes do not match immutable integrity metadata.', 'key')
    }
    return bytes
  }

  async head(scope: ObjectTenantScope, key: string): Promise<ObjectMetadata> {
    const dataKey = physicalObjectKey(scope, key)
    const [metadata, raw] = await Promise.all([
      this.#readMetadata(dataKey),
      this.#transport.head(dataKey),
    ])
    if (raw.sizeBytes !== metadata.sizeBytes || raw.mimeType !== metadata.mimeType) {
      throw new ObjectStorageError('corrupt_object', 'Object HEAD does not match immutable integrity metadata.', 'key')
    }
    return metadata
  }

  async list(scope: ObjectTenantScope, prefix = ''): Promise<ObjectList> {
    assertLogicalObjectKey(prefix, true)
    const tenantPrefix = tenantObjectPrefix(scope)
    const entries = await this.#transport.list(`${tenantPrefix}${prefix}`)
    const sidecars = entries.filter((entry) => entry.key.endsWith(OBJECT_METADATA_SUFFIX))
    const objects = await Promise.all(sidecars.map(async (entry) => {
      const dataKey = entry.key.slice(0, -OBJECT_METADATA_SUFFIX.length)
      const metadata = await this.#readMetadata(dataKey)
      if (!metadata.key.startsWith(prefix)) {
        throw new ObjectStorageError('corrupt_object', 'Listed metadata escaped the requested logical prefix.', 'key')
      }
      return metadata
    }))
    objects.sort((left, right) => left.key.localeCompare(right.key))
    return {
      objects,
      totalBytes: objects.reduce((total, object) => total + object.sizeBytes, 0),
    }
  }

  async delete(scope: ObjectTenantScope, key: string): Promise<void> {
    const dataKey = physicalObjectKey(scope, key)
    await this.#transport.delete(metadataKey(dataKey))
    await this.#transport.delete(dataKey)
  }

  #signature(payload: string): Buffer {
    return createHmac('sha256', this.#signingSecret).update(payload).digest()
  }

  async createSignedUrl(input: Readonly<{
    scope: ObjectTenantScope
    key: string
    purpose: ObjectUrlPurpose
    ttlSeconds: number
  }>): Promise<SignedObjectUrl> {
    await this.head(input.scope, input.key)
    const maxTtl = this.#policy.maxSignedUrlTtlSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS
    if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds <= 0 || input.ttlSeconds > maxTtl) {
      throw new ObjectStorageError('invalid_signed_url', `Signed object URL TTL must be between 1 and ${maxTtl} seconds.`, 'ttlSeconds')
    }
    const issuedAt = this.#nowMs()
    const payload: SignedPayload = {
      version: 1,
      scope: input.scope,
      key: input.key,
      purpose: input.purpose,
      issuedAt,
      expiresAt: issuedAt + input.ttlSeconds * 1_000,
    }
    const encoded = encodeBase64Url(JSON.stringify(payload))
    const url = new URL(this.#accessUrlBase)
    url.search = ''
    url.searchParams.set('token', encoded)
    url.searchParams.set('signature', this.#signature(encoded).toString('base64url'))
    return { url: url.toString(), expiresAt: payload.expiresAt, purpose: payload.purpose }
  }

  async redeemSignedUrl(urlValue: string, requiredPurpose: ObjectUrlPurpose): Promise<RedeemedObjectUrl> {
    let url: URL
    try {
      url = new URL(urlValue)
    } catch (error) {
      throw new ObjectStorageError('invalid_signed_url', 'Signed object URL is invalid.', 'url', error)
    }
    if (url.origin !== this.#accessUrlBase.origin || url.pathname !== this.#accessUrlBase.pathname) {
      throw new ObjectStorageError('invalid_signed_url', 'Signed object URL has the wrong access endpoint.', 'url')
    }
    const token = url.searchParams.get('token')
    const signature = url.searchParams.get('signature')
    if (!token || !signature || [...url.searchParams.keys()].some((key) => key !== 'token' && key !== 'signature')) {
      throw new ObjectStorageError('invalid_signed_url', 'Signed object URL parameters are invalid.', 'url')
    }
    let suppliedSignature: Buffer
    try {
      suppliedSignature = Buffer.from(signature, 'base64url')
    } catch (error) {
      throw new ObjectStorageError('invalid_signed_url', 'Signed object URL signature is invalid.', 'url', error)
    }
    const expectedSignature = this.#signature(token)
    if (suppliedSignature.byteLength !== expectedSignature.byteLength || !timingSafeEqual(suppliedSignature, expectedSignature)) {
      throw new ObjectStorageError('invalid_signed_url', 'Signed object URL signature is invalid.', 'url')
    }
    const parsed = safeParseJson(decodeBase64Url(token), SignedPayloadSchema)
    if (!parsed.ok) throw new ObjectStorageError('invalid_signed_url', 'Signed object URL payload is invalid.', 'url', parsed.error)
    const payload = parsed.value
    physicalObjectKey(payload.scope, payload.key)
    if (payload.purpose !== requiredPurpose) {
      throw new ObjectStorageError('wrong_url_purpose', 'Signed object URL cannot be used for this purpose.', 'purpose')
    }
    const now = this.#nowMs()
    if (payload.expiresAt <= now || payload.issuedAt > now || payload.expiresAt <= payload.issuedAt) {
      throw new ObjectStorageError('expired_signed_url', 'Signed object URL has expired.', 'url')
    }
    await this.head(payload.scope, payload.key)
    const method = methodForPurpose(payload.purpose)
    const ttlSeconds = Math.max(1, Math.ceil((payload.expiresAt - now) / 1_000))
    return {
      providerUrl: this.#transport.presign(physicalObjectKey(payload.scope, payload.key), method, ttlSeconds),
      method,
      expiresAt: payload.expiresAt,
    }
  }
}
