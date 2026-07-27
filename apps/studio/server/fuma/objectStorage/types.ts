export type ObjectTenantScope = Readonly<{
  organizationId: string
  workspaceId: string
  siteId: string
}>

export type ObjectStoragePolicy = Readonly<{
  allowedMimeTypes: readonly string[]
  maxObjectBytes: number
  maxTenantBytes: number
  multipartPartBytes?: number
  maxSignedUrlTtlSeconds?: number
}>

export type PutObjectInput = Readonly<{
  scope: ObjectTenantScope
  key: string
  bytes: Uint8Array
  mimeType: string
  checksumSha256: string
}>

export type BeginMultipartInput = Readonly<{
  scope: ObjectTenantScope
  key: string
  mimeType: string
  sizeBytes: number
  checksumSha256: string
}>

export type UploadPartInput = Readonly<{
  partNumber: number
  bytes: Uint8Array
  checksumSha256: string
}>

export type ObjectMetadata = Readonly<{
  key: string
  sizeBytes: number
  mimeType: string
  checksumSha256: string
  createdAt: string
}>

export type ObjectList = Readonly<{
  objects: readonly ObjectMetadata[]
  totalBytes: number
}>

export const OBJECT_URL_PURPOSES = ['download', 'preview', 'metadata'] as const
export type ObjectUrlPurpose = (typeof OBJECT_URL_PURPOSES)[number]

export type SignedObjectUrl = Readonly<{
  url: string
  expiresAt: number
  purpose: ObjectUrlPurpose
}>

export type RedeemedObjectUrl = Readonly<{
  providerUrl: string
  method: 'GET' | 'HEAD'
  expiresAt: number
}>

export type RawObjectHead = Readonly<{
  sizeBytes: number
  mimeType: string
  lastModified: Date
  etag: string
}>

export type RawObjectListEntry = Readonly<{
  key: string
  sizeBytes: number
  lastModified?: Date
  etag?: string
}>

export interface RawMultipartUpload {
  uploadPart(partNumber: number, bytes: Uint8Array): Promise<void>
  completeImmutable(): Promise<void>
  abort(): Promise<void>
}

export interface ObjectStorageTransport {
  putImmutable(key: string, bytes: Uint8Array, mimeType: string): Promise<void>
  get(key: string): Promise<Uint8Array>
  head(key: string): Promise<RawObjectHead>
  list(prefix: string): Promise<readonly RawObjectListEntry[]>
  delete(key: string): Promise<void>
  beginMultipart(key: string, mimeType: string): Promise<RawMultipartUpload>
  presign(key: string, method: 'GET' | 'HEAD', ttlSeconds: number): string
}

export type ObjectStorageErrorCode =
  | 'invalid_scope'
  | 'invalid_key'
  | 'not_found'
  | 'already_exists'
  | 'checksum_mismatch'
  | 'mime_mismatch'
  | 'mime_not_allowed'
  | 'object_too_large'
  | 'quota_exceeded'
  | 'invalid_multipart'
  | 'corrupt_object'
  | 'invalid_signed_url'
  | 'expired_signed_url'
  | 'wrong_url_purpose'
  | 'transport_error'

export class ObjectStorageError extends Error {
  readonly code: ObjectStorageErrorCode
  readonly path?: string

  constructor(code: ObjectStorageErrorCode, message: string, path?: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ObjectStorageError'
    this.code = code
    this.path = path
  }
}

export interface TenantMultipartUpload {
  uploadPart(input: UploadPartInput): Promise<void>
  complete(): Promise<ObjectMetadata>
  abort(): Promise<void>
}

export interface TenantObjectStorage {
  put(input: PutObjectInput): Promise<ObjectMetadata>
  beginMultipart(input: BeginMultipartInput): Promise<TenantMultipartUpload>
  get(scope: ObjectTenantScope, key: string): Promise<Uint8Array>
  head(scope: ObjectTenantScope, key: string): Promise<ObjectMetadata>
  list(scope: ObjectTenantScope, prefix?: string): Promise<ObjectList>
  delete(scope: ObjectTenantScope, key: string): Promise<void>
  createSignedUrl(input: Readonly<{
    scope: ObjectTenantScope
    key: string
    purpose: ObjectUrlPurpose
    ttlSeconds: number
  }>): Promise<SignedObjectUrl>
  redeemSignedUrl(url: string, requiredPurpose: ObjectUrlPurpose): Promise<RedeemedObjectUrl>
}
