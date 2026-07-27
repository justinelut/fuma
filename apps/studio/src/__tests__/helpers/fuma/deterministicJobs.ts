import {
  FumaJobAdmissionError,
  FumaJobFenceError,
  type EnqueueFumaJob,
  type FumaJobAdmissionPolicy,
  type FumaJobClaim,
  type FumaJobEffect,
  type FumaJobJsonValue,
  type FumaJobRecord,
  type FumaJobSchedule,
} from '../../../../server/fuma/jobs/contracts'
import type { FumaJobReadyQueue } from '../../../../server/fuma/jobs/readyQueue'
import type { FumaJobRepository } from '../../../../server/fuma/jobs/repository'

function clone<T>(value: T): T {
  return structuredClone(value)
}

export class DeterministicJobReadyQueue implements FumaJobReadyQueue {
  readonly values: string[] = []
  available = true

  connect(): Promise<void> {
    return Promise.resolve()
  }

  close(): Promise<void> {
    return Promise.resolve()
  }

  enqueue(jobIds: readonly string[]): Promise<number> {
    this.#assertAvailable()
    let added = 0
    for (const id of jobIds) {
      if (this.values.includes(id)) continue
      this.values.push(id)
      added += 1
    }
    return Promise.resolve(added)
  }

  take(): Promise<string | null> {
    this.#assertAvailable()
    return Promise.resolve(this.values.shift() ?? null)
  }

  remove(jobId: string): Promise<boolean> {
    this.#assertAvailable()
    const before = this.values.length
    for (let index = this.values.length - 1; index >= 0; index -= 1) {
      if (this.values[index] === jobId) this.values.splice(index, 1)
    }
    return Promise.resolve(before !== this.values.length)
  }

  rebuild(jobIds: readonly string[]): Promise<void> {
    this.#assertAvailable()
    this.values.splice(0, this.values.length, ...new Set(jobIds))
    return Promise.resolve()
  }

  deliverDuplicate(jobId: string): void {
    this.values.push(jobId, jobId)
  }

  loseAll(): void {
    this.values.length = 0
  }

  #assertAvailable(): void {
    if (!this.available) throw new Error('Deterministic ready queue unavailable.')
  }
}

export class InMemoryFumaJobRepository implements FumaJobRepository {
  readonly jobs = new Map<string, FumaJobRecord>()
  readonly effects = new Map<string, FumaJobEffect>()
  readonly schedules = new Map<string, FumaJobSchedule>()

  enqueue(input: EnqueueFumaJob, admission: FumaJobAdmissionPolicy, now: Date): Promise<{ job: FumaJobRecord; created: boolean }> {
    const existing = input.idempotencyKey === undefined ? undefined : [...this.jobs.values()].find((job) => (
      job.organizationId === input.organizationId
      && job.siteId === (input.siteId ?? null)
      && job.kind === input.kind
      && job.idempotencyKey === input.idempotencyKey
    ))
    if (existing) return Promise.resolve({ job: clone(existing), created: false })
    this.#assertAdmission(input.organizationId, input.siteId ?? null, admission)
    const nowIso = now.toISOString()
    const job: FumaJobRecord = {
      id: input.id ?? crypto.randomUUID(),
      organizationId: input.organizationId,
      siteId: input.siteId ?? null,
      kind: input.kind,
      payload: clone(input.payload),
      status: 'queued',
      priority: input.priority ?? 0,
      organizationWeight: input.organizationWeight ?? 1,
      siteWeight: input.siteWeight ?? 1,
      maxAttempts: input.maxAttempts ?? 5,
      attemptCount: 0,
      runAt: input.runAt ?? nowIso,
      claimedBy: null,
      claimExpiresAt: null,
      fence: '0',
      cancellationRequestedAt: null,
      idempotencyKey: input.idempotencyKey ?? null,
      result: null,
      error: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      completedAt: null,
    }
    this.jobs.set(job.id, job)
    return Promise.resolve({ job: clone(job), created: true })
  }

