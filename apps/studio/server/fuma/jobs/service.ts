import { safeParseValue } from '@core/utils/typeboxHelpers'
import {
  EnqueueFumaJobSchema,
  type EnqueueFumaJob,
  type FumaJobAdmissionPolicy,
  type FumaJobRecord,
} from './contracts'
import type { FumaJobReadyQueue } from './readyQueue'
import type { FumaJobRepository } from './repository'

export interface FumaJobServiceOptions {
  repository: FumaJobRepository
  readyQueue: FumaJobReadyQueue
  admission: FumaJobAdmissionPolicy
  now?: () => Date
}

export class FumaJobService {
  readonly #repository: FumaJobRepository
  readonly #readyQueue: FumaJobReadyQueue
  readonly #admission: FumaJobAdmissionPolicy
  readonly #now: () => Date

  constructor(options: FumaJobServiceOptions) {
    this.#repository = options.repository
    this.#readyQueue = options.readyQueue
    this.#admission = options.admission
    this.#now = options.now ?? (() => new Date())
  }

  async enqueue(input: EnqueueFumaJob): Promise<{ job: FumaJobRecord; created: boolean }> {
    const parsed = safeParseValue(EnqueueFumaJobSchema, input)
    if (!parsed.ok) throw new TypeError('Durable job input failed validation.')
    const value = await this.#repository.enqueue(parsed.value, this.#admission, this.#now())
    if (Date.parse(value.job.runAt) <= this.#now().getTime() && (value.job.status === 'queued' || value.job.status === 'retry_wait')) {
      try {
        await this.#readyQueue.enqueue([value.job.id])
      } catch (error) {
        console.warn('[fuma:jobs] Redis ready notification failed; PostgreSQL reconciliation will recover:', error)
      }
    }
    return value
  }

  async cancel(jobId: string): Promise<FumaJobRecord | null> {
    const job = await this.#repository.requestCancellation(jobId, this.#now())
    try {
      await this.#readyQueue.remove(jobId)
    } catch (error) {
      console.warn('[fuma:jobs] Redis ready removal failed; PostgreSQL claim validation remains authoritative:', error)
    }
    return job
  }
}
