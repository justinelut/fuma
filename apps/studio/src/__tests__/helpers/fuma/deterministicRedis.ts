import type {
  FumaFencedLease,
  FumaLeaseRequest,
  FumaLimitDecision,
  FumaPresenceEntry,
  FumaRedisDriver,
  FumaRedisMessageListener,
  FumaRedisUnsubscribe,
} from '../../../../server/fuma/redis'

interface ExpiringValue {
  value: string
  expiresAtMs: number
}

interface LimitState {
  consumed: number
  expiresAtMs: number
}

interface PresenceState {
  payload: string
  expiresAtMs: number
}

interface LeaseState {
  ownerId: string
  acquisitionId: string
  fencingToken: string
  expiresAtMs: number
}

export class DeterministicRedisServer {
  readonly #nowMs: () => number
  readonly values = new Map<string, ExpiringValue>()
  readonly limits = new Map<string, LimitState>()
  readonly presence = new Map<string, Map<string, PresenceState>>()
  readonly leases = new Map<string, LeaseState>()
  readonly fences = new Map<string, bigint>()
  readonly subscribers = new Map<string, Set<FumaRedisMessageListener>>()
  available = true
  hanging = false

  constructor(nowMs: () => number) {
    this.#nowMs = nowMs
  }

  nowMs(): number {
    return this.#nowMs()
  }

  setAvailable(available: boolean): void {
    this.available = available
  }

  setHanging(hanging: boolean): void {
    this.hanging = hanging
  }

  restart(): void {
    this.available = false
    this.subscribers.clear()
    this.available = true
  }

  clearEphemeralData(): void {
    this.values.clear()
    this.limits.clear()
    this.presence.clear()
    this.leases.clear()
    this.fences.clear()
  }

  async run<T>(operation: () => T | Promise<T>): Promise<T> {
    if (!this.available) throw new Error('Deterministic Redis is unavailable.')
    if (this.hanging) return new Promise<T>(() => {})
    return operation()
  }
}

export class DeterministicRedisDriver implements FumaRedisDriver {
  readonly #server: DeterministicRedisServer
  readonly #subscriptions = new Map<string, Set<FumaRedisMessageListener>>()
  #connected = false

  constructor(server: DeterministicRedisServer) {
    this.#server = server
  }

