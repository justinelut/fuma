import { Value } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
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

type InitializationRow = Readonly<{
  reference: string
  purpose: string
  amount_minor: number | string
  currency: string
  metadata_sha256: string
}>

type EventRow = Readonly<{ raw_sha256: string }>

type ReconciliationRow = Readonly<{
  reference: string
  purpose: string
  provider_transaction_id: string
  amount_minor: number | string
  currency: string
  metadata_sha256: string
  state: 'pending' | 'applying' | 'settled'
  claim_id: string | null
  claim_expires_at: Date | string | null
}>

type SettlementRow = Readonly<{
  reference: string
  purpose: string
  provider_transaction_id: string
  amount_minor: number | string
  currency: string
}>

function exactAmount(value: number | string): number {
  const amount = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new PaystackError('verification-mismatch', 'Stored Paystack amount is outside the exact integer range.')
  }
  return amount
}

function sameMoney(row: Readonly<{ amount_minor: number | string; currency: string }>, money: PaystackMoney): boolean {
  return exactAmount(row.amount_minor) === money.amountMinor && row.currency === money.currency
}

function sameInitialization(row: InitializationRow, input: PaystackInitialization): boolean {
  return row.reference === input.reference
    && row.purpose === input.purpose
    && sameMoney(row, input.money)
    && row.metadata_sha256 === input.metadataHash
}

function sameReconciliation(row: ReconciliationRow, input: PaystackSettlementIdentity): boolean {
  return row.reference === input.reference
    && row.purpose === input.purpose
    && row.provider_transaction_id === input.providerTransactionId
    && sameMoney(row, input.money)
    && row.metadata_sha256 === input.metadataHash
}

function sameSettlement(row: SettlementRow, input: PaystackSettlementIdentity): boolean {
  return row.reference === input.reference
    && row.purpose === input.purpose
    && row.provider_transaction_id === input.providerTransactionId
    && sameMoney(row, input.money)
}

class BoundPostgresPaystackLedger implements ScopedPaystackLedger {
  readonly scope: PaystackScope
  readonly #db: DbClient
  readonly #now: () => Date
  readonly #claimFactory: () => string
  readonly #claimLeaseMs: number

  constructor(
    db: DbClient,
    scope: PaystackScope,
    now: () => Date,
    claimFactory: () => string,
    claimLeaseMs: number,
  ) {
    this.#db = db
    this.scope = scope
    this.#now = now
    this.#claimFactory = claimFactory
    this.#claimLeaseMs = claimLeaseMs
  }

