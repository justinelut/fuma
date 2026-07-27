import { Type, Value } from '@core/utils/typeboxHelpers'
import type { PlatformCheckoutMetadata } from '../checkout'
import {
  type ScopedPaystackTransport,
  type VerifiedPaystackTransaction,
} from '../paystack/transport'

export const PLATFORM_BILLING_EVENT_TYPES = Object.freeze([
  'charge.success',
  'subscription.create',
  'subscription.not_renew',
  'subscription.disable',
] as const)
export type PlatformBillingEventType = typeof PLATFORM_BILLING_EVENT_TYPES[number]
export type BillingEventState = 'stored' | 'reduced' | 'unknown'

export type BillingEvent = Readonly<{
  eventId: string
  providerSequence: bigint
  eventType: string
  reference: string | null
  receivedAt: string
  rawSha256: string
  state: BillingEventState
  claimId: string | null
  claimExpiresAt: string | null
  attemptCount: number
  errorCode: string | null
}>

export type BillingEventClaim = Readonly<{
  claimId: string
  event: BillingEvent
}>

export type BillingObligation = Readonly<{
  checkoutId: string
  candidateId: string
  entitlementCandidateId: string | null
  sourceKind: 'public-plan' | 'private-offer'
  organizationId: string
  workspaceId: string
  siteId: string
  profileId: string
  kind: 'setup' | 'recurring'
  reference: string
  amountMinor: number
  currency: 'KES'
  allowedChannels: readonly ('card' | 'mobile_money' | 'bank')[]
  metadata: PlatformCheckoutMetadata
  settledAt: string | null
  providerTransactionId: string | null
}>

export type ActiveContract = Readonly<{
  contractId: string
  checkoutId: string
  candidateId: string | null
  organizationId: string
  workspaceId: string
  siteId: string
  activatedAt: string
  state: 'active' | 'paid-transfer-pending'
  handoffCommandId: string | null
}>

export type BillingApplyResult = Readonly<{
  eventId: string
  outcome: 'partial' | 'active' | 'paid-transfer-pending' | 'subscription-reduced'
  contract: ActiveContract | null
}>

export interface BillingRepository {
  ingest(event: BillingEvent): Promise<boolean>
  pendingEventIds(limit: number): Promise<readonly string[]>
  claimNext(): Promise<BillingEventClaim | null>
  obligationForReference(reference: string): Promise<BillingObligation | null>
  applyVerified(
    claim: BillingEventClaim,
    obligation: BillingObligation,
    transaction: VerifiedPaystackTransaction,
  ): Promise<BillingApplyResult>
  applySubscription(
    claim: BillingEventClaim,
    state: 'active' | 'non-renewing' | 'disabled',
  ): Promise<BillingApplyResult>
  release(claim: BillingEventClaim, errorCode: string): Promise<void>
}

export class BillingReconciliationError extends Error {
  readonly code: 'contract' | 'partial' | 'mismatch' | 'scope' | 'busy'

  constructor(code: BillingReconciliationError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'BillingReconciliationError'
  }
}

const ProviderEventSchema = Type.Object({
  event: Type.String({ minLength: 1, maxLength: 100 }),
  data: Type.Object({
    id: Type.Union([
      Type.String({ minLength: 1, maxLength: 128 }),
      Type.Integer({ minimum: 1 }),
    ]),
    reference: Type.Optional(Type.String({ minLength: 16, maxLength: 100 })),
    created_at: Type.Optional(Type.String({ format: 'date-time' })),
  }, { additionalProperties: true }),
}, { additionalProperties: false })

type ProviderEvent = {
  event: string
  data: { id: string | number; reference?: string; created_at?: string }
}

function providerSequence(event: ProviderEvent): bigint {
  const id = String(event.data.id)
  if (/^[0-9]+$/.test(id)) {
    try { return BigInt(id) } catch { /* fall through */ }
  }
  const createdAt = event.data.created_at ? Date.parse(event.data.created_at) : Number.NaN
  return Number.isFinite(createdAt) && createdAt >= 0 ? BigInt(createdAt) : 0n
}

