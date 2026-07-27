import { safeParseValue } from '@core/utils/typeboxHelpers'
import {
  QUOTA_CLASSES,
  QuotaActualObservationSchema,
  QuotaAdmissionSchema,
  QuotaForecastSchema,
  QuotaReservationSchema,
  QuotaSettlementSchema,
  ZERO_QUOTA_USAGE,
  type QuotaActualObservation,
  type QuotaAdmission,
  type QuotaClass,
  type QuotaForecastResult,
  type QuotaNotice,
  type QuotaReservation,
  type QuotaReservationResult,
  type QuotaSettlement,
  type QuotaState,
  type QuotaUsageEnvelope,
} from './contracts'

export * from './contracts'

export interface QuotaRepository {
  reserve(input: QuotaReservation): Promise<QuotaReservationResult>
  settle(input: QuotaSettlement): Promise<Readonly<{ duplicate: boolean }>>
  release(idempotencyKey: string): Promise<Readonly<{ duplicate: boolean }>>
  state(organizationId: string): Promise<QuotaState>
  observe(input: QuotaActualObservation): Promise<Readonly<{
    duplicate: boolean
    notices: readonly QuotaNotice[]
  }>>
}

export class QuotaError extends Error {
  readonly code:
    | 'invalid'
    | 'exhausted'
    | 'unverified-contract'
    | 'payment-required'
    | 'conflict'
  readonly preserveExisting: boolean

  constructor(
    code: QuotaError['code'],
    message: string,
    preserveExisting = true,
  ) {
    super(message)
    this.code = code
    this.preserveExisting = preserveExisting
    this.name = 'QuotaError'
  }
}

function validateUniqueItems(
  items: readonly Readonly<{ quotaClass: QuotaClass; units: number }>[],
  label: string,
): void {
  if (new Set(items.map(({ quotaClass }) => quotaClass)).size !== items.length) {
    throw new QuotaError('invalid', `${label} contains duplicate quota classes.`)
  }
}

function finiteBalance(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new QuotaError('invalid', `${label} is not a non-negative safe integer.`)
  }
  return value
}

function totalLimit(state: QuotaState, quotaClass: QuotaClass): number {
  const contractual = finiteBalance(state.limits[quotaClass], 'Quota limit')
  const topUp = finiteBalance(state.topUps[quotaClass], 'Quota adjustment')
  const total = contractual + topUp
  if (!Number.isSafeInteger(total)) throw new QuotaError('invalid', 'Effective quota exceeds safe integer range.')
  return total
}

function sameReservation(left: QuotaReservation, right: QuotaReservation): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameSettlement(left: QuotaSettlement, right: QuotaSettlement): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

const NOTICE_THRESHOLDS = [50, 75, 90, 100] as const

function crossedNotices(
  organizationId: string,
  quotaClass: QuotaClass,
  before: number,
  after: number,
  limit: number,
): readonly QuotaNotice[] {
  const beforePercent = (before * 100) / limit
  const afterPercent = (after * 100) / limit
  return Object.freeze(NOTICE_THRESHOLDS
    .filter((threshold) => beforePercent < threshold && afterPercent >= threshold)
    .map((percent) => Object.freeze({
      organizationId,
      quotaClass,
      percent,
      used: after,
      limit,
    })))
}

export class QuotaService {
  readonly #repository: QuotaRepository

  constructor(repository: QuotaRepository) {
    this.#repository = repository
  }

  async admit(raw: unknown): Promise<QuotaReservationResult> {
    const parsed = safeParseValue(QuotaAdmissionSchema, raw)
    if (!parsed.ok) throw new QuotaError('invalid', 'Quota admission contract invalid.')
    const input = Object.freeze(structuredClone(parsed.value)) as QuotaAdmission
    return await this.reserve({
      idempotencyKey: input.idempotencyKey,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      siteId: input.siteId,
      operation: input.operation,
      items: [{ quotaClass: input.quotaClass, units: input.units }],
    })
  }

