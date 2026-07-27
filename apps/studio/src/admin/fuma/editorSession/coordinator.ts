import {
  createEditorSessionTarget,
  EditorSessionConflictError,
  EditorSessionCoordinatorError,
  type BoundEditorSessionAdapter,
  type EditorSessionConflict,
  type EditorSessionCoordinatorOptions,
  type EditorSessionCoordinatorSnapshot,
  type EditorSessionImport,
  type EditorSessionImportState,
  type EditorSessionLoadState,
  type EditorSessionSaveState,
  type EditorSessionSnapshot,
  type EditorSessionSubscriber,
  type EditorSessionTarget,
} from './contracts'

type HistoryState<TDocument> = Readonly<{
  document: TDocument
  stateId: number
}>

type TargetSession<TDocument> = {
  readonly key: string
  readonly target: EditorSessionTarget
  readonly adapter: BoundEditorSessionAdapter<TDocument>
  document: TDocument | null
  past: HistoryState<TDocument>[]
  future: HistoryState<TDocument>[]
  currentStateId: number
  savedStateId: number
  nextStateId: number
  sequence: number
  conflict?: EditorSessionConflict<TDocument>
  loadState: EditorSessionLoadState
  saveState: EditorSessionSaveState
  importState: EditorSessionImportState
  errorMessage?: string
  loadToken: number
  saveToken: number
  importToken: number
}

function targetKey(target: EditorSessionTarget): string {
  return JSON.stringify([
    target.organizationId,
    target.workspaceId,
    target.siteId,
    target.profileId,
  ])
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback
}

function defaultClone<TDocument>(document: TDocument): TDocument {
  return structuredClone(document)
}

/**
 * Owns editor state for one browser tab. There is intentionally no module-level
 * cache: two coordinator instances cannot observe or mutate one another.
 */
export class EditorSessionCoordinator<TDocument> {
  readonly #bindAdapter: EditorSessionCoordinatorOptions<TDocument>['bindAdapter']
  readonly #cloneDocument: (document: TDocument) => TDocument
  readonly #generateMutationId: () => string
  readonly #sessions = new Map<string, TargetSession<TDocument>>()
  readonly #subscribers = new Set<EditorSessionSubscriber<TDocument>>()
  #active: TargetSession<TDocument> | null = null

  constructor(options: EditorSessionCoordinatorOptions<TDocument>) {
    this.#bindAdapter = options.bindAdapter
    this.#cloneDocument = options.cloneDocument ?? defaultClone
    this.#generateMutationId = options.generateMutationId ?? (() => crypto.randomUUID())
  }

  getSnapshot(): EditorSessionCoordinatorSnapshot<TDocument> {
    const session = this.#active
    if (!session) return Object.freeze({ kind: 'empty' })
    return this.#snapshot(session)
  }

  subscribe(subscriber: EditorSessionSubscriber<TDocument>): () => void {
    this.#subscribers.add(subscriber)
    return () => {
      this.#subscribers.delete(subscriber)
    }
  }

  /**
   * Activates exactly one fully-qualified target. A loaded target restores its
   * own in-tab state; an unfinished or failed target starts a fresh bound load.
   */
  async switchTarget(value: unknown): Promise<void> {
    const target = createEditorSessionTarget(value)
    const key = targetKey(target)
    const previous = this.#active

    if (previous?.key === key && previous.loadState === 'ready') return
    if (previous) this.#deactivate(previous)

    let session = this.#sessions.get(key)
    if (!session) {
      session = this.#createSession(key, target)
      this.#sessions.set(key, session)
    }

    this.#active = session
    this.#emit()

    if (session.loadState === 'ready') return
    await this.#load(session)
  }

  /** Starts a new load generation for the active target. */
  async reload(): Promise<void> {
    const session = this.#requireActive()
    await this.#load(session)
  }

  replaceDocument(document: TDocument): void {
    const session = this.#requireDocument()
    this.#invalidateDocumentOperations(session)
    session.past.push({
      document: this.#cloneDocument(session.document),
      stateId: session.currentStateId,
    })
    session.future = []
    session.document = this.#cloneDocument(document)
    session.currentStateId = ++session.nextStateId
    session.errorMessage = undefined
    this.#emit()
  }

