export type FumaRedisCapability = 'cache' | 'limits' | 'pubsub' | 'presence' | 'leases'
export type FumaRedisFailureMode = 'fail-open' | 'fail-closed'
export type FumaRedisHealthStatus = 'healthy' | 'unavailable'

export const FUMA_REDIS_FAILURE_POLICY: Readonly<Record<FumaRedisCapability, FumaRedisFailureMode>> = Object.freeze({
  cache: 'fail-open',
  limits: 'fail-closed',
  pubsub: 'fail-open',
  presence: 'fail-open',
  leases: 'fail-closed',
})

export interface FumaRedisHealth {
  status: FumaRedisHealthStatus
  ready: boolean
  checkedAtMs: number | null
  lastSuccessAtMs: number | null
  lastFailureAtMs: number | null
  failure: string | null
}

export interface FumaRedisHealthDecision {
  capability: FumaRedisCapability
  mode: FumaRedisFailureMode
  allowed: boolean
  degraded: boolean
  reason: string
}

export function decideFumaRedisAvailability(
  capability: FumaRedisCapability,
  health: FumaRedisHealth,
): FumaRedisHealthDecision {
  const mode = FUMA_REDIS_FAILURE_POLICY[capability]
  if (health.status === 'healthy') {
    return { capability, mode, allowed: true, degraded: false, reason: 'Redis is healthy.' }
  }
  if (mode === 'fail-open') {
    return {
      capability,
      mode,
      allowed: true,
      degraded: true,
      reason: `${capability} is ephemeral and must fall back to absence or durable reconciliation.`,
    }
  }
  return {
    capability,
    mode,
    allowed: false,
    degraded: true,
    reason: `${capability} cannot make a safe decision while Redis is unavailable.`,
  }
}

export class FumaRedisUnavailableError extends Error {
  readonly capability: FumaRedisCapability
  readonly operation: string

  constructor(capability: FumaRedisCapability, operation: string, cause: unknown) {
    super(`Redis ${capability} operation ${operation} is unavailable.`, { cause })
    this.name = 'FumaRedisUnavailableError'
    this.capability = capability
    this.operation = operation
  }
}

export class FumaRedisTimeoutError extends Error {
  readonly operation: string
  readonly timeoutMs: number

  constructor(operation: string, timeoutMs: number) {
    super(`Redis operation ${operation} exceeded its ${timeoutMs}ms deadline.`)
    this.name = 'FumaRedisTimeoutError'
    this.operation = operation
    this.timeoutMs = timeoutMs
  }
}

export interface FumaLimitRequest {
  limit: number
  windowMs: number
  cost?: number
}

export interface FumaLimitDecision {
  allowed: boolean
  remaining: number
  retryAfterMs: number
}

export interface FumaPresenceEntry {
  memberId: string
  payload: string
  expiresAtMs: number
}

export interface FumaLeaseRequest {
  resource: string
  ownerId: string
  acquisitionId: string
  ttlMs: number
}

export interface FumaFencedLease {
  resource: string
  ownerId: string
  acquisitionId: string
  fencingToken: string
  expiresAtMs: number
}

export type FumaRedisMessageListener = (message: string) => void
export type FumaRedisUnsubscribe = () => Promise<void>

export interface FumaRedisDriver {
  connect(): Promise<void>
  reconnect(): Promise<void>
  close(): Promise<void>
  ping(): Promise<void>
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlMs: number): Promise<void>
  delete(key: string): Promise<boolean>
  consumeLimit(key: string, limit: number, windowMs: number, cost: number): Promise<FumaLimitDecision>
  publish(channel: string, message: string): Promise<number>
  subscribe(channel: string, listener: FumaRedisMessageListener): Promise<FumaRedisUnsubscribe>
  heartbeatPresence(
    indexKey: string,
    payloadKey: string,
    memberId: string,
    payload: string,
    nowMs: number,
    ttlMs: number,
  ): Promise<void>
  removePresence(indexKey: string, payloadKey: string, memberId: string): Promise<boolean>
  listPresence(indexKey: string, payloadKey: string, nowMs: number): Promise<FumaPresenceEntry[]>
  acquireLease(leaseKey: string, fenceKey: string, request: FumaLeaseRequest): Promise<string | null>
  renewLease(leaseKey: string, lease: FumaFencedLease, ttlMs: number): Promise<boolean>
  releaseLease(leaseKey: string, lease: FumaFencedLease): Promise<boolean>
}
