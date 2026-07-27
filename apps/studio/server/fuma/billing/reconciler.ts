import { Type, Value } from '@core/utils/typeboxHelpers'
import { verifyPaystackWebhook, type ScopedPaystackTransport } from '../paystack/transport'

export type BillingEvent = Readonly<{ eventId: string; providerSequence: bigint; eventType: string; reference: string | null; receivedAt: string; rawSha256: string; state: 'stored' | 'reduced' | 'unknown' }>
export type BillingObligation = Readonly<{
  candidateId: string; checkoutId: string; organizationId: string; workspaceId: string; siteId: string
  kind: 'setup' | 'recurring'; reference: string; amountMinor: number; currency: 'KES'; settledAt: string | null; providerTransactionId: string | null
}>
export type ActiveContract = Readonly<{
  contractId: string; candidateId: string; organizationId: string; workspaceId: string; siteId: string; activatedAt: string
  state: 'paid-transfer-pending'; handoffCommandId: string
}>
export interface BillingRepository {
  ingest(event: BillingEvent): Promise<boolean>
  unknown(event: BillingEvent): Promise<void>
  pendingOrdered(): Promise<readonly BillingEvent[]>
  markReduced(eventId: string): Promise<void>
  obligationsForReference(reference: string): Promise<readonly BillingObligation[]>
  settle(obligation: BillingObligation, transactionId: string, at: string): Promise<void>
  activateExact(candidateId: string, at: string): Promise<ActiveContract | null>
  emitHandoff(contract: ActiveContract): Promise<boolean>
}
export class BillingReconciliationError extends Error {
  readonly code: 'signature' | 'contract' | 'partial' | 'mismatch' | 'scope';
  constructor(code: 'signature' | 'contract' | 'partial' | 'mismatch' | 'scope', message: string) { super(message); this.code = code; this.name = 'BillingReconciliationError' }
}
const EventSchema = Type.Object({
  event: Type.String({ minLength: 1, maxLength: 100 }),
  data: Type.Object({ id: Type.Union([Type.String({ minLength: 1 }), Type.Number()]), reference: Type.Optional(Type.String({ minLength: 1 })), created_at: Type.Optional(Type.String()) }, { additionalProperties: true }),
}, { additionalProperties: false })
function sequence(value: string | number): bigint {
  const text = String(value)
  if (!/^[0-9]+$/.test(text)) return 0n
  try { return BigInt(text) } catch { return 0n }
}

export class PlatformBillingReconciler {
  private readonly webhookSecret: string;
  private readonly transport: ScopedPaystackTransport;
  private readonly repository: BillingRepository;
  private readonly now: () => Date;
  constructor(
    webhookSecret: string,
    transport: ScopedPaystackTransport,
    repository: BillingRepository,
    now: () => Date = () => new Date(),
  ) { this.webhookSecret = webhookSecret; this.transport = transport; this.repository = repository; this.now = now;
    if (transport.scope !== 'platform_billing') throw new BillingReconciliationError('scope', 'Platform webhook cannot use customer merchant credentials.')
    if (!webhookSecret) throw new BillingReconciliationError('signature', 'Platform webhook verifier is not configured.')
  }