  updateDocument(update: (document: TDocument) => TDocument): void {
    const session = this.#requireDocument()
    const next = update(this.#cloneDocument(session.document))
    this.replaceDocument(next)
  }

  undo(): boolean {
    const session = this.#requireDocument()
    const previous = session.past.pop()
    if (!previous) return false

    this.#invalidateDocumentOperations(session)
    session.future.push({
      document: this.#cloneDocument(session.document),
      stateId: session.currentStateId,
    })
    session.document = this.#cloneDocument(previous.document)
    session.currentStateId = previous.stateId
    session.errorMessage = undefined
    this.#emit()
    return true
  }

  redo(): boolean {
    const session = this.#requireDocument()
    const next = session.future.pop()
    if (!next) return false

    this.#invalidateDocumentOperations(session)
    session.past.push({
      document: this.#cloneDocument(session.document),
      stateId: session.currentStateId,
    })
    session.document = this.#cloneDocument(next.document)
    session.currentStateId = next.stateId
    session.errorMessage = undefined
    this.#emit()
    return true
  }

  async save(): Promise<void> {
    const session = this.#requireDocument()
    if (session.conflict) throw new EditorSessionConflictError(session.conflict)
    const token = ++session.saveToken
    const stateId = session.currentStateId
    const expectedSequence = session.sequence
    const mutationId = this.#generateMutationId()
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(mutationId)) {
      throw new EditorSessionCoordinatorError(
        'invalid-adapter',
        'editor mutation ID generator returned an invalid ID',
      )
    }
    const document = this.#cloneDocument(session.document)
    session.saveState = 'saving'
    session.errorMessage = undefined
    this.#emit()

    try {
      const accepted = await session.adapter.save({
        document,
        expectedSequence,
        mutationId,
      })
      if (
        accepted.outcome !== 'accepted'
        || accepted.mutationId !== mutationId
        || accepted.expectedSequence !== expectedSequence
        || accepted.sequence !== expectedSequence + 1
      ) {
        throw new EditorSessionCoordinatorError(
          'invalid-adapter',
          'editor save adapter returned an invalid sequence acknowledgement',
        )
      }
      session.sequence = Math.max(session.sequence, accepted.sequence)
      if (
        !this.#isCurrent(session)
        || session.saveToken !== token
        || session.currentStateId !== stateId
      ) return
      session.savedStateId = stateId
      session.saveState = 'saved'
      session.conflict = undefined
      this.#emit()
    } catch (error) {
      if (error instanceof EditorSessionConflictError) {
        const conflict = error.conflict as EditorSessionConflict<TDocument>
        session.sequence = Math.max(session.sequence, conflict.authoritativeSequence)
        if (
          this.#isCurrent(session)
          && session.saveToken === token
          && conflict.authoritativeSequence >= expectedSequence
        ) {
          session.saveState = 'conflict'
          session.conflict = {
            ...conflict,
            authoritativeDocument: conflict.authoritativeDocument === null
              ? null
              : this.#cloneDocument(conflict.authoritativeDocument),
          }
          session.errorMessage = error.message
          this.#emit()
        }
        throw error
      }
      if (this.#isCurrent(session) && session.saveToken === token) {
        session.saveState = 'error'
        session.errorMessage = messageFrom(error, 'Editor document save failed')
        this.#emit()
      }
      throw error
    }
  }

  /** Conflict resolution is explicit: accept server state or knowingly retry local state. */
  resolveConflict(resolution: 'accept-authoritative' | 'retry-local'): void {
    const session = this.#requireActive()
    const conflict = session.conflict
    if (!conflict) return
    if (resolution === 'accept-authoritative') {
      session.document = conflict.authoritativeDocument === null
        ? null
        : this.#cloneDocument(conflict.authoritativeDocument)
      session.past = []
      session.future = []
      session.currentStateId = ++session.nextStateId
      session.savedStateId = session.currentStateId
    }
    session.conflict = undefined
    session.saveState = 'idle'
    session.errorMessage = undefined
    this.#emit()
  }

  async importDocument(runImport: EditorSessionImport<TDocument>): Promise<void> {
    const session = this.#requireDocument()
    const token = ++session.importToken
    const stateId = session.currentStateId
    const source = this.#cloneDocument(session.document)
    session.importState = 'running'
    session.errorMessage = undefined
    this.#emit()

    try {
      const imported = await runImport(source, session.target)
      if (
        !this.#isCurrent(session)
        || session.importToken !== token
        || session.currentStateId !== stateId
      ) return

      session.past.push({
        document: this.#cloneDocument(session.document),
        stateId: session.currentStateId,
      })
      session.future = []
      session.document = this.#cloneDocument(imported)
      session.currentStateId = ++session.nextStateId
      session.importState = 'succeeded'
      this.#emit()
    } catch (error) {
      if (this.#isCurrent(session) && session.importToken === token) {
        session.importState = 'error'
        session.errorMessage = messageFrom(error, 'Editor document import failed')
        this.#emit()
      }
      throw error
    }
  }

  resetImportState(): void {
    const session = this.#requireActive()
    session.importToken += 1
    session.importState = 'idle'
    session.errorMessage = undefined
    this.#emit()
  }

