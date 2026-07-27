import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import { QUOTA_CLASSES, type QuotaEnvelope } from '../entitlements/service'

const QuotaClassSchema = Type.Union(QUOTA_CLASSES.map((quotaClass) => Type.Literal(quotaClass)))
export const QuotaAdmissionSchema = Type.Object({
  idempotencyKey: Type.String({ minLength: 1, maxLength: 512 }),
  organizationId: Type.String({ minLength: 1, maxLength: 255 }),
  workspaceId: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
  siteId: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
  quotaClass: QuotaClassSchema,
  units: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  operation: Type.Union([Type.Literal('create'), Type.Literal('campaign'), Type.Literal('build'), Type.Literal('domain')]),
}, { additionalProperties: false })
export type QuotaAdmission = Static<typeof QuotaAdmissionSchema>
export type QuotaState = Readonly<{
  limits: QuotaEnvelope
  used: Readonly<Record<string, number>>
  reserved: Readonly<Record<string, number>>
  topUps: Readonly<Record<string, number>>
  source: 'public-contract' | 'private-contract' | 'platform-internal'
}>
export type QuotaNotice = Readonly<{ organizationId: string; quotaClass: string; percent: 50 | 75 | 90 | 100; used: number; limit: number }>
export type QuotaAdmissionResult = Readonly<{ duplicate: boolean; notice: QuotaNotice | null; notices: readonly QuotaNotice[] }>

export interface QuotaRepository {
  /** Serializes the idempotency claim and balance mutation on the organization. */
  admitAtomic<T>(input: QuotaAdmission, work: (state: QuotaState) => Promise<Readonly<{ state: QuotaState; result: T }>>): Promise<Readonly<{ duplicate: boolean; result: T | null }>>
  transaction<T>(organizationId: string, work: (state: QuotaState) => Promise<Readonly<{ state: QuotaState; result: T }>>): Promise<T>
  emitNotice(notice: QuotaNotice): Promise<boolean>
}

export class QuotaError extends Error {
  readonly code: 'invalid' | 'exhausted' | 'unverified-contract';
  readonly preserveExisting: boolean;
  constructor(code: 'invalid' | 'exhausted' | 'unverified-contract', message: string, preserveExisting = true) {
    super(message); this.code = code; this.preserveExisting = preserveExisting;
    this.name = 'QuotaError'
  }
}

const NOTICE_THRESHOLDS = [50, 75, 90, 100] as const
function finiteBalance(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new QuotaError('invalid', `${label} is not a non-negative safe integer.`)
  return value
}
function crossedNotices(input: QuotaAdmission, before: number, after: number, limit: number): readonly QuotaNotice[] {
  const beforePercent = limit === 0 ? 100 : (before * 100) / limit
  const afterPercent = limit === 0 ? 100 : (after * 100) / limit
  return NOTICE_THRESHOLDS
    .filter((threshold) => beforePercent < threshold && afterPercent >= threshold)
    .map((percent) => Object.freeze({ organizationId: input.organizationId, quotaClass: input.quotaClass, percent, used: after, limit }))
}

export class QuotaService {
  private readonly repository: QuotaRepository;
  constructor(repository: QuotaRepository) { this.repository = repository;}

  async admit(raw: unknown): Promise<QuotaAdmissionResult> {
    if (!Value.Check(QuotaAdmissionSchema, raw)) throw new QuotaError('invalid', 'Quota admission contract invalid.')
    const input = Object.freeze(structuredClone(raw)) as QuotaAdmission
    let pendingNotices: readonly QuotaNotice[] = []
    const admission = await this.repository.admitAtomic(input, async (state) => {
      const contractualLimit = finiteBalance(state.limits[input.quotaClass], 'Quota limit')
      const topUp = finiteBalance(state.topUps[input.quotaClass] ?? 0, 'Quota top-up')
      const limit = contractualLimit + topUp
      const used = finiteBalance(state.used[input.quotaClass] ?? 0, 'Used quota')
      const reserved = finiteBalance(state.reserved[input.quotaClass] ?? 0, 'Reserved quota')
      const nextReserved = reserved + input.units
      if (!Number.isSafeInteger(nextReserved) || used + nextReserved > limit) {
        throw new QuotaError('exhausted', `Quota ${input.quotaClass} exhausted; existing data remains readable and exportable.`)
      }
      pendingNotices = crossedNotices(input, used + reserved, used + nextReserved, limit)
      return {
        state: Object.freeze({ ...state, reserved: Object.freeze({ ...state.reserved, [input.quotaClass]: nextReserved }) }),
        result: true,
      }
    })
    if (admission.duplicate) return Object.freeze({ duplicate: true, notice: null, notices: Object.freeze([]) })
    const emitted: QuotaNotice[] = []
    for (const notice of pendingNotices) if (await this.repository.emitNotice(notice)) emitted.push(notice)
    return Object.freeze({ duplicate: false, notice: emitted.at(-1) ?? null, notices: Object.freeze(emitted) })
  }

  async settle(organizationId: string, quotaClass: keyof QuotaEnvelope, reservedUnits: number, actualUnits: number): Promise<void> {
    finiteBalance(reservedUnits, 'Settlement reservation')
    finiteBalance(actualUnits, 'Settlement actual')
    if (actualUnits > reservedUnits) throw new QuotaError('invalid', 'Actual quota use exceeds its reservation.')
    await this.repository.transaction(organizationId, async (state) => {
      const currentReserved = finiteBalance(state.reserved[quotaClass] ?? 0, 'Reserved quota')
      const currentUsed = finiteBalance(state.used[quotaClass] ?? 0, 'Used quota')
      if (reservedUnits > currentReserved) throw new QuotaError('invalid', 'Quota settlement exceeds the outstanding reservation.')
      return {
        state: Object.freeze({
          ...state,
          reserved: Object.freeze({ ...state.reserved, [quotaClass]: currentReserved - reservedUnits }),
          used: Object.freeze({ ...state.used, [quotaClass]: currentUsed + actualUnits }),
        }),
        result: undefined,
      }
    })
  }