  async reserve(raw: unknown): Promise<QuotaReservationResult> {
    const parsed = safeParseValue(QuotaReservationSchema, raw)
    if (!parsed.ok) throw new QuotaError('invalid', 'Quota reservation contract invalid.')
    validateUniqueItems(parsed.value.items, 'Quota reservation')
    return await this.#repository.reserve(Object.freeze(structuredClone(parsed.value)))
  }

  async settleReservation(raw: unknown): Promise<Readonly<{ duplicate: boolean }>> {
    const parsed = safeParseValue(QuotaSettlementSchema, raw)
    if (!parsed.ok) throw new QuotaError('invalid', 'Quota settlement contract invalid.')
    validateUniqueItems(parsed.value.actual, 'Quota settlement')
    return await this.#repository.settle(Object.freeze(structuredClone(parsed.value)))
  }

  async releaseReservation(idempotencyKey: string): Promise<Readonly<{ duplicate: boolean }>> {
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 512) {
      throw new QuotaError('invalid', 'Quota release identity is invalid.')
    }
    return await this.#repository.release(idempotencyKey)
  }

  async observe(raw: unknown): Promise<Readonly<{
    duplicate: boolean
    notices: readonly QuotaNotice[]
  }>> {
    const parsed = safeParseValue(QuotaActualObservationSchema, raw)
    if (!parsed.ok) throw new QuotaError('invalid', 'Quota usage observation contract invalid.')
    return await this.#repository.observe(Object.freeze(structuredClone(parsed.value)))
  }

  state(organizationId: string): Promise<QuotaState> {
    if (typeof organizationId !== 'string' || organizationId.length < 1 || organizationId.length > 255) {
      throw new QuotaError('invalid', 'Quota organization identity is invalid.')
    }
    return this.#repository.state(organizationId)
  }

  async forecast(raw: unknown): Promise<QuotaForecastResult> {
    const parsed = safeParseValue(QuotaForecastSchema, raw)
    if (!parsed.ok) throw new QuotaError('invalid', 'Setup/import forecast contract invalid.')
    const state = await this.state(parsed.value.organizationId)
    const shortfalls = QUOTA_CLASSES.flatMap((quotaClass) => {
      const available = Math.max(0, totalLimit(state, quotaClass) - state.used[quotaClass] - state.reserved[quotaClass])
      const projected = finiteBalance(parsed.value.projected[quotaClass], 'Projected quota')
      return projected > available ? [{ quotaClass, projected, available }] : []
    })
    return Object.freeze({
      allowed: shortfalls.length === 0,
      shortfalls: Object.freeze(shortfalls),
    })
  }

  /** Compatibility projection; undefined internal-only fields are omitted by JSON serialization. */
  selfService(state: QuotaState) {
    const base = Object.freeze({
      limits: state.limits,
      used: state.used,
      reserved: state.reserved,
      notices: QUOTA_CLASSES.map((quotaClass) => ({
        quotaClass,
        percent: Math.min(100, Math.floor(
          ((state.used[quotaClass] + state.reserved[quotaClass])
            / (state.limits[quotaClass] || 1)) * 100,
        )),
      })),
    })
    if (state.source === 'platform-internal') {
      return Object.freeze({
        ...base,
        billing: null,
        shadowCost: undefined,
        provider: undefined,
      })
    }
    return Object.freeze({
      ...base,
      billing: Object.freeze({
        invoices: true,
        transactions: true,
        contracts: true,
        receipts: true,
        planChanges: true,
        cancellation: true,
        grace: true,
      }),
    })
  }
}

type MemoryReservation = Readonly<{
  input: QuotaReservation
  state: 'reserved' | 'settled' | 'released'
  settlement: QuotaSettlement | null
}>

function clonedState(state: QuotaState): QuotaState {
  return structuredClone(state)
}

function usage(values: Readonly<Record<string, number>>): QuotaUsageEnvelope {
  return Object.freeze(Object.fromEntries(QUOTA_CLASSES.map((quotaClass) => [
    quotaClass,
    finiteBalance(values[quotaClass] ?? 0, `Stored ${quotaClass}`),
  ])) as unknown as QuotaUsageEnvelope)
}

