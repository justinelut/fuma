import { getErrorMessage } from '../../../src/core/utils/errorMessage'
import type { FumaRuntimeComponent, FumaRuntimeContext } from '../runtime/lifecycle'
import {
  FumaJobProcessDeathError,
  type FumaJobClaim,
  type FumaJobJsonValue,
  type FumaJobRecord,
  type FumaJobRetryPolicy,
} from './contracts'
import { weightedFairJobOrder } from './fairScheduling'
import type { FumaJobReadyQueue } from './readyQueue'
import type { FumaJobRepository } from './repository'

export interface FumaJobHandlerContext {
  job: FumaJobRecord
  attemptNumber: number
  fence: string
  cancellationRequested(): Promise<boolean>
  readDurableResult(effectKey: string): Promise<{ result: FumaJobJsonValue } | null>
  commitDurableResult(effectKey: string, result: FumaJobJsonValue): Promise<{ result: FumaJobJsonValue; created: boolean }>
}

export type FumaJobHandler = (context: FumaJobHandlerContext) => Promise<FumaJobJsonValue>

export interface FumaJobWorkerOptions {
  repository: FumaJobRepository
  readyQueue: FumaJobReadyQueue
  handlers: Readonly<Record<string, FumaJobHandler>>
  workerId: string
  leaseMs?: number
  readyBatchSize?: number
  retry?: FumaJobRetryPolicy
  now?: () => Date
}

function errorPayload(error: unknown): FumaJobJsonValue {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: getErrorMessage(error, 'Unknown durable job error'),
  }
}

export class FumaJobWorker {
  readonly #repository: FumaJobRepository
  readonly #readyQueue: FumaJobReadyQueue
  readonly #handlers: Readonly<Record<string, FumaJobHandler>>
  readonly #workerId: string
  readonly #leaseMs: number
  readonly #readyBatchSize: number
  readonly #retry: FumaJobRetryPolicy
  readonly #now: () => Date

  constructor(options: FumaJobWorkerOptions) {
    this.#repository = options.repository
    this.#readyQueue = options.readyQueue
    this.#handlers = options.handlers
    this.#workerId = options.workerId
    this.#leaseMs = options.leaseMs ?? 30_000
    this.#readyBatchSize = options.readyBatchSize ?? 1_000
    this.#retry = options.retry ?? { baseDelayMs: 1_000, maxDelayMs: 300_000 }
    this.#now = options.now ?? (() => new Date())
  }

  async rebuildReadyQueue(): Promise<number> {
    const jobs = await this.#repository.listReady(this.#now(), this.#readyBatchSize, Object.keys(this.#handlers))
    const ordered = weightedFairJobOrder(jobs)
    await this.#readyQueue.rebuild(ordered.map(({ id }) => id))
    return ordered.length
  }

  async runOnce(): Promise<'idle' | 'duplicate' | 'succeeded' | 'cancelled' | 'retry_wait' | 'dead_letter'> {
    let jobId = await this.#readyQueue.take()
    if (jobId === null) {
      await this.rebuildReadyQueue()
      jobId = await this.#readyQueue.take()
      if (jobId === null) return 'idle'
    }
    const claim = await this.#repository.claim(jobId, this.#workerId, this.#leaseMs, this.#now())
    if (!claim) return 'duplicate'
    const handler = this.#handlers[claim.job.kind]
    if (!handler) {
      return await this.#fail(claim, new Error(`No durable job handler is registered for ${claim.job.kind}.`))
    }
    try {
      if (await this.#repository.cancellationRequested(claim)) {
        return await this.#repository.complete(claim, null, this.#now())
      }
      const result = await handler({
        job: claim.job,
        attemptNumber: claim.attemptNumber,
        fence: claim.fence,
        cancellationRequested: () => this.#repository.cancellationRequested(claim),
        readDurableResult: async (effectKey) => {
          const effect = await this.#repository.getEffect(claim.job.id, effectKey)
          return effect === null ? null : { result: effect.result }
        },
        commitDurableResult: async (effectKey, value) => {
          const committed = await this.#repository.commitEffect(claim, effectKey, value, this.#now())
          return { result: committed.effect.result, created: committed.created }
        },
      })
      return await this.#repository.complete(claim, result, this.#now())
    } catch (error) {
      if (error instanceof FumaJobProcessDeathError) throw error
      return await this.#fail(claim, error)
    }
  }

  async #fail(claim: FumaJobClaim, error: unknown): Promise<'retry_wait' | 'dead_letter' | 'cancelled'> {
    const exponent = Math.max(0, claim.attemptNumber - 1)
    const delay = Math.min(this.#retry.maxDelayMs, this.#retry.baseDelayMs * (2 ** exponent))
    const now = this.#now()
    return await this.#repository.fail(claim, errorPayload(error), new Date(now.getTime() + delay), now)
  }
}

export function createFumaJobWorkerComponent(
  worker: FumaJobWorker,
  pollIntervalMs = 100,
): FumaRuntimeComponent {
  return {
    id: 'durable-job-worker',
    start(context: FumaRuntimeContext) {
      let accepting = true
      const loop = (async () => {
        while (accepting) {
          await Bun.sleep(pollIntervalMs)
          if (!accepting) break
          try {
            await context.run(() => worker.runOnce())
          } catch (error) {
            console.error('[fuma:jobs] worker iteration failed:', error)
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
