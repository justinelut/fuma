import {
  FumaRedisTimeoutError,
  FumaRedisUnavailableError,
  type FumaFencedLease,
  type FumaLeaseRequest,
  type FumaLimitDecision,
  type FumaLimitRequest,
  type FumaPresenceEntry,
  type FumaRedisCapability,
  type FumaRedisDriver,
  type FumaRedisHealth,
  type FumaRedisMessageListener,
  type FumaRedisUnsubscribe,
} from './contracts'
import { FumaRedisKeyspace } from './keyspace'

const MIN_TTL_MS = 50
const MAX_TTL_MS = 86_400_000
const MAX_CACHE_BYTES = 262_144
const MAX_MESSAGE_BYTES = 65_536
const MAX_PRESENCE_BYTES = 16_384
const MAX_LIMIT = 1_000_000

export interface FumaRedisCoordinationOptions {
  namespace: string
  driver: FumaRedisDriver
  timeoutMs?: number
  nowMs?: () => number
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}.`)
  }
  return value
}

function boundedPayload(value: string, maximum: number, label: string): void {
  if (utf8Bytes(value) > maximum) throw new RangeError(`${label} exceeds ${maximum} UTF-8 bytes.`)
}

function boundedIdentifier(value: string, label: string): void {
  if (!value || utf8Bytes(value) > 512) {
    throw new RangeError(`${label} must contain 1-512 UTF-8 bytes.`)
  }
}

export class FumaRedisCoordination {
  readonly #driver: FumaRedisDriver
  readonly #keys: FumaRedisKeyspace
  readonly #timeoutMs: number
  readonly #nowMs: () => number
  #health: FumaRedisHealth = {
    status: 'unavailable',
    ready: false,
    checkedAtMs: null,
    lastSuccessAtMs: null,
    lastFailureAtMs: null,
    failure: 'Redis has not completed a health check.',
  }

  constructor(options: FumaRedisCoordinationOptions) {
    this.#driver = options.driver
    this.#keys = new FumaRedisKeyspace(options.namespace)
    this.#timeoutMs = boundedInteger(options.timeoutMs ?? 500, 1, 30_000, 'Redis timeout')
    this.#nowMs = options.nowMs ?? Date.now
  }

  health(): FumaRedisHealth {
    return { ...this.#health }
  }

  async connect(): Promise<void> {
    await this.#required('leases', 'connect', () => this.#driver.connect())
    await this.probe()
  }

  async reconnect(): Promise<void> {
    await this.#required('leases', 'reconnect', () => this.#driver.reconnect())
    await this.probe()
  }

  async close(): Promise<void> {
    await this.#bounded('close', () => this.#driver.close())
    this.#health = {
      ...this.#health,
      status: 'unavailable',
      ready: false,
      checkedAtMs: this.#nowMs(),
      failure: 'Redis coordination is closed.',
    }
  }

  async probe(): Promise<FumaRedisHealth> {
    try {
      await this.#bounded('ping', () => this.#driver.ping())
      this.#markSuccess()
    } catch (error) {
      this.#markFailure(error)
    }
    return this.health()
  }

  async cacheGet(key: string): Promise<string | null> {
    return this.#optional('cache', 'get', null, () => this.#driver.get(this.#keys.key('cache', key)))
  }

  async cacheSet(key: string, value: string, ttlMs: number): Promise<boolean> {
    boundedPayload(value, MAX_CACHE_BYTES, 'Redis cache value')
    const ttl = boundedInteger(ttlMs, MIN_TTL_MS, MAX_TTL_MS, 'Redis cache TTL')
    return this.#optional('cache', 'set', false, async () => {
      await this.#driver.set(this.#keys.key('cache', key), value, ttl)
      return true
    })
  }

  async cacheDelete(key: string): Promise<boolean> {
    return this.#optional('cache', 'delete', false, () => this.#driver.delete(this.#keys.key('cache', key)))
  }

  async consumeLimit(key: string, request: FumaLimitRequest): Promise<FumaLimitDecision> {
    const limit = boundedInteger(request.limit, 1, MAX_LIMIT, 'Redis limit')
    const cost = boundedInteger(request.cost ?? 1, 1, limit, 'Redis limit cost')
    const windowMs = boundedInteger(request.windowMs, MIN_TTL_MS, MAX_TTL_MS, 'Redis limit window')
    return this.#required('limits', 'consume', () => (
      this.#driver.consumeLimit(this.#keys.key('limits', key), limit, windowMs, cost)
    ))
  }

  async publish(channel: string, message: string): Promise<number> {
    boundedPayload(message, MAX_MESSAGE_BYTES, 'Redis pub/sub message')
    return this.#optional('pubsub', 'publish', 0, () => (
      this.#driver.publish(this.#keys.channel(channel), message)
    ))
  }

  async subscribe(channel: string, listener: FumaRedisMessageListener): Promise<FumaRedisUnsubscribe> {
    const pending = this.#driver.subscribe(this.#keys.channel(channel), listener)
    try {
      const unsubscribe = await this.#bounded('pubsub.subscribe', () => pending)
      this.#markSuccess()
      return unsubscribe
    } catch (error) {
      this.#markFailure(error)
      void pending.then(async (unsubscribe) => {
        try {
          await unsubscribe()
        } catch (cleanupError) {
          console.warn('[fuma:redis] failed to clean up a late subscription:', cleanupError)
        }
      }).catch(() => undefined)
      return async () => {}
    }
  }

  async heartbeatPresence(
    room: string,
    memberId: string,
    payload: string,
    ttlMs: number,
  ): Promise<boolean> {
    boundedIdentifier(memberId, 'Redis presence member ID')
    boundedPayload(payload, MAX_PRESENCE_BYTES, 'Redis presence payload')
    const ttl = boundedInteger(ttlMs, MIN_TTL_MS, MAX_TTL_MS, 'Redis presence TTL')
    const keys = this.#keys.presence(room)
    return this.#optional('presence', 'heartbeat', false, async () => {
      await this.#driver.heartbeatPresence(
        keys.indexKey,
        keys.payloadKey,
        memberId,
        payload,
        this.#nowMs(),
        ttl,
      )
      return true
    })
  }

  async removePresence(room: string, memberId: string): Promise<boolean> {
    boundedIdentifier(memberId, 'Redis presence member ID')
    const keys = this.#keys.presence(room)
    return this.#optional('presence', 'remove', false, () => (
      this.#driver.removePresence(keys.indexKey, keys.payloadKey, memberId)
    ))
  }

  async listPresence(room: string): Promise<FumaPresenceEntry[]> {
    const keys = this.#keys.presence(room)
    return this.#optional('presence', 'list', [], () => (
      this.#driver.listPresence(keys.indexKey, keys.payloadKey, this.#nowMs())
    ))
  }

  async acquireLease(request: FumaLeaseRequest): Promise<FumaFencedLease | null> {
    boundedIdentifier(request.ownerId, 'Redis lease owner ID')
    boundedIdentifier(request.acquisitionId, 'Redis lease acquisition ID')
    const ttlMs = boundedInteger(request.ttlMs, MIN_TTL_MS, MAX_TTL_MS, 'Redis lease TTL')
    const keys = this.#keys.lease(request.resource)
    const fencingToken = await this.#required('leases', 'acquire', () => (
      this.#driver.acquireLease(keys.leaseKey, keys.fenceKey, { ...request, ttlMs })
    ))
    if (fencingToken === null) return null
    return {
      resource: request.resource,
      ownerId: request.ownerId,
      acquisitionId: request.acquisitionId,
      fencingToken,
      expiresAtMs: this.#nowMs() + ttlMs,
    }
  }

  async renewLease(lease: FumaFencedLease, ttlMs: number): Promise<FumaFencedLease | null> {
    const ttl = boundedInteger(ttlMs, MIN_TTL_MS, MAX_TTL_MS, 'Redis lease TTL')
    const { leaseKey } = this.#keys.lease(lease.resource)
    const renewed = await this.#required('leases', 'renew', () => this.#driver.renewLease(leaseKey, lease, ttl))
    return renewed ? { ...lease, expiresAtMs: this.#nowMs() + ttl } : null
  }

  async releaseLease(lease: FumaFencedLease): Promise<boolean> {
    const { leaseKey } = this.#keys.lease(lease.resource)
    return this.#required('leases', 'release', () => this.#driver.releaseLease(leaseKey, lease))
  }

  async #optional<T>(
    capability: FumaRedisCapability,
    operation: string,
    fallback: T,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      const value = await this.#bounded(`${capability}.${operation}`, run)
      this.#markSuccess()
      return value
    } catch (error) {
      this.#markFailure(error)
      return fallback
    }
  }

  async #required<T>(
    capability: FumaRedisCapability,
    operation: string,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      const value = await this.#bounded(`${capability}.${operation}`, run)
      this.#markSuccess()
      return value
    } catch (error) {
      this.#markFailure(error)
      throw new FumaRedisUnavailableError(capability, operation, error)
    }
  }

  async #bounded<T>(operation: string, run: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        run(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new FumaRedisTimeoutError(operation, this.#timeoutMs)), this.#timeoutMs)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  #markSuccess(): void {
    const now = this.#nowMs()
    this.#health = {
      ...this.#health,
      status: 'healthy',
      ready: true,
      checkedAtMs: now,
      lastSuccessAtMs: now,
      failure: null,
    }
  }

  #markFailure(error: unknown): void {
    const now = this.#nowMs()
    this.#health = {
      ...this.#health,
      status: 'unavailable',
      ready: false,
      checkedAtMs: now,
      lastFailureAtMs: now,
      failure: error instanceof FumaRedisTimeoutError
        ? error.message
        : 'Redis operation failed.',
    }
  }
}