  async connect(): Promise<void> {
    await this.#server.run(() => {
      this.#connected = true
    })
  }

  async reconnect(): Promise<void> {
    await this.#server.run(() => {
      this.#connected = true
      for (const [channel, listeners] of this.#subscriptions) {
        let registered = this.#server.subscribers.get(channel)
        if (!registered) {
          registered = new Set()
          this.#server.subscribers.set(channel, registered)
        }
        for (const listener of listeners) registered.add(listener)
      }
    })
  }

  async close(): Promise<void> {
    for (const [channel, listeners] of this.#subscriptions) {
      const registered = this.#server.subscribers.get(channel)
      for (const listener of listeners) registered?.delete(listener)
      if (registered?.size === 0) this.#server.subscribers.delete(channel)
    }
    this.#connected = false
  }

  async ping(): Promise<void> {
    await this.#run(() => {})
  }

  get(key: string): Promise<string | null> {
    return this.#run(() => {
      const entry = this.#server.values.get(key)
      if (!entry) return null
      if (entry.expiresAtMs <= this.#server.nowMs()) {
        this.#server.values.delete(key)
        return null
      }
      return entry.value
    })
  }

  set(key: string, value: string, ttlMs: number): Promise<void> {
    return this.#run(() => {
      this.#server.values.set(key, { value, expiresAtMs: this.#server.nowMs() + ttlMs })
    })
  }

  delete(key: string): Promise<boolean> {
    return this.#run(() => this.#server.values.delete(key))
  }

  consumeLimit(key: string, limit: number, windowMs: number, cost: number): Promise<FumaLimitDecision> {
    return this.#run(() => {
      const now = this.#server.nowMs()
      let state = this.#server.limits.get(key)
      if (!state || state.expiresAtMs <= now) {
        state = { consumed: 0, expiresAtMs: now + windowMs }
        this.#server.limits.set(key, state)
      }
      state.consumed += cost
      return {
        allowed: state.consumed <= limit,
        remaining: Math.max(0, limit - state.consumed),
        retryAfterMs: Math.max(0, state.expiresAtMs - now),
      }
    })
  }

  publish(channel: string, message: string): Promise<number> {
    return this.#run(() => {
      const listeners = [...(this.#server.subscribers.get(channel) ?? [])]
      for (const listener of listeners) listener(message)
      return listeners.length
    })
  }

  async subscribe(channel: string, listener: FumaRedisMessageListener): Promise<FumaRedisUnsubscribe> {
    await this.#run(() => {
      let local = this.#subscriptions.get(channel)
      if (!local) {
        local = new Set()
        this.#subscriptions.set(channel, local)
      }
      local.add(listener)
      let registered = this.#server.subscribers.get(channel)
      if (!registered) {
        registered = new Set()
        this.#server.subscribers.set(channel, registered)
      }
      registered.add(listener)
    })
    return async () => {
      const local = this.#subscriptions.get(channel)
      local?.delete(listener)
      if (local?.size === 0) this.#subscriptions.delete(channel)
      const registered = this.#server.subscribers.get(channel)
      registered?.delete(listener)
      if (registered?.size === 0) this.#server.subscribers.delete(channel)
    }
  }

  heartbeatPresence(
    indexKey: string,
    _payloadKey: string,
    memberId: string,
    payload: string,
    nowMs: number,
    ttlMs: number,
  ): Promise<void> {
    return this.#run(() => {
      let room = this.#server.presence.get(indexKey)
      if (!room) {
        room = new Map()
        this.#server.presence.set(indexKey, room)
      }
      room.set(memberId, { payload, expiresAtMs: nowMs + ttlMs })
    })
  }

  removePresence(indexKey: string, _payloadKey: string, memberId: string): Promise<boolean> {
    return this.#run(() => {
      const room = this.#server.presence.get(indexKey)
      if (!room) return false
      const removed = room.delete(memberId)
      if (room.size === 0) this.#server.presence.delete(indexKey)
      return removed
    })
  }

  listPresence(indexKey: string, _payloadKey: string, nowMs: number): Promise<FumaPresenceEntry[]> {
    return this.#run(() => {
      const room = this.#server.presence.get(indexKey)
      if (!room) return []
      const entries: FumaPresenceEntry[] = []
      for (const [memberId, state] of room) {
        if (state.expiresAtMs <= nowMs) {
          room.delete(memberId)
        } else {
          entries.push({ memberId, payload: state.payload, expiresAtMs: state.expiresAtMs })
        }
      }
      if (room.size === 0) this.#server.presence.delete(indexKey)
      return entries.sort((left, right) => left.memberId.localeCompare(right.memberId))
    })
  }

  acquireLease(leaseKey: string, fenceKey: string, request: FumaLeaseRequest): Promise<string | null> {
    return this.#run(() => {
      const now = this.#server.nowMs()
      const current = this.#server.leases.get(leaseKey)
      if (current && current.expiresAtMs > now) {
        if (current.ownerId === request.ownerId && current.acquisitionId === request.acquisitionId) {
          current.expiresAtMs = now + request.ttlMs
          return current.fencingToken
        }
        return null
      }
      const fencingToken = (this.#server.fences.get(fenceKey) ?? 0n) + 1n
      this.#server.fences.set(fenceKey, fencingToken)
      this.#server.leases.set(leaseKey, {
        ownerId: request.ownerId,
        acquisitionId: request.acquisitionId,
        fencingToken: fencingToken.toString(),
        expiresAtMs: now + request.ttlMs,
      })
      return fencingToken.toString()
    })
  }

  renewLease(leaseKey: string, lease: FumaFencedLease, ttlMs: number): Promise<boolean> {
    return this.#run(() => {
      const current = this.#activeLease(leaseKey)
      if (!this.#sameLease(current, lease)) return false
      current.expiresAtMs = this.#server.nowMs() + ttlMs
      return true
    })
  }

  releaseLease(leaseKey: string, lease: FumaFencedLease): Promise<boolean> {
    return this.#run(() => {
      const current = this.#activeLease(leaseKey)
      if (!this.#sameLease(current, lease)) return false
      return this.#server.leases.delete(leaseKey)
    })
  }

  #activeLease(leaseKey: string): LeaseState | undefined {
    const current = this.#server.leases.get(leaseKey)
    if (current && current.expiresAtMs <= this.#server.nowMs()) {
      this.#server.leases.delete(leaseKey)
      return undefined
    }
    return current
  }

  #sameLease(current: LeaseState | undefined, lease: FumaFencedLease): current is LeaseState {
    return current?.ownerId === lease.ownerId
      && current.acquisitionId === lease.acquisitionId
      && current.fencingToken === lease.fencingToken
  }

  #run<T>(operation: () => T | Promise<T>): Promise<T> {
    if (!this.#connected) return Promise.reject(new Error('Deterministic Redis driver is disconnected.'))
    return this.#server.run(operation)
  }
}
