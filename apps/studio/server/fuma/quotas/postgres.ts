import type { DbClient } from '../../db/client'
import { evidenceSha256 } from '../entitlements'
import {
  QUOTA_CLASSES,
  type QuotaActualObservation,
  type QuotaClass,
  type QuotaNotice,
  type QuotaReservation,
  type QuotaReservationResult,
  type QuotaSettlement,
  type QuotaState,
  type QuotaUsageEnvelope,
  type VerifiedQuotaSource,
} from './contracts'
import { QuotaError, type QuotaRepository } from './service'
import { resolveVerifiedQuotaSource } from './source'

type BalanceRow = Readonly<{
  quota_class: QuotaClass
  entitlement_snapshot_id: string
  window_key: string
  limit_units: string | number
  used_units: string | number
  reserved_units: string | number
}>
type AdjustmentRow = Readonly<{
  quota_class: QuotaClass
  units: string | number
}>
type ReservationRow = Readonly<{
  idempotency_key: string
  organization_id: string
  request_sha256: string
  settlement_sha256: string | null
  state: 'reserved' | 'settled' | 'released'
}>
type ReservationItemRow = Readonly<{
  quota_class: QuotaClass
  window_key: string
  reserved_units: string | number
  actual_units: string | number | null
}>
type NoticeRow = Readonly<{
  organization_id: string
  quota_class: QuotaClass
  threshold: 50 | 75 | 90 | 100
  used_units: string | number
  limit_units: string | number
  emitted_at: Date | string
}>
type AccountRow = Readonly<{
  contract_id: string
  payment_state: 'current' | 'past-due' | 'grace' | 'cancelled'
}>

const THRESHOLDS = [50, 75, 90, 100] as const
const MONTHLY_CLASSES = new Set<QuotaClass>([
  'bandwidthBytes',
  'emailRecipientsMonth',
  'buildPublishMinutes',
  'pluginComputeMinutes',
  'aiCredits',
])

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function units(value: number | string, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new QuotaError('invalid', `Stored ${label} is invalid.`)
  }
  return parsed
}

function usage(values: ReadonlyMap<QuotaClass, number>): QuotaUsageEnvelope {
  return Object.freeze(Object.fromEntries(QUOTA_CLASSES.map((quotaClass) => [
    quotaClass,
    values.get(quotaClass) ?? 0,
  ])) as unknown as QuotaUsageEnvelope)
}

function windowKey(quotaClass: QuotaClass, at: string): string {
  const instant = new Date(at)
  if (!Number.isFinite(instant.getTime())) throw new QuotaError('invalid', 'Quota window time is invalid.')
  const day = instant.toISOString().slice(0, 10)
  if (quotaClass === 'emailRecipientsDay') return `day:${day}`
  if (MONTHLY_CLASSES.has(quotaClass)) return `month:${day.slice(0, 7)}`
  return 'current'
}

function crossed(before: number, after: number, limit: number): readonly (typeof THRESHOLDS)[number][] {
  return THRESHOLDS.filter((threshold) => (
    (before * 100) / limit < threshold && (after * 100) / limit >= threshold
  ))
}

function exactItems(
  items: readonly Readonly<{ quotaClass: QuotaClass; units: number }>[],
  label: string,
): void {
  if (new Set(items.map(({ quotaClass }) => quotaClass)).size !== items.length) {
    throw new QuotaError('invalid', `${label} contains duplicate quota classes.`)
  }
}

export type PostgresQuotaRepositoryOptions = Readonly<{ now?: () => Date }>

export class PostgresQuotaRepository implements QuotaRepository {
  readonly #db: DbClient
  readonly #now: () => Date

  constructor(db: DbClient, options: PostgresQuotaRepositoryOptions = {}) {
    if (db.dialect !== 'postgres') throw new TypeError('Quota enforcement requires PostgreSQL authority.')
    this.#db = db
    this.#now = options.now ?? (() => new Date())
  }

