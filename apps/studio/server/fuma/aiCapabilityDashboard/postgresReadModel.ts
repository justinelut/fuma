import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import { BackendCapabilityReceiptSchema, type BackendCapabilityReceipt, type BackendCapabilityScope } from '../aiBackendCapabilities'

export type DashboardReceiptEvidence = Readonly<{
  receipt: BackendCapabilityReceipt | null
  channel: 'site-ai' | 'mcp'
  operationId: string
  state: 'started' | 'completed' | 'failed' | 'denied'
  auditId: string | null
  metered: boolean
  occurredAt: string
}>
export type DashboardConnectorGrant = Readonly<{
  connectorId: string
  label: string
  actorId: string
  state: 'active' | 'revoked'
}>
export type DashboardUsageEvidence = Readonly<{
  logicalCredits: number
  providerCredits: number
  spendUsdMicros: string
}>
export type SiteDashboardEvidence = Readonly<{
  receipts: readonly DashboardReceiptEvidence[]
  hasMore: boolean
  connectors: readonly DashboardConnectorGrant[]
  usage: DashboardUsageEvidence
  totalSuccessful: number
  totalFailed: number
  totalMetered: number
  totalAudited: number
  driftedReceipts: number
}>
export type PlatformDashboardEvidence = Readonly<{
  receipts: readonly DashboardReceiptEvidence[]
  hasMore: boolean
  tenantCount: number
  successful: number
  failed: number
  metered: number
  audited: number
  logicalCredits: number
  providerCredits: number
  spendUsdMicros: string
  activeMcpGrants: number
  revokedMcpGrants: number
  currentVersionOperations: number
  driftedReceipts: number
}>

interface ReceiptRow {
  channel: 'site-ai' | 'mcp'
  operation_id: string
  state: 'started' | 'completed' | 'failed' | 'denied'
  output_json: unknown
  audit_id: string | null
  occurred_at: string | Date
}
interface ConnectorRow { connector_id: string; label: string; actor_id: string; state: 'active'|'revoked' }
interface UsageRow { logical: string|number; physical: string|number; spend: string|number }
interface CountRow { successful: string|number; failed: string|number; metered: string|number; audited: string|number; drifted: string|number }
interface AggregateRow {
  tenant_count: string|number; successful: string|number; failed: string|number
  metered: string|number; audited: string|number; logical: string|number; physical: string|number
  spend: string|number; active_mcp_grants: string|number; revoked_mcp_grants: string|number
  current_version_operations: string|number; drifted_receipts: string|number
}

