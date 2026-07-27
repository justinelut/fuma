import { Type, type Static } from '@sinclair/typebox'
import { parseStrict } from './contracts'

const Id = Type.String({ minLength: 1, maxLength: 96, pattern: '^[a-z0-9](?:[a-z0-9._:-]{0,94}[a-z0-9])?$' })
const Sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' })

const ArchiveEntrySchema = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 512 }),
  kind: Type.Union([Type.Literal('file'), Type.Literal('directory')]),
  compressedBytes: Type.Integer({ minimum: 0, maximum: 536_870_912 }),
  uncompressedBytes: Type.Integer({ minimum: 0, maximum: 536_870_912 }),
}, { additionalProperties: false })
const ArchiveInventorySchema = Type.Object({
  entries: Type.Array(ArchiveEntrySchema, { maxItems: 10_000 }),
}, { additionalProperties: false })

const UploadSchema = Type.Object({
  filename: Type.String({ minLength: 1, maxLength: 255 }),
  claimedMime: Type.String({ minLength: 3, maxLength: 100, pattern: '^[a-z0-9.+-]+/[a-z0-9.+-]+$' }),
  sniffedMime: Type.String({ minLength: 3, maxLength: 100, pattern: '^[a-z0-9.+-]+/[a-z0-9.+-]+$' }),
  bytes: Type.Integer({ minimum: 1, maximum: 52_428_800 }),
}, { additionalProperties: false })

const PluginExecutionGrantSchema = Type.Object({
  installationId: Id,
  siteId: Id,
  ownerGeneration: Type.Integer({ minimum: 1 }),
  deadlineMilliseconds: Type.Integer({ minimum: 1, maximum: 30_000 }),
  memoryBytes: Type.Integer({ minimum: 1_048_576, maximum: 268_435_456 }),
  networkHosts: Type.Array(Type.String({ minLength: 1, maxLength: 253, pattern: '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$' }), { uniqueItems: true, maxItems: 20 }),
}, { additionalProperties: false })
export type PluginExecutionGrant = Static<typeof PluginExecutionGrantSchema>

export class SecurityBoundaryError extends Error {
  constructor(readonly code: 'archive-denied' | 'ssrf-denied' | 'upload-denied' | 'sandbox-denied' | 'replay-denied', message: string) {
    super(message)
    this.name = 'SecurityBoundaryError'
  }
}

export function validateArchive(value: unknown): Readonly<{ entries: number; compressedBytes: number; uncompressedBytes: number }> {
  const archive = parseStrict(ArchiveInventorySchema, value, 'security.archive')
  let compressedBytes = 0
  let uncompressedBytes = 0
  const paths = new Set<string>()
  for (const entry of archive.entries) {
    const normalizedPath = entry.path.endsWith('/') ? entry.path.slice(0, -1) : entry.path
    const segments = normalizedPath.replaceAll('\\', '/').split('/')
    if (!normalizedPath || entry.path.startsWith('/') || entry.path.includes('\\') || segments.some((segment) => segment === '' || segment === '.' || segment === '..') || paths.has(normalizedPath) || (entry.kind === 'file' && entry.path.endsWith('/')) || (entry.kind === 'directory' && (entry.compressedBytes !== 0 || entry.uncompressedBytes !== 0))) throw new SecurityBoundaryError('archive-denied', 'Archive path, identity, or directory size is unsafe.')
    paths.add(normalizedPath)
    compressedBytes += entry.compressedBytes
    uncompressedBytes += entry.uncompressedBytes
    if (!Number.isSafeInteger(compressedBytes) || !Number.isSafeInteger(uncompressedBytes) || entry.uncompressedBytes > Math.max(1, entry.compressedBytes) * 100) throw new SecurityBoundaryError('archive-denied', 'Archive expansion ratio is unsafe.')
  }
  if (uncompressedBytes > 536_870_912 || uncompressedBytes > Math.max(1, compressedBytes) * 100) throw new SecurityBoundaryError('archive-denied', 'Archive count or expanded size exceeds policy.')
  return Object.freeze({ entries: archive.entries.length, compressedBytes, uncompressedBytes })
}

function privateAddress(hostname: string): boolean {
  return hostname === 'localhost' || /^\[?::1\]?$/.test(hostname) || /^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname) || /^172\.(?:1[6-9]|2[0-9]|3[01])\./.test(hostname) || /^fc/i.test(hostname) || /^fd/i.test(hostname) || /^fe80:/i.test(hostname)
}

export function authorizeOutboundUrl(rawUrl: string, allowedHosts: ReadonlySet<string>): URL {
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new SecurityBoundaryError('ssrf-denied', 'Outbound URL is invalid.') }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash || privateAddress(host) || !allowedHosts.has(host) || [...allowedHosts].some((allowed) => allowed.includes('*') || privateAddress(allowed))) throw new SecurityBoundaryError('ssrf-denied', 'Outbound URL is outside the exact approved HTTPS host set.')
  return url
}

export function validateUpload(value: unknown): Static<typeof UploadSchema> {
  const upload = parseStrict(UploadSchema, value, 'security.upload')
  const forbidden = new Set(['image/svg+xml', 'text/html', 'application/xhtml+xml'])
  const extension = upload.filename.toLowerCase().split('.').pop()
  const expected: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' }
  if (upload.filename.includes('/') || upload.filename.includes('\\') || upload.filename === '.' || upload.filename === '..' || upload.claimedMime !== upload.sniffedMime || forbidden.has(upload.sniffedMime) || !extension || expected[extension] !== upload.sniffedMime || /\.(?:html?|svg|js)\./i.test(upload.filename)) throw new SecurityBoundaryError('upload-denied', 'Upload MIME, extension, or active content is denied.')
  return upload
}

export function authorizePluginExecution(value: unknown, input: { installationId: string; siteId: string; ownerGeneration: number; requestedNetworkHost: string | null }): PluginExecutionGrant {
  const grant = parseStrict(PluginExecutionGrantSchema, value, 'security.plugin-execution')
  const exact = grant.installationId === input.installationId && grant.siteId === input.siteId && grant.ownerGeneration === input.ownerGeneration
  const networkAllowed = input.requestedNetworkHost === null || (grant.networkHosts.includes(input.requestedNetworkHost) && !privateAddress(input.requestedNetworkHost))
  if (!exact || !networkAllowed) throw new SecurityBoundaryError('sandbox-denied', 'Plugin execution scope or network grant denied.')
  return grant
}

export function acceptWebhookOnce(eventHashSha256: string, seen: ReadonlySet<string>): string {
  const hash = parseStrict(Sha256, eventHashSha256, 'security.webhook-hash')
  if (seen.has(hash)) throw new SecurityBoundaryError('replay-denied', 'Webhook event is invalid or already consumed.')
  return hash
}
