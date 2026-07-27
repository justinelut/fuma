import { RedisClient, type RedisOptions } from 'bun'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { FumaRuntimeComponent } from '../runtime/lifecycle'
import type { EdgeCacheEntry, EdgeCacheStore } from './service'

const CACHE_KEY = /^edge:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[a-f0-9]{64}:[a-f0-9]{64}$/
const CACHE_PREFIX = /^edge:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:(?:[A-Za-z0-9_-]+:)?$/
const NAMESPACE = /^[a-z0-9][a-z0-9._-]{0,62}$/
const EtagSchema = Type.String({ minLength: 66, maxLength: 66, pattern: '^"[a-f0-9]{64}"$' })
const StoredEntrySchema = Type.Object({
  bodyBase64: Type.String({ maxLength: 4_000_000 }),
  etag: EtagSchema,
  contentType: Type.String({ minLength: 3, maxLength: 255 }),
  releaseId: Type.String({ minLength: 1, maxLength: 255 }),
  expiresAt: Type.Number({ minimum: 0 }),
  staleUntil: Type.Number({ minimum: 0 }),
  cacheControl: Type.String({ minLength: 1, maxLength: 128 }),
  vary: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
}, { additionalProperties: false })

const PUT_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('SADD', KEYS[2], KEYS[1])
redis.call('SADD', KEYS[3], KEYS[1])
redis.call('SADD', KEYS[4], KEYS[3])
redis.call('PEXPIRE', KEYS[2], ARGV[2])
redis.call('PEXPIRE', KEYS[3], ARGV[2])
redis.call('PEXPIRE', KEYS[4], ARGV[2])
return 1
`
const DELETE_RELEASE_SCRIPT = `
local keys = redis.call('SMEMBERS', KEYS[1])
if #keys > tonumber(ARGV[1]) then return redis.error_reply('edge purge exceeds bounded key count') end
local removed = 0
for offset = 1, #keys, 500 do
  local batch = {}
  for index = offset, math.min(offset + 499, #keys) do table.insert(batch, keys[index]) end
  if #batch > 0 then
    removed = removed + redis.call('UNLINK', unpack(batch))
    redis.call('SREM', KEYS[2], unpack(batch))
  end
end
redis.call('UNLINK', KEYS[1])
return removed
`
const DELETE_SITE_SCRIPT = `
local entries = redis.call('SMEMBERS', KEYS[1])
local indexes = redis.call('SMEMBERS', KEYS[2])
if #entries + #indexes > tonumber(ARGV[1]) then return redis.error_reply('edge purge exceeds bounded key count') end
local removed = 0
for offset = 1, #entries, 500 do
  local batch = {}
  for index = offset, math.min(offset + 499, #entries) do table.insert(batch, entries[index]) end
  if #batch > 0 then removed = removed + redis.call('UNLINK', unpack(batch)) end
end
for offset = 1, #indexes, 500 do
  local batch = {}
  for index = offset, math.min(offset + 499, #indexes) do table.insert(batch, indexes[index]) end
  if #batch > 0 then redis.call('UNLINK', unpack(batch)) end
end
redis.call('UNLINK', KEYS[1], KEYS[2])
return removed
`

function parseKey(value: string): readonly [string, string, string] {
  if (!CACHE_KEY.test(value)) throw new RangeError('Edge cache key is invalid.')
  const [, host, site, release] = value.split(':')
  return [host!, site!, release!]
}
function parsePrefix(value: string): Readonly<{ host: string; site: string; release: string | null }> {
  if (!CACHE_PREFIX.test(value)) throw new RangeError('Edge cache prefix is invalid.')
  const [, host, site, release] = value.slice(0, -1).split(':')
  return { host: host!, site: site!, release: release ?? null }
}
function parseInteger(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Redis returned an invalid edge purge count.')
  return parsed
}
function serialize(entry: EdgeCacheEntry): string {
  const value = {
    bodyBase64: Buffer.from(entry.body).toString('base64'),
    etag: entry.etag,
    contentType: entry.contentType,
    releaseId: entry.releaseId,
    expiresAt: entry.expiresAt,
    staleUntil: entry.staleUntil,
    cacheControl: entry.cacheControl,
    vary: entry.vary,
  }
  if (!safeParseValue(StoredEntrySchema, value).ok) throw new TypeError('Edge cache entry is invalid.')
  return JSON.stringify(value)
}
function deserialize(raw: string): EdgeCacheEntry | null {
  let candidate: unknown
  try { candidate = JSON.parse(raw) } catch { return null }
  const parsed = safeParseValue(StoredEntrySchema, candidate)
  if (!parsed.ok) return null
  const body = new Uint8Array(Buffer.from(parsed.value.bodyBase64, 'base64'))
  if (body.byteLength > 2_097_152 || parsed.value.staleUntil < parsed.value.expiresAt) return null
  return Object.freeze({ ...parsed.value, body })
}

export type BunRedisEdgeCacheOptions = Readonly<{
  connectionTimeoutMs?: number
  maxRetries?: number
  maxPurgeKeys?: number
  maxTtlMs?: number
}>

/** Ephemeral production edge cache. Reads/writes fail open; explicit purge fails closed. */
export class BunRedisEdgeCache implements EdgeCacheStore {
  readonly #client: RedisClient
  readonly #prefix: string
  readonly #maxPurgeKeys: number
  readonly #maxTtlMs: number

  constructor(url: string, namespace: string, options: BunRedisEdgeCacheOptions = {}) {
    if (!NAMESPACE.test(namespace)) throw new RangeError('Edge cache namespace is invalid.')
    const redisOptions: RedisOptions = { autoReconnect: true, enableOfflineQueue: false, connectionTimeout: options.connectionTimeoutMs ?? 500, maxRetries: options.maxRetries ?? 5 }
    this.#client = new RedisClient(url, redisOptions)
    this.#prefix = `fuma:v1:${namespace}:edge-cache:`
    this.#maxPurgeKeys = options.maxPurgeKeys ?? 10_000
    this.#maxTtlMs = options.maxTtlMs ?? 300_000
    if (!Number.isSafeInteger(this.#maxPurgeKeys) || this.#maxPurgeKeys < 1 || this.#maxPurgeKeys > 100_000) throw new RangeError('Edge purge bound is invalid.')
    if (!Number.isSafeInteger(this.#maxTtlMs) || this.#maxTtlMs < 1_000 || this.#maxTtlMs > 86_400_000) throw new RangeError('Edge cache TTL bound is invalid.')
  }

  connect(): Promise<void> { return this.#client.connect() }
  close(): void { this.#client.close() }

  async get(key: string): Promise<EdgeCacheEntry | null> {
    try {
      const raw = await this.#client.get(this.#entry(key))
      return raw === null ? null : deserialize(raw)
    } catch { return null }
  }

  async put(key: string, entry: EdgeCacheEntry): Promise<void> {
    const [host, site, release] = parseKey(key)
    const ttlMs = Math.max(1_000, Math.min(this.#maxTtlMs, Math.ceil(entry.staleUntil - Date.now())))
    try {
      await this.#client.send('EVAL', [PUT_SCRIPT, '4', this.#entry(key), this.#siteIndex(host, site), this.#releaseIndex(host, site, release), this.#siteReleaseIndexes(host, site), serialize(entry), String(ttlMs)])
    } catch { /* cache is fail-open */ }
  }

  async deletePrefix(prefix: string): Promise<number> {
    const parsed = parsePrefix(prefix)
    const raw = parsed.release === null
      ? await this.#client.send('EVAL', [DELETE_SITE_SCRIPT, '2', this.#siteIndex(parsed.host, parsed.site), this.#siteReleaseIndexes(parsed.host, parsed.site), String(this.#maxPurgeKeys)])
      : await this.#client.send('EVAL', [DELETE_RELEASE_SCRIPT, '2', this.#releaseIndex(parsed.host, parsed.site, parsed.release), this.#siteIndex(parsed.host, parsed.site), String(this.#maxPurgeKeys)])
    return parseInteger(raw)
  }

  #entry(key: string): string { parseKey(key); return `${this.#prefix}entry:${key}` }
  #siteIndex(host: string, site: string): string { return `${this.#prefix}index:site:${host}:${site}` }
  #releaseIndex(host: string, site: string, release: string): string { return `${this.#prefix}index:release:${host}:${site}:${release}` }
  #siteReleaseIndexes(host: string, site: string): string { return `${this.#prefix}index:releases:${host}:${site}` }
}

export function createBunRedisEdgeCacheComponent(cache: BunRedisEdgeCache): FumaRuntimeComponent {
  return { id: 'edge-cache', async start() { await cache.connect(); return { stop() { cache.close() } } } }
}
