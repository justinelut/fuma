import { RedisClient, type RedisOptions } from 'bun'
import { Type, safeParseValue, type TSchema, type Static } from '@core/utils/typeboxHelpers'
import type {
  FumaFencedLease,
  FumaLeaseRequest,
  FumaLimitDecision,
  FumaPresenceEntry,
  FumaRedisDriver,
  FumaRedisMessageListener,
  FumaRedisUnsubscribe,
} from './contracts'

const LIMIT_SCRIPT = `
local current = redis.call('INCRBY', KEYS[1], ARGV[1])
if current == tonumber(ARGV[1]) then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
local ttl = redis.call('PTTL', KEYS[1])
local remaining = tonumber(ARGV[2]) - current
if remaining < 0 then remaining = 0 end
return {current <= tonumber(ARGV[2]) and 1 or 0, remaining, ttl}
`

const PRESENCE_HEARTBEAT_SCRIPT = `
redis.call('ZADD', KEYS[1], ARGV[3] + ARGV[4], ARGV[1])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[4] + 1000)
redis.call('PEXPIRE', KEYS[2], ARGV[4] + 1000)
return 1
`

const PRESENCE_REMOVE_SCRIPT = `
local removed = redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
return removed
`

const PRESENCE_LIST_SCRIPT = `
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if #expired > 0 then
  redis.call('ZREM', KEYS[1], unpack(expired))
  redis.call('HDEL', KEYS[2], unpack(expired))
end
local active = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
local result = {}
for index = 1, #active, 2 do
  local payload = redis.call('HGET', KEYS[2], active[index])
  if payload then
    table.insert(result, active[index])
    table.insert(result, payload)
    table.insert(result, active[index + 1])
  end
end
return result
`

const LEASE_ACQUIRE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  if redis.call('HGET', KEYS[1], 'owner') == ARGV[1]
    and redis.call('HGET', KEYS[1], 'acquisition') == ARGV[2] then
    redis.call('PEXPIRE', KEYS[1], ARGV[3])
    return redis.call('HGET', KEYS[1], 'token')
  end
  return false
end
redis.call('INCR', KEYS[2])
local token = redis.call('GET', KEYS[2])
redis.call('HSET', KEYS[1], 'owner', ARGV[1], 'acquisition', ARGV[2], 'token', token)
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return token
`

const LEASE_RENEW_SCRIPT = `
if redis.call('HGET', KEYS[1], 'owner') == ARGV[1]
  and redis.call('HGET', KEYS[1], 'acquisition') == ARGV[2]
  and redis.call('HGET', KEYS[1], 'token') == ARGV[3] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[4])
end
return 0
`

const LEASE_RELEASE_SCRIPT = `
if redis.call('HGET', KEYS[1], 'owner') == ARGV[1]
  and redis.call('HGET', KEYS[1], 'acquisition') == ARGV[2]
  and redis.call('HGET', KEYS[1], 'token') == ARGV[3] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

const IntegerSchema = Type.Integer()
const NullableStringSchema = Type.Union([Type.String(), Type.Null()])
const LimitResultSchema = Type.Tuple([Type.Integer(), Type.Integer({ minimum: 0 }), Type.Integer()])
const PresenceResultSchema = Type.Array(Type.String())

function parseResult<T extends TSchema>(value: unknown, schema: T, operation: string): Static<T> {
  const result = safeParseValue(schema, value)
  if (!result.ok) {
    const detail = result.errors.map((error) => `${error.path}: ${error.message}`).join('; ')
    throw new Error(`Redis returned an invalid ${operation} response (${detail}).`)
  }
  return result.value
}

export interface BunRedisDriverOptions {
  connectionTimeoutMs?: number
  maxRetries?: number
}

/** Bun-native Redis adapter. Every compound mutation is one server-side atomic script. */
export class BunRedisDriver implements FumaRedisDriver {
  readonly #url: string
  readonly #options: RedisOptions
  #commands: RedisClient
  #subscriber: RedisClient
  readonly #subscriptions = new Map<string, Set<FumaRedisMessageListener>>()

