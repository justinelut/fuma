import {
  Type,
  safeParseValue,
} from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import type { FumaJobJsonValue, FumaScopedJobHandler } from '../jobs'
import { PLATFORM_ORGANIZATION_ID } from '../organizations'
import { quotaUsageFromWorkload, type QuotaUsageCollector } from './collector'

const GAUGE_METERS = Object.freeze([
  'storage_source_bytes',
  'storage_variant_bytes',
  'storage_release_bytes',
  'storage_local_backup_bytes',
  'storage_offsite_bytes',
  'custom_hostnames',
  'release_retention_bytes',
] as const)

const PERIOD_METERS = Object.freeze([
  'origin_bandwidth_bytes',
  'email_recipients',
  'build_publish_milliseconds',
  'plugin_compute_milliseconds',
  'ai_credits',
] as const)

type CountRow = Readonly<{
  sites: string | number
  pages: string | number
  cms_items: string | number
  members: string | number
  collaborators: string | number
}>
type MeterRow = Readonly<{
  meter: (typeof GAUGE_METERS)[number] | (typeof PERIOD_METERS)[number]
  units: string | number
}>
type OrganizationRow = Readonly<{ organization_id: string }>

type Workload = Readonly<{
  sites: number
  pages: number
  cms_items: number
  members: number
  storage_source_bytes: number
  storage_variant_bytes: number
  storage_release_bytes: number
  storage_local_backup_bytes: number
  storage_offsite_bytes: number
  origin_bandwidth_bytes: number
  email_recipients: number
  email_message_bytes: number
  custom_hostnames: number
  build_publish_milliseconds: number
  plugin_compute_milliseconds: number
  ai_credits: number
  release_retention_bytes: number
  weighted_queue_milliseconds: number
}>

export type QuotaCollectionSummary = Readonly<{
  observedAt: string
  organizations: number
  duplicates: number
  notices: number
}>

function safeUnits(value: string | number, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`Trusted ${label} exceeds the supported quota range.`)
  }
  return parsed
}

function startOfUtcDay(at: Date): string {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())).toISOString()
}

function startOfUtcMonth(at: Date): string {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString()
}

function completeMeters(rows: readonly MeterRow[]): Workload {
  const byMeter = new Map(rows.map((row) => [row.meter, safeUnits(row.units, row.meter)]))
  return Object.freeze({
    sites: 0,
    pages: 0,
    cms_items: 0,
    members: 0,
    storage_source_bytes: byMeter.get('storage_source_bytes') ?? 0,
    storage_variant_bytes: byMeter.get('storage_variant_bytes') ?? 0,
    storage_release_bytes: byMeter.get('storage_release_bytes') ?? 0,
    storage_local_backup_bytes: byMeter.get('storage_local_backup_bytes') ?? 0,
    storage_offsite_bytes: byMeter.get('storage_offsite_bytes') ?? 0,
    origin_bandwidth_bytes: byMeter.get('origin_bandwidth_bytes') ?? 0,
    email_recipients: byMeter.get('email_recipients') ?? 0,
    email_message_bytes: 0,
    custom_hostnames: byMeter.get('custom_hostnames') ?? 0,
    build_publish_milliseconds: byMeter.get('build_publish_milliseconds') ?? 0,
    plugin_compute_milliseconds: byMeter.get('plugin_compute_milliseconds') ?? 0,
    ai_credits: byMeter.get('ai_credits') ?? 0,
    release_retention_bytes: byMeter.get('release_retention_bytes') ?? 0,
    weighted_queue_milliseconds: 0,
  })
}

/**
 * Reads trusted hosted authorities only. Entity and collaborator gauges come
 * from canonical rows; byte/domain gauges use the latest immutable meter per
 * exact site; consumptive classes use the current UTC quota period.
 */
export class PostgresQuotaUsageAuthority {
  readonly #db: DbClient
  readonly #collector: QuotaUsageCollector

  constructor(db: DbClient, collector: QuotaUsageCollector) {
    if (db.dialect !== 'postgres') throw new TypeError('Quota usage collection requires PostgreSQL authority.')
    this.#db = db
    this.#collector = collector
  }

