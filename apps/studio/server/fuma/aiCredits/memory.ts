import type { AiByokCredential, AiCreditAccount, AiCreditLot, AiCreditReservation, AiCreditSettlement } from './contracts'
import { AiCreditRepositoryError, type AiCreditRepository, type AiCreditSnapshot, type AiCreditWriteOutcome } from './repository'

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)
const sameCreditIntent = (left: AiCreditLot, right: AiCreditLot): boolean => left.lotId === right.lotId && left.accountId === right.accountId && left.kind === right.kind && left.amountMicros === right.amountMicros && left.expiresAt === right.expiresAt && left.evidenceId === right.evidenceId && left.idempotencyKey === right.idempotencyKey
const sameCredentialIntent = (left: AiByokCredential, right: AiByokCredential): boolean => left.credentialId === right.credentialId && same(left.scope, right.scope) && left.providerId === right.providerId && left.envelope.fingerprintSha256 === right.envelope.fingerprintSha256
const clone = <T>(value: T): T => structuredClone(value)

export class MemoryAiCreditRepository implements AiCreditRepository {
  readonly accounts = new Map<string, AiCreditAccount>()
  readonly lots = new Map<string, AiCreditLot>()
  readonly reservations = new Map<string, AiCreditReservation>()
  readonly settlements = new Map<string, AiCreditSettlement>()
  readonly credentials = new Map<string, AiByokCredential>()
  readonly #idempotency = new Map<string, unknown>()
  readonly #reservationIdempotency = new Map<string, string>()
  readonly #credentialIdempotency = new Map<string, string>()
  readonly #tails = new Map<string, Promise<void>>()
  failNext: 'credit' | 'reserve' | 'settle' | 'resolve' | 'refund' | 'credential' | null = null

  async #serialized<T>(key: string, work: () => T | Promise<T>): Promise<T> {
    const prior = this.#tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const tail = prior.then(() => gate)
    this.#tails.set(key, tail)
    await prior
    try { return await work() } finally { release(); if (this.#tails.get(key) === tail) this.#tails.delete(key) }
  }
  #fault(kind: NonNullable<MemoryAiCreditRepository['failNext']>): void {
    if (this.failNext === kind) { this.failNext = null; throw new Error(`injected-${kind}-failure`) }
  }
  async snapshot(accountId: string): Promise<AiCreditSnapshot | null> {
    const account = this.accounts.get(accountId)
    if (!account) return null
    return Object.freeze({ account: clone(account), lots: [...this.lots.values()].filter((v) => v.accountId === accountId).map(clone), reservations: [...this.reservations.values()].filter((v) => v.accountId === accountId).map(clone), settlements: [...this.settlements.values()].filter((v) => this.reservations.get(v.reservationId)?.accountId === accountId).map(clone), credentials: [...this.credentials.values()].filter((v) => v.scope.siteId === account.scope.siteId).map(clone) })
  }
  async reservation(id: string) { return clone(this.reservations.get(id) ?? null) }
  async credential(id: string) { return clone(this.credentials.get(id) ?? null) }