  constructor(url: string, options: BunRedisDriverOptions = {}) {
    this.#url = url
    this.#options = {
      autoReconnect: true,
      enableOfflineQueue: false,
      connectionTimeout: options.connectionTimeoutMs ?? 500,
      maxRetries: options.maxRetries ?? 5,
    }
    this.#commands = this.#makeClient()
    this.#subscriber = this.#makeClient()
  }

  async connect(): Promise<void> {
    await Promise.all([this.#commands.connect(), this.#subscriber.connect()])
  }

  async reconnect(): Promise<void> {
    this.#commands.close()
    this.#subscriber.close()
    this.#commands = this.#makeClient()
    this.#subscriber = this.#makeClient()
    await this.connect()
    await Promise.all([...this.#subscriptions].flatMap(([channel, listeners]) => (
      [...listeners].map((listener) => this.#subscriber.subscribe(channel, listener))
    )))
  }

  async close(): Promise<void> {
    this.#commands.close()
    this.#subscriber.close()
  }

  async ping(): Promise<void> {
    const response = await this.#commands.ping('fuma-health')
    if (response !== 'fuma-health') throw new Error('Redis PING response did not match.')
  }

  get(key: string): Promise<string | null> {
    return this.#commands.get(key)
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.#commands.set(key, value, 'PX', ttlMs)
  }

  async delete(key: string): Promise<boolean> {
    return (await this.#commands.del(key)) > 0
  }

  async consumeLimit(key: string, limit: number, windowMs: number, cost: number): Promise<FumaLimitDecision> {
    const raw: unknown = await this.#commands.send('EVAL', [
      LIMIT_SCRIPT,
      '1',
      key,
      String(cost),
      String(limit),
      String(windowMs),
    ])
    const [allowed, remaining, retryAfterMs] = parseResult(raw, LimitResultSchema, 'limit')
    return { allowed: allowed === 1, remaining, retryAfterMs: Math.max(0, retryAfterMs) }
  }

  publish(channel: string, message: string): Promise<number> {
    return this.#commands.publish(channel, message)
  }

  async subscribe(channel: string, listener: FumaRedisMessageListener): Promise<FumaRedisUnsubscribe> {
    let listeners = this.#subscriptions.get(channel)
    if (!listeners) {
      listeners = new Set()
      this.#subscriptions.set(channel, listeners)
    }
    if (!listeners.has(listener)) {
      listeners.add(listener)
      await this.#subscriber.subscribe(channel, listener)
    }
    return async () => {
      const current = this.#subscriptions.get(channel)
      if (!current?.delete(listener)) return
      await this.#subscriber.unsubscribe(channel, listener)
      if (current.size === 0) this.#subscriptions.delete(channel)
    }
  }

  async heartbeatPresence(
    indexKey: string,
    payloadKey: string,
    memberId: string,
    payload: string,
    nowMs: number,
    ttlMs: number,
  ): Promise<void> {
    const raw: unknown = await this.#commands.send('EVAL', [
      PRESENCE_HEARTBEAT_SCRIPT,
      '2',
      indexKey,
      payloadKey,
      memberId,
      payload,
      String(nowMs),
      String(ttlMs),
    ])
    parseResult(raw, IntegerSchema, 'presence heartbeat')
  }

  async removePresence(indexKey: string, payloadKey: string, memberId: string): Promise<boolean> {
    const raw: unknown = await this.#commands.send('EVAL', [
      PRESENCE_REMOVE_SCRIPT,
      '2',
      indexKey,
      payloadKey,
      memberId,
    ])
    return parseResult(raw, IntegerSchema, 'presence remove') === 1
  }

  async listPresence(indexKey: string, payloadKey: string, nowMs: number): Promise<FumaPresenceEntry[]> {
    const raw: unknown = await this.#commands.send('EVAL', [
      PRESENCE_LIST_SCRIPT,
      '2',
      indexKey,
      payloadKey,
      String(nowMs),
    ])
    const flat = parseResult(raw, PresenceResultSchema, 'presence list')
    if (flat.length % 3 !== 0) throw new Error('Redis returned an invalid presence tuple count.')
    const entries: FumaPresenceEntry[] = []
    for (let index = 0; index < flat.length; index += 3) {
      const expiresAtMs = Number(flat[index + 2])
      if (!Number.isFinite(expiresAtMs)) throw new Error('Redis returned an invalid presence expiry.')
      entries.push({ memberId: flat[index]!, payload: flat[index + 1]!, expiresAtMs })
    }
    return entries
  }

  async acquireLease(leaseKey: string, fenceKey: string, request: FumaLeaseRequest): Promise<string | null> {
    const raw: unknown = await this.#commands.send('EVAL', [
      LEASE_ACQUIRE_SCRIPT,
      '2',
      leaseKey,
      fenceKey,
      request.ownerId,
      request.acquisitionId,
      String(request.ttlMs),
    ])
    return parseResult(raw, NullableStringSchema, 'lease acquisition')
  }

  async renewLease(leaseKey: string, lease: FumaFencedLease, ttlMs: number): Promise<boolean> {
    const raw: unknown = await this.#commands.send('EVAL', [
      LEASE_RENEW_SCRIPT,
      '1',
      leaseKey,
      lease.ownerId,
      lease.acquisitionId,
      lease.fencingToken,
      String(ttlMs),
    ])
    return parseResult(raw, IntegerSchema, 'lease renewal') === 1
  }

  async releaseLease(leaseKey: string, lease: FumaFencedLease): Promise<boolean> {
    const raw: unknown = await this.#commands.send('EVAL', [
      LEASE_RELEASE_SCRIPT,
      '1',
      leaseKey,
      lease.ownerId,
      lease.acquisitionId,
      lease.fencingToken,
    ])
    return parseResult(raw, IntegerSchema, 'lease release') === 1
  }

  #makeClient(): RedisClient {
    return new RedisClient(this.#url, this.#options)
  }
}