function sha256(value: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

function eventState(event: ProviderEvent): BillingEventState {
  return PLATFORM_BILLING_EVENT_TYPES.includes(event.event as PlatformBillingEventType)
    && event.data.reference !== undefined
    ? 'stored'
    : 'unknown'
}

function subscriptionState(eventType: string): 'active' | 'non-renewing' | 'disabled' | null {
  if (eventType === 'subscription.create') return 'active'
  if (eventType === 'subscription.not_renew') return 'non-renewing'
  if (eventType === 'subscription.disable') return 'disabled'
  return null
}

function safeErrorCode(error: unknown): string {
  if (error instanceof BillingReconciliationError) return error.code
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code)
    if (/^[a-z][a-z0-9-]{0,63}$/.test(code)) return code
  }
  return 'reconciliation-failed'
}

export type BillingIngestResult = Readonly<{
  duplicate: boolean
  eventId: string
  state: BillingEventState
}>

export type BillingReductionResult = Readonly<{
  processed: number
  partial: number
  activated: number
  handoffs: number
  subscriptions: number
}>

export class PlatformBillingReconciler {
  readonly #transport: ScopedPaystackTransport
  readonly #repository: BillingRepository
  readonly #now: () => Date

  constructor(
    transport: ScopedPaystackTransport,
    repository: BillingRepository,
    now: () => Date = () => new Date(),
  ) {
    if (transport.scope !== 'platform_billing') {
      throw new BillingReconciliationError(
        'scope',
        'Platform webhook cannot use customer merchant credentials.',
      )
    }
    this.#transport = transport
    this.#repository = repository
    this.#now = now
  }

  async ingest(raw: Uint8Array, signature: string): Promise<BillingIngestResult> {
    // Shared transport verifies the exact raw signature before parsing, validates
    // scope/purpose/money labels, and durably rejects mutated event replay.
    const transportResult = await this.#transport.ingestWebhook(raw, signature)
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
    } catch {
      throw new BillingReconciliationError('contract', 'Signed webhook JSON is invalid.')
    }
    if (!Value.Check(ProviderEventSchema, parsed)) {
      throw new BillingReconciliationError('contract', 'Signed webhook contract is invalid.')
    }
    const event = parsed as ProviderEvent
    const state = eventState(event)
    const record: BillingEvent = Object.freeze({
      eventId: transportResult.eventId,
      providerSequence: providerSequence(event),
      eventType: event.event,
      reference: event.data.reference ?? null,
      receivedAt: this.#now().toISOString(),
      rawSha256: sha256(raw),
      state,
      claimId: null,
      claimExpiresAt: null,
      attemptCount: 0,
      errorCode: null,
    })
    const inserted = await this.#repository.ingest(record)
    return Object.freeze({
      duplicate: !inserted,
      eventId: record.eventId,
      state,
    })
  }

  pendingEventIds(limit = 100): Promise<readonly string[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new TypeError('Billing recovery limit must be between 1 and 1000.')
    }
    return this.#repository.pendingEventIds(limit)
  }

  async reducePending(limit = 100): Promise<BillingReductionResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new TypeError('Billing reduction limit must be between 1 and 1000.')
    }
    const totals = { processed: 0, partial: 0, activated: 0, handoffs: 0, subscriptions: 0 }
    for (let index = 0; index < limit; index += 1) {
      const claim = await this.#repository.claimNext()
      if (!claim) break
      try {
        const subscription = subscriptionState(claim.event.eventType)
        let result: BillingApplyResult
        if (subscription) {
          result = await this.#repository.applySubscription(claim, subscription)
        } else {
          if (claim.event.eventType !== 'charge.success' || !claim.event.reference) {
            throw new BillingReconciliationError('contract', 'Stored billing event is not reducible.')
          }
          const obligation = await this.#repository.obligationForReference(claim.event.reference)
          if (!obligation) {
            throw new BillingReconciliationError(
              'mismatch',
              'Webhook reference does not bind one exact platform obligation.',
            )
          }
          const purpose = obligation.kind === 'setup' ? 'platform-setup' : 'platform-recurring'
          const transaction = await this.#transport.verify(
            purpose,
            obligation.reference,
            obligation.metadata,
          )
          if (
            transaction.money.amountMinor !== obligation.amountMinor
            || transaction.money.currency !== obligation.currency
            || !obligation.allowedChannels.includes(
              transaction.channel as BillingObligation['allowedChannels'][number],
            )
          ) {
            throw new BillingReconciliationError(
              'mismatch',
              'Verified provider transaction differs from the exact local obligation.',
            )
          }
          result = await this.#repository.applyVerified(claim, obligation, transaction)
        }
        totals.processed += 1
        if (result.outcome === 'partial') totals.partial += 1
        if (result.outcome === 'active' || result.outcome === 'paid-transfer-pending') {
          totals.activated += 1
        }
        if (result.outcome === 'paid-transfer-pending') totals.handoffs += 1
        if (result.outcome === 'subscription-reduced') totals.subscriptions += 1
      } catch (error) {
        await this.#repository.release(claim, safeErrorCode(error))
        throw error
      }
    }
    return Object.freeze(totals)
  }
}

