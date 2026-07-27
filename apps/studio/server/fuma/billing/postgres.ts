import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import {
  PlatformCheckoutMetadataSchema,
  type PlatformCheckoutMetadata,
} from '../checkout'
import { evidenceSha256 } from '../entitlements'
import type { VerifiedPaystackTransaction } from '../paystack/transport'
import {
  BillingReconciliationError,
  type ActiveContract,
  type BillingApplyResult,
  type BillingEvent,
  type BillingEventClaim,
  type BillingObligation,
  type BillingRepository,
} from './reconciler'

type EventRow = Readonly<{
  event_id: string
  provider_sequence: string | number | bigint
  event_type: string
  reference: string | null
  raw_sha256: string
  state: BillingEvent['state']
  received_at: Date | string
  claim_id: string | null
  claim_expires_at: Date | string | null
  attempt_count: number
  error_code: string | null
}>

type ObligationRow = Readonly<{
  checkout_id: string
  candidate_id: string
  entitlement_candidate_id: string | null
  source_kind: 'public-plan' | 'private-offer'
  source_id: string
  source_version: string
  organization_id: string
  workspace_id: string
  site_id: string
  profile_id: string
  customer_actor_id: string
  payer_email_sha256: string
  cadence: 'monthly' | 'annual'
  callback_url: string
  allowed_channels: string[] | string
  evidence_sha256: string
  checkout_state: 'awaiting-payment' | 'cancelled'
  kind: 'setup' | 'recurring'
  reference: string
  amount_minor: string | number
  currency: 'KES'
  settled_at: Date | string | null
  provider_transaction_id: string | null
}>

type SettlementSummaryRow = Readonly<{
  total: string | number
  settled: string | number
  has_setup: boolean
  setup_settled: boolean
  recurring_settled: boolean
}>

type ContractRow = Readonly<{
  contract_id: string
  checkout_id: string
  candidate_id: string | null
  organization_id: string
  workspace_id: string
  site_id: string
  state: 'active' | 'paid-transfer-pending'
  activated_at: Date | string
  source_kind: 'public-plan' | 'private-offer'
  source_id: string
  source_version: string
  cadence: 'monthly' | 'annual'
  evidence_sha256: string
}>

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function exactAmount(value: number | string): number {
  const amount = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000_000) {
    throw new BillingReconciliationError('contract', 'Stored billing amount is invalid.')
  }
  return amount
}

function channels(value: string[] | string): BillingObligation['allowedChannels'] {
  const parsed = typeof value === 'string'
    ? value.replace(/^\{|\}$/g, '').split(',').filter(Boolean)
    : value
  if (
    parsed.length < 1
    || parsed.length > 3
    || parsed.some((channel) => !['card', 'mobile_money', 'bank'].includes(channel))
  ) {
    throw new BillingReconciliationError('contract', 'Stored billing channels are invalid.')
  }
  return Object.freeze([...parsed]) as BillingObligation['allowedChannels']
}

function mapEvent(row: EventRow): BillingEvent {
  let providerSequence: bigint
  try { providerSequence = BigInt(row.provider_sequence) } catch {
    throw new BillingReconciliationError('contract', 'Stored provider sequence is invalid.')
  }
  return Object.freeze({
    eventId: row.event_id,
    providerSequence,
    eventType: row.event_type,
    reference: row.reference,
    receivedAt: iso(row.received_at),
    rawSha256: row.raw_sha256,
    state: row.state,
    claimId: row.claim_id,
    claimExpiresAt: row.claim_expires_at === null ? null : iso(row.claim_expires_at),
    attemptCount: Number(row.attempt_count),
    errorCode: row.error_code,
  })
}

function metadata(row: ObligationRow): PlatformCheckoutMetadata {
  const value = {
    checkoutId: row.checkout_id,
    candidateId: row.candidate_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    sourceVersion: row.source_version,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    customerActorId: row.customer_actor_id,
    payerEmailSha256: row.payer_email_sha256,
    kind: row.kind,
    amountMinor: exactAmount(row.amount_minor),
    currency: row.currency,
    cadence: row.cadence,
    callbackUrl: row.callback_url,
    allowedChannels: [...channels(row.allowed_channels)],
    evidenceSha256: row.evidence_sha256,
  }
  const parsed = safeParseValue(PlatformCheckoutMetadataSchema, value)
  if (!parsed.ok) {
    throw new BillingReconciliationError('contract', 'Stored checkout metadata is invalid.')
  }
  return Object.freeze(parsed.value)
}

