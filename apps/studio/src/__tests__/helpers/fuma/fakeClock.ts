export type FakeClockInstant = number | string | Date

function instantMs(value: FakeClockInstant): number {
  const milliseconds = typeof value === 'number' ? value : new Date(value).getTime()
  if (!Number.isFinite(milliseconds) || !Number.isFinite(new Date(milliseconds).getTime())) {
    throw new Error('Fake clock instant must be finite and within the valid Date range')
  }
  return milliseconds
}

/** An injected clock; it never modifies global Date. */
export class FumaFakeClock {
  readonly #initialMs: number
  #currentMs: number

  constructor(initial: FakeClockInstant) {
    this.#initialMs = instantMs(initial)
    this.#currentMs = this.#initialMs
  }

  nowMs(): number {
    return this.#currentMs
  }

  now(): Date {
    return new Date(this.#currentMs)
  }

  set(next: FakeClockInstant): Date {
    const nextMs = instantMs(next)
    if (nextMs < this.#currentMs) throw new Error('Fake clock cannot move backward')
    this.#currentMs = nextMs
    return this.now()
  }

  advance(milliseconds: number): Date {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new Error('Fake clock advance must be a finite non-negative number')
    }
    const nextMs = instantMs(this.#currentMs + milliseconds)
    this.#currentMs = nextMs
    return this.now()
  }

  /** Starts a new deterministic run at the constructor instant. */
  reset(): Date {
    this.#currentMs = this.#initialMs
    return this.now()
  }
}
