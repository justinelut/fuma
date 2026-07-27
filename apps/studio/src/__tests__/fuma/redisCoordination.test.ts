import { describe, expect, it } from 'bun:test'
import {
  BunRedisDriver,
  FumaRedisCoordination,
  FumaRedisUnavailableError,
  decideFumaRedisAvailability,
} from '../../../server/fuma/redis'
import { FumaFakeClock } from '../helpers/fuma/fakeClock'
import {
  DeterministicRedisDriver,
  DeterministicRedisServer,
} from '../helpers/fuma/deterministicRedis'

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Redis pub/sub delivery.')
    await Bun.sleep(5)
  }
}

function leaseRequest(ownerId: string, acquisitionId: string, ttlMs = 100) {
  return { resource: 'publish:site-1', ownerId, acquisitionId, ttlMs }
}

describe('FUMA-007 deterministic Redis coordination contract', () => {
  it('expires cache entries and isolates equal logical keys by namespace', async () => {
    const clock = new FumaFakeClock(1_000)
    const server = new DeterministicRedisServer(() => clock.nowMs())
    const alpha = new FumaRedisCoordination({
      namespace: 'alpha',
      driver: new DeterministicRedisDriver(server),
      nowMs: () => clock.nowMs(),
    })
    const beta = new FumaRedisCoordination({
      namespace: 'beta',
      driver: new DeterministicRedisDriver(server),
      nowMs: () => clock.nowMs(),
    })
    await Promise.all([alpha.connect(), beta.connect()])

    expect(await alpha.cacheSet('same:key', 'alpha-value', 100)).toBe(true)
    expect(await beta.cacheSet('same:key', 'beta-value', 100)).toBe(true)
    expect(await alpha.cacheGet('same:key')).toBe('alpha-value')
    expect(await beta.cacheGet('same:key')).toBe('beta-value')

    clock.advance(100)
    expect(await alpha.cacheGet('same:key')).toBeNull()
    expect(await beta.cacheGet('same:key')).toBeNull()
  })

  it('atomically bounds concurrent fixed-window limits and resets after expiry', async () => {
    const clock = new FumaFakeClock(2_000)
    const server = new DeterministicRedisServer(() => clock.nowMs())
    const coordination = new FumaRedisCoordination({
      namespace: 'limits',
      driver: new DeterministicRedisDriver(server),
      nowMs: () => clock.nowMs(),
    })
    await coordination.connect()

    const decisions = await Promise.all(Array.from({ length: 5 }, () => (
      coordination.consumeLimit('organization-1:send', { limit: 3, windowMs: 100 })
    )))
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(3)
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(2)
    expect(decisions.at(-1)?.remaining).toBe(0)

    clock.advance(100)
    expect(await coordination.consumeLimit('organization-1:send', { limit: 3, windowMs: 100 }))
      .toEqual({ allowed: true, remaining: 2, retryAfterMs: 100 })
  })

  it('expires presence heartbeats without turning disconnects into durable state', async () => {
    const clock = new FumaFakeClock(3_000)
    const server = new DeterministicRedisServer(() => clock.nowMs())
    const coordination = new FumaRedisCoordination({
      namespace: 'presence',
      driver: new DeterministicRedisDriver(server),
      nowMs: () => clock.nowMs(),
    })
    await coordination.connect()

    expect(await coordination.heartbeatPresence('site-1', 'tab-1', '{"selection":"node-1"}', 100)).toBe(true)
    expect(await coordination.listPresence('site-1')).toEqual([{
      memberId: 'tab-1',
      payload: '{"selection":"node-1"}',
      expiresAtMs: 3_100,
    }])

    clock.advance(100)
    expect(await coordination.listPresence('site-1')).toEqual([])
  })

  it('re-subscribes pub/sub listeners after a Redis connection restart', async () => {
    const clock = new FumaFakeClock(4_000)
    const server = new DeterministicRedisServer(() => clock.nowMs())
    const coordination = new FumaRedisCoordination({
      namespace: 'events',
      driver: new DeterministicRedisDriver(server),
      nowMs: () => clock.nowMs(),
    })
    await coordination.connect()
    const messages: string[] = []
    const unsubscribe = await coordination.subscribe('site-1', (message) => messages.push(message))

    expect(await coordination.publish('site-1', 'before')).toBe(1)
    server.restart()
    await coordination.reconnect()
    expect(coordination.health()).toMatchObject({ status: 'healthy', ready: true })
    expect(await coordination.publish('site-1', 'after')).toBe(1)
    expect(messages).toEqual(['before', 'after'])
    await unsubscribe()
  })

  it('serializes lease contention and rejects stale owners with increasing fencing tokens', async () => {
    const clock = new FumaFakeClock(5_000)
    const server = new DeterministicRedisServer(() => clock.nowMs())
    const coordination = new FumaRedisCoordination({
      namespace: 'leases',
      driver: new DeterministicRedisDriver(server),
      nowMs: () => clock.nowMs(),
    })
    await coordination.connect()

    const first = await coordination.acquireLease(leaseRequest('worker-1', 'attempt-1'))
    expect(first?.fencingToken).toBe('1')
    expect(await coordination.acquireLease(leaseRequest('worker-2', 'attempt-2'))).toBeNull()
    expect((await coordination.acquireLease(leaseRequest('worker-1', 'attempt-1')))?.fencingToken).toBe('1')

    clock.advance(100)
    const second = await coordination.acquireLease(leaseRequest('worker-2', 'attempt-2'))
    expect(second?.fencingToken).toBe('2')
    expect(await coordination.renewLease(first!, 100)).toBeNull()
    expect(await coordination.releaseLease(first!)).toBe(false)
    expect(await coordination.releaseLease(second!)).toBe(true)
  })

  it('uses bounded timeouts and explicit fail-open/fail-closed decisions during Redis loss', async () => {
    const clock = new FumaFakeClock(6_000)
    const server = new DeterministicRedisServer(() => clock.nowMs())
    const coordination = new FumaRedisCoordination({
      namespace: 'failure',
      driver: new DeterministicRedisDriver(server),
      timeoutMs: 5,
      nowMs: () => clock.nowMs(),
    })
    await coordination.connect()
    server.setHanging(true)

    expect(await coordination.cacheGet('missing')).toBeNull()
    expect(await coordination.cacheSet('key', 'value', 100)).toBe(false)
    expect(await coordination.publish('events', 'message')).toBe(0)
    expect(await coordination.heartbeatPresence('room', 'member', '{}', 100)).toBe(false)
    expect(await coordination.listPresence('room')).toEqual([])
    expect(coordination.consumeLimit('login', { limit: 1, windowMs: 100 }))
      .rejects.toBeInstanceOf(FumaRedisUnavailableError)
    expect(coordination.acquireLease(leaseRequest('worker', 'attempt')))
      .rejects.toBeInstanceOf(FumaRedisUnavailableError)

    const health = coordination.health()
    expect(health.status).toBe('unavailable')
    expect(health.ready).toBe(false)
    expect(decideFumaRedisAvailability('cache', health)).toMatchObject({
      mode: 'fail-open',
      allowed: true,
      degraded: true,
    })
    expect(decideFumaRedisAvailability('presence', health).allowed).toBe(true)
    expect(decideFumaRedisAvailability('limits', health)).toMatchObject({
      mode: 'fail-closed',
      allowed: false,
      degraded: true,
    })
    expect(decideFumaRedisAvailability('leases', health).allowed).toBe(false)
  })

  it('never promotes Redis loss or erased ephemeral state into durable truth', async () => {
    const clock = new FumaFakeClock(7_000)
    const server = new DeterministicRedisServer(() => clock.nowMs())
    const coordination = new FumaRedisCoordination({
      namespace: 'authority',
      driver: new DeterministicRedisDriver(server),
      nowMs: () => clock.nowMs(),
    })
    await coordination.connect()
    const durableRecord = { status: 'queued', version: 9 }
    await coordination.cacheSet('job-1', JSON.stringify(durableRecord), 100)
    const lease = await coordination.acquireLease(leaseRequest('worker', 'attempt'))

    server.clearEphemeralData()
    expect(await coordination.cacheGet('job-1')).toBeNull()
    expect(await coordination.releaseLease(lease!)).toBe(false)
    expect(durableRecord).toEqual({ status: 'queued', version: 9 })
  })

  it('rejects unbounded payloads, TTLs, limits, and namespaces before Redis I/O', async () => {
    const clock = new FumaFakeClock(8_000)
    const server = new DeterministicRedisServer(() => clock.nowMs())
    expect(() => new FumaRedisCoordination({
      namespace: 'INVALID:NAMESPACE',
      driver: new DeterministicRedisDriver(server),
    })).toThrow(RangeError)

    const coordination = new FumaRedisCoordination({
      namespace: 'bounds',
      driver: new DeterministicRedisDriver(server),
      nowMs: () => clock.nowMs(),
    })
    await coordination.connect()
    expect(coordination.cacheSet('key', 'value', 0)).rejects.toThrow(RangeError)
    expect(coordination.publish('channel', 'x'.repeat(65_537))).rejects.toThrow(RangeError)
    expect(coordination.consumeLimit('key', { limit: 0, windowMs: 100 })).rejects.toThrow(RangeError)
  })
})

