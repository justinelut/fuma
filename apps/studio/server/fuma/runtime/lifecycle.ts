export type FumaRuntimeRole = 'web' | 'worker' | 'scheduler'
export type FumaRuntimeState = 'starting' | 'ready' | 'draining' | 'stopped' | 'failed'

export interface FumaRuntimeSnapshot {
  role: FumaRuntimeRole
  state: FumaRuntimeState
  ownedComponents: readonly string[]
  inFlight: number
}

export interface FumaRuntimeContext {
  readonly role: FumaRuntimeRole
  snapshot(): FumaRuntimeSnapshot
  run<T>(work: () => Promise<T> | T): Promise<T>
}

export interface FumaRuntimeComponentHandle {
  beginDrain?(): Promise<void> | void
  stop?(): Promise<void> | void
}

export interface FumaRuntimeComponent {
  readonly id: string
  start(context: FumaRuntimeContext): Promise<FumaRuntimeComponentHandle | void> | FumaRuntimeComponentHandle | void
}

export interface FumaRuntimeLifecycleOptions {
  role: FumaRuntimeRole
  components: readonly FumaRuntimeComponent[]
  drainTimeoutMs: number
}

export class FumaRuntimeDrainingError extends Error {
  constructor(role: FumaRuntimeRole) {
    super(`The Fuma ${role} runtime is not accepting new work.`)
    this.name = 'FumaRuntimeDrainingError'
  }
}

export class FumaRuntimeDrainTimeoutError extends Error {
  constructor(role: FumaRuntimeRole, timeoutMs: number) {
    super(`The Fuma ${role} runtime did not drain within ${timeoutMs}ms.`)
    this.name = 'FumaRuntimeDrainTimeoutError'
  }
}

interface StartedComponent {
  component: FumaRuntimeComponent
  handle: FumaRuntimeComponentHandle
}

export class FumaRuntimeLifecycle {
  readonly #role: FumaRuntimeRole
  readonly #components: readonly FumaRuntimeComponent[]
  readonly #componentIds: readonly string[]
  readonly #drainTimeoutMs: number
  readonly #started: StartedComponent[] = []
  readonly #inFlight = new Set<Promise<unknown>>()
  #state: FumaRuntimeState = 'starting'
  #shutdownPromise: Promise<void> | undefined

  constructor(options: FumaRuntimeLifecycleOptions) {
    const componentIds = options.components.map(({ id }) => id)
    const duplicate = componentIds.find((id, index) => componentIds.indexOf(id) !== index)
    if (duplicate) throw new Error(`Fuma runtime component "${duplicate}" is owned more than once.`)

    this.#role = options.role
    this.#components = options.components
    this.#componentIds = componentIds
    this.#drainTimeoutMs = options.drainTimeoutMs
  }

  snapshot(): FumaRuntimeSnapshot {
    return {
      role: this.#role,
      state: this.#state,
      ownedComponents: [...this.#componentIds],
      inFlight: this.#inFlight.size,
    }
  }

  async start(): Promise<void> {
    if (this.#state !== 'starting' || this.#started.length > 0) {
      throw new Error(`The Fuma ${this.#role} runtime cannot be started twice.`)
    }

    const context: FumaRuntimeContext = {
      role: this.#role,
      snapshot: () => this.snapshot(),
      run: (work) => this.run(work),
    }

    try {
      for (const component of this.#components) {
        const handle = await component.start(context)
        this.#started.push({ component, handle: handle ?? {} })
      }
      this.#state = 'ready'
    } catch (error) {
      this.#state = 'failed'
      await this.#stopStartedComponents()
      throw new Error(`The Fuma ${this.#role} runtime failed to start.`, { cause: error })
    }
  }

  run<T>(work: () => Promise<T> | T): Promise<T> {
    if (this.#state !== 'ready') return Promise.reject(new FumaRuntimeDrainingError(this.#role))

    const operation = Promise.resolve().then(work)
    const tracked = operation.finally(() => {
      this.#inFlight.delete(tracked)
    })
    this.#inFlight.add(tracked)
    return tracked
  }

  shutdown(): Promise<void> {
    this.#shutdownPromise ??= this.#drainAndStop()
    return this.#shutdownPromise
  }

  async #drainAndStop(): Promise<void> {
    if (this.#state === 'stopped') return
    this.#state = 'draining'
    const failures: unknown[] = []

    for (const { handle } of [...this.#started].reverse()) {
      try {
        await handle.beginDrain?.()
      } catch (error) {
        failures.push(error)
      }
    }

    try {
      await this.#waitForInFlight()
    } catch (error) {
      failures.push(error)
    }

    failures.push(...await this.#stopStartedComponents())
    this.#state = 'stopped'

    if (failures.length > 0) {
      throw new AggregateError(failures, `The Fuma ${this.#role} runtime stopped with lifecycle errors.`)
    }
  }

  async #waitForInFlight(): Promise<void> {
    if (this.#inFlight.size === 0) return

    let timeout: ReturnType<typeof setTimeout> | undefined
    const drained = (async () => {
      while (this.#inFlight.size > 0) await Promise.allSettled([...this.#inFlight])
    })()
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new FumaRuntimeDrainTimeoutError(this.#role, this.#drainTimeoutMs)), this.#drainTimeoutMs)
    })

    try {
      await Promise.race([drained, deadline])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  async #stopStartedComponents(): Promise<unknown[]> {
    const failures: unknown[] = []
    for (const { handle } of [...this.#started].reverse()) {
      try {
        await handle.stop?.()
      } catch (error) {
        failures.push(error)
      }
    }
    this.#started.length = 0
    return failures
  }
}