  async recordInitialization(initialization: PaystackInitialization): Promise<boolean> {
    const now = this.#now().toISOString()
    const inserted = await this.#db`
      insert into fuma_paystack_initializations (
        scope, reference, purpose, amount_minor, currency, metadata_sha256, created_at
      ) values (
        ${this.scope}, ${initialization.reference}, ${initialization.purpose},
        ${initialization.money.amountMinor}, ${initialization.money.currency},
        ${initialization.metadataHash}, ${now}
      ) on conflict (scope, reference) do nothing
    `
    const { rows } = await this.#db<InitializationRow>`
      select reference, purpose, amount_minor, currency, metadata_sha256
      from fuma_paystack_initializations
      where scope = ${this.scope} and reference = ${initialization.reference}
    `
    if (!rows[0] || !sameInitialization(rows[0], initialization)) {
      throw new PaystackError('duplicate', 'Paystack reference identity changed on retry.')
    }
    return inserted.rowCount === 1
  }

  async exactInitialization(initialization: PaystackInitialization): Promise<boolean> {
    const { rows } = await this.#db<InitializationRow>`
      select reference, purpose, amount_minor, currency, metadata_sha256
      from fuma_paystack_initializations
      where scope = ${this.scope} and reference = ${initialization.reference}
    `
    return rows[0] !== undefined && sameInitialization(rows[0], initialization)
  }

  async ingestEvent(eventId: string, rawHash: string): Promise<boolean> {
    const inserted = await this.#db`
      insert into fuma_paystack_events (scope, event_id, raw_sha256, received_at)
      values (${this.scope}, ${eventId}, ${rawHash}, ${this.#now().toISOString()})
      on conflict (scope, event_id) do nothing
    `
    const { rows } = await this.#db<EventRow>`
      select raw_sha256 from fuma_paystack_events
      where scope = ${this.scope} and event_id = ${eventId}
    `
    if (!rows[0] || rows[0].raw_sha256 !== rawHash) {
      throw new PaystackError('duplicate', 'A Paystack event ID was replayed with different signed bytes.')
    }
    return inserted.rowCount === 1
  }

  claimSettlement(identity: PaystackSettlementIdentity): Promise<
    | Readonly<{ state: 'claimed'; claim: PaystackSettlementClaim }>
    | Readonly<{ state: 'settled' }>
    | Readonly<{ state: 'busy' }>
  > {
    return this.#db.transaction(async (tx) => {
      const selected = await tx<ReconciliationRow>`
        select reference, purpose, provider_transaction_id, amount_minor, currency,
          metadata_sha256, state, claim_id, claim_expires_at
        from fuma_paystack_reconciliations
        where scope = ${this.scope} and reference = ${identity.reference} and purpose = ${identity.purpose}
        for update
      `
      const existing = selected.rows[0]
      if (existing && !sameReconciliation(existing, identity)) {
        throw new PaystackError('duplicate', 'Payment settlement identity changed on retry.')
      }
      if (existing?.state === 'settled') return Object.freeze({ state: 'settled' as const })
      const now = this.#now()
      if (
        existing?.state === 'applying'
        && existing.claim_expires_at !== null
        && new Date(existing.claim_expires_at).getTime() > now.getTime()
      ) {
        return Object.freeze({ state: 'busy' as const })
      }
      const claimId = this.#claimFactory()
      const claimExpiresAt = new Date(now.getTime() + this.#claimLeaseMs).toISOString()
      if (existing) {
        await tx`
          update fuma_paystack_reconciliations set
            state = 'applying', claim_id = ${claimId}, claim_expires_at = ${claimExpiresAt},
            attempt_count = attempt_count + 1, updated_at = ${now.toISOString()}
          where scope = ${this.scope} and reference = ${identity.reference} and purpose = ${identity.purpose}
        `
      } else {
        await tx`
          insert into fuma_paystack_reconciliations (
            scope, reference, purpose, provider_transaction_id, amount_minor, currency,
            metadata_sha256, state, claim_id, claim_expires_at, attempt_count,
            created_at, updated_at
          ) values (
            ${this.scope}, ${identity.reference}, ${identity.purpose},
            ${identity.providerTransactionId}, ${identity.money.amountMinor},
            ${identity.money.currency}, ${identity.metadataHash}, 'applying',
            ${claimId}, ${claimExpiresAt}, 1, ${now.toISOString()}, ${now.toISOString()}
          )
        `
      }
      return Object.freeze({
        state: 'claimed' as const,
        claim: Object.freeze({ ...identity, claimId }),
      })
    })
  }

  completeSettlement(claim: PaystackSettlementClaim): Promise<void> {
    return this.#db.transaction(async (tx) => {
      const selected = await tx<ReconciliationRow>`
        select reference, purpose, provider_transaction_id, amount_minor, currency,
          metadata_sha256, state, claim_id, claim_expires_at
        from fuma_paystack_reconciliations
        where scope = ${this.scope} and reference = ${claim.reference} and purpose = ${claim.purpose}
        for update
      `
      const current = selected.rows[0]
      if (
        !current
        || current.state !== 'applying'
        || current.claim_id !== claim.claimId
        || !sameReconciliation(current, claim)
      ) {
        throw new PaystackError('duplicate', 'Payment settlement claim is stale or mismatched.')
      }
      const finalRows = await tx<SettlementRow>`
        select reference, purpose, provider_transaction_id, amount_minor, currency
        from fuma_paystack_settlements
        where scope = ${this.scope} and (
          (reference = ${claim.reference} and purpose = ${claim.purpose})
          or provider_transaction_id = ${claim.providerTransactionId}
        )
        for update
      `
      if (finalRows.rows.some((row) => !sameSettlement(row, claim))) {
        throw new PaystackError('duplicate', 'Provider transaction is already reconciled to another obligation.')
      }
      if (finalRows.rows.length === 0) {
        await tx`
          insert into fuma_paystack_settlements (
            scope, reference, purpose, provider_transaction_id, amount_minor, currency, settled_at
          ) values (
            ${this.scope}, ${claim.reference}, ${claim.purpose}, ${claim.providerTransactionId},
            ${claim.money.amountMinor}, ${claim.money.currency}, ${this.#now().toISOString()}
          )
        `
      }
      await tx`
        update fuma_paystack_reconciliations set
          state = 'settled', claim_id = null, claim_expires_at = null,
          reconciled_at = ${this.#now().toISOString()}, updated_at = ${this.#now().toISOString()}
        where scope = ${this.scope} and reference = ${claim.reference}
          and purpose = ${claim.purpose} and claim_id = ${claim.claimId}
      `
    })
  }

  async releaseSettlement(claim: PaystackSettlementClaim): Promise<void> {
    const released = await this.#db`
      update fuma_paystack_reconciliations set
        state = 'pending', claim_id = null, claim_expires_at = null,
        updated_at = ${this.#now().toISOString()}
      where scope = ${this.scope} and reference = ${claim.reference}
        and purpose = ${claim.purpose} and provider_transaction_id = ${claim.providerTransactionId}
        and amount_minor = ${claim.money.amountMinor} and currency = ${claim.money.currency}
        and metadata_sha256 = ${claim.metadataHash} and state = 'applying'
        and claim_id = ${claim.claimId}
    `
    if (released.rowCount !== 1) {
      throw new PaystackError('duplicate', 'Payment settlement claim is stale or mismatched.')
    }
  }
}

export type PostgresPaystackLedgerOptions = Readonly<{
  now?: () => Date
  claimFactory?: () => string
  claimLeaseMs?: number
}>

export class PostgresPaystackLedger implements PaystackLedgerRepository {
  readonly #db: DbClient
  readonly #now: () => Date
  readonly #claimFactory: () => string
  readonly #claimLeaseMs: number
  readonly #scopes = new Map<PaystackScope, ScopedPaystackLedger>()

  constructor(db: DbClient, options: PostgresPaystackLedgerOptions = {}) {
    if (db.dialect !== 'postgres') {
      throw new Error('Fuma Paystack ledger requires PostgreSQL authority.')
    }
    const claimLeaseMs = options.claimLeaseMs ?? 30_000
    if (!Number.isSafeInteger(claimLeaseMs) || claimLeaseMs < 1_000 || claimLeaseMs > 300_000) {
      throw new TypeError('Paystack reconciliation claim lease must be between 1 and 300 seconds.')
    }
    this.#db = db
    this.#now = options.now ?? (() => new Date())
    this.#claimFactory = options.claimFactory ?? (() => crypto.randomUUID())
    this.#claimLeaseMs = claimLeaseMs
  }

  forScope(scope: PaystackScope): ScopedPaystackLedger {
    if (!Value.Check(PaystackScopeSchema, scope)) {
      throw new PaystackError('scope-crossing', 'Paystack ledger scope is invalid.')
    }
    const existing = this.#scopes.get(scope)
    if (existing) return existing
    const bound = new BoundPostgresPaystackLedger(
      this.#db,
      scope,
      this.#now,
      this.#claimFactory,
      this.#claimLeaseMs,
    )
    this.#scopes.set(scope, bound)
    return bound
  }
}
