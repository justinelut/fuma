import type { FumaRedisCoordination } from '../redis'
import type { FumaRuntimeComponent, FumaRuntimeContext } from '../runtime/lifecycle'
import type { FumaJobAdmissionPolicy } from './contracts'
import type { FumaJobReadyQueue } from './readyQueue'
import type { FumaJobRepository } from './repository'

export interface FumaJobSchedulerOptions {
  repository: FumaJobRepository
  readyQueue: FumaJobReadyQueue
  coordination: FumaRedisCoordination
  admission: FumaJobAdmissionPolicy
  schedulerId: string
  leaseMs?: number
  batchSize?: number
  now?: () => Date
}

export class FumaJobScheduler {
  readonly #repository: FumaJobRepository
  readonly #readyQueue: FumaJobReadyQueue
  readonly #coordination: FumaRedisCoordination
  readonly #admission: FumaJobAdmissionPolicy
  readonly #schedulerId: string
  readonly #leaseMs: number
  readonly #batchSize: number
  readonly #now: () => Date

  constructor(options: FumaJobSchedulerOptions) {
    this.#repository = options.repository
    this.#readyQueue = options.readyQueue
    this.#coordination = options.coordination
    this.#admission = options.admission
    this.#schedulerId = options.schedulerId
    this.#leaseMs = options.leaseMs ?? 10_000
    this.#batchSize = options.batchSize ?? 100
    this.#now = options.now ?? (() => new Date())
  }

  async runOnce(): Promise<number> {
    const now = this.#now()
    const schedules = await this.#repository.listDueSchedules(now, this.#batchSize)
    let enqueued = 0
    for (const schedule of schedules) {
      const lease = await this.#coordination.acquireLease({
        resource: `durable-job-schedule:${schedule.id}`,
        ownerId: this.#schedulerId,
        acquisitionId: `${this.#schedulerId}:${schedule.id}:${schedule.nextRunAt}`,
        ttlMs: this.#leaseMs,
      })
      if (!lease) continue
      try {
        const result = await this.#repository.enqueueSchedule(schedule.id, lease.fencingToken, this.#admission, now)
        if (!result) continue
        if (result.created) enqueued += 1
        try {
          await this.#readyQueue.enqueue([result.job.id])
        } catch (error) {
          console.warn('[fuma:jobs] scheduled Redis enqueue failed; worker reconciliation will recover:', error)
        }
      } finally {
        await this.#coordination.releaseLease(lease)
      }
    }
    return enqueued
  }
}

export function createFumaJobSchedulerComponent(
  scheduler: FumaJobScheduler,
  pollIntervalMs = 250,
): FumaRuntimeComponent {
  return {
    id: 'durable-job-scheduler',
    start(context: FumaRuntimeContext) {
      let accepting = true
      const loop = (async () => {
        while (accepting) {
          await Bun.sleep(pollIntervalMs)
          if (!accepting) break
          try {
            await context.run(() => scheduler.runOnce())
          } catch (error) {
            console.error('[fuma:jobs] scheduler iteration failed:', error)
          }
        }
      })()
      return {
        beginDrain() {
          accepting = false
        },
        async stop() {
          accepting = false
          await loop
        },
      }
    },
  }
}
