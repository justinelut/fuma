import {
  CollaborationSocketServerMessageSchema,
  applyCollaborationOperationBatch,
  type CollaborationOperation,
  type CollaborationOperationInput,
  type CollaborationReconcileCommand,
  type CollaborationReconcileResult,
  type CollaborationSocketServerMessage,
} from '@core/fuma/publication'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import { publicationCollaborationSocketUrl, type PublicationClientTarget, type PublicationHttpClient } from './client'

export type PublicationCollaborationSnapshot<Document> = Readonly<{
  document: Document
  sequence: number
  localOperations: readonly CollaborationOperationInput[]
  state: 'clean' | 'dirty' | 'saving' | 'rebase-required'
  authoritative: Readonly<{
    document: Document
    sequence: number
    operationsSinceBase: readonly CollaborationOperation[]
  }> | null
}>

export type PublicationCollaborationClient = Pick<PublicationHttpClient, 'reconcile'>

export class PublicationCollaborationCoordinator<Document> {
  readonly #client: PublicationCollaborationClient
  readonly #kind: CollaborationReconcileCommand['resourceKind']
  readonly #id: string
  readonly #mutationId: () => string
  #snapshot: PublicationCollaborationSnapshot<Document>
  #listeners = new Set<() => void>()

  constructor(input: Readonly<{
    client: PublicationCollaborationClient
    resourceKind: CollaborationReconcileCommand['resourceKind']
    resourceId: string
    document: Document
    sequence: number
    mutationId?: () => string
  }>) {
    this.#client = input.client
    this.#kind = input.resourceKind
    this.#id = input.resourceId
    this.#mutationId = input.mutationId ?? (() => crypto.randomUUID())
    this.#snapshot = freeze({ document: structuredClone(input.document), sequence: input.sequence, localOperations: [], state: 'clean', authoritative: null })
  }

