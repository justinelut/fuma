import { Type, type Static } from '@core/utils/typeboxHelpers'

export const FumaJobStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('retry_wait'),
  Type.Literal('succeeded'),
  Type.Literal('cancelled'),
  Type.Literal('dead_letter'),
])
export type FumaJobStatus = Static<typeof FumaJobStatusSchema>

const JsonValueSchema = Type.Recursive((Self) => Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String(),
  Type.Array(Self),
  Type.Record(Type.String(), Self),
]))
export type FumaJobJsonValue = Static<typeof JsonValueSchema>

const FumaJobTimestampSchema = Type.String({
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$',
})

export const FumaJobRecordSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  organizationId: Type.String({ minLength: 1 }),
  siteId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  kind: Type.String({ minLength: 1 }),
  payload: JsonValueSchema,
  status: FumaJobStatusSchema,
  priority: Type.Integer(),
  organizationWeight: Type.Integer({ minimum: 1 }),
  siteWeight: Type.Integer({ minimum: 1 }),
  maxAttempts: Type.Integer({ minimum: 1 }),
  attemptCount: Type.Integer({ minimum: 0 }),
  runAt: FumaJobTimestampSchema,
  claimedBy: Type.Union([Type.String(), Type.Null()]),
  claimExpiresAt: Type.Union([FumaJobTimestampSchema, Type.Null()]),
  fence: Type.String({ pattern: '^\\d+$' }),
  cancellationRequestedAt: Type.Union([FumaJobTimestampSchema, Type.Null()]),
  idempotencyKey: Type.Union([Type.String(), Type.Null()]),
  result: Type.Union([JsonValueSchema, Type.Null()]),
  error: Type.Union([JsonValueSchema, Type.Null()]),
  createdAt: FumaJobTimestampSchema,
  updatedAt: FumaJobTimestampSchema,
  completedAt: Type.Union([FumaJobTimestampSchema, Type.Null()]),
}, { additionalProperties: false })
export type FumaJobRecord = Static<typeof FumaJobRecordSchema>

export const EnqueueFumaJobSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1 })),
  organizationId: Type.String({ minLength: 1 }),
  siteId: Type.Optional(Type.String({ minLength: 1 })),
  kind: Type.String({ minLength: 1 }),
  payload: JsonValueSchema,
  priority: Type.Optional(Type.Integer({ minimum: -1_000, maximum: 1_000 })),
  organizationWeight: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  siteWeight: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  maxAttempts: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  runAt: Type.Optional(FumaJobTimestampSchema),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
}, { additionalProperties: false })
export type EnqueueFumaJob = Static<typeof EnqueueFumaJobSchema>

export interface FumaJobClaim {
  job: FumaJobRecord
  workerId: string
  fence: string
  attemptNumber: number
}

export interface FumaJobAdmissionPolicy {
  maxActivePerOrganization: number
  maxActivePerSite: number
}

export interface FumaJobRetryPolicy {
  baseDelayMs: number
  maxDelayMs: number
}

export interface FumaJobSchedule {
  id: string
  organizationId: string
  siteId: string | null
  kind: string
  payload: FumaJobJsonValue
  intervalMs: number
  nextRunAt: string
  maxAttempts: number
  priority: number
  organizationWeight: number
  siteWeight: number
  enqueueFence: string
}

export interface FumaJobEffect {
  jobId: string
  effectKey: string
  fence: string
  result: FumaJobJsonValue
  createdAt: string
}

export class FumaJobAdmissionError extends Error {
  readonly scope: 'organization' | 'site'

  constructor(scope: 'organization' | 'site') {
    super(`Durable job admission limit reached for ${scope}.`)
    this.name = 'FumaJobAdmissionError'
    this.scope = scope
  }
}

export class FumaJobFenceError extends Error {
  readonly jobId: string

  constructor(jobId: string) {
    super(`Durable job ${jobId} rejected a stale claim fence.`)
    this.name = 'FumaJobFenceError'
    this.jobId = jobId
  }
}

/** Test/demo signal for a process that disappears without failure acknowledgement. */
export class FumaJobProcessDeathError extends Error {
  constructor() {
    super('Simulated process death after durable effect and before acknowledgement.')
    this.name = 'FumaJobProcessDeathError'
  }
}