function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString() }
function integer(value: string | number | undefined, label: string): number {
  const parsed = Number(value ?? 0)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Stored ${label} exceeds the dashboard integer bound.`)
  return parsed
}
function receipt(value: unknown): BackendCapabilityReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = (value as Record<string, unknown>).data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const candidate = (data as Record<string, unknown>).receipt
  const parsed = safeParseValue(BackendCapabilityReceiptSchema, candidate)
  return parsed.ok ? Object.freeze(structuredClone(parsed.value)) as BackendCapabilityReceipt : null
}

async function meteredKeys(db: DbClient, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  if (ids.length > 50) throw new Error('Capability dashboard meter lookup exceeds its bound.')
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(',')
  const rows = await db.unsafe<{ idempotency_key: string }>(
    `select idempotency_key from fuma_usage_ledger where idempotency_key in (${placeholders})`,
    [...ids],
  )
  return new Set(rows.rows.map((row) => row.idempotency_key))
}
function scopeArgs(scope: BackendCapabilityScope): readonly unknown[] {
  return [scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.ownerGeneration, scope.profileId]
}

const RECEIPT_UNION = (scoped: boolean) => `
  select 'site-ai'::text channel,job.organization_id,receipt.tool_call_id operation_id,receipt.state,
    receipt.output_json,
    (select audit.audit_id from fuma_component_catalog_audit_v1 audit
      where audit.operation_id=receipt.tool_call_id and audit.action='component.inserted'
        ${scoped ? 'and audit.platform_id=$1 and audit.organization_id=$2 and audit.workspace_id=$3 and audit.site_id=$4 and audit.owner_key=$5 and audit.owner_generation=$6 and audit.profile_id=$7' : ''}
      order by audit.occurred_at desc,audit.audit_id limit 1) audit_id,
    coalesce(receipt.completed_at,receipt.created_at) occurred_at
  from fuma_site_ai_tool_receipts receipt
  join fuma_site_ai_turn_jobs job on job.job_id=receipt.job_id
  where receipt.tool_name='site_insert_component'
    ${scoped ? 'and job.platform_id=$1 and job.organization_id=$2 and job.workspace_id=$3 and job.site_id=$4 and job.owner_key=$5 and job.owner_generation=$6 and job.profile_id=$7' : ''}
  union all
  select 'mcp'::text channel,binding.organization_id,receipt.operation_id,receipt.state,receipt.output_json,
    (select audit.audit_id from fuma_component_catalog_audit_v1 audit
      where audit.operation_id=receipt.operation_id and audit.action='component.inserted'
        ${scoped ? 'and audit.platform_id=$1 and audit.organization_id=$2 and audit.workspace_id=$3 and audit.site_id=$4 and audit.owner_key=$5 and audit.owner_generation=$6 and audit.profile_id=$7' : ''}
      order by audit.occurred_at desc,audit.audit_id limit 1) audit_id,
    coalesce(receipt.completed_at,receipt.created_at) occurred_at
  from fuma_mcp_tool_receipts_v2 receipt
  join fuma_mcp_connector_bindings_v2 binding on binding.connector_id=receipt.connector_id
  where receipt.tool_name='site_insert_component'
    ${scoped ? 'and binding.platform_id=$1 and binding.organization_id=$2 and binding.workspace_id=$3 and binding.site_id=$4 and binding.owner_key=$5 and binding.owner_generation=$6 and binding.profile_id=$7' : ''}
`

export class PostgresCapabilityDashboardReadModel {
  readonly #db: DbClient
  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Capability dashboard requires PostgreSQL authority.')
    this.#db = db
  }

  async site(scope: BackendCapabilityScope, limit: number, offset: number): Promise<SiteDashboardEvidence> {
    const args = [...scopeArgs(scope)]
    const [receiptRows, connectorRows, usageRows, countRows] = await Promise.all([
      this.#db.unsafe<ReceiptRow>(`select * from (${RECEIPT_UNION(true)}) evidence order by occurred_at desc,operation_id limit $8 offset $9`, [...args, limit + 1, offset]),
      this.#db.unsafe<ConnectorRow>(`select binding.connector_id,connector.label,binding.actor_id,binding.state from fuma_mcp_connector_bindings_v2 binding join ai_mcp_connectors connector on connector.id=binding.connector_id where binding.platform_id=$1 and binding.organization_id=$2 and binding.workspace_id=$3 and binding.site_id=$4 and binding.owner_key=$5 and binding.owner_generation=$6 and binding.profile_id=$7 and binding.connector_capabilities_json ? 'component.mutate' order by connector.created_at desc,binding.connector_id limit 100`, args),
      this.#db.unsafe<UsageRow>(`
        with attempts as (${RECEIPT_UNION(true)}),
        receipt_ids as (
          select distinct jsonb_extract_path_text(output_json,'data','receipt','receiptId') receipt_id
          from attempts
          where state='completed'
            and jsonb_extract_path_text(output_json,'data','receipt','receiptId') ~ '^[a-f0-9]{64}$'
        )
        select coalesce(sum(ledger.logical_units),0)::text logical,
          coalesce(sum(ledger.physical_units),0)::text physical,
          coalesce(sum(ledger.cost_usd_micros),0)::text spend
        from receipt_ids
        join fuma_usage_ledger ledger
          on ledger.idempotency_key='backend-capability:' || receipt_ids.receipt_id || ':ai_credits'
        where ledger.organization_id=$2 and ledger.workspace_id=$3 and ledger.site_id=$4
          and ledger.meter='ai_credits'
      `, args),
      this.#db.unsafe<CountRow>(`
        with attempts as (${RECEIPT_UNION(true)}),
        evidenced as (
          select attempts.*,
            jsonb_extract_path_text(attempts.output_json,'data','receipt','receiptId') receipt_id,
            jsonb_extract_path_text(attempts.output_json,'data','receipt','capabilityVersion') capability_version
          from attempts
        )
        select count(*) filter(where state='completed')::text successful,
          count(*) filter(where state in ('failed','denied'))::text failed,
          count(*) filter(where state='completed' and exists(
            select 1 from fuma_usage_ledger ledger
            where ledger.idempotency_key='backend-capability:' || evidenced.receipt_id || ':ai_credits'
              and ledger.meter='ai_credits'
          ))::text metered,
          count(*) filter(where state='completed' and audit_id is not null)::text audited,
          count(*) filter(where state='completed' and (receipt_id is null or capability_version <> '1.0.0'))::text drifted
        from evidenced
      `, args),
    ])
    const selected = receiptRows.rows.slice(0, limit)
    const parsedReceipts = selected.map((row) => receipt(row.output_json))
    const receiptIds = parsedReceipts.flatMap((value) => value ? [`backend-capability:${value.receiptId}:ai_credits`] : [])
    const metered = await meteredKeys(this.#db, receiptIds)
    const evidence = selected.map((row, index): DashboardReceiptEvidence => {
      const parsed = parsedReceipts[index] ?? null
      return Object.freeze({
        receipt: parsed,
        channel: row.channel,
        operationId: row.operation_id,
        state: row.state,
        auditId: row.audit_id,
        metered: parsed ? metered.has(`backend-capability:${parsed.receiptId}:ai_credits`) : false,
        occurredAt: iso(row.occurred_at),
      })
    })
    const usage = usageRows.rows[0]
    const counts = countRows.rows[0]
    return Object.freeze({
      receipts: Object.freeze(evidence),
      hasMore: receiptRows.rows.length > limit,
      connectors: Object.freeze(connectorRows.rows.map((row) => Object.freeze({ connectorId: row.connector_id, label: row.label, actorId: row.actor_id, state: row.state }))),
      usage: Object.freeze({ logicalCredits: integer(usage?.logical, 'logical credits'), providerCredits: integer(usage?.physical, 'provider credits'), spendUsdMicros: String(usage?.spend ?? '0') }),
      totalSuccessful: integer(counts?.successful, 'successful operation count'),
      totalFailed: integer(counts?.failed, 'failed operation count'),
      totalMetered: integer(counts?.metered, 'metered operation count'),
      totalAudited: integer(counts?.audited, 'audited operation count'),
      driftedReceipts: integer(counts?.drifted, 'drifted receipt count'),
    })
  }

  async platform(version: string, limit: number, offset: number): Promise<PlatformDashboardEvidence> {
    const [receiptRows, aggregateRows] = await Promise.all([
      this.#db.unsafe<ReceiptRow>(`select * from (${RECEIPT_UNION(false)}) evidence order by occurred_at desc,operation_id limit $1 offset $2`, [limit + 1, offset]),
      this.#db.unsafe<AggregateRow>(`
        with attempts as (${RECEIPT_UNION(false)}),
        evidenced as (
          select attempts.*,
            jsonb_extract_path_text(attempts.output_json,'data','receipt','receiptId') receipt_id,
            jsonb_extract_path_text(attempts.output_json,'data','receipt','capabilityVersion') capability_version
          from attempts
        ),
        canonical as (
          select evidenced.*,ledger.idempotency_key meter_key,
            ledger.logical_units,ledger.physical_units,ledger.cost_usd_micros
          from evidenced
          left join fuma_usage_ledger ledger
            on ledger.idempotency_key='backend-capability:' || evidenced.receipt_id || ':ai_credits'
            and ledger.meter='ai_credits'
        ),
        connector_totals as (
          select count(*) filter(where state='active')::bigint active_mcp_grants,
            count(*) filter(where state='revoked')::bigint revoked_mcp_grants
          from fuma_mcp_connector_bindings_v2
          where connector_capabilities_json ? 'component.mutate'
        )
        select count(distinct canonical.organization_id) filter(where canonical.state='completed')::bigint tenant_count,
          count(*) filter(where canonical.state='completed')::bigint successful,
          count(*) filter(where canonical.state in ('failed','denied'))::bigint failed,
          count(*) filter(where canonical.state='completed' and canonical.meter_key is not null)::bigint metered,
          count(*) filter(where canonical.state='completed' and canonical.audit_id is not null)::bigint audited,
          coalesce(sum(canonical.logical_units) filter(where canonical.state='completed'),0)::bigint logical,
          coalesce(sum(canonical.physical_units) filter(where canonical.state='completed'),0)::bigint physical,
          coalesce(sum(canonical.cost_usd_micros) filter(where canonical.state='completed'),0)::numeric spend,
          (select active_mcp_grants from connector_totals) active_mcp_grants,
          (select revoked_mcp_grants from connector_totals) revoked_mcp_grants,
          count(*) filter(where canonical.state='completed' and canonical.capability_version=$1)::bigint current_version_operations,
          count(*) filter(where canonical.state='completed' and (canonical.receipt_id is null or canonical.capability_version is distinct from $1))::bigint drifted_receipts
        from canonical
      `, [version]),
    ])
    const aggregate = aggregateRows.rows[0]
    const selected = receiptRows.rows.slice(0, limit)
    const parsedReceipts = selected.map((row) => receipt(row.output_json))
    const receiptIds = parsedReceipts.flatMap((value) => value ? [`backend-capability:${value.receiptId}:ai_credits`] : [])
    const metered = await meteredKeys(this.#db, receiptIds)
    const recent = selected.map((row, index): DashboardReceiptEvidence => {
      const parsed = parsedReceipts[index] ?? null
      return Object.freeze({
        receipt: parsed,
        channel: row.channel,
        operationId: row.operation_id,
        state: row.state,
        auditId: row.audit_id,
        metered: parsed ? metered.has(`backend-capability:${parsed.receiptId}:ai_credits`) : false,
        occurredAt: iso(row.occurred_at),
      })
    })
    return Object.freeze({
      receipts: Object.freeze(recent), hasMore: receiptRows.rows.length > limit,
      tenantCount: integer(aggregate?.tenant_count, 'tenant count'), successful: integer(aggregate?.successful, 'success count'), failed: integer(aggregate?.failed, 'failure count'),
      metered: integer(aggregate?.metered, 'metered count'), audited: integer(aggregate?.audited, 'audited count'), logicalCredits: integer(aggregate?.logical, 'logical credits'), providerCredits: integer(aggregate?.physical, 'provider credits'), spendUsdMicros: String(aggregate?.spend ?? '0'),
      activeMcpGrants: integer(aggregate?.active_mcp_grants, 'active MCP grants'), revokedMcpGrants: integer(aggregate?.revoked_mcp_grants, 'revoked MCP grants'), currentVersionOperations: integer(aggregate?.current_version_operations, 'version adoption count'), driftedReceipts: integer(aggregate?.drifted_receipts, 'drifted receipt count'),
    })
  }
}