function cloneEvent(event: BillingEvent): BillingEvent {
  return Object.freeze(structuredClone(event))
}

export class MemoryBillingRepository implements BillingRepository {
  readonly events = new Map<string, BillingEvent>()
  readonly obligations: BillingObligation[] = []
  readonly contracts = new Map<string, ActiveContract>()
  readonly handoffs = new Set<string>()
  readonly subscriptions = new Map<string, Readonly<{
    state: 'active' | 'non-renewing' | 'disabled'
    sequence: bigint
    eventId: string
  }>>()
  readonly #now: () => Date
  readonly #claimLeaseMs: number
  #claim = 0

  constructor(now: () => Date = () => new Date(), claimLeaseMs = 30_000) {
    this.#now = now
    this.#claimLeaseMs = claimLeaseMs
  }

  async ingest(event: BillingEvent): Promise<boolean> {
    const existing = this.events.get(event.eventId)
    if (existing && existing.rawSha256 !== event.rawSha256) {
      throw new BillingReconciliationError(
        'mismatch',
        'Signed event ID was replayed with different bytes.',
      )
    }
    if (existing) return false
    this.events.set(event.eventId, cloneEvent(event))
    return true
  }

  async pendingEventIds(limit: number): Promise<readonly string[]> {
    return this.#pending().slice(0, limit).map((event) => event.eventId)
  }

