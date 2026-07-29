import { sameDomainScope, type DomainScope } from '../domains/contracts'
import {
  canonicalRegistrarJson,
  type DomainRegistration,
  type RegistrarDnsHandoff,
  type RegistrarOperation,
  type RegistrarPurchaseReceipt,
  type RegistrarQuote,
  type RegistrarRenewalReceipt,
} from './contracts'
import { RegistrarWorkflowError, type RegistrarWorkflowRepository } from './workflow'

function scopeKey(scope: DomainScope): string {
  return canonicalRegistrarJson(scope)
}
function scoped(scope: DomainScope, id: string): string { return `${scopeKey(scope)}\u0000${id}` }
function clone<T>(value: T): T { return structuredClone(value) }
function same(left: unknown, right: unknown): boolean { return canonicalRegistrarJson(left) === canonicalRegistrarJson(right) }

/** Deterministic serialized repository used only by focused tests and demos. */
export class MemoryRegistrarWorkflowRepository implements RegistrarWorkflowRepository {
  readonly quotes = new Map<string, RegistrarQuote>()
  readonly operations = new Map<string, RegistrarOperation>()
  readonly registrationRecords = new Map<string, DomainRegistration>()
  readonly purchases = new Map<string, RegistrarPurchaseReceipt>()
  readonly renewals = new Map<string, RegistrarRenewalReceipt>()
  readonly handoffs = new Map<string, RegistrarDnsHandoff>()
  #tail: Promise<void> = Promise.resolve()