function mapObligation(row: ObligationRow): BillingObligation {
  return Object.freeze({
    checkoutId: row.checkout_id,
    candidateId: row.candidate_id,
    entitlementCandidateId: row.entitlement_candidate_id,
    sourceKind: row.source_kind,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    profileId: row.profile_id,
    kind: row.kind,
    reference: row.reference,
    amountMinor: exactAmount(row.amount_minor),
    currency: row.currency,
    allowedChannels: channels(row.allowed_channels),
    metadata: metadata(row),
    settledAt: row.settled_at === null ? null : iso(row.settled_at),
    providerTransactionId: row.provider_transaction_id,
  })
}

function mapContract(row: ContractRow): ActiveContract {
  const handoffCommandId = row.state === 'paid-transfer-pending'
    ? `paid-handoff:${row.contract_id}`
    : null
  return Object.freeze({
    contractId: row.contract_id,
    checkoutId: row.checkout_id,
    candidateId: row.candidate_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    activatedAt: iso(row.activated_at),
    state: row.state,
    handoffCommandId,
  })
}

function sameObligation(left: BillingObligation, right: BillingObligation): boolean {
  return left.checkoutId === right.checkoutId
    && left.kind === right.kind
    && left.reference === right.reference
    && left.amountMinor === right.amountMinor
    && left.currency === right.currency
    && evidenceSha256(left.metadata) === evidenceSha256(right.metadata)
}

export type PostgresBillingRepositoryOptions = Readonly<{
  now?: () => Date
  claimFactory?: () => string
  claimLeaseMs?: number
}>

export class PostgresBillingRepository implements BillingRepository {
  readonly #db: DbClient
  readonly #now: () => Date
  readonly #claimFactory: () => string
  readonly #claimLeaseMs: number

  constructor(db: DbClient, options: PostgresBillingRepositoryOptions = {}) {
    if (db.dialect !== 'postgres') {
      throw new TypeError('Platform billing reconciliation requires PostgreSQL authority.')
    }
    const lease = options.claimLeaseMs ?? 30_000
    if (!Number.isSafeInteger(lease) || lease < 1_000 || lease > 300_000) {
      throw new TypeError('Billing event claim lease must be between 1 and 300 seconds.')
    }
    this.#db = db
    this.#now = options.now ?? (() => new Date())
    this.#claimFactory = options.claimFactory ?? (() => crypto.randomUUID())
    this.#claimLeaseMs = lease
  }

