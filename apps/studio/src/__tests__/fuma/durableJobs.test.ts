import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import { FumaRuntimeLifecycle } from '../../../server/fuma/runtime/lifecycle'
import { FumaRedisCoordination } from '../../../server/fuma/redis'
import {
  FumaJobAdmissionError,
  FumaJobFenceError,
  FumaJobProcessDeathError,
  FumaJobScheduler,
  FumaJobService,
  FumaJobWorker,
  PostgresFumaJobRepository,
  createFumaJobSchedulerComponentFactory,
  createFumaJobWorkerComponentFactory,
  weightedFairJobOrder,
  type FumaJobClaim,
  type FumaJobHandler,
  type FumaJobRecord,
} from '../../../server/fuma/jobs'
import { FumaFakeClock } from '../helpers/fuma/fakeClock'
import {
  DeterministicRedisDriver,
  DeterministicRedisServer,
} from '../helpers/fuma/deterministicRedis'
import {
  DeterministicJobReadyQueue,
  InMemoryFumaJobRepository,
} from '../helpers/fuma/deterministicJobs'

const ADMISSION = { maxActivePerOrganization: 4, maxActivePerSite: 2 }

function harness(handler: FumaJobHandler, clock = new FumaFakeClock('2026-07-24T10:00:00.000Z')) {
  const repository = new InMemoryFumaJobRepository()
  const readyQueue = new DeterministicJobReadyQueue()
  const service = new FumaJobService({ repository, readyQueue, admission: ADMISSION, now: () => clock.now() })
  const worker = new FumaJobWorker({
    repository,
    readyQueue,
    handlers: { demo: handler },
    workerId: 'worker-1',
    leaseMs: 100,
    retry: { baseDelayMs: 10, maxDelayMs: 100 },
    now: () => clock.now(),
  })
  return { clock, repository, readyQueue, service, worker }
}

async function enqueueDemo(service: FumaJobService, overrides: Partial<Parameters<FumaJobService['enqueue']>[0]> = {}) {
  return await service.enqueue({
    id: 'job-1',
    organizationId: 'org-1',
    siteId: 'site-1',
    kind: 'demo',
    payload: { value: 1 },
    ...overrides,
  })
}

function fairJob(id: string, organizationId: string, siteId: string, organizationWeight: number, siteWeight = 1): FumaJobRecord {
  return {
    id,
    organizationId,
    siteId,
    kind: 'demo',
    payload: null,
    status: 'queued',
    priority: 0,
    organizationWeight,
    siteWeight,
    maxAttempts: 3,
    attemptCount: 0,
    runAt: '2026-07-24T10:00:00.000Z',
    claimedBy: null,
    claimExpiresAt: null,
    fence: '0',
    cancellationRequestedAt: null,
    idempotencyKey: null,
    result: null,
    error: null,
    createdAt: '2026-07-24T10:00:00.000Z',
    updatedAt: '2026-07-24T10:00:00.000Z',
    completedAt: null,
  }
}

type CancellationAuthorityRow = Readonly<{
  status: string
  claimed_by: string | null
  claim_expires_at: string | null
  fence: string
  cancellation_requested_at: string | null
}>

function claimedFixture(): FumaJobClaim {
  const record: FumaJobRecord = {
    ...fairJob('job-authority', 'org-1', 'site-1', 1),
    status: 'running',
    attemptCount: 1,
    claimedBy: 'worker-1',
    claimExpiresAt: '2026-07-24T10:01:00.000Z',
    fence: '7',
  }
  return { job: record, workerId: 'worker-1', fence: '7', attemptNumber: 1 }
}

function cancellationAuthorityDb(readRow: () => CancellationAuthorityRow | null): DbClient {
  const db = (async <Row = Record<string, unknown>>(): Promise<DbResult<Row>> => {
    const row = readRow()
    return { rows: row === null ? [] : [structuredClone(row) as Row], rowCount: row === null ? 0 : 1 }
  }) as DbClient
  db.unsafe = async () => {
    throw new Error('Cancellation polling must not require unsafe SQL.')
  }
  db.transaction = async <T>(work: (tx: DbClient) => Promise<T>): Promise<T> => await work(db)
  Object.defineProperty(db, 'dialect', { value: 'postgres' })
  return db
}

