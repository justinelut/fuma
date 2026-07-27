import type { UsageAppendOutcome, UsageLedgerEntry, UsageLedgerRepository } from './contracts'

function frozenClone(entry: UsageLedgerEntry): UsageLedgerEntry {
  return Object.freeze(structuredClone(entry))
}

function sameAttribution(left: UsageLedgerEntry, right: UsageLedgerEntry): boolean {
  return left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
    && left.meter === right.meter
    && left.internalWorkload === right.internalWorkload
}

export class MemoryUsageLedger implements UsageLedgerRepository {
  readonly #rows: UsageLedgerEntry[] = []
  #tail: Promise<void> = Promise.resolve()

  async append(entry: UsageLedgerEntry): Promise<UsageAppendOutcome> {
    const previous = this.#tail
    let release!: () => void
    this.#tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      if (this.#rows.some((row) => row.idempotencyKey === entry.idempotencyKey)) return 'duplicate'
      if (entry.kind === 'settlement' || entry.kind === 'release') {
        const reservation = this.#rows.find((row) => row.entryId === entry.reservationId && row.kind === 'reservation')
        if (!reservation || !sameAttribution(reservation, entry)) return 'reservation-mismatch'
        const consumed = this.#rows
          .filter((row) => row.reservationId === reservation.entryId && (row.kind === 'settlement' || row.kind === 'release'))
          .reduce((sum, row) => ({
            logical: sum.logical + BigInt(row.logicalUnits),
            physical: sum.physical + BigInt(row.physicalUnits),
          }), { logical: 0n, physical: 0n })
        if (consumed.logical + BigInt(entry.logicalUnits) > BigInt(reservation.logicalUnits)
          || consumed.physical + BigInt(entry.physicalUnits) > BigInt(reservation.physicalUnits)) {
          return 'reservation-exceeded'
        }
      }
      this.#rows.push(frozenClone(entry))
      return 'created'
    } finally {
      release()
    }
  }

  async findByIdempotency(key: string): Promise<UsageLedgerEntry | null> {
    await this.#tail
    const row = this.#rows.find((value) => value.idempotencyKey === key)
    return row ? frozenClone(row) : null
  }

  async remainingReservation(id: string): Promise<Readonly<{ logical: bigint; physical: bigint }> | null> {
    await this.#tail
    const reservation = this.#rows.find((row) => row.entryId === id && row.kind === 'reservation')
    if (!reservation) return null
    const consumed = this.#rows
      .filter((row) => row.reservationId === id && (row.kind === 'settlement' || row.kind === 'release'))
      .reduce((sum, row) => ({
        logical: sum.logical + BigInt(row.logicalUnits),
        physical: sum.physical + BigInt(row.physicalUnits),
      }), { logical: 0n, physical: 0n })
    return Object.freeze({
      logical: BigInt(reservation.logicalUnits) - consumed.logical,
      physical: BigInt(reservation.physicalUnits) - consumed.physical,
    })
  }

  async entries(period?: Readonly<{ start: string; end: string }>): Promise<readonly UsageLedgerEntry[]> {
    await this.#tail
    const rows = period
      ? this.#rows.filter((row) => Date.parse(row.occurredAt) >= Date.parse(period.start)
        && Date.parse(row.occurredAt) < Date.parse(period.end))
      : this.#rows
    return Object.freeze(rows.map(frozenClone))
  }
}
