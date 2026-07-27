import { createHmac } from 'node:crypto'
import {
  ObjectStorageError,
  type ObjectStorageTransport,
  type RawMultipartUpload,
  type RawObjectHead,
  type RawObjectListEntry,
} from './types'

export type BunS3ObjectStorageOptions = Readonly<{
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  region?: string
}>

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function sha256(value: string | Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function canonicalPath(endpoint: URL, bucket: string, key: string): string {
  const base = endpoint.pathname === '/' ? '' : endpoint.pathname.replace(/\/$/, '')
  return `${base}/${encode(bucket)}/${key.split('/').map(encode).join('/')}`
}

function canonicalQuery(query: Readonly<Record<string, string>>): string {
  return Object.entries(query)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${encode(name)}=${encode(value)}`)
    .join('&')
}

function awsTimestamp(now: Date): { date: string; timestamp: string } {
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { date: timestamp.slice(0, 8), timestamp }
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function xmlValue(xml: string, name: string): string | undefined {
  const match = xml.match(new RegExp(`<${name}>([^<]+)</${name}>`))
  if (!match) return undefined
  return match[1]
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export class BunS3ObjectStorageTransport implements ObjectStorageTransport {
  readonly #endpoint: URL
  readonly #accessKeyId: string
  readonly #secretAccessKey: string
  readonly #bucket: string
  readonly #region: string
  readonly #client: Bun.S3Client
  readonly #now: () => Date

  constructor(options: BunS3ObjectStorageOptions, now: () => Date = () => new Date()) {
    this.#endpoint = new URL(options.endpoint)
    if (!['http:', 'https:'].includes(this.#endpoint.protocol) || this.#endpoint.username || this.#endpoint.password || this.#endpoint.search || this.#endpoint.hash) {
      throw new ObjectStorageError('transport_error', 'S3 endpoint must be an HTTP(S) URL without credentials, query, or fragment.')
    }
    this.#accessKeyId = options.accessKeyId
    this.#secretAccessKey = options.secretAccessKey
    this.#bucket = options.bucket
    this.#region = options.region ?? 'us-east-1'
    this.#now = now
    this.#client = new Bun.S3Client({
      endpoint: this.#endpoint.origin,
      accessKeyId: this.#accessKeyId,
      secretAccessKey: this.#secretAccessKey,
      bucket: this.#bucket,
      region: this.#region,
    })
  }

  async #request(input: Readonly<{
    method: 'PUT' | 'POST' | 'DELETE'
    key: string
    query?: Readonly<Record<string, string>>
    bytes?: Uint8Array
    headers?: Readonly<Record<string, string>>
  }>): Promise<Response> {
    const bytes = input.bytes ?? new Uint8Array()
    const payloadHash = bytes.byteLength === 0 ? EMPTY_SHA256 : sha256(bytes)
    const path = canonicalPath(this.#endpoint, this.#bucket, input.key)
    const query = canonicalQuery(input.query ?? {})
    const { date, timestamp } = awsTimestamp(this.#now())
    const headers: Record<string, string> = {
      host: this.#endpoint.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': timestamp,
      ...Object.fromEntries(Object.entries(input.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value.trim()])),
    }
    const signedHeaderNames = Object.keys(headers).sort()
    const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name].replace(/\s+/g, ' ')}`).join('\n') + '\n'
    const canonicalRequest = [
      input.method,
      path,
      query,
      canonicalHeaders,
      signedHeaderNames.join(';'),
      payloadHash,
    ].join('\n')
    const scope = `${date}/${this.#region}/s3/aws4_request`
    const stringToSign = `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`
    const dateKey = hmac(`AWS4${this.#secretAccessKey}`, date)
    const regionKey = hmac(dateKey, this.#region)
    const serviceKey = hmac(regionKey, 's3')
    const signingKey = hmac(serviceKey, 'aws4_request')
    const signature = hmac(signingKey, stringToSign).toString('hex')
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.#accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`

    return fetch(`${this.#endpoint.origin}${path}${query ? `?${query}` : ''}`, {
      method: input.method,
      headers,
      body: input.method === 'DELETE' ? undefined : arrayBuffer(bytes),
    })
  }

  async #assertSuccess(response: Response, operation: string): Promise<void> {
    if (response.ok) return
    if (response.status === 409 || response.status === 412) {
      throw new ObjectStorageError('already_exists', 'Object is immutable and already exists.', 'key')
    }
    const body = (await response.text()).slice(0, 300)
    throw new ObjectStorageError('transport_error', `${operation} failed with S3 status ${response.status}: ${body}`)
  }

  async putImmutable(key: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    const response = await this.#request({
      method: 'PUT',
      key,
      bytes,
      headers: { 'content-type': mimeType, 'if-none-match': '*' },
    })
    await this.#assertSuccess(response, 'Immutable object PUT')
  }

  async get(key: string): Promise<Uint8Array> {
    if (!(await this.#client.exists(key))) {
      throw new ObjectStorageError('not_found', 'Object was not found.', 'key')
    }
    return new Uint8Array(await this.#client.file(key).arrayBuffer())
  }

  async head(key: string): Promise<RawObjectHead> {
    if (!(await this.#client.exists(key))) {
      throw new ObjectStorageError('not_found', 'Object was not found.', 'key')
    }
    const stat = await this.#client.stat(key)
    return {
      sizeBytes: stat.size,
      mimeType: stat.type,
      lastModified: stat.lastModified,
      etag: stat.etag,
    }
  }

  async list(prefix: string): Promise<readonly RawObjectListEntry[]> {
    const entries: RawObjectListEntry[] = []
    let continuationToken: string | undefined
    do {
      const page = await this.#client.list({ prefix, continuationToken, maxKeys: 1_000 })
      for (const object of page.contents ?? []) {
        entries.push({
          key: object.key,
          sizeBytes: object.size ?? 0,
          lastModified: object.lastModified ? new Date(object.lastModified) : undefined,
          etag: object.eTag,
        })
      }
      continuationToken = page.isTruncated ? page.nextContinuationToken : undefined
      if (page.isTruncated && !continuationToken) {
        throw new ObjectStorageError('transport_error', 'S3 list response was truncated without a continuation token.')
      }
    } while (continuationToken)
    return entries
  }

  async delete(key: string): Promise<void> {
    if (await this.#client.exists(key)) await this.#client.delete(key)
  }

  async beginMultipart(key: string, mimeType: string): Promise<RawMultipartUpload> {
    const initiate = await this.#request({ method: 'POST', key, query: { uploads: '' }, headers: { 'content-type': mimeType } })
    await this.#assertSuccess(initiate, 'Multipart initiation')
    const uploadId = xmlValue(await initiate.text(), 'UploadId')
    if (!uploadId) throw new ObjectStorageError('transport_error', 'S3 multipart initiation omitted UploadId.')

    const etags = new Map<number, string>()
    let closed = false
    const abort = async (): Promise<void> => {
      if (closed) return
      const response = await this.#request({ method: 'DELETE', key, query: { uploadId } })
      if (!response.ok && response.status !== 404) await this.#assertSuccess(response, 'Multipart abort')
      closed = true
    }

    return {
      uploadPart: async (partNumber, bytes) => {
        if (closed) throw new ObjectStorageError('invalid_multipart', 'Multipart upload is closed.')
        const response = await this.#request({
          method: 'PUT',
          key,
          query: { partNumber: String(partNumber), uploadId },
          bytes,
        })
        await this.#assertSuccess(response, `Multipart part ${partNumber}`)
        const etag = response.headers.get('etag')
        if (!etag) throw new ObjectStorageError('transport_error', `S3 multipart part ${partNumber} omitted ETag.`)
        etags.set(partNumber, etag.replace(/^"|"$/g, ''))
      },
      completeImmutable: async () => {
        if (closed) throw new ObjectStorageError('invalid_multipart', 'Multipart upload is closed.')
        const parts = [...etags.entries()].sort(([left], [right]) => left - right)
        const xml = `<CompleteMultipartUpload>${parts.map(([partNumber, etag]) => `<Part><PartNumber>${partNumber}</PartNumber><ETag>"${xmlEscape(etag)}"</ETag></Part>`).join('')}</CompleteMultipartUpload>`
        const response = await this.#request({
          method: 'POST',
          key,
          query: { uploadId },
          bytes: new TextEncoder().encode(xml),
          headers: { 'content-type': 'application/xml', 'if-none-match': '*' },
        })
        await this.#assertSuccess(response, 'Multipart completion')
        closed = true
      },
      abort,
    }
  }

  presign(key: string, method: 'GET' | 'HEAD', ttlSeconds: number): string {
    return this.#client.presign(key, { method, expiresIn: ttlSeconds })
  }
}