  #pending(): BillingEvent[] {
    return [...this.events.values()]
      .filter((event) => event.state === 'stored')
      .sort((left, right) => (
        left.providerSequence < right.providerSequence ? -1
          : left.providerSequence > right.providerSequence ? 1
            : left.eventId.localeCompare(right.eventId)
      ))
  }

  async claimNext(): Promise<BillingEventClaim | null> {
    const now = this.#now()
    const event = this.#pending()[0]
    if (
      !event
      || (
        event.claimId !== null
        && event.claimExpiresAt !== null
        && Date.parse(event.claimExpiresAt) > now.getTime()
      )
    ) return null
    const claimId = `billing-claim-${++this.#claim}`
    const claimed = Object.freeze({
      ...event,
      claimId,
      claimExpiresAt: new Date(now.getTime() + this.#claimLeaseMs).toISOString(),
      attemptCount: event.attemptCount + 1,
      errorCode: null,
    })
    this.events.set(event.eventId, claimed)
    return Object.freeze({ claimId, event: cloneEvent(claimed) })
  }

  async obligationForReference(reference: string): Promise<BillingObligation | null> {
    const found = this.obligations.filter((obligation) => obligation.reference === reference)
    if (found.length > 1) {
      throw new BillingReconciliationError('mismatch', 'Reference binds multiple obligations.')
    }
    return found[0] ? Object.freeze(structuredClone(found[0])) : null
  }

  #assertClaim(claim: BillingEventClaim): BillingEvent {
    const event = this.events.get(claim.event.eventId)
    if (!event || event.state !== 'stored' || event.claimId !== claim.claimId) {
      throw new BillingReconciliationError('busy', 'Billing event claim is stale.')
    }
    return event
  }

  #reduceEvent(claim: BillingEventClaim): void {
    const event = this.#assertClaim(claim)
    this.events.set(event.eventId, Object.freeze({
      ...event,
      state: 'reduced',
      claimId: null,
      claimExpiresAt: null,
      errorCode: null,
    }))
  }

  async applyVerified(
    claim: BillingEventClaim,
    obligation: BillingObligation,
    transaction: VerifiedPaystackTransaction,
  ): Promise<BillingApplyResult> {
    this.#assertClaim(claim)
    const index = this.obligations.findIndex((candidate) => (
      candidate.checkoutId === obligation.checkoutId && candidate.kind === obligation.kind
    ))
    const stored = this.obligations[index]
    if (!stored || stored.reference !== transaction.reference) {
      throw new BillingReconciliationError('mismatch', 'Billing obligation changed during settlement.')
    }
    if (
      stored.providerTransactionId !== null
      && stored.providerTransactionId !== transaction.providerTransactionId
    ) {
      throw new BillingReconciliationError('mismatch', 'Provider transaction identity changed.')
    }
    const reused = this.obligations.find((candidate, candidateIndex) => (
      candidateIndex !== index
      && candidate.providerTransactionId === transaction.providerTransactionId
    ))
    if (reused) {
      throw new BillingReconciliationError('mismatch', 'Provider transaction was reused.')
    }
    this.obligations[index] = Object.freeze({
      ...stored,
      settledAt: stored.settledAt ?? this.#now().toISOString(),
      providerTransactionId: stored.providerTransactionId ?? transaction.providerTransactionId,
    })
    const all = this.obligations.filter((candidate) => candidate.checkoutId === obligation.checkoutId)
    const complete = all.length > 0 && all.every((candidate) => candidate.settledAt !== null)
    let contract: ActiveContract | null = null
    let outcome: BillingApplyResult['outcome'] = 'partial'
    if (complete) {
      const existing = this.contracts.get(obligation.checkoutId)
      const state = obligation.sourceKind === 'private-offer'
        ? 'paid-transfer-pending' as const
        : 'active' as const
      contract = existing ?? Object.freeze({
        contractId: `contract:${obligation.checkoutId}`,
        checkoutId: obligation.checkoutId,
        candidateId: obligation.entitlementCandidateId,
        organizationId: obligation.organizationId,
        workspaceId: obligation.workspaceId,
        siteId: obligation.siteId,
        activatedAt: this.#now().toISOString(),
        state,
        handoffCommandId: state === 'paid-transfer-pending'
          ? `paid-handoff:contract:${obligation.checkoutId}`
          : null,
      })
      this.contracts.set(obligation.checkoutId, contract)
      if (contract.handoffCommandId) this.handoffs.add(contract.handoffCommandId)
      outcome = state
    }
    this.#reduceEvent(claim)
    return Object.freeze({ eventId: claim.event.eventId, outcome, contract })
  }

  async applySubscription(
    claim: BillingEventClaim,
    state: 'active' | 'non-renewing' | 'disabled',
  ): Promise<BillingApplyResult> {
    const event = this.#assertClaim(claim)
    if (!event.reference) {
      throw new BillingReconciliationError('mismatch', 'Subscription event has no reference.')
    }
    const previous = this.subscriptions.get(event.reference)
    if (
      !previous
      || event.providerSequence > previous.sequence
      || (
        event.providerSequence === previous.sequence
        && event.eventId.localeCompare(previous.eventId) > 0
      )
    ) {
      this.subscriptions.set(event.reference, Object.freeze({
        state,
        sequence: event.providerSequence,
        eventId: event.eventId,
      }))
    }
    this.#reduceEvent(claim)
    return Object.freeze({
      eventId: event.eventId,
      outcome: 'subscription-reduced',
      contract: null,
    })
  }

  async release(claim: BillingEventClaim, errorCode: string): Promise<void> {
    const event = this.events.get(claim.event.eventId)
    if (!event || event.state !== 'stored' || event.claimId !== claim.claimId) return
    this.events.set(event.eventId, Object.freeze({
      ...event,
      claimId: null,
      claimExpiresAt: null,
      errorCode,
    }))
  }
}