  async #ensureAccount(tx: DbClient, source: VerifiedQuotaSource, now: string): Promise<void> {
    if (!source.contractId || source.source === 'platform-internal' || source.source === 'grandfathered') return
    const found = await tx<AccountRow>`
      select contract_id,payment_state from fuma_billing_accounts_v2
      where organization_id=${source.organizationId} for update
    `
    const account = found.rows[0]
    if (!account) {
      await tx`
        insert into fuma_billing_accounts_v2 (
          organization_id,contract_id,source,payment_state,grace_ends_at,
          cancellation_requested_at,version,updated_at
        ) values (
          ${source.organizationId},${source.contractId},${source.source},'current',null,null,1,${now}
        )
      `
      await tx`
        insert into fuma_billing_account_transitions_v2 (
          transition_id,organization_id,contract_id,from_state,to_state,reason,occurred_at
        ) values (
          ${`billing-transition:${source.contractId}:activated`},${source.organizationId},
          ${source.contractId},null,'current','contract-activated',${now}
        ) on conflict (transition_id) do nothing
      `
    } else if (account.contract_id !== source.contractId) {
      const updated = await tx`
        update fuma_billing_accounts_v2 set contract_id=${source.contractId},source=${source.source},
          payment_state='current',grace_ends_at=null,cancellation_requested_at=null,
          version=version+1,updated_at=${now}
        where organization_id=${source.organizationId} and contract_id=${account.contract_id}
      `
      if (updated.rowCount !== 1) throw new QuotaError('conflict', 'Billing account plan change lost serialization.')
      await tx`
        insert into fuma_billing_account_transitions_v2 (
          transition_id,organization_id,contract_id,from_state,to_state,reason,occurred_at
        ) values (
          ${`billing-transition:${source.contractId}:activated`},${source.organizationId},
          ${source.contractId},${account.payment_state},'current','contract-activated',${now}
        ) on conflict (transition_id) do nothing
      `
    }
  }

  async #sync(
    tx: DbClient,
    organizationId: string,
    enforcePayment: boolean,
  ): Promise<Readonly<{ source: VerifiedQuotaSource; state: QuotaState }>> {
    const now = this.#now().toISOString()
    const source = await resolveVerifiedQuotaSource(tx, organizationId, now)
    await tx`
      insert into fuma_quota_entitlement_snapshots_v2 (
        snapshot_id,organization_id,source,source_id,source_version,contract_id,
        quota_json,evidence_sha256,activated_at,created_at
      ) values (
        ${source.entitlementSnapshotId},${organizationId},${source.source},${source.sourceId},
        ${source.sourceVersion},${source.contractId},${JSON.stringify(source.quotas)}::text::jsonb,
        ${source.evidenceSha256},${source.activatedAt},${now}
      ) on conflict (snapshot_id) do nothing
    `
    const exact = await tx<Readonly<{
      organization_id: string
      evidence_sha256: string
    }>>`
      select organization_id,evidence_sha256 from fuma_quota_entitlement_snapshots_v2
      where snapshot_id=${source.entitlementSnapshotId}
    `
    if (exact.rows[0]?.organization_id !== organizationId
      || exact.rows[0]?.evidence_sha256 !== source.evidenceSha256) {
      throw new QuotaError('conflict', 'Quota entitlement binding changed on replay.')
    }
    await tx`
      insert into fuma_quota_entitlement_bindings_v2 (
        organization_id,snapshot_id,source,source_id,source_version,activated_at,bound_at
      ) values (
        ${organizationId},${source.entitlementSnapshotId},${source.source},${source.sourceId},
        ${source.sourceVersion},${source.activatedAt},${now}
      ) on conflict (organization_id) do update set
        snapshot_id=excluded.snapshot_id,source=excluded.source,source_id=excluded.source_id,
        source_version=excluded.source_version,activated_at=excluded.activated_at,
        bound_at=excluded.bound_at
      where fuma_quota_entitlement_bindings_v2.activated_at<=excluded.activated_at
    `
    for (const quotaClass of QUOTA_CLASSES) {
      const currentWindow = windowKey(quotaClass, now)
      await tx`
        insert into fuma_quota_balances_v2 (
          organization_id,quota_class,entitlement_snapshot_id,window_key,limit_units,
          used_units,reserved_units,version,updated_at
        ) values (
          ${organizationId},${quotaClass},${source.entitlementSnapshotId},${currentWindow},
          ${source.quotas[quotaClass]},0,0,1,${now}
        ) on conflict (organization_id,quota_class) do update set
          entitlement_snapshot_id=excluded.entitlement_snapshot_id,
          window_key=excluded.window_key,
          limit_units=excluded.limit_units,
          used_units=case
            when fuma_quota_balances_v2.window_key=excluded.window_key
              then fuma_quota_balances_v2.used_units else 0 end,
          reserved_units=case
            when fuma_quota_balances_v2.window_key=excluded.window_key
              then fuma_quota_balances_v2.reserved_units else 0 end,
          version=fuma_quota_balances_v2.version+1,
          updated_at=excluded.updated_at
      `
    }
    await this.#ensureAccount(tx, source, now)
    if (enforcePayment && source.contractId) {
      const result = await tx<AccountRow>`
        select contract_id,payment_state from fuma_billing_accounts_v2
        where organization_id=${organizationId}
      `
      if (result.rows[0]?.payment_state === 'cancelled') {
        throw new QuotaError('payment-required', 'Quota writes require a current verified payment; existing data remains readable and exportable.')
      }
    }
    return Object.freeze({ source, state: await this.#readState(tx, source, now) })
  }

  async #readState(
    db: DbClient,
    source: VerifiedQuotaSource,
    now: string,
  ): Promise<QuotaState> {
    const balances = await db<BalanceRow>`
      select quota_class,entitlement_snapshot_id,window_key,limit_units,used_units,reserved_units
      from fuma_quota_balances_v2 where organization_id=${source.organizationId}
      order by quota_class
    `
    const adjustments = await db<AdjustmentRow>`
      select quota_class,units from fuma_entitlement_adjustments
      where organization_id=${source.organizationId} and state='active'
        and effective_at<=${now} and expires_at>${now}
      order by adjustment_id
    `
    const limits = new Map<QuotaClass, number>()
    const used = new Map<QuotaClass, number>()
    const reserved = new Map<QuotaClass, number>()
    const topUps = new Map<QuotaClass, number>()
    for (const row of balances.rows) {
      limits.set(row.quota_class, units(row.limit_units, 'quota limit'))
      used.set(row.quota_class, units(row.used_units, 'used quota'))
      reserved.set(row.quota_class, units(row.reserved_units, 'reserved quota'))
    }
    for (const row of adjustments.rows) {
      const next = (topUps.get(row.quota_class) ?? 0) + units(row.units, 'quota adjustment')
      if (!Number.isSafeInteger(next)) throw new QuotaError('invalid', 'Effective quota adjustment exceeds safe range.')
      topUps.set(row.quota_class, next)
    }
    if (limits.size !== QUOTA_CLASSES.length) throw new QuotaError('invalid', 'Quota balance coverage is incomplete.')
    return Object.freeze({
      limits: Object.freeze(Object.fromEntries(QUOTA_CLASSES.map((quotaClass) => [
        quotaClass,
        limits.get(quotaClass)!,
      ]))) as QuotaState['limits'],
      used: usage(used),
      reserved: usage(reserved),
      topUps: usage(topUps),
      source: source.source,
      sourceId: source.sourceId,
      sourceVersion: source.sourceVersion,
      entitlementSnapshotId: source.entitlementSnapshotId,
    })
  }

  async #existingReservation(tx: DbClient, idempotencyKey: string): Promise<ReservationRow | null> {
    const result = await tx<ReservationRow>`
      select idempotency_key,organization_id,request_sha256,settlement_sha256,state
      from fuma_quota_reservations_v2 where idempotency_key=${idempotencyKey} for update
    `
    return result.rows[0] ?? null
  }

  async #notices(
    tx: DbClient,
    source: VerifiedQuotaSource,
    quotaClass: QuotaClass,
    window: string,
    before: number,
    after: number,
    limit: number,
    now: string,
  ): Promise<readonly QuotaNotice[]> {
    const emitted: QuotaNotice[] = []
    for (const threshold of crossed(before, after, limit)) {
      const result = await tx<NoticeRow>`
        insert into fuma_quota_notices_v2 (
          organization_id,entitlement_snapshot_id,quota_class,window_key,threshold,
          used_units,limit_units,emitted_at
        ) values (
          ${source.organizationId},${source.entitlementSnapshotId},${quotaClass},${window},
          ${threshold},${after},${limit},${now}
        ) on conflict do nothing
        returning organization_id,quota_class,threshold,used_units,limit_units,emitted_at
      `
      const row = result.rows[0]
      if (row) emitted.push(Object.freeze({
        organizationId: row.organization_id,
        quotaClass: row.quota_class,
        percent: row.threshold,
        used: units(row.used_units, 'notice usage'),
        limit: units(row.limit_units, 'notice limit'),
        emittedAt: iso(row.emitted_at),
      }))
    }
    return Object.freeze(emitted)
  }

  reserve(input: QuotaReservation): Promise<QuotaReservationResult> {
    exactItems(input.items, 'Quota reservation')
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:quota:${input.organizationId}`},0))`
      const requestSha256 = evidenceSha256(input)
      const replay = await this.#existingReservation(tx, input.idempotencyKey)
      if (replay) {
        if (replay.organization_id !== input.organizationId || replay.request_sha256 !== requestSha256) {
          throw new QuotaError('conflict', 'Quota reservation identity changed on replay.')
        }
        return Object.freeze({ duplicate: true, notice: null, notices: Object.freeze([]) })
      }
      if ((input.workspaceId === null) !== (input.siteId === null)) {
        throw new QuotaError('invalid', 'Quota reservation requires both workspace and site coordinates or neither.')
      }
      if (input.workspaceId && input.siteId) {
        const destination = await tx<{ authorized: number }>`
          select 1 as authorized from fuma_workspaces w
          join fuma_sites s on s.organization_id=w.organization_id and s.workspace_id=w.id
          where w.organization_id=${input.organizationId} and w.id=${input.workspaceId}
            and w.status='active' and s.id=${input.siteId} and s.status='active'
          for share of w,s
        `
        if (!destination.rows[0]) throw new QuotaError('invalid', 'Quota reservation scope authority denied.')
      }
      const { source, state } = await this.#sync(tx, input.organizationId, true)
      const now = this.#now().toISOString()
      const balances = await tx<BalanceRow>`
        select quota_class,entitlement_snapshot_id,window_key,limit_units,used_units,reserved_units
        from fuma_quota_balances_v2 where organization_id=${input.organizationId} for update
      `
      const byClass = new Map(balances.rows.map((row) => [row.quota_class, row]))
      const pending: Array<Readonly<{
        item: QuotaReservation['items'][number]
        row: BalanceRow
        before: number
        after: number
        limit: number
      }>> = []
      for (const item of input.items) {
        const row = byClass.get(item.quotaClass)
        if (!row) throw new QuotaError('invalid', 'Quota balance is unavailable.')
        const before = units(row.used_units, 'used quota') + units(row.reserved_units, 'reserved quota')
        const limit = state.limits[item.quotaClass] + state.topUps[item.quotaClass]
        const after = before + item.units
        if (!Number.isSafeInteger(after) || after > limit) {
          throw new QuotaError('exhausted', `Quota ${item.quotaClass} exhausted; existing data remains readable and exportable.`)
        }
        pending.push(Object.freeze({ item, row, before, after, limit }))
      }
      await tx`
        insert into fuma_quota_reservations_v2 (
          idempotency_key,organization_id,workspace_id,site_id,operation,
          entitlement_snapshot_id,request_sha256,settlement_sha256,state,created_at,resolved_at
        ) values (
          ${input.idempotencyKey},${input.organizationId},${input.workspaceId},${input.siteId},
          ${input.operation},${source.entitlementSnapshotId},${requestSha256},null,'reserved',${now},null
        )
      `
      const emitted: QuotaNotice[] = []
      for (const item of pending) {
        await tx`
          insert into fuma_quota_reservation_items_v2 (
            idempotency_key,quota_class,window_key,reserved_units,actual_units
          ) values (
            ${input.idempotencyKey},${item.item.quotaClass},${item.row.window_key},
            ${item.item.units},null
          )
        `
        const updated = await tx`
          update fuma_quota_balances_v2 set reserved_units=reserved_units+${item.item.units},
            version=version+1,updated_at=${now}
          where organization_id=${input.organizationId} and quota_class=${item.item.quotaClass}
            and window_key=${item.row.window_key}
        `
        if (updated.rowCount !== 1) throw new QuotaError('conflict', 'Quota reservation lost its balance window.')
        emitted.push(...await this.#notices(
          tx,
          source,
          item.item.quotaClass,
          item.row.window_key,
          item.before,
          item.after,
          item.limit,
          now,
        ))
      }
      return Object.freeze({
        duplicate: false,
        notice: emitted.at(-1) ?? null,
        notices: Object.freeze(emitted),
      })
    })
  }

  settle(input: QuotaSettlement): Promise<Readonly<{ duplicate: boolean }>> {
    exactItems(input.actual, 'Quota settlement')
    return this.#db.transaction(async (tx) => {
      const initial = await tx<ReservationRow>`
        select idempotency_key,organization_id,request_sha256,settlement_sha256,state
        from fuma_quota_reservations_v2 where idempotency_key=${input.idempotencyKey}
      `
      if (!initial.rows[0]) throw new QuotaError('invalid', 'Quota reservation does not exist.')
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:quota:${initial.rows[0].organization_id}`},0))`
      const reservation = await this.#existingReservation(tx, input.idempotencyKey)
      if (!reservation) throw new QuotaError('conflict', 'Quota reservation disappeared.')
      const settlementSha256 = evidenceSha256(input)
      if (reservation.state === 'settled') {
        if (reservation.settlement_sha256 !== settlementSha256) {
          throw new QuotaError('conflict', 'Quota settlement identity changed on replay.')
        }
        return Object.freeze({ duplicate: true })
      }
      if (reservation.state !== 'reserved') throw new QuotaError('conflict', 'Released quota cannot be settled.')
      const rows = await tx<ReservationItemRow>`
        select quota_class,window_key,reserved_units,actual_units
        from fuma_quota_reservation_items_v2
        where idempotency_key=${input.idempotencyKey} order by quota_class for update
      `
      const actual = new Map(input.actual.map((item) => [item.quotaClass, item.units]))
      if (actual.size !== rows.rows.length || rows.rows.some((row) => !actual.has(row.quota_class))) {
        throw new QuotaError('invalid', 'Settlement must reconcile every reserved quota class exactly once.')
      }
      const now = this.#now().toISOString()
      for (const row of rows.rows) {
        const reservedUnits = units(row.reserved_units, 'reservation units')
        const actualUnits = actual.get(row.quota_class)!
        if (actualUnits > reservedUnits) throw new QuotaError('invalid', 'Actual quota use exceeds its exact reservation.')
        const balance = await tx<BalanceRow>`
          select quota_class,entitlement_snapshot_id,window_key,limit_units,used_units,reserved_units
          from fuma_quota_balances_v2
          where organization_id=${reservation.organization_id} and quota_class=${row.quota_class}
          for update
        `
        const current = balance.rows[0]
        if (current?.window_key === row.window_key) {
          if (units(current.reserved_units, 'reserved quota') < reservedUnits) {
            throw new QuotaError('conflict', 'Exact quota reservation is no longer outstanding.')
          }
          await tx`
            update fuma_quota_balances_v2
            set reserved_units=reserved_units-${reservedUnits},used_units=used_units+${actualUnits},
              version=version+1,updated_at=${now}
            where organization_id=${reservation.organization_id} and quota_class=${row.quota_class}
          `
        }
        await tx`
          update fuma_quota_reservation_items_v2 set actual_units=${actualUnits}
          where idempotency_key=${input.idempotencyKey} and quota_class=${row.quota_class}
        `
      }
      const updated = await tx`
        update fuma_quota_reservations_v2 set state='settled',settlement_sha256=${settlementSha256},
          resolved_at=${now}
        where idempotency_key=${input.idempotencyKey} and state='reserved'
      `
      if (updated.rowCount !== 1) throw new QuotaError('conflict', 'Quota settlement lost its reservation.')
      return Object.freeze({ duplicate: false })
    })
  }

  release(idempotencyKey: string): Promise<Readonly<{ duplicate: boolean }>> {
    return this.#db.transaction(async (tx) => {
      const initial = await tx<ReservationRow>`
        select idempotency_key,organization_id,request_sha256,settlement_sha256,state
        from fuma_quota_reservations_v2 where idempotency_key=${idempotencyKey}
      `
      if (!initial.rows[0]) throw new QuotaError('invalid', 'Quota reservation does not exist.')
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:quota:${initial.rows[0].organization_id}`},0))`
      const reservation = await this.#existingReservation(tx, idempotencyKey)
      if (!reservation) throw new QuotaError('conflict', 'Quota reservation disappeared.')
      if (reservation.state === 'released') return Object.freeze({ duplicate: true })
      if (reservation.state !== 'reserved') throw new QuotaError('conflict', 'Settled quota cannot be released.')
      const rows = await tx<ReservationItemRow>`
        select quota_class,window_key,reserved_units,actual_units
        from fuma_quota_reservation_items_v2 where idempotency_key=${idempotencyKey} for update
      `
      const now = this.#now().toISOString()
      for (const row of rows.rows) {
        const reservedUnits = units(row.reserved_units, 'reservation units')
        const updated = await tx`
          update fuma_quota_balances_v2 set reserved_units=reserved_units-${reservedUnits},
            version=version+1,updated_at=${now}
          where organization_id=${reservation.organization_id} and quota_class=${row.quota_class}
            and window_key=${row.window_key} and reserved_units>=${reservedUnits}
        `
        if (updated.rowCount > 1) throw new QuotaError('conflict', 'Quota release crossed balance authority.')
      }
      const updated = await tx`
        update fuma_quota_reservations_v2 set state='released',resolved_at=${now}
        where idempotency_key=${idempotencyKey} and state='reserved'
      `
      if (updated.rowCount !== 1) throw new QuotaError('conflict', 'Quota release lost its reservation.')
      return Object.freeze({ duplicate: false })
    })
  }

  state(organizationId: string): Promise<QuotaState> {
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:quota:${organizationId}`},0))`
      return (await this.#sync(tx, organizationId, false)).state
    })
  }

  observe(input: QuotaActualObservation): Promise<Readonly<{
    duplicate: boolean
    notices: readonly QuotaNotice[]
  }>> {
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:quota:${input.organizationId}`},0))`
      const observationSha256 = evidenceSha256(input)
      const replay = await tx<Readonly<{ observation_sha256: string }>>`
        select observation_sha256 from fuma_quota_usage_observations_v2
        where idempotency_key=${input.idempotencyKey}
      `
      if (replay.rows[0]) {
        if (replay.rows[0].observation_sha256 !== observationSha256) {
          throw new QuotaError('conflict', 'Quota usage observation changed on replay.')
        }
        return Object.freeze({ duplicate: true, notices: Object.freeze([]) })
      }
      const { source, state } = await this.#sync(tx, input.organizationId, false)
      const now = this.#now().toISOString()
      const latest = await tx<Readonly<{ observed_at: Date | string }>>`
        select observed_at from fuma_quota_usage_observations_v2
        where organization_id=${input.organizationId}
        order by observed_at desc,idempotency_key desc limit 1
      `
      await tx`
        insert into fuma_quota_usage_observations_v2 (
          idempotency_key,organization_id,entitlement_snapshot_id,source,usage_json,
          observation_sha256,observed_at,created_at
        ) values (
          ${input.idempotencyKey},${input.organizationId},${source.entitlementSnapshotId},
          ${input.source},${JSON.stringify(input.usage)}::text::jsonb,${observationSha256},
          ${input.observedAt},${now}
        )
      `
      if (latest.rows[0] && Date.parse(iso(latest.rows[0].observed_at)) > Date.parse(input.observedAt)) {
        return Object.freeze({ duplicate: false, notices: Object.freeze([]) })
      }
      const emitted: QuotaNotice[] = []
      for (const quotaClass of QUOTA_CLASSES) {
        const currentWindow = windowKey(quotaClass, now)
        if (windowKey(quotaClass, input.observedAt) !== currentWindow) continue
        const balance = await tx<BalanceRow>`
          select quota_class,entitlement_snapshot_id,window_key,limit_units,used_units,reserved_units
          from fuma_quota_balances_v2
          where organization_id=${input.organizationId} and quota_class=${quotaClass} for update
        `
        const row = balance.rows[0]
        if (!row || row.window_key !== currentWindow) continue
        const before = units(row.used_units, 'used quota') + units(row.reserved_units, 'reserved quota')
        const after = input.usage[quotaClass] + units(row.reserved_units, 'reserved quota')
        const limit = state.limits[quotaClass] + state.topUps[quotaClass]
        await tx`
          update fuma_quota_balances_v2 set used_units=${input.usage[quotaClass]},
            version=version+1,updated_at=${now}
          where organization_id=${input.organizationId} and quota_class=${quotaClass}
        `
        emitted.push(...await this.#notices(
          tx,
          source,
          quotaClass,
          currentWindow,
          before,
          after,
          limit,
          now,
        ))
      }
      return Object.freeze({ duplicate: false, notices: Object.freeze(emitted) })
    })
  }
}