  listReady(now: Date, limit: number, kinds: readonly string[] = []): Promise<FumaJobRecord[]> {
    return Promise.resolve([...this.jobs.values()].filter((job) => {
      const supported = kinds.length === 0 || kinds.includes(job.kind)
      const due = (job.status === 'queued' || job.status === 'retry_wait') && Date.parse(job.runAt) <= now.getTime()
      const expired = job.status === 'running' && job.claimExpiresAt !== null && Date.parse(job.claimExpiresAt) <= now.getTime()
      return supported && (due || expired)
    }).sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id)).slice(0, limit).map(clone))
  }

  claim(jobId: string, workerId: string, leaseMs: number, now: Date): Promise<FumaJobClaim | null> {
    const job = this.jobs.get(jobId)
    if (!job) return Promise.resolve(null)
    const due = (job.status === 'queued' || job.status === 'retry_wait') && Date.parse(job.runAt) <= now.getTime()
    const expired = job.status === 'running' && job.claimExpiresAt !== null && Date.parse(job.claimExpiresAt) <= now.getTime()
    if ((!due && !expired) || job.cancellationRequestedAt !== null) return Promise.resolve(null)
    job.status = 'running'
    job.attemptCount += 1
    job.claimedBy = workerId
    job.claimExpiresAt = new Date(now.getTime() + leaseMs).toISOString()
    job.fence = (BigInt(job.fence) + 1n).toString()
    job.updatedAt = now.toISOString()
    return Promise.resolve({ job: clone(job), workerId, fence: job.fence, attemptNumber: job.attemptCount })
  }

  renewClaim(claim: FumaJobClaim, leaseMs: number, now: Date): Promise<boolean> {
    const job = this.#claimed(claim, false)
    if (!job) return Promise.resolve(false)
    job.claimExpiresAt = new Date(now.getTime() + leaseMs).toISOString()
    return Promise.resolve(true)
  }

  async complete(claim: FumaJobClaim, result: FumaJobJsonValue, now: Date): Promise<'succeeded' | 'cancelled'> {
    const job = this.#claimed(claim)
    const status = job.cancellationRequestedAt === null ? 'succeeded' : 'cancelled'
    job.status = status
    job.result = clone(result)
    job.claimedBy = null
    job.claimExpiresAt = null
    job.completedAt = now.toISOString()
    job.updatedAt = now.toISOString()
    return Promise.resolve(status)
  }

  fail(claim: FumaJobClaim, error: FumaJobJsonValue, nextRunAt: Date, now: Date): Promise<'retry_wait' | 'dead_letter' | 'cancelled'> {
    const job = this.#claimed(claim)
    const status = job.cancellationRequestedAt !== null
      ? 'cancelled'
      : job.attemptCount >= job.maxAttempts ? 'dead_letter' : 'retry_wait'
    job.status = status
    job.error = clone(error)
    job.runAt = nextRunAt.toISOString()
    job.claimedBy = null
    job.claimExpiresAt = null
    job.completedAt = status === 'retry_wait' ? null : now.toISOString()
    job.updatedAt = now.toISOString()
    return Promise.resolve(status)
  }

  requestCancellation(jobId: string, now: Date): Promise<FumaJobRecord | null> {
    const job = this.jobs.get(jobId)
    if (!job) return Promise.resolve(null)
    if (job.status === 'queued' || job.status === 'retry_wait' || job.status === 'running') {
      job.cancellationRequestedAt ??= now.toISOString()
      if (job.status !== 'running') {
        job.status = 'cancelled'
        job.completedAt = now.toISOString()
      }
      job.updatedAt = now.toISOString()
    }
    return Promise.resolve(clone(job))
  }

  async cancellationRequested(claim: FumaJobClaim): Promise<boolean> {
    return this.#claimed(claim).cancellationRequestedAt !== null
  }

  async commitEffect(claim: FumaJobClaim, effectKey: string, result: FumaJobJsonValue, now: Date): Promise<{ effect: FumaJobEffect; created: boolean }> {
    this.#claimed(claim)
    const key = `${claim.job.id}:${effectKey}`
    const existing = this.effects.get(key)
    if (existing) return Promise.resolve({ effect: clone(existing), created: false })
    const effect: FumaJobEffect = {
      jobId: claim.job.id,
      effectKey,
      fence: claim.fence,
      result: clone(result),
      createdAt: now.toISOString(),
    }
    this.effects.set(key, effect)
    return Promise.resolve({ effect: clone(effect), created: true })
  }

  get(jobId: string): Promise<FumaJobRecord | null> {
    const job = this.jobs.get(jobId)
    return Promise.resolve(job ? clone(job) : null)
  }

  getEffect(jobId: string, effectKey: string): Promise<FumaJobEffect | null> {
    const effect = this.effects.get(`${jobId}:${effectKey}`)
    return Promise.resolve(effect ? clone(effect) : null)
  }

  listDueSchedules(now: Date, limit: number): Promise<FumaJobSchedule[]> {
    return Promise.resolve([...this.schedules.values()]
      .filter((schedule) => Date.parse(schedule.nextRunAt) <= now.getTime())
      .sort((left, right) => Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt) || left.id.localeCompare(right.id))
      .slice(0, limit).map(clone))
  }

  async enqueueSchedule(scheduleId: string, fencingToken: string, admission: FumaJobAdmissionPolicy, now: Date): Promise<{ job: FumaJobRecord; created: boolean } | null> {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule || Date.parse(schedule.nextRunAt) > now.getTime() || BigInt(fencingToken) <= BigInt(schedule.enqueueFence)) return null
    const dueAt = schedule.nextRunAt
    const value = await this.enqueue({
      organizationId: schedule.organizationId,
      ...(schedule.siteId === null ? {} : { siteId: schedule.siteId }),
      kind: schedule.kind,
      payload: schedule.payload,
      priority: schedule.priority,
      organizationWeight: schedule.organizationWeight,
      siteWeight: schedule.siteWeight,
      maxAttempts: schedule.maxAttempts,
      idempotencyKey: `schedule:${schedule.id}:${dueAt}`,
    }, admission, now)
    schedule.enqueueFence = fencingToken
    do schedule.nextRunAt = new Date(Date.parse(schedule.nextRunAt) + schedule.intervalMs).toISOString()
    while (Date.parse(schedule.nextRunAt) <= now.getTime())
    return value
  }

  addSchedule(schedule: FumaJobSchedule): void {
    this.schedules.set(schedule.id, clone(schedule))
  }

  #assertAdmission(organizationId: string, siteId: string | null, policy: FumaJobAdmissionPolicy): void {
    const active = [...this.jobs.values()].filter((job) => job.status === 'queued' || job.status === 'running' || job.status === 'retry_wait')
    if (active.filter((job) => job.organizationId === organizationId).length >= policy.maxActivePerOrganization) {
      throw new FumaJobAdmissionError('organization')
    }
    if (siteId !== null && active.filter((job) => job.siteId === siteId).length >= policy.maxActivePerSite) {
      throw new FumaJobAdmissionError('site')
    }
  }

  #claimed(claim: FumaJobClaim): FumaJobRecord
  #claimed(claim: FumaJobClaim, throwing: true): FumaJobRecord
  #claimed(claim: FumaJobClaim, throwing: false): FumaJobRecord | null
  #claimed(claim: FumaJobClaim, throwing = true): FumaJobRecord | null {
    const job = this.jobs.get(claim.job.id)
    const valid = job?.status === 'running'
      && job.fence === claim.fence
      && job.claimedBy === claim.workerId
      && job.claimExpiresAt !== null
    if (valid) return job
    if (throwing) throw new FumaJobFenceError(claim.job.id)
    return null
  }
}