  async eligibleOrganizations(at: string): Promise<readonly string[]> {
    const rows = await this.#db<OrganizationRow>`
      select distinct organization_id from (
        select ${PLATFORM_ORGANIZATION_ID}::text as organization_id
        where exists (
          select 1 from fuma_entitlement_grants
          where grant_id='platform-internal' and organization_id=${PLATFORM_ORGANIZATION_ID}
        )
        union all
        select organization_id from fuma_organization_contracts
        where state in ('active','paid-transfer-pending') and checkout_id is not null
        union all
        select s.organization_id from fuma_entitlement_snapshots s
        join fuma_entitlement_assignments a
          on a.organization_id=s.organization_id and a.source=s.source and a.source_id=s.source_id
        where s.source='grandfathered' and a.state='active' and s.effective_at<=${at}
          and (s.expires_at is null or s.expires_at>${at})
      ) eligible
      order by organization_id
    `
    return Object.freeze(rows.rows.map((row) => row.organization_id))
  }

  async #counts(organizationId: string): Promise<Readonly<{
    sites: number
    pages: number
    cmsItems: number
    members: number
    collaborators: number
  }>> {
    const result = await this.#db<CountRow>`
      select
        (select count(*) from fuma_sites
          where organization_id=${organizationId} and status='active') as sites,
        (select count(*) from fuma_publication_content c
          join fuma_tenant_owner_keys k
            on k.platform_id=c.platform_id and k.owner_key=c.owner_key
              and k.generation=c.owner_generation
          where k.organization_id=${organizationId} and c.kind='page' and c.status<>'archived') as pages,
        (select count(*) from fuma_publication_content c
          join fuma_tenant_owner_keys k
            on k.platform_id=c.platform_id and k.owner_key=c.owner_key
              and k.generation=c.owner_generation
          where k.organization_id=${organizationId} and c.status<>'archived') as cms_items,
        (select count(*) from fuma_publication_member_accounts
          where organization_id=${organizationId} and state<>'deleted') as members,
        (select count(*) from auth_members
          where organization_id=${organizationId}) as collaborators
    `
    const row = result.rows[0]
    if (!row) throw new TypeError('Trusted quota entity counts are unavailable.')
    return Object.freeze({
      sites: safeUnits(row.sites, 'site count'),
      pages: safeUnits(row.pages, 'page count'),
      cmsItems: safeUnits(row.cms_items, 'CMS item count'),
      members: safeUnits(row.members, 'member count'),
      collaborators: safeUnits(row.collaborators, 'collaborator count'),
    })
  }

  async #meterSnapshot(organizationId: string, observedAt: string): Promise<Workload> {
    const at = new Date(observedAt)
    if (!Number.isFinite(at.getTime())) throw new TypeError('Quota observation timestamp is invalid.')
    const monthStart = startOfUtcMonth(at)
    const gauges = await this.#db<MeterRow>`
      with latest as (
        select distinct on (meter,coalesce(workspace_id,''),coalesce(site_id,''))
          meter,physical_units
        from fuma_usage_ledger
        where organization_id=${organizationId}
          and meter in (${GAUGE_METERS[0]},${GAUGE_METERS[1]},${GAUGE_METERS[2]},${GAUGE_METERS[3]},${GAUGE_METERS[4]},${GAUGE_METERS[5]},${GAUGE_METERS[6]})
          and kind in ('settlement','adjustment')
          and occurred_at<=${observedAt}
          and not idempotency_key like 'meter-reconcile:%'
        order by meter,coalesce(workspace_id,''),coalesce(site_id,''),occurred_at desc,entry_id desc
      )
      select meter,coalesce(sum(physical_units),0) as units from latest group by meter
    `
    const period = await this.#db<MeterRow>`
      select meter,coalesce(sum(case when meter='ai_credits' then logical_units else physical_units end),0) as units
      from fuma_usage_ledger
      where organization_id=${organizationId}
        and meter in (${PERIOD_METERS[0]},${PERIOD_METERS[1]},${PERIOD_METERS[2]},${PERIOD_METERS[3]},${PERIOD_METERS[4]})
        and kind in ('settlement','adjustment')
        and occurred_at>=${monthStart} and occurred_at<=${observedAt}
        and not idempotency_key like 'meter-reconcile:%'
      group by meter
    `
    return completeMeters([...gauges.rows, ...period.rows])
  }

  async collectOrganization(organizationId: string, observedAt: string): Promise<Readonly<{
    duplicate: boolean
    notices: number
  }>> {
    const [counts, workload] = await Promise.all([
      this.#counts(organizationId),
      this.#meterSnapshot(organizationId, observedAt),
    ])
    const monthlyRecipients = workload.email_recipients
    const dayStart = startOfUtcDay(new Date(observedAt))
    const day = await this.#db<Readonly<{ units: string | number }>>`
      select coalesce(sum(physical_units),0) as units from fuma_usage_ledger
      where organization_id=${organizationId} and meter='email_recipients'
        and kind in ('settlement','adjustment')
        and occurred_at>=${dayStart} and occurred_at<=${observedAt}
        and not idempotency_key like 'meter-reconcile:%'
    `
    const envelope = quotaUsageFromWorkload(Object.freeze({
      ...workload,
      sites: counts.sites,
      pages: counts.pages,
      cms_items: counts.cmsItems,
      members: counts.members,
    }), counts.collaborators)
    const result = await this.#collector.collect(Object.freeze({
      idempotencyKey: `fuma.quota-usage:v1:${organizationId}:${observedAt}`,
      organizationId,
      observedAt,
      usage: Object.freeze({
        ...envelope,
        emailRecipientsDay: safeUnits(day.rows[0]?.units ?? 0, 'daily email recipients'),
        emailRecipientsMonth: monthlyRecipients,
      }),
      source: 'continuous',
    }))
    return Object.freeze({ duplicate: result.duplicate, notices: result.notices.length })
  }

  async collectAll(observedAt: string): Promise<QuotaCollectionSummary> {
    const organizations = await this.eligibleOrganizations(observedAt)
    let duplicates = 0
    let notices = 0
    for (const organizationId of organizations) {
      const result = await this.collectOrganization(organizationId, observedAt)
      if (result.duplicate) duplicates += 1
      notices += result.notices
    }
    return Object.freeze({ observedAt, organizations: organizations.length, duplicates, notices })
  }
}

export const QUOTA_USAGE_COLLECTION_JOB = 'fuma.quota-usage-collection' as const

export const QuotaUsageCollectionPayloadSchema = Type.Object({
  observedAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false })

const QuotaCollectionSummarySchema = Type.Object({
  observedAt: Type.String({ format: 'date-time' }),
  organizations: Type.Integer({ minimum: 0 }),
  duplicates: Type.Integer({ minimum: 0 }),
  notices: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false })

export function quotaUsageCollectionJobRegistration(input: Readonly<{
  authority: PostgresQuotaUsageAuthority
  protectedOrganizationId?: string
}>): Readonly<Record<typeof QUOTA_USAGE_COLLECTION_JOB, FumaScopedJobHandler>> {
  const protectedOrganizationId = input.protectedOrganizationId ?? PLATFORM_ORGANIZATION_ID
  const handler: FumaScopedJobHandler = async (context) => {
    if (context.job.kind !== QUOTA_USAGE_COLLECTION_JOB
      || context.job.organizationId !== protectedOrganizationId
      || context.job.siteId !== null
      || context.jobContext.kind !== 'organization'
      || context.repositoryScope !== null
      || context.jobContext.scope.organization.id !== protectedOrganizationId) {
      throw new TypeError('Quota usage collection requires protected platform authority.')
    }
    const payload = safeParseValue(QuotaUsageCollectionPayloadSchema, context.job.payload)
    if (!payload.ok) throw new TypeError('Quota usage collection payload is invalid.')
    const effectKey = `fuma.quota-usage-collection:v1:${payload.value.observedAt}`
    const prior = await context.readDurableResult(effectKey)
    if (prior) {
      const parsed = safeParseValue(QuotaCollectionSummarySchema, prior.result)
      if (!parsed.ok || parsed.value.observedAt !== payload.value.observedAt) {
        throw new TypeError('Durable quota usage collection result is invalid.')
      }
      return parsed.value as FumaJobJsonValue
    }
    const result = await input.authority.collectAll(payload.value.observedAt)
    const parsed = safeParseValue(QuotaCollectionSummarySchema, result)
    if (!parsed.ok) throw new TypeError('Quota usage collection result is invalid.')
    return (await context.commitDurableResult(
      effectKey,
      parsed.value as FumaJobJsonValue,
    )).result
  }
  return Object.freeze({ [QUOTA_USAGE_COLLECTION_JOB]: handler })
}