  async ingest(raw: Uint8Array, signature: string): Promise<Readonly<{ duplicate: boolean; eventId: string }>> {
    verifyPaystackWebhook(this.webhookSecret, raw, signature)
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) } catch { throw new BillingReconciliationError('contract', 'Signed webhook JSON is invalid.') }
    if (!Value.Check(EventSchema, parsed)) throw new BillingReconciliationError('contract', 'Signed webhook contract is invalid.')
    const event = parsed as { event: string; data: { id: string | number; reference?: string } }
    const record: BillingEvent = Object.freeze({
      eventId: `${event.event}:${event.data.id}`, providerSequence: sequence(event.data.id), eventType: event.event, reference: event.data.reference ?? null,
      receivedAt: this.now().toISOString(), rawSha256: new Bun.CryptoHasher('sha256').update(raw).digest('hex'), state: event.event === 'charge.success' ? 'stored' : 'unknown',
    })
    const inserted = await this.repository.ingest(record)
    if (!inserted) return Object.freeze({ duplicate: true, eventId: record.eventId })
    if (record.state === 'unknown' || !record.reference) await this.repository.unknown(record)
    return Object.freeze({ duplicate: false, eventId: record.eventId })
  }

  async reducePending<T>(initial: T, reducer: (state: T, event: BillingEvent) => Promise<T>): Promise<T> {
    let state = initial
    for (const event of await this.repository.pendingOrdered()) {
      state = await reducer(state, event)
      await this.repository.markReduced(event.eventId)
    }
    return state
  }

  async reconcile(reference: string, metadata: unknown): Promise<ActiveContract | null> {
    const obligations = await this.repository.obligationsForReference(reference)
    if (obligations.length !== 1) throw new BillingReconciliationError('mismatch', 'Reference must bind exactly one platform obligation.')
    const obligation = obligations[0]
    const purpose = obligation.kind === 'setup' ? 'platform-setup' : 'platform-recurring'
    const transaction = await this.transport.verify(purpose, reference, metadata)
    if (transaction.money.amountMinor !== obligation.amountMinor || transaction.money.currency !== obligation.currency) throw new BillingReconciliationError('mismatch', 'Verified amount and currency do not match the local obligation.')
    if (obligation.providerTransactionId && obligation.providerTransactionId !== transaction.providerTransactionId) throw new BillingReconciliationError('mismatch', 'Settled obligation cannot change provider transaction identity.')
    await this.repository.settle(obligation, transaction.providerTransactionId, this.now().toISOString())
    const contract = await this.repository.activateExact(obligation.candidateId, this.now().toISOString())
    if (!contract) return null
    if (contract.organizationId !== obligation.organizationId || contract.workspaceId !== obligation.workspaceId || contract.siteId !== obligation.siteId) throw new BillingReconciliationError('mismatch', 'Activated contract destination differs from the paid obligation.')
    await this.repository.emitHandoff(contract)
    return contract
  }
}

export class MemoryBillingRepository implements BillingRepository {
  readonly events = new Map<string, BillingEvent>()
  readonly obligations: BillingObligation[] = []
  readonly contracts = new Map<string, ActiveContract>()
  readonly handoffs = new Set<string>()
  async ingest(event: BillingEvent) {
    const existing = this.events.get(event.eventId)
    if (existing && existing.rawSha256 !== event.rawSha256) throw new BillingReconciliationError('signature', 'Signed event ID was replayed with different bytes.')
    if (existing) return false
    this.events.set(event.eventId, structuredClone(event)); return true
  }
  async unknown(event: BillingEvent) { this.events.set(event.eventId, Object.freeze({ ...event, state: 'unknown' })) }
  async pendingOrdered() { return [...this.events.values()].filter((event) => event.state === 'stored').sort((left, right) => left.providerSequence < right.providerSequence ? -1 : left.providerSequence > right.providerSequence ? 1 : left.eventId.localeCompare(right.eventId)) }
  async markReduced(eventId: string) { const event = this.events.get(eventId); if (event) this.events.set(eventId, Object.freeze({ ...event, state: 'reduced' })) }
  async obligationsForReference(reference: string) { return this.obligations.filter((obligation) => obligation.reference === reference).map((obligation) => structuredClone(obligation)) }
  async settle(obligation: BillingObligation, transactionId: string, at: string) {
    const index = this.obligations.findIndex((value) => value.candidateId === obligation.candidateId && value.kind === obligation.kind)
    if (index < 0) throw new BillingReconciliationError('mismatch', 'Obligation disappeared during settlement.')
    const stored = this.obligations[index]
    if (stored.providerTransactionId && stored.providerTransactionId !== transactionId) throw new BillingReconciliationError('mismatch', 'Provider transaction changed during settlement.')
    this.obligations[index] = Object.freeze({ ...stored, settledAt: stored.settledAt ?? at, providerTransactionId: stored.providerTransactionId ?? transactionId })
  }
  async activateExact(candidateId: string, at: string) {
    const all = this.obligations.filter((obligation) => obligation.candidateId === candidateId)
    if (all.length < 1 || all.some((obligation) => !obligation.settledAt)) return null
    const coordinates = new Set(all.map((obligation) => `${obligation.organizationId}:${obligation.workspaceId}:${obligation.siteId}`))
    if (coordinates.size !== 1) throw new BillingReconciliationError('mismatch', 'Candidate obligations have inconsistent destinations.')
    const old = this.contracts.get(candidateId)
    if (old) return old
    const seed = all[0]
    const contract: ActiveContract = Object.freeze({
      contractId: `contract:${candidateId}`, candidateId, organizationId: seed.organizationId, workspaceId: seed.workspaceId, siteId: seed.siteId,
      activatedAt: at, state: 'paid-transfer-pending', handoffCommandId: `paid-handoff:${candidateId}`,
    })
    this.contracts.set(candidateId, contract); return contract
  }
  async emitHandoff(contract: ActiveContract) { if (this.handoffs.has(contract.handoffCommandId)) return false; this.handoffs.add(contract.handoffCommandId); return true }
}