describe('FUMA-009 durable jobs', () => {
  it('deduplicates enqueue admission and duplicate Redis delivery through PostgreSQL claims', async () => {
    let executions = 0
    const h = harness(async () => ({ executions: ++executions }))
    const first = await enqueueDemo(h.service, { idempotencyKey: 'same-request' })
    const duplicate = await h.service.enqueue({
      organizationId: 'org-1', siteId: 'site-1', kind: 'demo', payload: { ignored: true }, idempotencyKey: 'same-request',
    })
    expect(duplicate).toEqual({ job: first.job, created: false })

    h.readyQueue.loseAll()
    h.readyQueue.deliverDuplicate(first.job.id)
    expect(await h.worker.runOnce()).toBe('succeeded')
    expect(await h.worker.runOnce()).toBe('duplicate')
    expect(executions).toBe(1)
  })

  it('demo kill/restart reads and replays one durable result before re-running work', async () => {
    let executions = 0
    const h = harness(async (context) => {
      const prior = await context.readDurableResult('published-output')
      if (prior !== null) return prior.result
      executions += 1
      await context.commitDurableResult('published-output', { outputId: 'result-1' })
      throw new FumaJobProcessDeathError()
    })
    const { job } = await enqueueDemo(h.service)

    await expect(h.worker.runOnce()).rejects.toBeInstanceOf(FumaJobProcessDeathError)
    expect((await h.repository.get(job.id))?.status).toBe('running')
    expect(h.repository.effects.size).toBe(1)

    h.clock.advance(100)
    h.readyQueue.loseAll()
    expect(await h.worker.runOnce()).toBe('succeeded')
    expect((await h.repository.get(job.id))?.attemptCount).toBe(2)
    expect((await h.repository.get(job.id))?.result).toEqual({ outputId: 'result-1' })
    expect(h.repository.effects.size).toBe(1)
    expect(executions).toBe(1)
    process.stdout.write('[FUMA-009 demo] killed after effect, restarted, durableResults=1\n')
  })

  it('rebuilds an erased Redis ready queue from PostgreSQL truth', async () => {
    let executions = 0
    const h = harness(async () => ({ execution: ++executions }))
    h.readyQueue.available = false
    const { job } = await enqueueDemo(h.service)
    expect(h.readyQueue.values).toEqual([])

    h.readyQueue.available = true
    h.readyQueue.loseAll()
    expect(await h.worker.rebuildReadyQueue()).toBe(1)
    expect(h.readyQueue.values).toEqual([job.id])
    expect(await h.worker.runOnce()).toBe('succeeded')
    expect(executions).toBe(1)
  })

  it('rejects a stale lease fence after an expired claim is reclaimed', async () => {
    const h = harness(async () => null)
    const { job } = await enqueueDemo(h.service)
    h.readyQueue.loseAll()
    const first = await h.repository.claim(job.id, 'worker-old', 100, h.clock.now())
    h.clock.advance(100)
    const second = await h.repository.claim(job.id, 'worker-new', 100, h.clock.now())
    expect(first?.fence).toBe('1')
    expect(second?.fence).toBe('2')
    await expect(h.repository.cancellationRequested(first!)).rejects.toBeInstanceOf(FumaJobFenceError)
    await expect(h.repository.complete(first!, { stale: true }, h.clock.now())).rejects.toBeInstanceOf(FumaJobFenceError)
    await expect(h.repository.commitEffect(first!, 'stale-effect', {}, h.clock.now())).rejects.toBeInstanceOf(FumaJobFenceError)
    expect(await h.repository.complete(second!, { current: true }, h.clock.now())).toBe('succeeded')
  })

  it('preserves renewed claim authority and revokes a captured cancellation handle after same-fence completion', async () => {
    const h = harness(async () => null)
    const { job } = await enqueueDemo(h.service)
    h.readyQueue.loseAll()
    const claim = await h.repository.claim(job.id, 'worker-1', 100, h.clock.now())
    if (!claim) throw new Error('Expected a claimed job.')
    const cancellationRequested = () => h.repository.cancellationRequested(claim)

    h.clock.advance(50)
    expect(await h.repository.renewClaim(claim, 100, h.clock.now())).toBe(true)
    expect(await cancellationRequested()).toBe(false)
    expect(await h.repository.complete(claim, null, h.clock.now())).toBe('succeeded')
    expect((await h.repository.get(job.id))?.fence).toBe(claim.fence)
    expect((await h.repository.get(job.id))?.claimedBy).toBeNull()
    await expect(cancellationRequested()).rejects.toBeInstanceOf(FumaJobFenceError)
  })

  it('requires full PostgreSQL live-claim authority before returning cancellation state', async () => {
    const claim = claimedFixture()
    let current: CancellationAuthorityRow | null = {
      status: 'running',
      claimed_by: claim.workerId,
      claim_expires_at: claim.job.claimExpiresAt,
      fence: claim.fence,
      cancellation_requested_at: null,
    }
    const now = new Date('2026-07-24T10:00:00.000Z')
    const repository = new PostgresFumaJobRepository(
      cancellationAuthorityDb(() => current),
      () => now,
    )

    expect(await repository.cancellationRequested(claim)).toBe(false)
    current = { ...current, cancellation_requested_at: '2026-07-24T10:00:30.000Z' }
    expect(await repository.cancellationRequested(claim)).toBe(true)

    current = {
      ...current,
      status: 'succeeded',
      claimed_by: null,
      claim_expires_at: null,
    }
    await expect(repository.cancellationRequested(claim)).rejects.toBeInstanceOf(FumaJobFenceError)

    current = {
      ...current,
      status: 'running',
      claimed_by: 'worker-2',
      claim_expires_at: '2026-07-24T10:02:00.000Z',
      fence: '8',
    }
    await expect(repository.cancellationRequested(claim)).rejects.toBeInstanceOf(FumaJobFenceError)

    current = {
      ...current,
      claimed_by: claim.workerId,
      claim_expires_at: '2026-07-24T09:59:59.999Z',
      fence: claim.fence,
    }
    await expect(repository.cancellationRequested(claim)).rejects.toBeInstanceOf(FumaJobFenceError)

    current = { ...current, claim_expires_at: 'not-a-timestamp' }
    await expect(repository.cancellationRequested(claim)).rejects.toBeInstanceOf(FumaJobFenceError)

    current = {
      ...current,
      claim_expires_at: null,
    }
    await expect(repository.cancellationRequested(claim)).rejects.toBeInstanceOf(FumaJobFenceError)
  })

  it('cancels queued and in-flight work without allowing success acknowledgement', async () => {
    const queued = harness(async () => ({ shouldNotRun: true }))
    const { job } = await enqueueDemo(queued.service)
    expect((await queued.service.cancel(job.id))?.status).toBe('cancelled')
    expect(await queued.worker.runOnce()).toBe('idle')

    const runningRef: { service?: FumaJobService } = {}
    const running = harness(async () => {
      await runningRef.service!.cancel('job-1')
      return { ignored: true }
    })
    runningRef.service = running.service
    await enqueueDemo(running.service)
    expect(await running.worker.runOnce()).toBe('cancelled')
    expect((await running.repository.get('job-1'))?.status).toBe('cancelled')
  })

  it('applies exponential backoff and dead-letters retry exhaustion', async () => {
    const h = harness(async () => { throw new Error('provider unavailable') })
    await enqueueDemo(h.service, { maxAttempts: 3 })
    expect(await h.worker.runOnce()).toBe('retry_wait')
    expect((await h.repository.get('job-1'))?.runAt).toBe('2026-07-24T10:00:00.010Z')
    h.clock.advance(10)
    expect(await h.worker.runOnce()).toBe('retry_wait')
    expect((await h.repository.get('job-1'))?.runAt).toBe('2026-07-24T10:00:00.030Z')
    h.clock.advance(20)
    expect(await h.worker.runOnce()).toBe('dead_letter')
    expect((await h.repository.get('job-1'))?.status).toBe('dead_letter')
    expect((await h.repository.get('job-1'))?.attemptCount).toBe(3)
  })

  it('enforces active organization/site admission while idempotent repeats remain accepted', async () => {
    const h = harness(async () => null)
    await enqueueDemo(h.service, { id: 'one', idempotencyKey: 'one' })
    await h.service.enqueue({ id: 'two', organizationId: 'org-1', siteId: 'site-1', kind: 'demo', payload: null })
    await expect(h.service.enqueue({ id: 'three', organizationId: 'org-1', siteId: 'site-1', kind: 'demo', payload: null }))
      .rejects.toMatchObject({ scope: 'site' } satisfies Partial<FumaJobAdmissionError>)
    expect((await enqueueDemo(h.service, { id: 'ignored', idempotencyKey: 'one' })).created).toBe(false)
  })

  it('orders organizations and sites with deterministic nested weighted fairness', () => {
    const jobs = [
      fairJob('a1', 'a', 'a-1', 2), fairJob('a2', 'a', 'a-2', 2, 2), fairJob('a3', 'a', 'a-2', 2, 2),
      fairJob('a4', 'a', 'a-1', 2), fairJob('b1', 'b', 'b-1', 1), fairJob('b2', 'b', 'b-1', 1),
    ]
    const order = weightedFairJobOrder(jobs).map(({ id }) => id)
    expect(order.slice(0, 3).filter((id) => id.startsWith('a'))).toHaveLength(2)
    expect(order.slice(0, 3).filter((id) => id.startsWith('b'))).toHaveLength(1)
    expect(order).toEqual(expect.arrayContaining(jobs.map(({ id }) => id)))
    expect(new Set(order).size).toBe(jobs.length)
  })

  it('serializes competing scheduler enqueue attempts with Redis locks and durable schedule fences', async () => {
    const clock = new FumaFakeClock('2026-07-24T10:00:00.000Z')
    const repository = new InMemoryFumaJobRepository()
    const readyQueue = new DeterministicJobReadyQueue()
    repository.addSchedule({
      id: 'schedule-1', organizationId: 'org-1', siteId: 'site-1', kind: 'demo', payload: null,
      intervalMs: 1_000, nextRunAt: clock.now().toISOString(), maxAttempts: 3, priority: 0,
      organizationWeight: 1, siteWeight: 1, enqueueFence: '0',
    })
    const redis = new DeterministicRedisServer(() => clock.nowMs())
    const firstCoordination = new FumaRedisCoordination({ namespace: 'jobs', driver: new DeterministicRedisDriver(redis), nowMs: () => clock.nowMs() })
    const secondCoordination = new FumaRedisCoordination({ namespace: 'jobs', driver: new DeterministicRedisDriver(redis), nowMs: () => clock.nowMs() })
    await Promise.all([firstCoordination.connect(), secondCoordination.connect()])
    const makeScheduler = (schedulerId: string, coordination: FumaRedisCoordination) => new FumaJobScheduler({
      repository, readyQueue, coordination, admission: ADMISSION, schedulerId, leaseMs: 100, now: () => clock.now(),
    })
    const results = await Promise.all([
      makeScheduler('scheduler-1', firstCoordination).runOnce(),
      makeScheduler('scheduler-2', secondCoordination).runOnce(),
    ])
    expect(results.reduce((sum, value) => sum + value, 0)).toBe(1)
    expect(repository.jobs.size).toBe(1)
    expect(readyQueue.values).toHaveLength(1)
    await Promise.all([firstCoordination.close(), secondCoordination.close()])
  })

  it('integrates worker and scheduler factories with FUMA-005 lifecycle drain semantics', async () => {
    const clock = new FumaFakeClock('2026-07-24T10:00:00.000Z')
    const workerRepository = new InMemoryFumaJobRepository()
    const workerQueue = new DeterministicJobReadyQueue()
    const workerFactory = createFumaJobWorkerComponentFactory({
      repository: workerRepository,
      readyQueue: workerQueue,
      handlers: {},
      instanceId: 'worker-lifecycle',
      now: () => clock.now(),
    })
    const workerRuntime = new FumaRuntimeLifecycle({
      role: 'worker',
      drainTimeoutMs: 1_000,
      components: [workerFactory({
        id: 'durable-job-worker', role: 'worker', settings: { healthPort: 0, drainTimeoutMs: 1_000 }, log() {},
      })],
    })
    await workerRuntime.start()
    expect(workerRuntime.snapshot().state).toBe('ready')
    await workerRuntime.shutdown()
    expect(workerRuntime.snapshot().state).toBe('stopped')

    const redis = new DeterministicRedisServer(() => clock.nowMs())
    const schedulerCoordination = new FumaRedisCoordination({
      namespace: 'jobs-lifecycle',
      driver: new DeterministicRedisDriver(redis),
      nowMs: () => clock.nowMs(),
    })
    const schedulerFactory = createFumaJobSchedulerComponentFactory({
      repository: new InMemoryFumaJobRepository(),
      readyQueue: new DeterministicJobReadyQueue(),
      coordination: schedulerCoordination,
      instanceId: 'scheduler-lifecycle',
      now: () => clock.now(),
    })
    const schedulerRuntime = new FumaRuntimeLifecycle({
      role: 'scheduler',
      drainTimeoutMs: 1_000,
      components: [schedulerFactory({
        id: 'durable-job-scheduler', role: 'scheduler', settings: { healthPort: 0, drainTimeoutMs: 1_000 }, log() {},
      })],
    })
    await schedulerRuntime.start()
    expect(schedulerRuntime.snapshot().state).toBe('ready')
    await schedulerRuntime.shutdown()
    expect(schedulerRuntime.snapshot().state).toBe('stopped')
  })
})