const realRedisUrl = process.env.FUMA_TEST_REDIS_URL

it.skipIf(realRedisUrl === undefined)('FUMA-007 opt-in real Redis contract covers expiry, contention, isolation, fencing, and reconnect', async () => {
  const namespace = `contract-${crypto.randomUUID().slice(0, 8)}`
  const driver = new BunRedisDriver(realRedisUrl!, { connectionTimeoutMs: 1_000, maxRetries: 2 })
  const alpha = new FumaRedisCoordination({ namespace: `${namespace}-a`, driver, timeoutMs: 1_500 })
  const beta = new FumaRedisCoordination({ namespace: `${namespace}-b`, driver, timeoutMs: 1_500 })
  await alpha.connect()
  try {
    await alpha.cacheSet('same', 'alpha', 60)
    await beta.cacheSet('same', 'beta', 60)
    expect(await alpha.cacheGet('same')).toBe('alpha')
    expect(await beta.cacheGet('same')).toBe('beta')
    await Bun.sleep(80)
    expect(await alpha.cacheGet('same')).toBeNull()

    expect(await alpha.heartbeatPresence('real-room', 'real-tab', '{}', 60)).toBe(true)
    expect(await alpha.listPresence('real-room')).toHaveLength(1)
    await Bun.sleep(80)
    expect(await alpha.listPresence('real-room')).toEqual([])

    const limits = await Promise.all(Array.from({ length: 4 }, () => (
      alpha.consumeLimit('contention', { limit: 2, windowMs: 500 })
    )))
    expect(limits.filter((decision) => decision.allowed)).toHaveLength(2)

    const first = await alpha.acquireLease(leaseRequest('real-1', 'attempt-1', 80))
    expect(first).not.toBeNull()
    expect(await alpha.acquireLease(leaseRequest('real-2', 'attempt-2', 80))).toBeNull()
    await Bun.sleep(100)
    const second = await alpha.acquireLease(leaseRequest('real-2', 'attempt-2', 80))
    expect(BigInt(second!.fencingToken)).toBeGreaterThan(BigInt(first!.fencingToken))

    const messages: string[] = []
    const unsubscribe = await alpha.subscribe('restart', (message) => messages.push(message))
    await alpha.publish('restart', 'before')
    await waitFor(() => messages.includes('before'))
    await alpha.reconnect()
    await alpha.publish('restart', 'after')
    await waitFor(() => messages.includes('after'))
    await unsubscribe()
  } finally {
    await alpha.close()
  }
}, 10_000)