  async ingest(event: BillingEvent): Promise<boolean> {
    const inserted = await this.#db`
      insert into fuma_billing_events (
        event_id,provider_sequence,event_type,reference,raw_sha256,state,received_at,
        reduced_at,claim_id,claim_expires_at,attempt_count,error_code
      ) values (
        ${event.eventId},${event.providerSequence.toString()},${event.eventType},${event.reference},
        ${event.rawSha256},${event.state},${event.receivedAt},null,null,null,0,null
      ) on conflict (event_id) do nothing
    `
    const existing = await this.#db<EventRow>`
      select event_id,provider_sequence,event_type,reference,raw_sha256,state,received_at,
        claim_id,claim_expires_at,attempt_count,error_code
      from fuma_billing_events where event_id=${event.eventId}
    `
    const row = existing.rows[0]
    if (!row || row.raw_sha256 !== event.rawSha256) {
      throw new BillingReconciliationError('mismatch', 'Billing event identity changed on replay.')
    }
    return inserted.rowCount === 1
  }

  async pendingEventIds(limit: number): Promise<readonly string[]> {
    const result = await this.#db<{ event_id: string }>`
      select event_id from fuma_billing_events
      where state='stored'
      order by provider_sequence,event_id limit ${limit}
    `
    return Object.freeze(result.rows.map((row) => row.event_id))
  }

  claimNext(): Promise<BillingEventClaim | null> {
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${'fuma:platform-billing-reduction'},0))`
      const selected = await tx<EventRow>`
        select event_id,provider_sequence,event_type,reference,raw_sha256,state,received_at,
          claim_id,claim_expires_at,attempt_count,error_code
        from fuma_billing_events where state='stored'
        order by provider_sequence,event_id limit 1 for update
      `
      const current = selected.rows[0]
      if (!current) return null
      const now = this.#now()
      if (
        current.claim_id !== null
        && current.claim_expires_at !== null
        && Date.parse(iso(current.claim_expires_at)) > now.getTime()
      ) return null
      const claimId = this.#claimFactory()
      const expiresAt = new Date(now.getTime() + this.#claimLeaseMs).toISOString()
      const updated = await tx<EventRow>`
        update fuma_billing_events set claim_id=${claimId},claim_expires_at=${expiresAt},
          attempt_count=attempt_count+1,error_code=null
        where event_id=${current.event_id} returning event_id,provider_sequence,event_type,
          reference,raw_sha256,state,received_at,claim_id,claim_expires_at,attempt_count,error_code
      `
      const event = updated.rows[0]
      if (!event) throw new BillingReconciliationError('busy', 'Billing event claim disappeared.')
      return Object.freeze({ claimId, event: mapEvent(event) })
    })
  }

  async obligationForReference(reference: string): Promise<BillingObligation | null> {
    const rows = await this.#obligationRows(this.#db, reference, false)
    if (rows.length > 1) {
      throw new BillingReconciliationError('mismatch', 'Reference binds multiple platform obligations.')
    }
    return rows[0] ? mapObligation(rows[0]) : null
  }

  async #obligationRows(db: DbClient, reference: string, lock: boolean): Promise<ObligationRow[]> {
    const suffix = lock ? ' for update of o,c' : ''
    const result = await db.unsafe<ObligationRow>(`
      select o.checkout_id,c.candidate_id,c.entitlement_candidate_id,c.source_kind,c.source_id,
        c.source_version,c.organization_id,c.workspace_id,c.site_id,c.profile_id,c.customer_actor_id,
        c.payer_email_sha256,c.cadence,c.callback_url,c.allowed_channels,c.evidence_sha256,
        c.state checkout_state,o.kind,o.reference,o.amount_minor,o.currency,o.settled_at,
        o.provider_transaction_id
      from fuma_platform_checkout_obligations_v2 o
      join fuma_platform_checkout_candidates_v2 c on c.checkout_id=o.checkout_id
      where o.reference=$1 and c.state='awaiting-payment'${suffix}
    `, [reference])
    return result.rows
  }

  async #assertClaim(tx: DbClient, claim: BillingEventClaim): Promise<EventRow> {
    const selected = await tx<EventRow>`
      select event_id,provider_sequence,event_type,reference,raw_sha256,state,received_at,
        claim_id,claim_expires_at,attempt_count,error_code
      from fuma_billing_events where event_id=${claim.event.eventId} for update
    `
    const current = selected.rows[0]
    if (!current || current.state !== 'stored' || current.claim_id !== claim.claimId) {
      throw new BillingReconciliationError('busy', 'Billing event claim is stale.')
    }
    return current
  }

  async #reduceEvent(tx: DbClient, claim: BillingEventClaim): Promise<void> {
    const updated = await tx`
      update fuma_billing_events set state='reduced',reduced_at=${this.#now().toISOString()},
        claim_id=null,claim_expires_at=null,error_code=null
      where event_id=${claim.event.eventId} and state='stored' and claim_id=${claim.claimId}
    `
    if (updated.rowCount !== 1) {
      throw new BillingReconciliationError('busy', 'Billing event reduction lost its claim.')
    }
  }

  applyVerified(
    claim: BillingEventClaim,
    obligation: BillingObligation,
    transaction: VerifiedPaystackTransaction,
  ): Promise<BillingApplyResult> {
    return this.#db.transaction(async (tx) => {
      await this.#assertClaim(tx, claim)
      const rows = await this.#obligationRows(tx, transaction.reference, true)
      if (rows.length !== 1) {
        throw new BillingReconciliationError('mismatch', 'Exact obligation disappeared during settlement.')
      }
      const current = mapObligation(rows[0]!)
      if (!sameObligation(current, obligation) || current.sourceKind !== obligation.sourceKind) {
        throw new BillingReconciliationError('mismatch', 'Exact obligation changed during settlement.')
      }
      if (
        (current.sourceKind === 'private-offer')
        !== (current.entitlementCandidateId !== null)
      ) {
        throw new BillingReconciliationError(
          'mismatch',
          'Checkout source and entitlement candidate binding differ.',
        )
      }
      if (
        current.providerTransactionId !== null
        && current.providerTransactionId !== transaction.providerTransactionId
      ) {
        throw new BillingReconciliationError('mismatch', 'Provider transaction identity changed.')
      }
      const destination = await tx<{ authorized: number }>`
        select 1 as authorized from auth_organizations a
        join fuma_workspaces w on w.organization_id=a.id and w.id=${current.workspaceId} and w.status='active'
        join fuma_sites s on s.organization_id=a.id and s.workspace_id=w.id
          and s.id=${current.siteId} and s.profile_id=${current.profileId} and s.status='active'
        where a.id=${current.organizationId} for share of w,s
      `
      if (!destination.rows[0]) {
        throw new BillingReconciliationError('mismatch', 'Paid destination authority is no longer current.')
      }
      const reused = await tx<{ checkout_id: string; kind: string }>`
        select checkout_id,kind from fuma_platform_checkout_obligations_v2
        where provider_transaction_id=${transaction.providerTransactionId}
          and (checkout_id<>${current.checkoutId} or kind<>${current.kind})
      `
      if (reused.rows[0]) {
        throw new BillingReconciliationError('mismatch', 'Provider transaction was reused across obligations.')
      }
      const settled = await tx`
        update fuma_platform_checkout_obligations_v2 set
          provider_transaction_id=coalesce(provider_transaction_id,${transaction.providerTransactionId}),
          settled_at=coalesce(settled_at,${this.#now().toISOString()}),updated_at=${this.#now().toISOString()}
        where checkout_id=${current.checkoutId} and kind=${current.kind}
          and reference=${current.reference}
          and (provider_transaction_id is null or provider_transaction_id=${transaction.providerTransactionId})
      `
      if (settled.rowCount !== 1) {
        throw new BillingReconciliationError('mismatch', 'Exact obligation settlement did not converge.')
      }
      const summary = await tx<SettlementSummaryRow>`
        select count(*) total,count(settled_at) settled,
          bool_or(kind='setup') has_setup,
          coalesce(bool_and(settled_at is not null) filter (where kind='setup'),true) setup_settled,
          coalesce(bool_and(settled_at is not null) filter (where kind='recurring'),false) recurring_settled
        from fuma_platform_checkout_obligations_v2 where checkout_id=${current.checkoutId}
      `
      const value = summary.rows[0]
      if (!value || Number(value.total) < 1) {
        throw new BillingReconciliationError('contract', 'Checkout has no settlement obligations.')
      }
      const complete = Number(value.total) === Number(value.settled)
      if (current.entitlementCandidateId !== null) {
        const candidateState = complete ? 'paid-transfer-pending' : 'partially-paid'
        const candidate = await tx`
          update fuma_contract_candidates set
            setup_fee_settled=${value.has_setup ? value.setup_settled : complete},
            recurring_settled=${value.recurring_settled},state=${candidateState},
            activated_at=case when ${complete}
              then coalesce(activated_at,${this.#now().toISOString()}) else null end,
            paid_transfer_pending=${complete}
          where candidate_id=${current.entitlementCandidateId}
            and state in ('awaiting-payment','partially-paid','paid-transfer-pending')
        `
        if (candidate.rowCount !== 1) {
          throw new BillingReconciliationError('mismatch', 'Exact entitlement candidate transition failed.')
        }
      }
      let contract: ActiveContract | null = null
      let outcome: BillingApplyResult['outcome'] = 'partial'
      if (complete) {
        const contractId = `contract:${current.checkoutId}`
        const state = current.sourceKind === 'private-offer'
          ? 'paid-transfer-pending' as const
          : 'active' as const
        await tx`
          insert into fuma_organization_contracts (
            contract_id,candidate_id,checkout_id,organization_id,workspace_id,site_id,state,
            activated_at,source_kind,source_id,source_version,cadence,evidence_sha256
          ) values (
            ${contractId},${current.entitlementCandidateId},${current.checkoutId},
            ${current.organizationId},${current.workspaceId},${current.siteId},${state},
            ${this.#now().toISOString()},${current.sourceKind},${current.metadata.sourceId},
            ${current.metadata.sourceVersion},${current.metadata.cadence},${current.metadata.evidenceSha256}
          ) on conflict (checkout_id) do nothing
        `
        const stored = await tx<ContractRow>`
          select contract_id,checkout_id,candidate_id,organization_id,workspace_id,site_id,state,
            activated_at,source_kind,source_id,source_version,cadence,evidence_sha256
          from fuma_organization_contracts where checkout_id=${current.checkoutId}
        `
        if (!stored.rows[0]) {
          throw new BillingReconciliationError('contract', 'Activated contract was not persisted.')
        }
        const contractRow = stored.rows[0]
        contract = mapContract(contractRow)
        if (
          contract.contractId !== contractId
          || contract.state !== state
          || contract.candidateId !== current.entitlementCandidateId
          || contract.organizationId !== current.organizationId
          || contract.workspaceId !== current.workspaceId
          || contract.siteId !== current.siteId
          || contractRow.source_kind !== current.sourceKind
          || contractRow.source_id !== current.metadata.sourceId
          || contractRow.source_version !== current.metadata.sourceVersion
          || contractRow.cadence !== current.metadata.cadence
          || contractRow.evidence_sha256 !== current.metadata.evidenceSha256
        ) {
          throw new BillingReconciliationError('mismatch', 'Activated contract identity changed.')
        }
        if (state === 'paid-transfer-pending') {
          const handoffCommandId = `paid-handoff:${contract.contractId}`
          await tx`
            insert into fuma_paid_handoff_outbox (
              command_id,contract_id,state,created_at,delivered_at
            ) values (${handoffCommandId},${contract.contractId},'pending',
              ${this.#now().toISOString()},null)
            on conflict (contract_id) do nothing
          `
          const handoff = await tx<{ command_id: string }>`
            select command_id from fuma_paid_handoff_outbox
            where contract_id=${contract.contractId}
          `
          if (handoff.rows[0]?.command_id !== handoffCommandId) {
            throw new BillingReconciliationError('mismatch', 'Paid handoff identity changed.')
          }
        }
        outcome = state
      }
      await this.#reduceEvent(tx, claim)
      return Object.freeze({ eventId: claim.event.eventId, outcome, contract })
    })
  }

  applySubscription(
    claim: BillingEventClaim,
    state: 'active' | 'non-renewing' | 'disabled',
  ): Promise<BillingApplyResult> {
    return this.#db.transaction(async (tx) => {
      const event = await this.#assertClaim(tx, claim)
      if (!event.reference) {
        throw new BillingReconciliationError('mismatch', 'Subscription event has no reference.')
      }
      await tx`
        insert into fuma_platform_subscription_reductions_v2 (
          reference,state,last_provider_sequence,last_event_id,updated_at
        ) values (${event.reference},${state},${String(event.provider_sequence)},
          ${event.event_id},${this.#now().toISOString()})
        on conflict (reference) do update set
          state=excluded.state,last_provider_sequence=excluded.last_provider_sequence,
          last_event_id=excluded.last_event_id,updated_at=excluded.updated_at
        where fuma_platform_subscription_reductions_v2.last_provider_sequence
            < excluded.last_provider_sequence
          or (
            fuma_platform_subscription_reductions_v2.last_provider_sequence
              = excluded.last_provider_sequence
            and fuma_platform_subscription_reductions_v2.last_event_id < excluded.last_event_id
          )
      `
      await this.#reduceEvent(tx, claim)
      return Object.freeze({
        eventId: claim.event.eventId,
        outcome: 'subscription-reduced' as const,
        contract: null,
      })
    })
  }

  async release(claim: BillingEventClaim, errorCode: string): Promise<void> {
    await this.#db`
      update fuma_billing_events set claim_id=null,claim_expires_at=null,error_code=${errorCode}
      where event_id=${claim.event.eventId} and state='stored' and claim_id=${claim.claimId}
    `
  }
}
