import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import { normalizePublicHost } from '../freeHosts/service'

export const EdgeRequestContextSchema = Type.Object({
  host: Type.String({ minLength: 1, maxLength: 253 }),
  siteId: Type.String({ minLength: 1, maxLength: 255 }),
  releaseId: Type.String({ minLength: 1, maxLength: 255 }),
  path: Type.String({ minLength: 1, maxLength: 2048, pattern: '^/' }),
  memberId: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
  accessFingerprint: Type.String({ minLength: 1, maxLength: 256 }),
}, { additionalProperties: false })
export type EdgeRequestContext = Static<typeof EdgeRequestContextSchema>
export type EdgeHoleScope = 'request' | 'member'
export interface EdgeHoleResolver { readonly id: string; readonly scope: EdgeHoleScope; resolve(context: EdgeRequestContext, input: unknown): Promise<string> }
export interface EdgeCacheStore { get(key: string): Promise<EdgeCacheEntry | null>; put(key: string, entry: EdgeCacheEntry): Promise<void>; deletePrefix(prefix: string): Promise<number> }
export type EdgeCacheEntry = Readonly<{ body: Uint8Array; etag: string; contentType: string; releaseId: string; expiresAt: number; staleUntil: number }>
export interface EdgeReleaseReader {
  read(releaseId: string, path: string): Promise<Readonly<{
    bytes: Uint8Array
    hashSha256: string
    mimeType: string
    holes: readonly Readonly<{ marker: string; resolverId: string; input: unknown }>[]
  }>>
}
export interface EdgePointerAuthority { rollback(siteId: string, targetReleaseId: string, expectedCurrentReleaseId: string): Promise<void> }

export class EdgeDeliveryError extends Error {
  readonly code: 'invalid-context' | 'unknown-hole' | 'member-required' | 'stale-pointer' | 'oversized-html';
  constructor(code: 'invalid-context' | 'unknown-hole' | 'member-required' | 'stale-pointer' | 'oversized-html', message: string) {
    super(message); this.code = code;
    this.name = 'EdgeDeliveryError'
  }
}

function digest(value: string | Uint8Array): string { return new Bun.CryptoHasher('sha256').update(value).digest('hex') }
function cacheKey(context: EdgeRequestContext, memberScoped: boolean): string {
  const access = memberScoped ? `${context.memberId ?? 'anonymous'}:${context.accessFingerprint}` : context.accessFingerprint
  return `edge:${context.host}:${context.siteId}:${context.releaseId}:${digest(context.path)}:${digest(access)}`
}
function normalizedContext(raw: unknown): EdgeRequestContext {
  if (!Value.Check(EdgeRequestContextSchema, raw)) throw new EdgeDeliveryError('invalid-context', 'Invalid edge request context.')
  const input = raw as EdgeRequestContext
  if (input.path.includes('\\') || input.path.includes('\0') || input.path.split('/').some((part) => part === '..') || input.path.includes('?') || input.path.includes('#')) {
    throw new EdgeDeliveryError('invalid-context', 'Edge path must be canonical and query-free.')
  }
  return Object.freeze({ ...structuredClone(input), host: normalizePublicHost(input.host) })
}
function immutableArtifact(path: string, artifactHash: string, dynamic: boolean): boolean {
  return !dynamic && artifactHash.length === 64 && path.toLowerCase().includes(artifactHash.toLowerCase())
}

export class EdgeDeliveryService {
  private readonly holes: ReadonlyMap<string, EdgeHoleResolver>
  private readonly dependencies: Readonly<{
    cache: EdgeCacheStore
    reader: EdgeReleaseReader
    pointers: EdgePointerAuthority
    holes: readonly EdgeHoleResolver[]
    now?: () => number
    htmlTtlMs?: number
    staleMs?: number
    maxHtmlBytes?: number
    maxHoleBytes?: number
  }>;
  constructor(dependencies: Readonly<{
    cache: EdgeCacheStore
    reader: EdgeReleaseReader
    pointers: EdgePointerAuthority
    holes: readonly EdgeHoleResolver[]
    now?: () => number
    htmlTtlMs?: number
    staleMs?: number
    maxHtmlBytes?: number
    maxHoleBytes?: number
  }>) { this.dependencies = dependencies;
    const entries = dependencies.holes.map((hole) => [hole.id, hole] as const)
    if (new Set(entries.map(([id]) => id)).size !== entries.length) throw new EdgeDeliveryError('unknown-hole', 'Hole resolver IDs must be unique.')
    this.holes = new Map(entries)
  }