  async #locked<T>(work: () => T | Promise<T>): Promise<T> {
    const previous = this.#tail
    let release!: () => void
    this.#tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await work() } finally { release() }
  }

  async saveQuote(scope: DomainScope, quote: RegistrarQuote): Promise<RegistrarQuote> {
    return await this.#locked(() => {
      const id = scoped(scope, quote.quoteId)
      const prior = this.quotes.get(id)
      if (prior && !same(prior, quote)) throw new RegistrarWorkflowError('conflict', 'Quote identity changed on replay.')
      this.quotes.set(id, clone(quote))
      return clone(quote)
    })
  }
  async quote(scope: DomainScope, quoteId: string): Promise<RegistrarQuote | null> {
    const value = this.quotes.get(scoped(scope, quoteId)); return value ? clone(value) : null
  }
  async begin(operation: RegistrarOperation): Promise<RegistrarOperation> {
    return await this.#locked(() => {
      const id = scoped(operation.scope, operation.operationId)
      const prior = this.operations.get(id)
      if (prior) {
        if (!same(prior, operation)) throw new RegistrarWorkflowError('conflict', 'Operation identity changed on replay.')
        return clone(prior)
      }
      this.operations.set(id, clone(operation)); return clone(operation)
    })
  }
  async operation(scope: DomainScope, operationId: string): Promise<RegistrarOperation | null> {
    const value = this.operations.get(scoped(scope, operationId)); return value ? clone(value) : null
  }
  async recordAttempt(scope: DomainScope, operationId: string, at: string): Promise<RegistrarOperation> {
    return await this.#locked(() => {
      const id = scoped(scope, operationId); const prior = this.operations.get(id)
      if (!prior || !sameDomainScope(scope, prior.scope) || prior.state === 'succeeded') throw new RegistrarWorkflowError('conflict', 'Registrar operation cannot be attempted.')
      const next = Object.freeze({ ...prior, attempts: prior.attempts + 1, updatedAt: at, state: 'pending' as const })
      this.operations.set(id, clone(next)); return clone(next)
    })
  }
  async markAmbiguous(scope: DomainScope, operationId: string, at: string): Promise<void> {
    await this.#locked(() => {
      const id = scoped(scope, operationId); const prior = this.operations.get(id)
      if (!prior) throw new RegistrarWorkflowError('not-found', 'Registrar operation is unavailable.')
      this.operations.set(id, { ...prior, state: 'ambiguous', updatedAt: at })
    })
  }
  async registration(scope: DomainScope, registrationId: string): Promise<DomainRegistration | null> {
    const value = this.registrationRecords.get(scoped(scope, registrationId)); return value ? clone(value) : null
  }
  async registrationForQuote(scope: DomainScope, quoteId: string): Promise<DomainRegistration | null> {
    for (const [key, value] of this.registrationRecords) if (key.startsWith(`${scopeKey(scope)}\u0000`) && value.quoteId === quoteId) return clone(value)
    return null
  }
  async registrations(scope: DomainScope): Promise<readonly DomainRegistration[]> {
    return Object.freeze([...this.registrationRecords].filter(([key]) => key.startsWith(`${scopeKey(scope)}\u0000`)).map(([, value]) => clone(value)))
  }
  async purchaseReceipt(scope: DomainScope, operationId: string): Promise<RegistrarPurchaseReceipt | null> {
    const value = this.purchases.get(scoped(scope, operationId)); return value ? clone(value) : null
  }
  async renewalReceipt(scope: DomainScope, operationId: string): Promise<RegistrarRenewalReceipt | null> {
    const value = this.renewals.get(scoped(scope, operationId)); return value ? clone(value) : null
  }
  async completePurchase(input: Readonly<{ operation: RegistrarOperation; registration: DomainRegistration; receipt: RegistrarPurchaseReceipt; handoff: RegistrarDnsHandoff; completedAt: string }>): Promise<RegistrarPurchaseReceipt> {
    return await this.#locked(() => {
      const operationKey = scoped(input.operation.scope, input.operation.operationId)
      const priorReceipt = this.purchases.get(operationKey)
      if (priorReceipt) {
        if (!same(priorReceipt, input.receipt)) throw new RegistrarWorkflowError('conflict', 'Purchase receipt changed on replay.')
        return clone(priorReceipt)
      }
      const quoteRegistration = [...this.registrationRecords].find(([id, value]) => id.startsWith(`${scopeKey(input.operation.scope)}\u0000`) && value.quoteId === input.registration.quoteId)?.[1]
      if (quoteRegistration && !same(quoteRegistration, input.registration)) throw new RegistrarWorkflowError('conflict', 'Quote already produced another registration.')
      this.registrationRecords.set(scoped(input.operation.scope, input.registration.registrationId), clone(input.registration))
      this.purchases.set(operationKey, clone(input.receipt))
      this.handoffs.set(scoped(input.operation.scope, input.operation.operationId), clone(input.handoff))
      this.operations.set(operationKey, { ...input.operation, state: 'succeeded', updatedAt: input.completedAt })
      return clone(input.receipt)
    })
  }
  async completeRenewal(input: Readonly<{ operation: RegistrarOperation; registration: DomainRegistration; receipt: RegistrarRenewalReceipt; completedAt: string }>): Promise<RegistrarRenewalReceipt> {
    return await this.#locked(() => {
      const operationKey = scoped(input.operation.scope, input.operation.operationId)
      const prior = this.renewals.get(operationKey)
      if (prior) {
        if (!same(prior, input.receipt)) throw new RegistrarWorkflowError('conflict', 'Renewal receipt changed on replay.')
        return clone(prior)
      }
      for (const [id, receipt] of this.renewals) {
        if (id.startsWith(`${scopeKey(input.operation.scope)}\u0000`) && receipt.registrationId === input.receipt.registrationId
          && receipt.previousExpiresAt === input.receipt.previousExpiresAt) {
          if (!same(receipt, input.receipt)) throw new RegistrarWorkflowError('conflict', 'Prior expiry was already renewed.')
          return clone(receipt)
        }
      }
      this.registrationRecords.set(scoped(input.operation.scope, input.registration.registrationId), clone(input.registration))
      this.renewals.set(operationKey, clone(input.receipt))
      this.operations.set(operationKey, { ...input.operation, state: 'succeeded', updatedAt: input.completedAt })
      return clone(input.receipt)
    })
  }
  async pendingHandoff(scope: DomainScope, operationId: string): Promise<RegistrarDnsHandoff | null> {
    const value = this.handoffs.get(scoped(scope, operationId)); return value?.state === 'pending' ? clone(value) : null
  }
  async completeHandoff(scope: DomainScope, handoffId: string, completedAt: string): Promise<void> {
    await this.#locked(() => {
      for (const [id, handoff] of this.handoffs) {
        if (id.startsWith(`${scopeKey(scope)}\u0000`) && handoff.handoffId === handoffId) {
          this.handoffs.set(id, { ...handoff, state: 'completed', completedAt }); return
        }
      }
      throw new RegistrarWorkflowError('not-found', 'Registrar DNS onboarding handoff is unavailable.')
    })
  }
}