  async release(organizationId: string, quotaClass: keyof QuotaEnvelope, reservedUnits: number): Promise<void> {
    finiteBalance(reservedUnits, 'Released reservation')
    await this.repository.transaction(organizationId, async (state) => {
      const currentReserved = finiteBalance(state.reserved[quotaClass] ?? 0, 'Reserved quota')
      if (reservedUnits > currentReserved) throw new QuotaError('invalid', 'Quota release exceeds the outstanding reservation.')
      return {
        state: Object.freeze({ ...state, reserved: Object.freeze({ ...state.reserved, [quotaClass]: currentReserved - reservedUnits }) }),
        result: undefined,
      }
    })
  }

  selfService(state: QuotaState) {
    const base = Object.freeze({
      limits: state.limits,
      used: state.used,
      reserved: state.reserved,
      notices: QUOTA_CLASSES.map((quotaClass) => ({
        quotaClass,
        percent: Math.min(100, Math.floor((((state.used[quotaClass] ?? 0) + (state.reserved[quotaClass] ?? 0)) / (state.limits[quotaClass] || 1)) * 100)),
      })),
    })
    if (state.source === 'platform-internal') return Object.freeze({ ...base, billing: null, shadowCost: undefined, provider: undefined })
    return Object.freeze({ ...base, billing: Object.freeze({ invoices: true, transactions: true, contracts: true, receipts: true, planChanges: true, cancellation: true, grace: true }) })
  }
}

export type DunningAccount = Readonly<{ organizationId: string; source: QuotaState['source']; paymentState: 'current' | 'past-due' | 'grace' | 'cancelled'; graceEndsAt: string | null }>
export interface DunningRepository {
  due(at: string): Promise<readonly DunningAccount[]>
  save(account: DunningAccount): Promise<void>
  notify(account: DunningAccount, kind: 'past-due' | 'grace-expiring' | 'cancelled'): Promise<void>
}
export class DunningJobService {
  private readonly repository: DunningRepository;
  private readonly now: () => Date;
  constructor(repository: DunningRepository, now: () => Date = () => new Date()) { this.repository = repository; this.now = now;}
  async run(): Promise<void> {
    const instant = this.now()
    for (const account of await this.repository.due(instant.toISOString())) {
      if (account.source === 'platform-internal' || account.paymentState === 'current' || account.paymentState === 'cancelled') continue
      if (account.paymentState === 'past-due') {
        const next = Object.freeze({ ...account, paymentState: 'grace' as const, graceEndsAt: new Date(instant.getTime() + 7 * 86_400_000).toISOString() })
        await this.repository.save(next)
        await this.repository.notify(next, 'past-due')
      } else if (account.graceEndsAt && Date.parse(account.graceEndsAt) <= instant.getTime()) {
        const next = Object.freeze({ ...account, paymentState: 'cancelled' as const })
        await this.repository.save(next)
        await this.repository.notify(next, 'cancelled')
      } else {
        await this.repository.notify(account, 'grace-expiring')
      }
    }
  }
}

export class MemoryQuotaRepository implements QuotaRepository {
  readonly states = new Map<string, QuotaState>()
  readonly keys = new Set<string>()
  readonly notices = new Set<string>()
  private readonly tails = new Map<string, Promise<void>>()

  private async serialized<T>(organizationId: string, work: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(organizationId) ?? Promise.resolve()
    let unlock!: () => void
    const next = new Promise<void>((resolve) => { unlock = resolve })
    this.tails.set(organizationId, prior.then(() => next))
    await prior
    try { return await work() } finally { unlock(); if (this.tails.get(organizationId) === next) this.tails.delete(organizationId) }
  }

  async admitAtomic<T>(input: QuotaAdmission, work: (state: QuotaState) => Promise<Readonly<{ state: QuotaState; result: T }>>) {
    return await this.serialized(input.organizationId, async () => {
      if (this.keys.has(input.idempotencyKey)) return Object.freeze({ duplicate: true, result: null })
      const state = this.states.get(input.organizationId)
      if (!state) throw new QuotaError('unverified-contract', 'Only verified contracts and grants create quota state.')
      const output = await work(structuredClone(state))
      this.states.set(input.organizationId, structuredClone(output.state))
      this.keys.add(input.idempotencyKey)
      return Object.freeze({ duplicate: false, result: output.result })
    })
  }

  async transaction<T>(organizationId: string, work: (state: QuotaState) => Promise<Readonly<{ state: QuotaState; result: T }>>) {
    return await this.serialized(organizationId, async () => {
      const state = this.states.get(organizationId)
      if (!state) throw new QuotaError('unverified-contract', 'Only verified contracts and grants create quota state.')
      const output = await work(structuredClone(state))
      this.states.set(organizationId, structuredClone(output.state))
      return output.result
    })
  }

  async emitNotice(notice: QuotaNotice) {
    const key = `${notice.organizationId}:${notice.quotaClass}:${notice.percent}`
    if (this.notices.has(key)) return false
    this.notices.add(key)
    return true
  }
}