/** Deterministic in-memory acceptance authority with organization-level serialization. */
export class MemoryQuotaRepository implements QuotaRepository {
  readonly states = new Map<string, QuotaState>()
  readonly keys = new Set<string>()
  readonly notices = new Set<string>()
  readonly reservations = new Map<string, MemoryReservation>()
  readonly observations = new Map<string, QuotaActualObservation>()
  readonly #tails = new Map<string, Promise<void>>()

  async #serialized<T>(organizationId: string, work: () => Promise<T>): Promise<T> {
    const prior = this.#tails.get(organizationId) ?? Promise.resolve()
    let unlock!: () => void
    const next = new Promise<void>((resolve) => { unlock = resolve })
    const tail = prior.then(() => next)
    this.#tails.set(organizationId, tail)
    await prior
    try {
      return await work()
    } finally {
      unlock()
      if (this.#tails.get(organizationId) === tail) this.#tails.delete(organizationId)
    }
  }

  #current(organizationId: string): QuotaState {
    const current = this.states.get(organizationId)
    if (!current) {
      throw new QuotaError('unverified-contract', 'Only verified contracts and grants create quota state.')
    }
    return Object.freeze({
      ...clonedState(current),
      used: usage(current.used),
      reserved: usage(current.reserved),
      topUps: usage(current.topUps),
    })
  }

  async state(organizationId: string): Promise<QuotaState> {
    return this.#current(organizationId)
  }

  reserve(input: QuotaReservation): Promise<QuotaReservationResult> {
    return this.#serialized(input.organizationId, async () => {
      const prior = this.reservations.get(input.idempotencyKey)
      if (prior) {
        if (!sameReservation(prior.input, input)) {
          throw new QuotaError('conflict', 'Quota reservation identity changed on replay.')
        }
        return Object.freeze({ duplicate: true, notice: null, notices: Object.freeze([]) })
      }
      const state = this.#current(input.organizationId)
      const nextReserved = { ...state.reserved }
      const pending: QuotaNotice[] = []
      for (const item of input.items) {
        const before = state.used[item.quotaClass] + state.reserved[item.quotaClass]
        const after = before + item.units
        const limit = totalLimit(state, item.quotaClass)
        if (!Number.isSafeInteger(after) || after > limit) {
          throw new QuotaError('exhausted', `Quota ${item.quotaClass} exhausted; existing data remains readable and exportable.`)
        }
        nextReserved[item.quotaClass] += item.units
        pending.push(...crossedNotices(input.organizationId, item.quotaClass, before, after, limit))
      }
      this.states.set(input.organizationId, Object.freeze({
        ...state,
        reserved: usage(nextReserved),
      }))
      this.keys.add(input.idempotencyKey)
      this.reservations.set(input.idempotencyKey, Object.freeze({
        input: structuredClone(input),
        state: 'reserved',
        settlement: null,
      }))
      const notices = pending.filter((notice) => {
        const key = `${notice.organizationId}:${notice.quotaClass}:${notice.percent}`
        if (this.notices.has(key)) return false
        this.notices.add(key)
        return true
      })
      return Object.freeze({
        duplicate: false,
        notice: notices.at(-1) ?? null,
        notices: Object.freeze(notices),
      })
    })
  }

  async settle(input: QuotaSettlement): Promise<Readonly<{ duplicate: boolean }>> {
    const found = this.reservations.get(input.idempotencyKey)
    if (!found) throw new QuotaError('invalid', 'Quota reservation does not exist.')
    return this.#serialized(found.input.organizationId, async () => {
      const current = this.reservations.get(input.idempotencyKey)!
      if (current.state === 'settled') {
        if (!current.settlement || !sameSettlement(current.settlement, input)) {
          throw new QuotaError('conflict', 'Quota settlement identity changed on replay.')
        }
        return Object.freeze({ duplicate: true })
      }
      if (current.state !== 'reserved') throw new QuotaError('conflict', 'Released quota cannot be settled.')
      const actual = new Map(input.actual.map((item) => [item.quotaClass, item.units]))
      if (actual.size !== current.input.items.length
        || current.input.items.some((item) => !actual.has(item.quotaClass))) {
        throw new QuotaError('invalid', 'Settlement must reconcile every reserved quota class exactly once.')
      }
      const state = this.#current(current.input.organizationId)
      const nextUsed = { ...state.used }
      const nextReserved = { ...state.reserved }
      for (const item of current.input.items) {
        const units = actual.get(item.quotaClass)!
        if (units > item.units || nextReserved[item.quotaClass] < item.units) {
          throw new QuotaError('invalid', 'Actual quota use exceeds its exact reservation.')
        }
        nextReserved[item.quotaClass] -= item.units
        nextUsed[item.quotaClass] += units
      }
      this.states.set(current.input.organizationId, Object.freeze({
        ...state,
        used: usage(nextUsed),
        reserved: usage(nextReserved),
      }))
      this.reservations.set(input.idempotencyKey, Object.freeze({
        ...current,
        state: 'settled',
        settlement: structuredClone(input),
      }))
      return Object.freeze({ duplicate: false })
    })
  }

  async release(idempotencyKey: string): Promise<Readonly<{ duplicate: boolean }>> {
    const found = this.reservations.get(idempotencyKey)
    if (!found) throw new QuotaError('invalid', 'Quota reservation does not exist.')
    return this.#serialized(found.input.organizationId, async () => {
      const current = this.reservations.get(idempotencyKey)!
      if (current.state === 'released') return Object.freeze({ duplicate: true })
      if (current.state !== 'reserved') throw new QuotaError('conflict', 'Settled quota cannot be released.')
      const state = this.#current(current.input.organizationId)
      const nextReserved = { ...state.reserved }
      for (const item of current.input.items) {
        if (nextReserved[item.quotaClass] < item.units) {
          throw new QuotaError('invalid', 'Quota release exceeds the exact outstanding reservation.')
        }
        nextReserved[item.quotaClass] -= item.units
      }
      this.states.set(current.input.organizationId, Object.freeze({
        ...state,
        reserved: usage(nextReserved),
      }))
      this.reservations.set(idempotencyKey, Object.freeze({ ...current, state: 'released' }))
      return Object.freeze({ duplicate: false })
    })
  }

  observe(input: QuotaActualObservation): Promise<Readonly<{
    duplicate: boolean
    notices: readonly QuotaNotice[]
  }>> {
    return this.#serialized(input.organizationId, async () => {
      const prior = this.observations.get(input.idempotencyKey)
      if (prior) {
        if (JSON.stringify(prior) !== JSON.stringify(input)) {
          throw new QuotaError('conflict', 'Quota usage observation changed on replay.')
        }
        return Object.freeze({ duplicate: true, notices: Object.freeze([]) })
      }
      const state = this.#current(input.organizationId)
      const pending: QuotaNotice[] = []
      for (const quotaClass of QUOTA_CLASSES) {
        const limit = totalLimit(state, quotaClass)
        pending.push(...crossedNotices(
          input.organizationId,
          quotaClass,
          state.used[quotaClass] + state.reserved[quotaClass],
          input.usage[quotaClass] + state.reserved[quotaClass],
          limit,
        ))
      }
      this.states.set(input.organizationId, Object.freeze({ ...state, used: input.usage }))
      this.observations.set(input.idempotencyKey, structuredClone(input))
      const notices = pending.filter((notice) => {
        const key = `${notice.organizationId}:${notice.quotaClass}:${notice.percent}`
        if (this.notices.has(key)) return false
        this.notices.add(key)
        return true
      })
      return Object.freeze({ duplicate: false, notices: Object.freeze(notices) })
    })
  }
}

export function emptyQuotaUsage(): QuotaUsageEnvelope {
  return structuredClone(ZERO_QUOTA_USAGE)
}
