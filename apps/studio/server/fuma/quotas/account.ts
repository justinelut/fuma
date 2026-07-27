import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import {
  QUOTA_CLASSES,
  QuotaSelfServiceSchema,
  TopUpRequestSchema,
  type DunningAccount,
  type QuotaSelfService,
  type QuotaSource,
  type TopUpRequest,
} from './contracts'
import { QuotaError, type QuotaService } from './service'

type NoticeRow = Readonly<{
  organization_id: string
  quota_class: (typeof QUOTA_CLASSES)[number]
  threshold: 50 | 75 | 90 | 100
  used_units: string | number
  limit_units: string | number
  emitted_at: Date | string
}>
type AccountRow = Readonly<{
  organization_id: string
  contract_id: string
  source: 'public-contract' | 'private-contract'
  payment_state: DunningAccount['paymentState']
  grace_ends_at: Date | string | null
  cancellation_requested_at: Date | string | null
  version: string | number
  updated_at: Date | string
}>
type ContractRow = Readonly<{
  contract_id: string
  source_kind: 'public-plan' | 'private-offer'
  source_id: string
  source_version: string
  cadence: 'monthly' | 'annual'
  state: 'active' | 'paid-transfer-pending'
  activated_at: Date | string
}>
type InvoiceRow = Readonly<{
  checkout_id: string
  contract_id: string
  kind: 'setup' | 'recurring'
  amount_minor: string | number
  currency: 'KES'
  created_at: Date | string
  settled_at: Date | string | null
  provider_transaction_id: string | null
}>
type AdjustmentRow = Readonly<{
  adjustment_id: string
  quota_class: (typeof QUOTA_CLASSES)[number]
  units: string | number
  kind: 'top-up' | 'overage' | 'grant' | 'promotion' | 'grace'
  effective_at: Date | string
  expires_at: Date | string
  approved_by: string
  state: 'active' | 'expired' | 'revoked'
}>

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function units(value: string | number, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new QuotaError('invalid', `Stored ${label} is invalid.`)
  return parsed
}

export interface DunningRepository {
  due(at: string): Promise<readonly DunningAccount[]>
  save(account: DunningAccount): Promise<void>
  notify(account: DunningAccount, kind: 'past-due' | 'grace-expiring' | 'cancelled'): Promise<void>
}

export class DunningJobService {
  readonly #repository: DunningRepository
  readonly #now: () => Date

  constructor(repository: DunningRepository, now: () => Date = () => new Date()) {
    this.#repository = repository
    this.#now = now
  }

  async run(): Promise<Readonly<{ transitioned: number; notified: number }>> {
    const instant = this.#now()
    let transitioned = 0
    let notified = 0
    for (const account of await this.#repository.due(instant.toISOString())) {
      if (account.source === 'platform-internal'
        || account.paymentState === 'current'
        || account.paymentState === 'cancelled') continue
      if (account.paymentState === 'past-due') {
        const next = Object.freeze({
          ...account,
          paymentState: 'grace' as const,
          graceEndsAt: new Date(instant.getTime() + 7 * 86_400_000).toISOString(),
        })
        await this.#repository.save(next)
        await this.#repository.notify(next, 'past-due')
        transitioned += 1
        notified += 1
      } else if (account.graceEndsAt && Date.parse(account.graceEndsAt) <= instant.getTime()) {
        const next = Object.freeze({
          ...account,
          paymentState: 'cancelled' as const,
          graceEndsAt: null,
        })
        await this.#repository.save(next)
        await this.#repository.notify(next, 'cancelled')
        transitioned += 1
        notified += 1
      } else {
        await this.#repository.notify(account, 'grace-expiring')
        notified += 1
      }
    }
    return Object.freeze({ transitioned, notified })
  }
}

export class PostgresQuotaAccountRepository implements DunningRepository {
  readonly #db: DbClient
  readonly #quota: QuotaService
  readonly #now: () => Date

  constructor(db: DbClient, quota: QuotaService, now: () => Date = () => new Date()) {
    if (db.dialect !== 'postgres') throw new TypeError('Quota self-service requires PostgreSQL authority.')
    this.#db = db
    this.#quota = quota
    this.#now = now
  }

