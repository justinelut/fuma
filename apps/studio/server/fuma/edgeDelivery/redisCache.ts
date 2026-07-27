import { RedisClient, type RedisOptions } from 'bun'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { FumaRuntimeComponent } from '../runtime/lifecycle'
import type { EdgeCacheEntry, EdgeCacheStore } from './service'

const CACHE_KEY = /^[A-Za-z0-9:._-]{1,4096}$/
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

const DELETE_PREFIX_SCRIPT = `
local cursor = '0'
local keys = {}
repeat
  local page = redis.call('SCAN', cursor, 'MATCH', ARGV[1] .. '*', 'COUNT', 500)
  cursor = page[1]
  for _, key in ipairs(page[2]) do
    table.insert(keys, key)
    if #keys > tonumber(ARGV[2]) then return redis.error_reply('edge purge exceeds bounded key count') end
  end
until cursor == '0'
local removed = 0
for offset = 1, #keys, 500 do
  local batch = {}
  for index = offset, math.min(offset + 499, #keys) do table.insert(batch, keys[index]) end
  if #batch > 0 then removed = removed + redis.call('UNLINK', unpack(batch)) end
end
return removed
`

function validKey(value: string): string {
  if (!CACHE_KEY.test(value)) throw new RangeError('Edge cache key is invalid.')
  return value
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
    const redisOptions: RedisOptions = {
      autoReconnect: true,
      enableOfflineQueue: false,
      connectionTimeout: options.connectionTimeoutMs ?? 500,
      maxRetries: options.maxRetries ?? 5,
    }
    this.#client = new RedisClient(url, redisOptions)
    this.#prefix = `fuma:v1:${namespace}:edge:`
    this.#maxPurgeKeys = options.maxPurgeKeys ?? 10_000
    this.#maxTtlMs = options.maxTtlMs ?? 300_000
    if (!Number.isSafeInteger(this.#maxPurgeKeys) || this.#maxPurgeKeys < 1 || this.#maxPurgeKeys > 100_000) throw new RangeError('Edge purge bound is invalid.')
    if (!Number.isSafeInteger(this.#maxTtlMs) || this.#maxTtlMs < 1_000 || this.#maxTtlMs > 86_400_000) throw new RangeError('Edge cache TTL bound is invalid.')
  }

  connect(): Promise<void> { return this.#client.connect() }
  close(): void { this.#client.close() }

  async get(key: string): Promise<EdgeCacheEntry | null> {
    try {
      const raw = await this.#client.get(this.#physical(key))
      return raw === null ? null : deserialize(raw)
    } catch { return null }
  }

  async put(key: string, entry: EdgeCacheEntry): Promise<void> {
    const ttlMs = Math.max(1_000, Math.min(this.#maxTtlMs, Math.ceil(entry.staleUntil - Date.now())))
    try { await this.#client.set(this.#physical(key), serialize(entry), 'PX', ttlMs) } catch { /* cache is fail-open */ }
  }

  async deletePrefix(prefix: string): Promise<number> {
    const physicalPrefix = this.#physical(prefix)
    const raw = await this.#client.send('EVAL', [DELETE_PREFIX_SCRIPT, '0', physicalPrefix, String(this.#maxPurgeKeys)])
    return parseInteger(raw)
  }

  #physical(key: string): string { return `${this.#prefix}${validKey(key)}` }
}

export function createBunRedisEdgeCacheComponent(cache: BunRedisEdgeCache): FumaRuntimeComponent {
  return {
    id: 'edge-cache',
    async start() {
      await cache.connect()
      return { stop() { cache.close() } }
    },
  }
}
