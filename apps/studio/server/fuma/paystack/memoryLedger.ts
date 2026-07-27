import { Value } from '@core/utils/typeboxHelpers'
import {
  PaystackError,
  PaystackScopeSchema,
  type PaystackInitialization,
  type PaystackLedgerRepository,
  type PaystackMoney,
  type PaystackScope,
  type PaystackSettlementClaim,
  type PaystackSettlementIdentity,
  type ScopedPaystackLedger,
} from './transport'

type MemoryInitialization = PaystackInitialization
type MemoryReconciliation = PaystackSettlementIdentity & Readonly<{
  state: 'applying' | 'pending' | 'settled'
  claimId: string | null
}>

function sha256(input: string): string {
  return new Bun.CryptoHasher('sha256').update(input).digest('hex')
}

function sameMoney(left: PaystackMoney, right: PaystackMoney): boolean {
  return left.amountMinor === right.amountMinor && left.currency === right.currency
}

function sameInitialization(left: PaystackInitialization, right: PaystackInitialization): boolean {
  return left.reference === right.reference
    && left.purpose === right.purpose
    && sameMoney(left.money, right.money)
    && left.metadataHash === right.metadataHash
}

function sameSettlement(left: PaystackSettlementIdentity, right: PaystackSettlementIdentity): boolean {
  return sameInitialization(left, right)
    && left.providerTransactionId === right.providerTransactionId
}

class MemoryScopedPaystackLedger implements ScopedPaystackLedger {
  readonly scope: PaystackScope
  readonly #root: MemoryPaystackLedger

  constructor(root: MemoryPaystackLedger, scope: PaystackScope) {
    this.#root = root
    this.scope = scope
  }

  async recordInitialization(initialization: PaystackInitialization): Promise<boolean> {
    const key = `${this.scope}:${initialization.reference}`
    const existing = this.#root.initializations.get(key)
    if (existing && !sameInitialization(existing, initialization)) {
      throw new PaystackError('duplicate', 'Paystack reference identity changed on retry.')
    }
    if (existing) return false
    this.#root.initializations.set(key, Object.freeze({
      ...initialization,
      money: Object.freeze({ ...initialization.money }),
    }))
    return true
  }

  async exactInitialization(initialization: PaystackInitialization): Promise<boolean> {
    const existing = this.#root.initializations.get(`${this.scope}:${initialization.reference}`)
    return existing !== undefined && sameInitialization(existing, initialization)
  }

  async ingestEvent(eventId: string, rawHash: string): Promise<boolean> {
    const key = `${this.scope}:${eventId}`
    const existing = this.#root.events.get(key)
    if (existing && existing !== rawHash) {
      throw new PaystackError('duplicate', 'A Paystack event ID was replayed with different signed bytes.')
    }
    if (existing) return false
    this.#root.events.set(key, rawHash)
    return true
  }

  async claimSettlement(identity: PaystackSettlementIdentity): Promise<
    | Readonly<{ state: 'claimed'; claim: PaystackSettlementClaim }>
    | Readonly<{ state: 'settled' }>
    | Readonly<{ state: 'busy' }>
  > {
    const key = `${this.scope}:${identity.reference}:${identity.purpose}`
    const existing = this.#root.reconciliations.get(key)
    if (existing && !sameSettlement(existing, identity)) {
      throw new PaystackError('duplicate', 'Payment settlement identity changed on retry.')
    }
    if (existing?.state === 'settled') return Object.freeze({ state: 'settled' })
    if (existing?.state === 'applying') return Object.freeze({ state: 'busy' })
    const claimId = this.#root.claimFactory()
    this.#root.reconciliations.set(key, Object.freeze({ ...identity, state: 'applying', claimId }))
    return Object.freeze({ state: 'claimed', claim: Object.freeze({ ...identity, claimId }) })
  }

  async completeSettlement(claim: PaystackSettlementClaim): Promise<void> {
    const key = `${this.scope}:${claim.reference}:${claim.purpose}`
    const existing = this.#root.reconciliations.get(key)
    if (!existing || existing.state !== 'applying' || existing.claimId !== claim.claimId || !sameSettlement(existing, claim)) {
      throw new PaystackError('duplicate', 'Payment settlement claim is stale or mismatched.')
    }
    const providerKey = `${this.scope}:${claim.providerTransactionId}`
    const providerOwner = this.#root.providerTransactions.get(providerKey)
    if (providerOwner && providerOwner !== key) {
      throw new PaystackError('duplicate', 'Provider transaction is already reconciled to another reference.')
    }
    this.#root.providerTransactions.set(providerKey, key)
    this.#root.reconciliations.set(key, Object.freeze({ ...existing, state: 'settled', claimId: null }))
  }

  async releaseSettlement(claim: PaystackSettlementClaim): Promise<void> {
    const key = `${this.scope}:${claim.reference}:${claim.purpose}`
    const existing = this.#root.reconciliations.get(key)
    if (!existing || existing.state !== 'applying' || existing.claimId !== claim.claimId || !sameSettlement(existing, claim)) {
      throw new PaystackError('duplicate', 'Payment settlement claim is stale or mismatched.')
    }
    this.#root.reconciliations.set(key, Object.freeze({ ...existing, state: 'pending', claimId: null }))
  }
}

export class MemoryPaystackLedger implements PaystackLedgerRepository {
  readonly events = new Map<string, string>()
  readonly initializations = new Map<string, MemoryInitialization>()
  readonly reconciliations = new Map<string, MemoryReconciliation>()
  readonly providerTransactions = new Map<string, string>()
  readonly #scopes = new Map<PaystackScope, ScopedPaystackLedger>()
  readonly claimFactory: () => string

  constructor(claimFactory: () => string = () => crypto.randomUUID()) {
    this.claimFactory = claimFactory
  }

  forScope(scope: PaystackScope): ScopedPaystackLedger {
    if (!Value.Check(PaystackScopeSchema, scope)) {
      throw new PaystackError('scope-crossing', 'Paystack ledger scope is invalid.')
    }
    const existing = this.#scopes.get(scope)
    if (existing) return existing
    const bound = new MemoryScopedPaystackLedger(this, scope)
    this.#scopes.set(scope, bound)
    return bound
  }

  /** Compatibility helper for fixture-only direct event assertions. */
  ingest(scope: PaystackScope, eventId: string, rawHash: string): Promise<boolean> {
    return this.forScope(scope).ingestEvent(eventId, rawHash)
  }

  /** Compatibility helper for fixture-only pre-reconciled rows. */
  async settle(
    scope: PaystackScope,
    reference: string,
    purpose: string,
    providerTransactionId: string,
    money: PaystackMoney = { amountMinor: 1, currency: 'KES' },
  ): Promise<boolean> {
    const ledger = this.forScope(scope)
    const initialization = Object.freeze({ reference, purpose, money, metadataHash: sha256('{}') })
    await ledger.recordInitialization(initialization)
    const result = await ledger.claimSettlement({ ...initialization, providerTransactionId })
    if (result.state !== 'claimed') return false
    await ledger.completeSettlement(result.claim)
    return true
  }
}