  getSnapshot = (): PublicationCollaborationSnapshot<Document> => this.#snapshot
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }

  update(document: Document, operation: CollaborationOperationInput): void {
    if (this.#snapshot.state === 'rebase-required') throw new Error('Resolve collaborative rebase before editing again.')
    if (operation.baseSequence !== this.#snapshot.sequence) throw new Error('Local operation base sequence is stale.')
    this.#set({ ...this.#snapshot, document: structuredClone(document), localOperations: [...this.#snapshot.localOperations, structuredClone(operation)], state: 'dirty' })
  }

  async flush(): Promise<void> {
    if (this.#snapshot.state !== 'dirty' || this.#snapshot.localOperations.length === 0) return
    const sent = this.#snapshot
    this.#set({ ...sent, state: 'saving' })
    try {
      const result = await this.#client.reconcile({
        mutationId: this.#mutationId(),
        resourceKind: this.#kind,
        resourceId: this.#id,
        expectedSequence: sent.sequence,
        operations: sent.localOperations,
      })
      if (result.outcome === 'accepted') {
        const current = this.#snapshot
        const newer = current.localOperations.slice(sent.localOperations.length).map((operation) => ({ ...operation, baseSequence: result.receipt.sequence }))
        this.#set({
          document: structuredClone(newer.length === 0 ? result.document as Document : current.document),
          sequence: result.receipt.sequence,
          localOperations: newer,
          state: newer.length > 0 ? 'dirty' : 'clean',
          authoritative: null,
        })
      } else {
        this.#enterRebase(result.sequence, result.document as Document, result.operationsSinceBase)
      }
    } catch (error) {
      this.#restoreDirtyAfterFailure(sent)
      throw error
    }
  }

  receive(message: CollaborationSocketServerMessage): void {
    if (message.type === 'collaboration-rebase-required') {
      if (message.sequence >= this.#snapshot.sequence) this.#enterRebase(message.sequence, message.document as Document, message.operationsSinceBase)
      return
    }
    const sequence = message.type === 'collaboration-accepted' ? message.receipt.sequence : message.sequence
    if (sequence <= this.#snapshot.sequence) return
    if (this.#snapshot.localOperations.length === 0 && this.#snapshot.state === 'clean') {
      this.#set({ document: structuredClone(message.document as Document), sequence, localOperations: [], state: 'clean', authoritative: null })
      return
    }
    const operations = message.type === 'collaboration-accepted' ? message.receipt.operations : message.operationsSinceBase
    this.#enterRebase(sequence, message.document as Document, operations)
  }

  resolve(choice: 'accept-authoritative' | 'retry-local'): void {
    const authoritative = this.#snapshot.authoritative
    if (this.#snapshot.state !== 'rebase-required' || !authoritative) throw new Error('No collaborative rebase is pending.')
    if (choice === 'accept-authoritative') {
      this.#set({ document: structuredClone(authoritative.document), sequence: authoritative.sequence, localOperations: [], state: 'clean', authoritative: null })
      return
    }
    const operations = this.#snapshot.localOperations.map((operation) => ({ ...structuredClone(operation), baseSequence: authoritative.sequence }))
    const document = applyCollaborationOperationBatch(authoritative.document, operations) as Document
    this.#set({ document: structuredClone(document), sequence: authoritative.sequence, localOperations: operations, state: 'dirty', authoritative: null })
  }

  #restoreDirtyAfterFailure(sent: PublicationCollaborationSnapshot<Document>): void {
    if (this.#snapshot.state === 'saving') this.#set({ ...sent, state: 'dirty' })
  }

  #enterRebase(sequence: number, document: Document, operationsSinceBase: readonly CollaborationOperation[]): void {
    this.#set({ ...this.#snapshot, state: 'rebase-required', authoritative: { document: structuredClone(document), sequence, operationsSinceBase: structuredClone(operationsSinceBase) } })
  }

  #set(next: PublicationCollaborationSnapshot<Document>): void {
    this.#snapshot = freeze(next)
    for (const listener of this.#listeners) listener()
  }
}


export type PublicationCollaborationSocketFactory = (url: string) => WebSocket

type PendingMutation = {
  command: CollaborationReconcileCommand
  resolve: (result: CollaborationReconcileResult) => void
  reject: (error: Error) => void
}

/** WebSocket client used by the coordinator. Pending mutation IDs survive reconnect and replay exactly. */
export class PublicationCollaborationSocketClient<Document> implements PublicationCollaborationClient {
  readonly #target: PublicationClientTarget
  readonly #kind: CollaborationReconcileCommand['resourceKind']
  readonly #resourceId: string
  readonly #coordinator: PublicationCollaborationCoordinator<Document>
  readonly #factory: PublicationCollaborationSocketFactory
  readonly #tabId: string
  readonly #location: Pick<Location, 'protocol' | 'host'>
  readonly #pending = new Map<string, PendingMutation>()
  #socket: WebSocket | null = null
  #stopped = true
  #attempt = 0
  #timer: ReturnType<typeof setTimeout> | null = null

  constructor(input: Readonly<{
    target: PublicationClientTarget
    resourceKind: CollaborationReconcileCommand['resourceKind']
    resourceId: string
    coordinator: PublicationCollaborationCoordinator<Document>
    socketFactory?: PublicationCollaborationSocketFactory
    tabId?: string
    location?: Pick<Location, 'protocol' | 'host'>
  }>) {
    this.#target = input.target
    this.#kind = input.resourceKind
    this.#resourceId = input.resourceId
    this.#coordinator = input.coordinator
    this.#factory = input.socketFactory ?? ((url) => new WebSocket(url))
    this.#tabId = input.tabId ?? crypto.randomUUID()
    this.#location = input.location ?? globalThis.location
  }

  start(): void { if (!this.#stopped) return; this.#stopped = false; this.#connect() }

  stop(): void {
    this.#stopped = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    this.#socket?.close(1000, 'Client stopped')
    this.#socket = null
    for (const pending of this.#pending.values()) pending.reject(new Error('Collaboration transport stopped.'))
    this.#pending.clear()
  }

  reconcile(command: CollaborationReconcileCommand): Promise<CollaborationReconcileResult> {
    if (command.resourceKind !== this.#kind || command.resourceId !== this.#resourceId) return Promise.reject(new Error('Collaboration command target does not match the socket.'))
    const existing = this.#pending.get(command.mutationId)
    if (existing) return Promise.reject(new Error('Mutation is already pending.'))
    return new Promise((resolve, reject) => {
      this.#pending.set(command.mutationId, { command: structuredClone(command), resolve, reject })
      this.#send({ type: 'collaboration-reconcile', command })
    })
  }

  #connect(): void {
    if (this.#stopped) return
    const socket = this.#factory(publicationCollaborationSocketUrl(this.#target, this.#kind, this.#resourceId, this.#tabId, this.#location))
    this.#socket = socket
    socket.addEventListener('open', () => {
      if (this.#stopped || socket !== this.#socket) return
      this.#attempt = 0
      this.#send({ type: 'collaboration-catch-up', afterSequence: this.#coordinator.getSnapshot().sequence })
      for (const pending of this.#pending.values()) this.#send({ type: 'collaboration-reconcile', command: pending.command })
    })
    socket.addEventListener('message', (event) => {
      if (this.#stopped || socket !== this.#socket || typeof event.data !== 'string') return
      let candidate: unknown
      try { candidate = JSON.parse(event.data) } catch { return }
      const parsed = safeParseValue(CollaborationSocketServerMessageSchema, candidate)
      if (!parsed.ok) return
      this.#receive(parsed.value)
    })
    socket.addEventListener('close', () => {
      if (this.#stopped || socket !== this.#socket) return
      this.#socket = null
      this.#timer = setTimeout(() => this.#connect(), Math.min(5_000, 250 * (2 ** this.#attempt++)))
    })
  }

  #receive(message: CollaborationSocketServerMessage): void {
    if (message.type === 'collaboration-catch-up') {
      this.#coordinator.receive(message)
      return
    }
    const mutationId = message.type === 'collaboration-accepted' ? message.receipt.mutationId : message.mutationId
    const pending = this.#pending.get(mutationId)
    if (pending) {
      this.#pending.delete(mutationId)
      pending.resolve(message.type === 'collaboration-accepted'
        ? { outcome: 'accepted', replayed: message.replayed, receipt: message.receipt, document: message.document }
        : { outcome: 'rebase-required', mutationId: message.mutationId, sequence: message.sequence, document: message.document, operationsSinceBase: message.operationsSinceBase })
      return
    }
    this.#coordinator.receive(message)
  }

  #send(message: { type: 'collaboration-catch-up'; afterSequence: number } | { type: 'collaboration-reconcile'; command: CollaborationReconcileCommand }): void {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(message))
  }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested)
    Object.freeze(value)
  }
  return value
}