  #createSession(
    key: string,
    target: EditorSessionTarget,
  ): TargetSession<TDocument> {
    const adapter = this.#bindAdapter(target)
    if (
      !adapter
      || typeof adapter.load !== 'function'
      || typeof adapter.save !== 'function'
    ) {
      throw new EditorSessionCoordinatorError(
        'invalid-adapter',
        'editor session adapter must expose target-bound load() and save(command)',
      )
    }

    return {
      key,
      target,
      adapter,
      document: null,
      past: [],
      future: [],
      currentStateId: 0,
      savedStateId: 0,
      nextStateId: 0,
      sequence: 0,
      loadState: 'idle',
      saveState: 'idle',
      importState: 'idle',
      loadToken: 0,
      saveToken: 0,
      importToken: 0,
    }
  }

  async #load(session: TargetSession<TDocument>): Promise<void> {
    const token = ++session.loadToken
    session.loadState = 'loading'
    session.errorMessage = undefined
    this.#emit()

    try {
      const loaded = await session.adapter.load()
      if (!this.#isCurrent(session) || session.loadToken !== token) return

      session.document = loaded.document === null
        ? null
        : this.#cloneDocument(loaded.document)
      session.sequence = loaded.sequence
      session.conflict = undefined
      session.past = []
      session.future = []
      session.currentStateId = ++session.nextStateId
      session.savedStateId = session.currentStateId
      session.loadState = 'ready'
      session.saveState = 'idle'
      session.importState = 'idle'
      this.#emit()
    } catch (error) {
      if (this.#isCurrent(session) && session.loadToken === token) {
        session.loadState = 'error'
        session.errorMessage = messageFrom(error, 'Editor document load failed')
        this.#emit()
      }
      throw error
    }
  }

  #deactivate(session: TargetSession<TDocument>): void {
    session.loadToken += 1
    session.saveToken += 1
    session.importToken += 1
    if (session.loadState === 'loading') session.loadState = 'idle'
    if (session.saveState === 'saving') session.saveState = 'idle'
    if (session.importState === 'running') session.importState = 'idle'
  }

  #invalidateDocumentOperations(session: TargetSession<TDocument>): void {
    session.saveToken += 1
    session.importToken += 1
    if (session.saveState === 'saving' || session.saveState === 'saved') {
      session.saveState = 'idle'
    }
    if (session.importState === 'running' || session.importState === 'succeeded') {
      session.importState = 'idle'
    }
  }

  #requireActive(): TargetSession<TDocument> {
    if (!this.#active) {
      throw new EditorSessionCoordinatorError(
        'no-active-target',
        'editor session has no active target',
      )
    }
    return this.#active
  }

  #requireDocument(): TargetSession<TDocument> & { document: TDocument } {
    const session = this.#requireActive()
    if (session.loadState !== 'ready' || session.document === null) {
      throw new EditorSessionCoordinatorError(
        'document-unavailable',
        'active editor target has no loaded document',
      )
    }
    return session as TargetSession<TDocument> & { document: TDocument }
  }

  #isCurrent(session: TargetSession<TDocument>): boolean {
    return this.#active === session
  }

  #snapshot(session: TargetSession<TDocument>): EditorSessionSnapshot<TDocument> {
    const snapshot: EditorSessionSnapshot<TDocument> = {
      kind: 'active',
      target: session.target,
      document: session.document === null
        ? null
        : this.#cloneDocument(session.document),
      loadState: session.loadState,
      saveState: session.saveState,
      importState: session.importState,
      dirty: session.currentStateId !== session.savedStateId,
      canUndo: session.past.length > 0,
      canRedo: session.future.length > 0,
      undoDepth: session.past.length,
      redoDepth: session.future.length,
      revision: session.currentStateId,
      sequence: session.sequence,
      ...(session.conflict === undefined
        ? {}
        : {
            conflict: {
              ...session.conflict,
              authoritativeDocument: session.conflict.authoritativeDocument === null
                ? null
                : this.#cloneDocument(session.conflict.authoritativeDocument),
            },
          }),
      ...(session.errorMessage === undefined
        ? {}
        : { errorMessage: session.errorMessage }),
    }
    return Object.freeze(snapshot)
  }

  #emit(): void {
    if (this.#subscribers.size === 0) return
    const snapshot = this.getSnapshot()
    for (const subscriber of this.#subscribers) subscriber(snapshot)
  }
}

export function createEditorSessionCoordinator<TDocument>(
  options: EditorSessionCoordinatorOptions<TDocument>,
): EditorSessionCoordinator<TDocument> {
  return new EditorSessionCoordinator(options)
}
