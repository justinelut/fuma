import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import { normalizePublicHost } from '../freeHosts/service'

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const ClaimValueSchema = Type.String({ maxLength: 2_048 })

export const EdgeRequestContextSchema = Type.Object({
  platformId: IdSchema,
  organizationId: IdSchema,
  workspaceId: IdSchema,
  siteId: IdSchema,
  ownerKey: IdSchema,
  ownerGeneration: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  host: Type.String({ minLength: 1, maxLength: 253 }),
  releaseId: IdSchema,
  path: Type.String({ minLength: 1, maxLength: 2_048, pattern: '^/' }),
  memberId: Type.Union([IdSchema, Type.Null()]),
  accessFingerprint: Type.String({ minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' }),
  requestClaims: Type.Record(Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z0-9._-]+$' }), ClaimValueSchema, { maxProperties: 32 }),
}, { additionalProperties: false })
export type EdgeRequestContext = Static<typeof EdgeRequestContextSchema>

export type EdgeHoleScope = 'request' | 'member'
export interface EdgeHoleResolver {
  readonly id: string
  readonly scope: EdgeHoleScope
  resolve(context: EdgeRequestContext, input: Readonly<Record<string, string | number | boolean | null>>): Promise<string>
}
export type EdgeHoleDeclaration = Readonly<{
  marker: string
  resolverId: string
  input: Readonly<Record<string, string | number | boolean | null>>
}>

export interface EdgeCacheStore {
  get(key: string): Promise<EdgeCacheEntry | null>
  put(key: string, entry: EdgeCacheEntry): Promise<void>
  deletePrefix(prefix: string): Promise<number>
}
export type EdgeCacheEntry = Readonly<{
  body: Uint8Array
  etag: string
  contentType: string
  releaseId: string
  expiresAt: number
  staleUntil: number
  cacheControl: string
  vary: string | null
}>

export interface EdgeReleaseReader {
  read(context: EdgeRequestContext): Promise<Readonly<{
    bytes: Uint8Array
    hashSha256: string
    mimeType: string
    holes: readonly EdgeHoleDeclaration[]
  }>>
}
export interface EdgePointerAuthority {
  rollback(context: EdgeRequestContext, targetReleaseId: string, expectedCurrentReleaseId: string): Promise<void>
}

export class EdgeDeliveryError extends Error {
  readonly code: 'invalid-context' | 'unknown-hole' | 'member-required' | 'stale-pointer' | 'oversized-html'
  constructor(code: EdgeDeliveryError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'EdgeDeliveryError'
  }
}

const encoder = new TextEncoder()
function digest(value: string | Uint8Array): string { return new Bun.CryptoHasher('sha256').update(value).digest('hex') }
function segment(value: string): string { return Buffer.from(value).toString('base64url') }
function sitePrefix(host: string, siteId: string): string { return `edge:${segment(host)}:${segment(siteId)}:` }
function releasePrefix(context: Pick<EdgeRequestContext, 'host' | 'siteId' | 'releaseId'>): string {
  return `${sitePrefix(context.host, context.siteId)}${segment(context.releaseId)}:`
}
function cacheKey(context: EdgeRequestContext): string {
  const access = `${context.memberId ?? 'anonymous'}:${context.accessFingerprint}`
  return `${releasePrefix(context)}${digest(context.path)}:${digest(access)}`
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
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false
  return header.split(',').map((value) => value.trim()).some((value) => value === '*' || value === etag)
}

export type EdgeDeliveryResult = Readonly<{
  status: 200 | 304
  body: Uint8Array
  etag: string
  cacheControl: string
  contentType: string
  releaseId: string
  vary: string | null
}>

export type EdgeDeliveryDependencies = Readonly<{
  cache: EdgeCacheStore
  reader: EdgeReleaseReader
  pointers: EdgePointerAuthority
  holes: readonly EdgeHoleResolver[]
  now?: () => number
  htmlTtlMs?: number
  staleMs?: number
  maxHtmlBytes?: number
  maxHoleBytes?: number
}>

export class EdgeDeliveryService {
  readonly #holes: ReadonlyMap<string, EdgeHoleResolver>
  readonly #dependencies: EdgeDeliveryDependencies

  constructor(dependencies: EdgeDeliveryDependencies) {
    this.#dependencies = dependencies
    const entries = dependencies.holes.map((hole) => [hole.id, hole] as const)
    if (new Set(entries.map(([id]) => id)).size !== entries.length || entries.some(([id]) => !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id))) {
      throw new EdgeDeliveryError('unknown-hole', 'Hole resolver IDs must be unique normalized names.')
    }
    this.#holes = new Map(entries)
  }

  async serve(rawContext: unknown, ifNoneMatch?: string): Promise<EdgeDeliveryResult> {
    const context = normalizedContext(rawContext)
    const now = (this.#dependencies.now ?? Date.now)()
    const key = cacheKey(context)
    const cached = await this.#dependencies.cache.get(key)
    let entry = cached && cached.expiresAt > now ? cached : null
    if (!entry) {
      try {
        const artifact = await this.#dependencies.reader.read(context)
        if (!/^[a-f0-9]{64}$/.test(artifact.hashSha256)) throw new EdgeDeliveryError('invalid-context', 'Release artifact hash is invalid.')
        const resolvers = artifact.holes.map((hole) => {
          const resolver = this.#holes.get(hole.resolverId)
          if (!resolver) throw new EdgeDeliveryError('unknown-hole', `Unknown dynamic hole ${hole.resolverId}.`)
          if (!hole.marker || encoder.encode(hole.marker).byteLength > 2_048) throw new EdgeDeliveryError('unknown-hole', 'Dynamic hole marker is invalid.')
          return { ...hole, resolver }
        })
        const memberScoped = resolvers.some(({ resolver }) => resolver.scope === 'member')
        const requestScoped = resolvers.some(({ resolver }) => resolver.scope === 'request')
        if (memberScoped && context.memberId === null) throw new EdgeDeliveryError('member-required', 'Member-scoped hole requires an authenticated site member.')
        let body = artifact.bytes.slice()
        if (resolvers.length > 0) {
          const maxHtmlBytes = this.#dependencies.maxHtmlBytes ?? 2_097_152
          if (!artifact.mimeType.toLowerCase().startsWith('text/html') || artifact.bytes.byteLength > maxHtmlBytes) {
            throw new EdgeDeliveryError('oversized-html', 'Dynamic HTML exceeds the bounded edge rendering policy.')
          }
          let html: string
          try { html = new TextDecoder('utf-8', { fatal: true }).decode(artifact.bytes) } catch {
            throw new EdgeDeliveryError('oversized-html', 'Dynamic HTML must be valid UTF-8.')
          }
          const maxHoleBytes = this.#dependencies.maxHoleBytes ?? 262_144
          for (const hole of resolvers) {
            const replacement = await hole.resolver.resolve(context, hole.input)
            if (encoder.encode(replacement).byteLength > maxHoleBytes) throw new EdgeDeliveryError('oversized-html', 'Dynamic hole output exceeds its byte budget.')
            html = html.replaceAll(hole.marker, replacement)
          }
          body = encoder.encode(html)
          if (body.byteLength > maxHtmlBytes) throw new EdgeDeliveryError('oversized-html', 'Rendered HTML exceeds the bounded edge rendering policy.')
        }
        const isImmutable = immutableArtifact(context.path, artifact.hashSha256, resolvers.length > 0)
        const cacheControl = requestScoped
          ? 'private, no-store'
          : isImmutable
            ? 'public, max-age=31536000, immutable'
            : memberScoped
              ? 'private, max-age=30, stale-while-revalidate=90'
              : 'public, max-age=30, stale-while-revalidate=90'
        const bodyHash = digest(body)
        entry = Object.freeze({
          body,
          etag: `"${bodyHash}"`,
          contentType: artifact.mimeType,
          releaseId: context.releaseId,
          expiresAt: now + (requestScoped ? 0 : this.#dependencies.htmlTtlMs ?? 30_000),
          staleUntil: now + (requestScoped ? 0 : this.#dependencies.staleMs ?? 120_000),
          cacheControl,
          vary: memberScoped ? 'Cookie, Authorization' : null,
        })
        if (!requestScoped) await this.#dependencies.cache.put(key, entry)
      } catch (error) {
        if (cached && cached.staleUntil > now) entry = cached
        else throw error
      }
    }
    const notModified = matchesEtag(ifNoneMatch, entry.etag)
    return Object.freeze({
      status: notModified ? 304 as const : 200 as const,
      body: notModified ? new Uint8Array() : entry.body.slice(),
      etag: entry.etag,
      cacheControl: entry.cacheControl,
      contentType: entry.contentType,
      releaseId: entry.releaseId,
      vary: entry.vary,
    })
  }

  async purge(hostInput: string, siteId: string, releaseId?: string): Promise<number> {
    const host = normalizePublicHost(hostInput)
    if (!Value.Check(IdSchema, siteId) || (releaseId !== undefined && !Value.Check(IdSchema, releaseId))) {
      throw new EdgeDeliveryError('invalid-context', 'Purge scope is invalid.')
    }
    return await this.#dependencies.cache.deletePrefix(releaseId ? `${sitePrefix(host, siteId)}${segment(releaseId)}:` : sitePrefix(host, siteId))
  }

  async warm(contexts: readonly EdgeRequestContext[]): Promise<readonly string[]> {
    const etags: string[] = []
    for (const context of contexts) etags.push((await this.serve(context)).etag)
    return Object.freeze(etags)
  }

  async rollback(input: Readonly<{ context: EdgeRequestContext; targetReleaseId: string }>): Promise<void> {
    const context = normalizedContext(input.context)
    if (!Value.Check(IdSchema, input.targetReleaseId) || context.releaseId === input.targetReleaseId) {
      throw new EdgeDeliveryError('stale-pointer', 'Rollback target must differ from the active release.')
    }
    await this.#dependencies.pointers.rollback(context, input.targetReleaseId, context.releaseId)
    await this.purge(context.host, context.siteId, context.releaseId)
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
