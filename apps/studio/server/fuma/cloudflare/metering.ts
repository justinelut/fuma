import type { DbClient } from '../../db/client'
import type { CloudflareStateRepository } from './repository'
import type { CloudflareSaasReconciler } from './reconciler'

export type CloudflareHostnameMeterReconciliation = Readonly<{
  reconciliationId: string
  observedHostnames: number
  ledgerHostnames: number
  delta: number
  included: 100
  paygMaximum: 50_000
  unitUsdCents: 10
  totalUsdCents: number
  baselineDate: '2026-07-23'
  observedAt: string
}>
export interface CloudflareHostnameLedgerAuthority { countActiveHostnames(): Promise<number> }
export interface CloudflareHostnameMeterRepository {
  exact(reconciliationId: string): Promise<CloudflareHostnameMeterReconciliation | null>
  insert(value: CloudflareHostnameMeterReconciliation): Promise<boolean>
}

export class CloudflareHostnameMeteringReconciler {
  readonly input: Readonly<{
    state: CloudflareStateRepository
    ledger: CloudflareHostnameLedgerAuthority
    repository: CloudflareHostnameMeterRepository
    pricing: Pick<CloudflareSaasReconciler, 'hostnameCost'>
    now?: () => Date
  }>
  constructor(input: CloudflareHostnameMeteringReconciler['input']) { this.input = input }
  async reconcile(reconciliationId: string): Promise<CloudflareHostnameMeterReconciliation> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(reconciliationId)) throw new TypeError('Cloudflare metering identity is invalid.')
    const prior = await this.input.repository.exact(reconciliationId)
    if (prior) return prior
    const [observedHostnames, ledgerHostnames] = await Promise.all([this.input.state.countBillable(), this.input.ledger.countActiveHostnames()])
    const pricing = this.input.pricing.hostnameCost(observedHostnames)
    this.input.pricing.hostnameCost(ledgerHostnames)
    const observedAt = (this.input.now ?? (() => new Date()))().toISOString()
    const value = Object.freeze({
      reconciliationId, observedHostnames, ledgerHostnames, delta: observedHostnames - ledgerHostnames,
      included: pricing.included, paygMaximum: pricing.paygMaximum, unitUsdCents: pricing.unitUsdCents,
      totalUsdCents: pricing.totalUsdCents, baselineDate: pricing.baselineDate, observedAt,
    })
    if (!await this.input.repository.insert(value)) {
      const winner = await this.input.repository.exact(reconciliationId)
      if (!winner || JSON.stringify(winner) !== JSON.stringify(value)) throw new TypeError('Cloudflare metering reconciliation conflicted.')
      return winner
    }
    return value
  }
}

export class MemoryCloudflareHostnameMeterRepository implements CloudflareHostnameMeterRepository {
  readonly values = new Map<string, CloudflareHostnameMeterReconciliation>()
  async exact(id: string) { return structuredClone(this.values.get(id) ?? null) }
  async insert(value: CloudflareHostnameMeterReconciliation) {
    const prior = this.values.get(value.reconciliationId)
    if (prior) return false
    this.values.set(value.reconciliationId, structuredClone(value)); return true
  }
}

export class PostgresCloudflareHostnameMeterRepository implements CloudflareHostnameMeterRepository {
  readonly db: DbClient
  constructor(db: DbClient) { this.db = db }
  async exact(reconciliationId: string): Promise<CloudflareHostnameMeterReconciliation | null> {
    const result = await this.db<{ reconciliation_id: string; observed_hostnames: number | string | bigint; ledger_hostnames: number | string | bigint; delta: number | string | bigint; total_usd_cents: number | string | bigint; observed_at: string | Date }>`select reconciliation_id,observed_hostnames,ledger_hostnames,delta,total_usd_cents,observed_at from fuma_cloudflare_hostname_meter_reconciliations_v2 where reconciliation_id=${reconciliationId}`
    const row = result.rows[0]; if (!row) return null
    return Object.freeze({ reconciliationId: row.reconciliation_id, observedHostnames: Number(row.observed_hostnames), ledgerHostnames: Number(row.ledger_hostnames), delta: Number(row.delta), included: 100, paygMaximum: 50_000, unitUsdCents: 10, totalUsdCents: Number(row.total_usd_cents), baselineDate: '2026-07-23', observedAt: row.observed_at instanceof Date ? row.observed_at.toISOString() : row.observed_at })
  }
  async insert(value: CloudflareHostnameMeterReconciliation): Promise<boolean> {
    const result = await this.db`insert into fuma_cloudflare_hostname_meter_reconciliations_v2(reconciliation_id,observed_hostnames,ledger_hostnames,delta,total_usd_cents,baseline_date,observed_at) values(${value.reconciliationId},${value.observedHostnames},${value.ledgerHostnames},${value.delta},${value.totalUsdCents},${value.baselineDate},${value.observedAt}) on conflict do nothing`
    return result.rowCount === 1
  }
}