  credit(input: Readonly<{ account: AiCreditAccount; lot: AiCreditLot; expectedVersion: number | null }>): Promise<AiCreditWriteOutcome<AiCreditAccount>> {
    return this.#serialized(JSON.stringify(input.account.scope), () => {
      this.#fault('credit')
      const replay = this.#idempotency.get(input.lot.idempotencyKey)
      if (replay) {
        if (!sameCreditIntent(replay as AiCreditLot, input.lot)) throw new AiCreditRepositoryError('duplicate-mismatch', 'Credit idempotency evidence changed.')
        return { duplicate: true, value: clone(this.accounts.get(input.account.accountId)!) }
      }
      const current = this.accounts.get(input.account.accountId)
      if ((current?.version ?? null) !== input.expectedVersion) throw new AiCreditRepositoryError('conflict', 'Credit account version changed.')
      if (!current && [...this.accounts.values()].some(({ scope }) => same(scope, input.account.scope))) {
        throw new AiCreditRepositoryError('conflict', 'Credit account scope already has an authority.')
      }
      if (this.lots.has(input.lot.lotId)) throw new AiCreditRepositoryError('conflict', 'Credit lot identity already exists.')
      this.accounts.set(input.account.accountId, clone(input.account)); this.lots.set(input.lot.lotId, clone(input.lot)); this.#idempotency.set(input.lot.idempotencyKey, clone(input.lot))
      return { duplicate: false, value: clone(input.account) }
    })
  }

  reserve(input: Readonly<{ reservation: AiCreditReservation; expectedAccountVersion: number }>): Promise<AiCreditWriteOutcome<AiCreditReservation>> {
    return this.#serialized(input.reservation.accountId, () => {
      this.#fault('reserve')
      const priorId = this.#reservationIdempotency.get(input.reservation.idempotencyKey)
      const prior = this.reservations.get(input.reservation.reservationId) ?? (priorId ? this.reservations.get(priorId) : undefined)
      if (prior) {
        if (!same(prior, input.reservation)) throw new AiCreditRepositoryError('duplicate-mismatch', 'Reservation identity changed.')
        return { duplicate: true, value: clone(prior) }
      }
      const account = this.accounts.get(input.reservation.accountId)
      if (!account || account.version !== input.expectedAccountVersion) throw new AiCreditRepositoryError('conflict', 'Credit account version changed.')
      const unexpired = [...this.lots.values()].filter((lot) => lot.accountId === account.accountId && (lot.expiresAt === null || Date.parse(lot.expiresAt) > Date.parse(input.reservation.expiresAt))).reduce((sum, lot) => sum + lot.remainingMicros, 0)
      if (unexpired - account.reservedMicros < input.reservation.reservedMicros) throw new AiCreditRepositoryError('exhausted', 'AI credits are exhausted.')
      if (account.budgetMicros - account.spentMicros - account.reservedMicros < input.reservation.reservedMicros) throw new AiCreditRepositoryError('budget-exhausted', 'AI budget is exhausted.')
      this.reservations.set(input.reservation.reservationId, clone(input.reservation))
      this.#reservationIdempotency.set(input.reservation.idempotencyKey, input.reservation.reservationId)
      this.accounts.set(account.accountId, { ...account, reservedMicros: account.reservedMicros + input.reservation.reservedMicros, version: account.version + 1, updatedAt: input.reservation.createdAt })
      return { duplicate: false, value: clone(input.reservation) }
    })
  }

  settle(input: Readonly<{ settlement: AiCreditSettlement; expectedReservationVersion: number }>): Promise<AiCreditWriteOutcome<AiCreditSettlement>> {
    const reservation = this.reservations.get(input.settlement.reservationId)
    if (!reservation) return Promise.reject(new AiCreditRepositoryError('not-found', 'Reservation does not exist.'))
    return this.#serialized(reservation.accountId, () => {
      this.#fault('settle')
      const replay = [...this.settlements.values()].find((v) => v.idempotencyKey === input.settlement.idempotencyKey || v.reservationId === input.settlement.reservationId)
      if (replay) {
        if (!same(replay, input.settlement)) throw new AiCreditRepositoryError('duplicate-mismatch', 'Settlement evidence changed.')
        return { duplicate: true, value: clone(replay) }
      }
      const current = this.reservations.get(input.settlement.reservationId)!
      const account = this.accounts.get(current.accountId)!
      if (current.state !== 'reserved' || current.version !== input.expectedReservationVersion) throw new AiCreditRepositoryError('conflict', 'Reservation is not settleable.')
      if (input.settlement.chargedMicros > current.reservedMicros || input.settlement.chargedMicros > account.balanceMicros) throw new AiCreditRepositoryError('exhausted', 'Settlement exceeds reserved credits.')
      let remaining = input.settlement.chargedMicros
      const lots = [...this.lots.values()].filter((lot) => lot.accountId === account.accountId && lot.remainingMicros > 0 && (lot.expiresAt === null || Date.parse(lot.expiresAt) > Date.parse(input.settlement.createdAt))).sort((a, b) => (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999') || a.createdAt.localeCompare(b.createdAt))
      for (const lot of lots) { const used = Math.min(remaining, lot.remainingMicros); this.lots.set(lot.lotId, { ...lot, remainingMicros: lot.remainingMicros - used }); remaining -= used; if (!remaining) break }
      if (remaining) throw new AiCreditRepositoryError('exhausted', 'Credit lots cannot cover settlement.')
      this.settlements.set(input.settlement.settlementId, clone(input.settlement))
      this.reservations.set(current.reservationId, { ...current, state: 'settled', version: current.version + 1, resolvedAt: input.settlement.createdAt })
      this.accounts.set(account.accountId, { ...account, balanceMicros: account.balanceMicros - input.settlement.chargedMicros, reservedMicros: account.reservedMicros - current.reservedMicros, spentMicros: account.spentMicros + input.settlement.chargedMicros, version: account.version + 1, updatedAt: input.settlement.createdAt })
      return { duplicate: false, value: clone(input.settlement) }
    })
  }

  resolve(input: Readonly<{ reservationId: string; idempotencyKey: string; state: 'released' | 'expired'; expectedReservationVersion: number; resolvedAt: string }>): Promise<AiCreditWriteOutcome<AiCreditReservation>> {
    const found = this.reservations.get(input.reservationId)
    if (!found) return Promise.reject(new AiCreditRepositoryError('not-found', 'Reservation does not exist.'))
    return this.#serialized(found.accountId, () => {
      this.#fault('resolve')
      const current = this.reservations.get(input.reservationId)!
      if (current.state === input.state) return { duplicate: true, value: clone(current) }
      if (current.state !== 'reserved' || current.version !== input.expectedReservationVersion) throw new AiCreditRepositoryError('conflict', 'Reservation is not releasable.')
      const account = this.accounts.get(current.accountId)!
      const next = { ...current, state: input.state, version: current.version + 1, resolvedAt: input.resolvedAt } as AiCreditReservation
      this.reservations.set(current.reservationId, next)
      this.accounts.set(account.accountId, { ...account, reservedMicros: account.reservedMicros - current.reservedMicros, version: account.version + 1, updatedAt: input.resolvedAt })
      return { duplicate: false, value: clone(next) }
    })
  }

  refund(input: Readonly<{ reservationId: string; idempotencyKey: string; expectedReservationVersion: number; refundedAt: string }>): Promise<AiCreditWriteOutcome<AiCreditSettlement>> {
    const found = this.reservations.get(input.reservationId)
    if (!found) return Promise.reject(new AiCreditRepositoryError('not-found', 'Reservation does not exist.'))
    return this.#serialized(found.accountId, () => {
      this.#fault('refund')
      const current = this.reservations.get(input.reservationId)!
      const settlement = [...this.settlements.values()].find((v) => v.reservationId === current.reservationId)
      if (!settlement) throw new AiCreditRepositoryError('not-found', 'Settlement does not exist.')
      if (current.state === 'refunded') return { duplicate: true, value: clone(settlement) }
      if (current.state !== 'settled' || current.version !== input.expectedReservationVersion) throw new AiCreditRepositoryError('conflict', 'Settlement is not refundable.')
      const account = this.accounts.get(current.accountId)!
      const updated = { ...settlement, refundedMicros: settlement.chargedMicros }
      this.settlements.set(settlement.settlementId, updated)
      this.reservations.set(current.reservationId, { ...current, state: 'refunded', version: current.version + 1, resolvedAt: input.refundedAt })
      this.accounts.set(account.accountId, { ...account, balanceMicros: account.balanceMicros + settlement.chargedMicros, spentMicros: account.spentMicros - settlement.chargedMicros, version: account.version + 1, updatedAt: input.refundedAt })
      let remaining = settlement.chargedMicros
      const lots = [...this.lots.values()].filter((value) => value.accountId === account.accountId && value.remainingMicros < value.amountMicros).sort((a, b) => (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999') || a.createdAt.localeCompare(b.createdAt))
      for (const lot of lots) { const restored = Math.min(remaining, lot.amountMicros - lot.remainingMicros); this.lots.set(lot.lotId, { ...lot, remainingMicros: lot.remainingMicros + restored }); remaining -= restored; if (!remaining) break }
      if (remaining) throw new AiCreditRepositoryError('conflict', 'Refund allocation is inconsistent.')
      return { duplicate: false, value: clone(updated) }
    })
  }

  putCredential(input: Readonly<{ credential: AiByokCredential; idempotencyKey: string; expectedVersion: number | null }>): Promise<AiCreditWriteOutcome<AiByokCredential>> {
    return this.#serialized(`credential:${input.credential.credentialId}`, () => {
      this.#fault('credential')
      const replayId = this.#credentialIdempotency.get(input.idempotencyKey)
      const replay = replayId ? this.credentials.get(replayId) : undefined
      if (replay) {
        if (!sameCredentialIntent(replay, input.credential)) throw new AiCreditRepositoryError('duplicate-mismatch', 'BYOK idempotency evidence changed.')
        return { duplicate: true, value: clone(replay) }
      }
      const current = this.credentials.get(input.credential.credentialId)
      if ((current?.version ?? null) !== input.expectedVersion) throw new AiCreditRepositoryError('conflict', 'BYOK metadata version changed.')
      this.credentials.set(input.credential.credentialId, clone(input.credential))
      this.#credentialIdempotency.set(input.idempotencyKey, input.credential.credentialId)
      return { duplicate: false, value: clone(input.credential) }
    })
  }
  async expireDue(now: string, limit: number): Promise<readonly AiCreditReservation[]> {
    const due = [...this.reservations.values()].filter((v) => v.state === 'reserved' && Date.parse(v.expiresAt) <= Date.parse(now)).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)).slice(0, limit)
    const result: AiCreditReservation[] = []
    for (const value of due) result.push((await this.resolve({ reservationId: value.reservationId, idempotencyKey: `expire:${value.reservationId}`, state: 'expired', expectedReservationVersion: value.version, resolvedAt: now })).value)
    for (const [id, lot] of this.lots) if (lot.expiresAt && Date.parse(lot.expiresAt) <= Date.parse(now) && lot.remainingMicros > 0) { const account = this.accounts.get(lot.accountId)!; this.lots.set(id, { ...lot, remainingMicros: 0 }); this.accounts.set(account.accountId, { ...account, balanceMicros: Math.max(0, account.balanceMicros - lot.remainingMicros), version: account.version + 1, updatedAt: now }) }
    return Object.freeze(result)
  }
}
