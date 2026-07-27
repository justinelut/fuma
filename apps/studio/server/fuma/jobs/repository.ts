import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import {
  FumaJobAdmissionError,
  FumaJobFenceError,
  FumaJobRecordSchema,
  type EnqueueFumaJob,
  type FumaJobAdmissionPolicy,
  type FumaJobClaim,
  type FumaJobEffect,
  type FumaJobJsonValue,
  type FumaJobRecord,
  type FumaJobSchedule,
} from './contracts'

const ACTIVE_STATUSES = ['queued', 'running', 'retry_wait'] as const

interface JobRow {
  id: string
  organization_id: string
  site_id: string | null
  kind: string
  payload_json: unknown
  status: string
  priority: number
  organization_weight: number
  site_weight: number
  max_attempts: number
  attempt_count: number
  run_at: string
  claimed_by: string | null
  claim_expires_at: string | null
  fence: string | number | bigint
  cancellation_requested_at: string | null
  idempotency_key: string | null
  result_json: unknown | null
  error_json: unknown | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

interface ScheduleRow {
  id: string
  organization_id: string
  site_id: string | null
  kind: string
  payload_json: unknown
  interval_ms: string | number | bigint
  next_run_at: string
  max_attempts: number
  priority: number
  organization_weight: number
  site_weight: number
  enqueue_fence: string | number | bigint
}

interface EffectRow {
  job_id: string
  effect_key: string
  fence: string | number | bigint
  result_json: unknown
  created_at: string
}

interface ClaimAuthorityRow {
  status: string
  claimed_by: string | null
  claim_expires_at: string | Date | null
  fence: string | number | bigint
  cancellation_requested_at: string | null
}

function hasClaimAuthority(
  row: ClaimAuthorityRow,
  claim: FumaJobClaim,
  now: Date,
): boolean {
  const claimExpiresAt = row.claim_expires_at === null
    ? Number.NaN
    : Date.parse(iso(row.claim_expires_at))
  return row.status === 'running'
    && row.claimed_by === claim.workerId
    && Number.isFinite(claimExpiresAt)
    && claimExpiresAt > now.getTime()
    && String(row.fence) === claim.fence
}

export interface FumaJobRepository {
  enqueue(input: EnqueueFumaJob, admission: FumaJobAdmissionPolicy, now: Date): Promise<{ job: FumaJobRecord; created: boolean }>
  listReady(now: Date, limit: number, kinds?: readonly string[]): Promise<FumaJobRecord[]>
  claim(jobId: string, workerId: string, leaseMs: number, now: Date): Promise<FumaJobClaim | null>
  renewClaim(claim: FumaJobClaim, leaseMs: number, now: Date): Promise<boolean>
  complete(claim: FumaJobClaim, result: FumaJobJsonValue, now: Date): Promise<'succeeded' | 'cancelled'>
  fail(claim: FumaJobClaim, error: FumaJobJsonValue, nextRunAt: Date, now: Date): Promise<'retry_wait' | 'dead_letter' | 'cancelled'>
  requestCancellation(jobId: string, now: Date): Promise<FumaJobRecord | null>
  cancellationRequested(claim: FumaJobClaim): Promise<boolean>
  commitEffect(claim: FumaJobClaim, effectKey: string, result: FumaJobJsonValue, now: Date): Promise<{ effect: FumaJobEffect; created: boolean }>
  get(jobId: string): Promise<FumaJobRecord | null>
  getEffect(jobId: string, effectKey: string): Promise<FumaJobEffect | null>
  listDueSchedules(now: Date, limit: number): Promise<FumaJobSchedule[]>
  enqueueSchedule(scheduleId: string, fencingToken: string, admission: FumaJobAdmissionPolicy, now: Date): Promise<{ job: FumaJobRecord; created: boolean } | null>
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value
}

function json(value: FumaJobJsonValue): string {
  return JSON.stringify(value)
}

function mapJob(row: JobRow): FumaJobRecord {
  const candidate = {
    id: row.id,
    organizationId: row.organization_id,
    siteId: row.site_id,
    kind: row.kind,
    payload: row.payload_json,
    status: row.status,
    priority: Number(row.priority),
    organizationWeight: Number(row.organization_weight),
    siteWeight: Number(row.site_weight),
    maxAttempts: Number(row.max_attempts),
    attemptCount: Number(row.attempt_count),
    runAt: iso(row.run_at),
    claimedBy: row.claimed_by,
    claimExpiresAt: row.claim_expires_at === null ? null : iso(row.claim_expires_at),
    fence: String(row.fence),
    cancellationRequestedAt: row.cancellation_requested_at === null ? null : iso(row.cancellation_requested_at),
    idempotencyKey: row.idempotency_key,
    result: row.result_json,
    error: row.error_json,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: row.completed_at === null ? null : iso(row.completed_at),
  }
  const parsed = safeParseValue(FumaJobRecordSchema, candidate)
  if (!parsed.ok) throw new Error(`Stored durable job ${row.id} failed schema validation.`)
  return parsed.value
}

function mapEffect(row: EffectRow): FumaJobEffect {
  return {
    jobId: row.job_id,
    effectKey: row.effect_key,
    fence: String(row.fence),
    result: row.result_json as FumaJobJsonValue,
    createdAt: iso(row.created_at),
  }
}

function mapSchedule(row: ScheduleRow): FumaJobSchedule {
  return {
    id: row.id,
    organizationId: row.organization_id,
    siteId: row.site_id,
    kind: row.kind,
    payload: row.payload_json as FumaJobJsonValue,
    intervalMs: Number(row.interval_ms),
    nextRunAt: iso(row.next_run_at),
    maxAttempts: Number(row.max_attempts),
    priority: Number(row.priority),
    organizationWeight: Number(row.organization_weight),
    siteWeight: Number(row.site_weight),
    enqueueFence: String(row.enqueue_fence),
  }
}

function isReady(job: FumaJobRecord, now: Date): boolean {
  if ((job.status === 'queued' || job.status === 'retry_wait') && Date.parse(job.runAt) <= now.getTime()) return true
  return job.status === 'running'
    && job.claimExpiresAt !== null
    && Date.parse(job.claimExpiresAt) <= now.getTime()
}

async function existingIdempotentJob(tx: DbClient, input: EnqueueFumaJob): Promise<FumaJobRecord | null> {
  if (input.idempotencyKey === undefined) return null
  const { rows } = await tx<JobRow>`
    select * from fuma_jobs
    where organization_id = ${input.organizationId}
      and site_id is not distinct from ${input.siteId ?? null}
      and kind = ${input.kind}
      and idempotency_key = ${input.idempotencyKey}
    limit 1
  `
  return rows[0] ? mapJob(rows[0]) : null
}

async function assertAdmission(
  tx: DbClient,
  organizationId: string,
  siteId: string | null,
  policy: FumaJobAdmissionPolicy,
): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${'jobs:organization:' + organizationId}, 0))`
  const organization = await tx<{ count: string | number }>`
    select count(*) as count from fuma_jobs
    where organization_id = ${organizationId} and status in ('queued', 'running', 'retry_wait')
  `
  if (Number(organization.rows[0]?.count ?? 0) >= policy.maxActivePerOrganization) {
    throw new FumaJobAdmissionError('organization')
  }
  if (siteId === null) return
  await tx`select pg_advisory_xact_lock(hashtextextended(${'jobs:site:' + siteId}, 0))`
  const site = await tx<{ count: string | number }>`
    select count(*) as count from fuma_jobs
    where site_id = ${siteId} and status in ('queued', 'running', 'retry_wait')
  `
  if (Number(site.rows[0]?.count ?? 0) >= policy.maxActivePerSite) throw new FumaJobAdmissionError('site')
}

async function insertJob(tx: DbClient, input: EnqueueFumaJob, now: Date): Promise<FumaJobRecord> {
  const id = input.id ?? crypto.randomUUID()
  const nowIso = now.toISOString()
  const { rows } = await tx<JobRow>`
    insert into fuma_jobs (
      id, organization_id, site_id, kind, payload_json, status, priority,
      organization_weight, site_weight, max_attempts, run_at, idempotency_key,
      created_at, updated_at
    ) values (
      ${id}, ${input.organizationId}, ${input.siteId ?? null}, ${input.kind}, ${json(input.payload)}::jsonb,
      'queued', ${input.priority ?? 0}, ${input.organizationWeight ?? 1}, ${input.siteWeight ?? 1},
      ${input.maxAttempts ?? 5}, ${input.runAt ?? nowIso}, ${input.idempotencyKey ?? null}, ${nowIso}, ${nowIso}
    ) returning *
  `
  if (!rows[0]) throw new Error(`Failed to insert durable job ${id}.`)
  return mapJob(rows[0])
}

export class PostgresFumaJobRepository implements FumaJobRepository {
  readonly #db: DbClient
  readonly #now: () => Date

  constructor(db: DbClient, now: () => Date = () => new Date()) {
    if (db.dialect !== 'postgres') throw new Error('Fuma durable jobs require PostgreSQL authority.')
    this.#db = db
    this.#now = now
  }

  enqueue(input: EnqueueFumaJob, admission: FumaJobAdmissionPolicy, now: Date): Promise<{ job: FumaJobRecord; created: boolean }> {
    return this.#db.transaction(async (tx) => {
      const existing = await existingIdempotentJob(tx, input)
      if (existing) return { job: existing, created: false }
      await assertAdmission(tx, input.organizationId, input.siteId ?? null, admission)
      return { job: await insertJob(tx, input, now), created: true }
    })
  }

  async listReady(now: Date, limit: number, kinds: readonly string[] = []): Promise<FumaJobRecord[]> {
    const kindFilter = kinds.length === 0 ? '' : ` and kind in (${kinds.map((_kind, index) => `$${index + 3}`).join(', ')})`
    const { rows } = await this.#db.unsafe<JobRow>(`
      select * from fuma_jobs
      where (
        (status in ('queued', 'retry_wait') and run_at <= $1)
        or (status = 'running' and claim_expires_at <= $1)
      )${kindFilter}
      order by priority desc, run_at, created_at, id
      limit $2
    `, [now.toISOString(), limit, ...kinds])
    return rows.map(mapJob)
  }

  claim(jobId: string, workerId: string, leaseMs: number, now: Date): Promise<FumaJobClaim | null> {
    return this.#db.transaction(async (tx) => {
      const selected = await tx<JobRow>`select * from fuma_jobs where id = ${jobId} for update`
      if (!selected.rows[0]) return null
      const current = mapJob(selected.rows[0])
      if (!isReady(current, now) || current.cancellationRequestedAt !== null) {
        if (current.cancellationRequestedAt !== null && (current.status === 'queued' || current.status === 'retry_wait')) {
          await tx`update fuma_jobs set status = 'cancelled', completed_at = ${now.toISOString()}, updated_at = ${now.toISOString()} where id = ${jobId}`
        }
        return null
      }
      if (current.status === 'running') {
        await tx`
          update fuma_job_attempts set status = 'abandoned', finished_at = ${now.toISOString()}
          where job_id = ${jobId} and fence = ${current.fence} and status = 'running'
        `
      }
      const attemptNumber = current.attemptCount + 1
      const fence = (BigInt(current.fence) + 1n).toString()
      const expiresAt = new Date(now.getTime() + leaseMs).toISOString()
      const updated = await tx<JobRow>`
        update fuma_jobs set status = 'running', attempt_count = ${attemptNumber}, claimed_by = ${workerId},
          claim_expires_at = ${expiresAt}, fence = ${fence}, updated_at = ${now.toISOString()}
        where id = ${jobId} returning *
      `
      await tx`
        insert into fuma_job_attempts (id, job_id, attempt_number, fence, worker_id, status, started_at)
        values (${crypto.randomUUID()}, ${jobId}, ${attemptNumber}, ${fence}, ${workerId}, 'running', ${now.toISOString()})
      `
      return { job: mapJob(updated.rows[0]!), workerId, fence, attemptNumber }
    })
  }

  async renewClaim(claim: FumaJobClaim, leaseMs: number, now: Date): Promise<boolean> {
    const result = await this.#db`
      update fuma_jobs set claim_expires_at = ${new Date(now.getTime() + leaseMs).toISOString()}, updated_at = ${now.toISOString()}
      where id = ${claim.job.id} and status = 'running' and claimed_by = ${claim.workerId} and fence = ${claim.fence}
    `
    return result.rowCount === 1
  }

  complete(claim: FumaJobClaim, result: FumaJobJsonValue, now: Date): Promise<'succeeded' | 'cancelled'> {
    return this.#db.transaction(async (tx) => {
      const selected = await tx<JobRow>`select * from fuma_jobs where id = ${claim.job.id} for update`
      const current = selected.rows[0] ? mapJob(selected.rows[0]) : null
      if (!current || current.status !== 'running' || current.fence !== claim.fence || current.claimedBy !== claim.workerId) {
        throw new FumaJobFenceError(claim.job.id)
      }
      const status = current.cancellationRequestedAt === null ? 'succeeded' : 'cancelled'
      await tx`
        update fuma_jobs set status = ${status}, result_json = ${json(result)}::jsonb, claimed_by = null,
          claim_expires_at = null, completed_at = ${now.toISOString()}, updated_at = ${now.toISOString()}
        where id = ${claim.job.id}
      `
      await tx`
        update fuma_job_attempts set status = ${status}, finished_at = ${now.toISOString()}
        where job_id = ${claim.job.id} and fence = ${claim.fence} and status = 'running'
      `
      return status
    })
  }

  fail(claim: FumaJobClaim, error: FumaJobJsonValue, nextRunAt: Date, now: Date): Promise<'retry_wait' | 'dead_letter' | 'cancelled'> {
    return this.#db.transaction(async (tx) => {
      const selected = await tx<JobRow>`select * from fuma_jobs where id = ${claim.job.id} for update`
      const current = selected.rows[0] ? mapJob(selected.rows[0]) : null
      if (!current || current.status !== 'running' || current.fence !== claim.fence || current.claimedBy !== claim.workerId) {
        throw new FumaJobFenceError(claim.job.id)
      }
      const status = current.cancellationRequestedAt !== null
        ? 'cancelled'
        : current.attemptCount >= current.maxAttempts ? 'dead_letter' : 'retry_wait'
      await tx`
        update fuma_jobs set status = ${status}, error_json = ${json(error)}::jsonb,
          run_at = ${nextRunAt.toISOString()}, claimed_by = null, claim_expires_at = null,
          completed_at = ${status === 'retry_wait' ? null : now.toISOString()}, updated_at = ${now.toISOString()}
        where id = ${claim.job.id}
      `
      await tx`
        update fuma_job_attempts set status = ${status === 'retry_wait' ? 'failed' : status === 'dead_letter' ? 'failed' : 'cancelled'},
          finished_at = ${now.toISOString()}, error_json = ${json(error)}::jsonb
        where job_id = ${claim.job.id} and fence = ${claim.fence} and status = 'running'
      `
      return status
    })
  }

  async requestCancellation(jobId: string, now: Date): Promise<FumaJobRecord | null> {
    const { rows } = await this.#db<JobRow>`
      update fuma_jobs set
        cancellation_requested_at = coalesce(cancellation_requested_at, ${now.toISOString()}),
        status = case when status in ('queued', 'retry_wait') then 'cancelled' else status end,
        completed_at = case when status in ('queued', 'retry_wait') then ${now.toISOString()} else completed_at end,
        updated_at = ${now.toISOString()}
      where id = ${jobId} and status in ('queued', 'retry_wait', 'running') returning *
    `
    return rows[0] ? mapJob(rows[0]) : await this.get(jobId)
  }

  async cancellationRequested(claim: FumaJobClaim): Promise<boolean> {
    const { rows } = await this.#db<ClaimAuthorityRow>`
      select status, claimed_by, claim_expires_at, fence, cancellation_requested_at
      from fuma_jobs where id = ${claim.job.id}
    `
    const current = rows[0]
    let now: Date
    try {
      now = this.#now()
    } catch (_error) {
      throw new FumaJobFenceError(claim.job.id)
    }
    if (
      !(now instanceof Date)
      || !Number.isFinite(now.getTime())
      || !current
      || !hasClaimAuthority(current, claim, now)
    ) {
      throw new FumaJobFenceError(claim.job.id)
    }
    return current.cancellation_requested_at !== null
  }

  commitEffect(claim: FumaJobClaim, effectKey: string, result: FumaJobJsonValue, now: Date): Promise<{ effect: FumaJobEffect; created: boolean }> {
    return this.#db.transaction(async (tx) => {
      const job = await tx<JobRow>`select * from fuma_jobs where id = ${claim.job.id} for update`
      const current = job.rows[0] ? mapJob(job.rows[0]) : null
      if (!current || current.status !== 'running' || current.fence !== claim.fence || current.claimedBy !== claim.workerId) {
        throw new FumaJobFenceError(claim.job.id)
      }
      const prior = await tx<EffectRow>`
        select * from fuma_job_effects where job_id = ${claim.job.id} and effect_key = ${effectKey}
      `
      if (prior.rows[0]) return { effect: mapEffect(prior.rows[0]), created: false }
      const inserted = await tx<EffectRow>`
        insert into fuma_job_effects (job_id, effect_key, fence, result_json, created_at)
        values (${claim.job.id}, ${effectKey}, ${claim.fence}, ${json(result)}::jsonb, ${now.toISOString()})
        returning *
      `
      return { effect: mapEffect(inserted.rows[0]!), created: true }
    })
  }

  async get(jobId: string): Promise<FumaJobRecord | null> {
    const { rows } = await this.#db<JobRow>`select * from fuma_jobs where id = ${jobId}`
    return rows[0] ? mapJob(rows[0]) : null
  }

  async getEffect(jobId: string, effectKey: string): Promise<FumaJobEffect | null> {
    const { rows } = await this.#db<EffectRow>`
      select * from fuma_job_effects where job_id = ${jobId} and effect_key = ${effectKey}
    `
    return rows[0] ? mapEffect(rows[0]) : null
  }

  async listDueSchedules(now: Date, limit: number): Promise<FumaJobSchedule[]> {
    const { rows } = await this.#db<ScheduleRow>`
      select * from fuma_job_schedules where enabled = true and next_run_at <= ${now.toISOString()}
      order by next_run_at, id limit ${limit}
    `
    return rows.map(mapSchedule)
  }

  enqueueSchedule(scheduleId: string, fencingToken: string, admission: FumaJobAdmissionPolicy, now: Date): Promise<{ job: FumaJobRecord; created: boolean } | null> {
    return this.#db.transaction(async (tx) => {
      const selected = await tx<ScheduleRow>`select * from fuma_job_schedules where id = ${scheduleId} and enabled = true for update`
      if (!selected.rows[0]) return null
      const schedule = mapSchedule(selected.rows[0])
      if (Date.parse(schedule.nextRunAt) > now.getTime()) return null
      if (BigInt(fencingToken) <= BigInt(schedule.enqueueFence)) return null
      const input: EnqueueFumaJob = {
        organizationId: schedule.organizationId,
        ...(schedule.siteId === null ? {} : { siteId: schedule.siteId }),
        kind: schedule.kind,
        payload: schedule.payload,
        priority: schedule.priority,
        organizationWeight: schedule.organizationWeight,
        siteWeight: schedule.siteWeight,
        maxAttempts: schedule.maxAttempts,
        idempotencyKey: `schedule:${schedule.id}:${schedule.nextRunAt}`,
      }
      const existing = await existingIdempotentJob(tx, input)
      let value: { job: FumaJobRecord; created: boolean }
      if (existing) {
        value = { job: existing, created: false }
      } else {
        await assertAdmission(tx, schedule.organizationId, schedule.siteId, admission)
        value = { job: await insertJob(tx, input, now), created: true }
      }
      let nextRunAt = Date.parse(schedule.nextRunAt)
      do nextRunAt += schedule.intervalMs
      while (nextRunAt <= now.getTime())
      await tx`
        update fuma_job_schedules set enqueue_fence = ${fencingToken}, last_enqueued_at = ${now.toISOString()},
          next_run_at = ${new Date(nextRunAt).toISOString()}, updated_at = ${now.toISOString()}
        where id = ${schedule.id}
      `
      return value
    })
  }
}

export { ACTIVE_STATUSES }