  async selfService(organizationId: string): Promise<QuotaSelfService> {
    const state = await this.#quota.state(organizationId)
    const notices = await this.#db<NoticeRow>`
      select organization_id,quota_class,threshold,used_units,limit_units,emitted_at
      from fuma_quota_notices_v2 where organization_id=${organizationId}
      order by emitted_at desc,quota_class,threshold
    `
    const base = {
      organizationId,
      source: state.source,
      sourceId: state.sourceId ?? 'unknown',
      sourceVersion: state.sourceVersion ?? 'unknown',
      usage: QUOTA_CLASSES.map((quotaClass) => {
        const limit = state.limits[quotaClass]
        const topUp = state.topUps[quotaClass]
        const used = state.used[quotaClass]
        const reserved = state.reserved[quotaClass]
        const effective = limit + topUp
        return {
          quotaClass,
          limit,
          used,
          reserved,
          topUp,
          remaining: Math.max(0, effective - used - reserved),
          percent: Math.min(100, Math.floor(((used + reserved) * 100) / effective)),
        }
      }),
      notices: notices.rows.map((row) => ({
        organizationId: row.organization_id,
        quotaClass: row.quota_class,
        percent: row.threshold,
        used: units(row.used_units, 'notice usage'),
        limit: units(row.limit_units, 'notice limit'),
        emittedAt: iso(row.emitted_at),
      })),
    }
    if (state.source === 'platform-internal') {
      const parsed = safeParseValue(QuotaSelfServiceSchema, { ...base, billing: null })
      if (!parsed.ok) throw new QuotaError('invalid', 'Internal usage projection failed validation.')
      return Object.freeze(parsed.value)
    }

    const [accounts, contracts, invoices, adjustments] = await Promise.all([
      this.#db<AccountRow>`
        select organization_id,contract_id,source,payment_state,grace_ends_at,
          cancellation_requested_at,version,updated_at
        from fuma_billing_accounts_v2 where organization_id=${organizationId}
      `,
      this.#db<ContractRow>`
        select contract_id,source_kind,source_id,source_version,cadence,state,activated_at
        from fuma_organization_contracts where organization_id=${organizationId}
          and state in ('active','paid-transfer-pending') and checkout_id is not null
        order by activated_at desc,contract_id desc
      `,
      this.#db<InvoiceRow>`
        select o.checkout_id,c.contract_id,o.kind,o.amount_minor,o.currency,o.created_at,
          o.settled_at,o.provider_transaction_id
        from fuma_platform_checkout_obligations_v2 o
        join fuma_organization_contracts c on c.checkout_id=o.checkout_id
        where c.organization_id=${organizationId}
        order by o.created_at desc,o.kind
      `,
      this.#db<AdjustmentRow>`
        select adjustment_id,quota_class,units,kind,effective_at,expires_at,approved_by,state
        from fuma_entitlement_adjustments where organization_id=${organizationId}
        order by effective_at desc,adjustment_id
      `,
    ])
    const account = accounts.rows[0]
    const billing = {
      account: account ? {
        paymentState: account.payment_state,
        graceEndsAt: account.grace_ends_at ? iso(account.grace_ends_at) : null,
        cancellationRequestedAt: account.cancellation_requested_at
          ? iso(account.cancellation_requested_at)
          : null,
      } : {
        paymentState: 'current' as const,
        graceEndsAt: null,
        cancellationRequestedAt: null,
      },
      contracts: contracts.rows.map((row) => ({
        contractId: row.contract_id,
        source: row.source_kind === 'public-plan' ? 'public-contract' as const : 'private-contract' as const,
        sourceId: row.source_id,
        sourceVersion: row.source_version,
        cadence: row.cadence,
        state: row.state,
        activatedAt: iso(row.activated_at),
      })),
      invoices: invoices.rows.map((row) => ({
        invoiceId: `invoice:${row.checkout_id}:${row.kind}`,
        contractId: row.contract_id,
        kind: row.kind,
        amountMinor: units(row.amount_minor, 'invoice amount'),
        currency: row.currency,
        state: row.settled_at ? 'paid' as const : 'open' as const,
        issuedAt: iso(row.created_at),
        paidAt: row.settled_at ? iso(row.settled_at) : null,
      })),
      transactions: invoices.rows.flatMap((row) => (
        row.provider_transaction_id && row.settled_at ? [{
          transactionId: row.provider_transaction_id,
          invoiceId: `invoice:${row.checkout_id}:${row.kind}`,
          amountMinor: units(row.amount_minor, 'transaction amount'),
          currency: row.currency,
          settledAt: iso(row.settled_at),
        }] : []
      )),
      receipts: invoices.rows.flatMap((row) => (
        row.provider_transaction_id && row.settled_at ? [{
          receiptId: `receipt:${row.provider_transaction_id}`,
          transactionId: row.provider_transaction_id,
          issuedAt: iso(row.settled_at),
        }] : []
      )),
      adjustments: adjustments.rows.map((row) => ({
        adjustmentId: row.adjustment_id,
        quotaClass: row.quota_class,
        units: units(row.units, 'adjustment units'),
        kind: row.kind,
        state: row.state,
        effectiveAt: iso(row.effective_at),
        expiresAt: iso(row.expires_at),
        approvedBy: row.approved_by,
      })),
      actions: {
        planChanges: true as const,
        cancellation: account !== undefined && account.payment_state !== 'cancelled',
        topUpRequest: true as const,
      },
    }
    const parsed = safeParseValue(QuotaSelfServiceSchema, { ...base, billing })
    if (!parsed.ok) throw new QuotaError('invalid', 'Customer usage and billing projection failed validation.')
    return Object.freeze(parsed.value)
  }

  async requestTopUp(
    organizationId: string,
    actorId: string,
    raw: unknown,
  ): Promise<Readonly<{ requestId: string; state: 'requested' }>> {
    const parsed = safeParseValue(TopUpRequestSchema, raw)
    if (!parsed.ok) throw new QuotaError('invalid', 'Top-up request is invalid.')
    const input = Object.freeze(parsed.value) as TopUpRequest
    const state = await this.#quota.state(organizationId)
    if (state.source === 'platform-internal') {
      throw new QuotaError('invalid', 'Protected internal usage does not expose billing or top-up requests.')
    }
    await this.#db`
      insert into fuma_quota_topup_requests_v2 (
        idempotency_key,organization_id,quota_class,units,reason,requested_by,
        state,requested_at,decided_at
      ) values (
        ${input.idempotencyKey},${organizationId},${input.quotaClass},${input.units},
        ${input.reason},${actorId},'requested',${this.#now().toISOString()},null
      ) on conflict (idempotency_key) do nothing
    `
    const exact = await this.#db<Readonly<{
      organization_id: string
      quota_class: string
      units: string | number
      reason: string
      requested_by: string
      state: string
    }>>`
      select organization_id,quota_class,units,reason,requested_by,state
      from fuma_quota_topup_requests_v2 where idempotency_key=${input.idempotencyKey}
    `
    const row = exact.rows[0]
    if (!row || row.organization_id !== organizationId || row.quota_class !== input.quotaClass
      || units(row.units, 'top-up request') !== input.units || row.reason !== input.reason
      || row.requested_by !== actorId || row.state !== 'requested') {
      throw new QuotaError('conflict', 'Top-up request identity changed on replay.')
    }
    return Object.freeze({ requestId: input.idempotencyKey, state: 'requested' })
  }

  async requestCancellation(organizationId: string, actorId: string): Promise<void> {
    const state = await this.#quota.state(organizationId)
    if (!['public-contract', 'private-contract'].includes(state.source)) {
      throw new QuotaError('invalid', 'Only customer contracts expose cancellation.')
    }
    await this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:billing-account:${organizationId}`},0))`
      const found = await tx<AccountRow>`
        select organization_id,contract_id,source,payment_state,grace_ends_at,
          cancellation_requested_at,version,updated_at
        from fuma_billing_accounts_v2 where organization_id=${organizationId} for update
      `
      const account = found.rows[0]
      if (!account) throw new QuotaError('unverified-contract', 'Customer billing account is unavailable.')
      if (account.cancellation_requested_at) return
      const now = this.#now().toISOString()
      await tx`
        update fuma_billing_accounts_v2 set cancellation_requested_at=${now},
          version=version+1,updated_at=${now} where organization_id=${organizationId}
      `
      await tx`
        insert into fuma_billing_account_transitions_v2 (
          transition_id,organization_id,contract_id,from_state,to_state,reason,occurred_at
        ) values (
          ${`billing-transition:${account.contract_id}:cancel-request:${actorId}`},${organizationId},
          ${account.contract_id},${account.payment_state},${account.payment_state},
          'customer-cancellation-requested',${now}
        ) on conflict (transition_id) do nothing
      `
    })
  }

  async markPastDue(organizationId: string, contractId: string): Promise<void> {
    await this.#transition(organizationId, contractId, 'past-due', 'provider-past-due')
  }

  async recordVerifiedPayment(organizationId: string, contractId: string): Promise<void> {
    await this.#transition(organizationId, contractId, 'current', 'verified-payment')
  }

  async #transition(
    organizationId: string,
    contractId: string,
    next: 'current' | 'past-due',
    reason: 'provider-past-due' | 'verified-payment',
  ): Promise<void> {
    await this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:billing-account:${organizationId}`},0))`
      const found = await tx<AccountRow>`
        select organization_id,contract_id,source,payment_state,grace_ends_at,
          cancellation_requested_at,version,updated_at
        from fuma_billing_accounts_v2 where organization_id=${organizationId} for update
      `
      const account = found.rows[0]
      if (!account || account.contract_id !== contractId) {
        throw new QuotaError('unverified-contract', 'Payment transition requires the current verified contract.')
      }
      if (account.payment_state === next) return
      const now = this.#now().toISOString()
      const version = units(account.version, 'billing account version') + 1
      await tx`
        update fuma_billing_accounts_v2 set payment_state=${next},grace_ends_at=null,
          version=${version},updated_at=${now} where organization_id=${organizationId}
      `
      await tx`
        insert into fuma_billing_account_transitions_v2 (
          transition_id,organization_id,contract_id,from_state,to_state,reason,occurred_at
        ) values (
          ${`billing-transition:${contractId}:${version}:${next}`},${organizationId},${contractId},
          ${account.payment_state},${next},${reason},${now}
        )
      `
    })
  }

  async due(_at: string): Promise<readonly DunningAccount[]> {
    const result = await this.#db<AccountRow>`
      select organization_id,contract_id,source,payment_state,grace_ends_at,
        cancellation_requested_at,version,updated_at
      from fuma_billing_accounts_v2 where payment_state in ('past-due','grace')
      order by organization_id
    `
    return Object.freeze(result.rows.map((row) => Object.freeze({
      organizationId: row.organization_id,
      source: row.source,
      paymentState: row.payment_state,
      graceEndsAt: row.grace_ends_at ? iso(row.grace_ends_at) : null,
      version: units(row.version, 'billing account version'),
    })))
  }

  async save(account: DunningAccount): Promise<void> {
    if (account.source === 'platform-internal') return
    await this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:billing-account:${account.organizationId}`},0))`
      const found = await tx<AccountRow>`
        select organization_id,contract_id,source,payment_state,grace_ends_at,
          cancellation_requested_at,version,updated_at
        from fuma_billing_accounts_v2 where organization_id=${account.organizationId} for update
      `
      const prior = found.rows[0]
      if (!prior) throw new QuotaError('unverified-contract', 'Dunning account is unavailable.')
      if (prior.payment_state === account.paymentState
        && (prior.grace_ends_at ? iso(prior.grace_ends_at) : null) === account.graceEndsAt) return
      const allowed = (prior.payment_state === 'past-due' && account.paymentState === 'grace')
        || (prior.payment_state === 'grace' && account.paymentState === 'cancelled')
      if (!allowed) throw new QuotaError('conflict', 'Dunning transition is invalid or stale.')
      const now = this.#now().toISOString()
      const version = units(prior.version, 'billing account version') + 1
      await tx`
        update fuma_billing_accounts_v2 set payment_state=${account.paymentState},
          grace_ends_at=${account.graceEndsAt},version=${version},updated_at=${now}
        where organization_id=${account.organizationId}
      `
      await tx`
        insert into fuma_billing_account_transitions_v2 (
          transition_id,organization_id,contract_id,from_state,to_state,reason,occurred_at
        ) values (
          ${`billing-transition:${prior.contract_id}:${version}:${account.paymentState}`},
          ${account.organizationId},${prior.contract_id},${prior.payment_state},
          ${account.paymentState},${account.paymentState === 'grace' ? 'grace-started' : 'grace-expired'},${now}
        )
      `
    })
  }

  async notify(
    account: DunningAccount,
    kind: 'past-due' | 'grace-expiring' | 'cancelled',
  ): Promise<void> {
    await this.#db`
      insert into fuma_billing_dunning_notices_v2 (
        organization_id,account_version,kind,emitted_at
      ) values (
        ${account.organizationId},${account.version ?? 1},${kind},${this.#now().toISOString()}
      ) on conflict do nothing
    `
  }
}

export type { QuotaSource }