  async serve(rawContext: unknown, ifNoneMatch?: string): Promise<Readonly<{ status: 200 | 304; body: Uint8Array; etag: string; cacheControl: string; contentType: string }>> {
    const context = normalizedContext(rawContext)
    const artifact = await this.dependencies.reader.read(context.releaseId, context.path)
    if (!/^[a-f0-9]{64}$/.test(artifact.hashSha256)) throw new EdgeDeliveryError('invalid-context', 'Release artifact hash is invalid.')
    const resolvers = artifact.holes.map((hole) => {
      const resolver = this.holes.get(hole.resolverId)
      if (!resolver) throw new EdgeDeliveryError('unknown-hole', `Unknown dynamic hole ${hole.resolverId}.`)
      if (!hole.marker || hole.marker.length > 512) throw new EdgeDeliveryError('unknown-hole', 'Dynamic hole marker is invalid.')
      return { ...hole, resolver }
    })
    const memberScoped = resolvers.some(({ resolver }) => resolver.scope === 'member')
    const requestScoped = resolvers.some(({ resolver }) => resolver.scope === 'request')
    if (memberScoped && context.memberId === null) throw new EdgeDeliveryError('member-required', 'Member-scoped hole requires an authenticated site member.')
    const now = (this.dependencies.now ?? Date.now)()
    const key = cacheKey(context, memberScoped)
    const cached = requestScoped ? null : await this.dependencies.cache.get(key)
    let entry = cached && cached.expiresAt > now ? cached : null
    if (!entry) {
      try {
        let body = artifact.bytes.slice()
        if (resolvers.length > 0) {
          const maxHtmlBytes = this.dependencies.maxHtmlBytes ?? 2_097_152
          if (!artifact.mimeType.toLowerCase().startsWith('text/html') || artifact.bytes.byteLength > maxHtmlBytes) {
            throw new EdgeDeliveryError('oversized-html', 'Dynamic HTML exceeds the bounded edge rendering policy.')
          }
          let html = new TextDecoder('utf-8', { fatal: true }).decode(artifact.bytes)
          const maxHoleBytes = this.dependencies.maxHoleBytes ?? 262_144
          for (const hole of resolvers) {
            const replacement = await hole.resolver.resolve(context, hole.input)
            if (new TextEncoder().encode(replacement).byteLength > maxHoleBytes) throw new EdgeDeliveryError('oversized-html', 'Dynamic hole output exceeds its byte budget.')
            html = html.replaceAll(hole.marker, replacement)
          }
          body = new TextEncoder().encode(html)
          if (body.byteLength > maxHtmlBytes) throw new EdgeDeliveryError('oversized-html', 'Rendered HTML exceeds the bounded edge rendering policy.')
        }
        const bodyHash = digest(body)
        entry = Object.freeze({
          body,
          etag: `"${bodyHash}"`,
          contentType: artifact.mimeType,
          releaseId: context.releaseId,
          expiresAt: now + (requestScoped ? 0 : this.dependencies.htmlTtlMs ?? 30_000),
          staleUntil: now + (requestScoped ? 0 : this.dependencies.staleMs ?? 120_000),
        })
        if (!requestScoped) await this.dependencies.cache.put(key, entry)
      } catch (error) {
        if (!requestScoped && cached && cached.staleUntil > now) entry = cached
        else throw error
      }
    }
    const isImmutable = immutableArtifact(context.path, artifact.hashSha256, resolvers.length > 0)
    const cacheControl = requestScoped
      ? 'private, no-store'
      : isImmutable
        ? 'public, max-age=31536000, immutable'
        : 'private, max-age=30, stale-while-revalidate=90'
    if (ifNoneMatch === entry.etag) return Object.freeze({ status: 304 as const, body: new Uint8Array(), etag: entry.etag, cacheControl, contentType: entry.contentType })
    return Object.freeze({ status: 200 as const, body: entry.body.slice(), etag: entry.etag, cacheControl, contentType: entry.contentType })
  }

  async purge(hostInput: string, siteId: string, releaseId?: string): Promise<number> {
    const host = normalizePublicHost(hostInput)
    return await this.dependencies.cache.deletePrefix(`edge:${host}:${siteId}:${releaseId ? `${releaseId}:` : ''}`)
  }
  async warm(contexts: readonly EdgeRequestContext[]): Promise<void> { for (const context of contexts) await this.serve(context) }
  async rollback(input: Readonly<{ host: string; siteId: string; currentReleaseId: string; targetReleaseId: string }>): Promise<void> {
    if (input.currentReleaseId === input.targetReleaseId) throw new EdgeDeliveryError('stale-pointer', 'Rollback target must differ from the active release.')
    await this.dependencies.pointers.rollback(input.siteId, input.targetReleaseId, input.currentReleaseId)
    await this.purge(input.host, input.siteId, input.currentReleaseId)
  }
}

export class MemoryEdgeCache implements EdgeCacheStore {
  readonly entries = new Map<string, EdgeCacheEntry>()
  async get(key: string) { return structuredClone(this.entries.get(key) ?? null) }
  async put(key: string, entry: EdgeCacheEntry) { this.entries.set(key, structuredClone(entry)) }
  async deletePrefix(prefix: string) {
    let count = 0
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) { this.entries.delete(key); count += 1 }
    return count
  }
}
