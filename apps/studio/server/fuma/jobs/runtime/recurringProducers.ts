import type { DbClient } from '../../../db/client'
import type { CardRenewalCommand } from '../../customerPayments/contracts'
import type { EnqueueFumaJob, FumaJobJsonValue } from '../contracts'
import type { FumaRecurringJobProducer, FumaRecurringJobProducerResult } from '../scheduler'

export const RECURRING_JOB_KINDS = Object.freeze({
  meterReconciliation: 'fuma.meter-reconcile',
  billingDunning: 'fuma.billing-dunning',
  quotaUsageCollection: 'fuma.quota-usage-collection',
  aiCreditExpiry: 'fuma.ai-credit-expiry',
  customerPaymentLifecycle: 'fuma.customer-payment-lifecycle',
  customerPaymentCardRenewal: 'fuma.customer-payment-card-renewal',
  cloudflareReconcile: 'fuma.cloudflare-reconcile',
  publicationAnalyticsRetention: 'publication.analytics-retention',
  publicationRevisionRetention: 'publication.revision-retention',
  publicationRevisionGc: 'publication.revision-gc',
  publicMarketingAnalyticsRetention: 'fuma.public-marketing-analytics-retention',
} as const)

export type RecurringJobKind = (typeof RECURRING_JOB_KINDS)[keyof typeof RECURRING_JOB_KINDS]

export const RECURRING_JOB_INTERVALS = Object.freeze({
  fiveMinutes: 5 * 60_000,
  hourly: 60 * 60_000,
  daily: 24 * 60 * 60_000,
} as const)

export type RecurringPublicationSite = Readonly<{
  organizationId: string
  siteId: string
}>

export interface RecurringPublicationSiteSource {
  listActivePublicationSites(): Promise<readonly RecurringPublicationSite[]>
}

export interface RecurringJobEnqueuePort {
  enqueue(input: EnqueueFumaJob): Promise<Readonly<{ created: boolean }>>
}

type PublicationSiteRow = Readonly<{
  organization_id: string
  site_id: string
}>

/**
 * Enumerates only scopes that the job-context authority can resolve at this
 * tick. Payloads never carry these coordinates; they remain committed job-row
 * authority.
 */
export class PostgresRecurringPublicationSiteSource implements RecurringPublicationSiteSource {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Recurring job scope discovery requires PostgreSQL authority.')
    this.#db = db
  }

  async listActivePublicationSites(): Promise<readonly RecurringPublicationSite[]> {
    const { rows } = await this.#db<PublicationSiteRow>`
      select site.organization_id, site.id as site_id
      from fuma_sites site
      join fuma_workspaces workspace
        on workspace.organization_id = site.organization_id
        and workspace.id = site.workspace_id
      join fuma_organization_profiles organization
        on organization.organization_id = site.organization_id
      join fuma_tenant_owner_keys owner
        on owner.organization_id = site.organization_id
        and owner.workspace_id = site.workspace_id
        and owner.site_id = site.id
      where site.status = 'active'
        and site.profile_id = 'publication'
        and workspace.status = 'active'
        and organization.status = 'active'
        and owner.state = 'active'
        and owner.transfer_id is null
        and owner.transfer_lock_id is null
        and owner.transfer_fence is null
      group by site.organization_id, site.id
      having count(*) = 1
      order by site.organization_id, site.id
    `
    return Object.freeze(rows.map((row) => Object.freeze({
      organizationId: row.organization_id,
      siteId: row.site_id,
    })))
  }
}

export type RecurringCardRenewal = Readonly<{
  organizationId: string
  siteId: string
  command: CardRenewalCommand
}>

export interface RecurringCustomerPaymentSource {
  listLifecycleSites(): Promise<readonly RecurringPublicationSite[]>
  listDueCardRenewals(at: Date, limit: number): Promise<readonly RecurringCardRenewal[]>
}

type DueCardRenewalRow = Readonly<{
  platform_id: string
  organization_id: string
  workspace_id: string
  site_id: string
  owner_key: string
  owner_generation: number | string
  member_id: string
  membership_id: string
  revision: number | string
}>

/** Discovers only current, unfenced Publication authority and exact due card revisions. */
export class PostgresRecurringCustomerPaymentSource implements RecurringCustomerPaymentSource {
  readonly #db: DbClient
  readonly #publicationSites: PostgresRecurringPublicationSiteSource

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Customer payment recurrence discovery requires PostgreSQL authority.')
    this.#db = db
    this.#publicationSites = new PostgresRecurringPublicationSiteSource(db)
  }

  listLifecycleSites(): Promise<readonly RecurringPublicationSite[]> {
    return this.#publicationSites.listActivePublicationSites()
  }

  async listDueCardRenewals(at: Date, limit: number): Promise<readonly RecurringCardRenewal[]> {
    validInstant(at)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new TypeError('Due card-renewal discovery limit must be between 1 and 1,000.')
    }
    const { rows } = await this.#db.unsafe<DueCardRenewalRow>(`
      select membership.platform_id, membership.organization_id, membership.workspace_id, membership.site_id,
        membership.owner_key, membership.owner_generation, membership.member_id,
        membership.membership_id, membership.revision
      from fuma_publication_memberships_v2 membership
      join fuma_customer_card_authorizations_v2 card_auth
        on card_auth.membership_id = membership.membership_id
        and card_auth.credential_id = membership.credential_id
        and card_auth.credential_version = membership.credential_version
      join fuma_tenant_owner_keys owner
        on owner.platform_id = membership.platform_id
        and owner.organization_id = membership.organization_id
        and owner.workspace_id = membership.workspace_id
        and owner.site_id = membership.site_id
        and owner.owner_key = membership.owner_key
        and owner.generation = membership.owner_generation
      join fuma_sites site
        on site.organization_id = membership.organization_id
        and site.workspace_id = membership.workspace_id
        and site.id = membership.site_id
      join fuma_workspaces workspace
        on workspace.organization_id = membership.organization_id
        and workspace.id = membership.workspace_id
      join fuma_organization_profiles organization
        on organization.organization_id = membership.organization_id
      where membership.renewal = 'supported-card-recurring'
        and membership.state in ('active', 'grace')
        and membership.access_until <= $1
        and card_auth.state = 'active'
        and owner.state = 'active'
        and owner.transfer_id is null
        and owner.transfer_lock_id is null
        and owner.transfer_fence is null
        and site.status = 'active'
        and site.profile_id = 'publication'
        and workspace.status = 'active'
        and organization.status = 'active'
      order by membership.access_until, membership.membership_id
      limit $2
    `, [at.toISOString(), limit])
    return Object.freeze(rows.map((row) => {
      const ownerGeneration = typeof row.owner_generation === 'number'
        ? row.owner_generation
        : Number(row.owner_generation)
      const expectedRevision = typeof row.revision === 'number' ? row.revision : Number(row.revision)
      if (!Number.isSafeInteger(ownerGeneration) || ownerGeneration < 1
        || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
        throw new TypeError('Due card-renewal authority contains an invalid generation or revision.')
      }
      return Object.freeze({
        organizationId: row.organization_id,
        siteId: row.site_id,
        command: Object.freeze({
          schemaVersion: 1 as const,
          scope: Object.freeze({
            platformId: row.platform_id,
            organizationId: row.organization_id,
            workspaceId: row.workspace_id,
            siteId: row.site_id,
            ownerKey: row.owner_key,
            ownerGeneration,
          }),
          memberId: row.member_id,
          membershipId: row.membership_id,
          expectedRevision,
        }),
      })
    }))
  }
}

export type RecurringCloudflareBinding = Readonly<{
  organizationId: string
  siteId: string
  domainId: string
}>

export interface RecurringCloudflareSource {
  listPollableBindings(limit: number): Promise<readonly RecurringCloudflareBinding[]>
}

type CloudflareBindingRow = Readonly<{
  organization_id: string
  site_id: string
  domain_id: string
}>

export class PostgresRecurringCloudflareSource implements RecurringCloudflareSource {
  readonly #db: DbClient
  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Cloudflare recurrence discovery requires PostgreSQL authority.')
    this.#db = db
  }
  async listPollableBindings(limit: number): Promise<readonly RecurringCloudflareBinding[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new TypeError('Cloudflare recurrence discovery limit must be between 1 and 1,000.')
    }
    const { rows } = await this.#db.unsafe<CloudflareBindingRow>(`
      select binding.organization_id, binding.site_id, binding.domain_id
      from fuma_cloudflare_hostname_authority_v2 binding
      join fuma_tenant_owner_keys owner
        on owner.platform_id=binding.platform_id and owner.organization_id=binding.organization_id
        and owner.workspace_id=binding.workspace_id and owner.site_id=binding.site_id
        and owner.owner_key=binding.owner_key and owner.generation=binding.owner_generation
      join fuma_sites site
        on site.organization_id=binding.organization_id and site.workspace_id=binding.workspace_id
        and site.id=binding.site_id and site.profile_id=binding.profile_id
      join fuma_workspaces workspace
        on workspace.organization_id=binding.organization_id and workspace.id=binding.workspace_id
      join fuma_organization_profiles organization
        on organization.organization_id=binding.organization_id
      where binding.lifecycle in ('awaiting-dns','awaiting-tls','ready','active','failed','rolling-back','deleting')
        and binding.owner_state='active' and binding.transfer_fence is null
        and owner.state='active' and owner.transfer_id is null
        and owner.transfer_lock_id is null and owner.transfer_fence is null
        and site.status='active' and workspace.status='active' and organization.status='active'
      order by binding.updated_at, binding.domain_id
      limit $1
    `, [limit])
    return Object.freeze(rows.map((row) => Object.freeze({
      organizationId: row.organization_id,
      siteId: row.site_id,
      domainId: row.domain_id,
    })))
  }
}

type RecurringOccurrence = Readonly<{
  organizationId: string
  siteId?: string
  kind: RecurringJobKind
  payload: FumaJobJsonValue
  maxAttempts?: number
  priority?: number
}>

type RecurringDefinition = Readonly<{
  id: string
  intervalMs: number
  occurrences(at: Date, bucket: string): Promise<readonly RecurringOccurrence[]>
}>

function validInstant(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Recurring job producer clock is invalid.')
  }
  return value
}

function bucketAt(at: Date, intervalMs: number): string {
  const instant = validInstant(at).getTime()
  return new Date(Math.floor(instant / intervalMs) * intervalMs).toISOString()
}

function previousUtcDay(bucket: string): Readonly<{ periodStart: string; periodEnd: string }> {
  const periodEnd = Date.parse(bucket)
  if (!Number.isFinite(periodEnd)) throw new TypeError('Recurring meter bucket is invalid.')
  return Object.freeze({
    periodStart: new Date(periodEnd - RECURRING_JOB_INTERVALS.daily).toISOString(),
    periodEnd: new Date(periodEnd).toISOString(),
  })
}

function occurrenceScopeDigest(occurrence: RecurringOccurrence): string {
  return new Bun.CryptoHasher('sha256')
    .update(`${occurrence.organizationId}\u0000${occurrence.siteId ?? ''}\u0000${JSON.stringify(occurrence.payload)}`)
    .digest('hex')
    .slice(0, 32)
}

function idempotencyKey(occurrence: RecurringOccurrence, bucket: string): string {
  return `recurring:v1:${occurrence.kind}:${bucket}:${occurrenceScopeDigest(occurrence)}`
}

class DerivedRecurringJobProducer implements FumaRecurringJobProducer {
  readonly id: string
  readonly intervalMs: number
  readonly #jobs: RecurringJobEnqueuePort
  readonly #occurrences: RecurringDefinition['occurrences']

  constructor(jobs: RecurringJobEnqueuePort, definition: RecurringDefinition) {
    this.id = definition.id
    this.intervalMs = definition.intervalMs
    this.#jobs = jobs
    this.#occurrences = definition.occurrences
  }

  bucket(at: Date): string {
    return bucketAt(at, this.intervalMs)
  }

  async produce(at: Date): Promise<FumaRecurringJobProducerResult> {
    const bucket = this.bucket(at)
    const occurrences = await this.#occurrences(validInstant(at), bucket)
    let created = 0
    for (const occurrence of occurrences) {
      const result = await this.#jobs.enqueue({
        organizationId: occurrence.organizationId,
        ...(occurrence.siteId === undefined ? {} : { siteId: occurrence.siteId }),
        kind: occurrence.kind,
        payload: occurrence.payload,
        priority: occurrence.priority ?? -100,
        maxAttempts: occurrence.maxAttempts ?? 20,
        idempotencyKey: idempotencyKey(occurrence, bucket),
      })
      if (result.created) created += 1
    }
    return Object.freeze({ attempted: occurrences.length, created })
  }
}

function platformOccurrence(
  protectedOrganizationId: string,
  kind: RecurringJobKind,
  payload: FumaJobJsonValue,
): readonly RecurringOccurrence[] {
  return Object.freeze([Object.freeze({
    organizationId: protectedOrganizationId,
    kind,
    payload,
  })])
}

async function publicationOccurrences(
  sites: RecurringPublicationSiteSource,
  kind: RecurringJobKind,
  payload: FumaJobJsonValue,
): Promise<readonly RecurringOccurrence[]> {
  return Object.freeze((await sites.listActivePublicationSites()).map((site) => Object.freeze({
    organizationId: site.organizationId,
    siteId: site.siteId,
    kind,
    payload,
  })))
}

async function customerPaymentOccurrences(
  source: RecurringCustomerPaymentSource,
  kind: typeof RECURRING_JOB_KINDS.customerPaymentLifecycle,
): Promise<readonly RecurringOccurrence[]>
async function customerPaymentOccurrences(
  source: RecurringCustomerPaymentSource,
  kind: typeof RECURRING_JOB_KINDS.customerPaymentCardRenewal,
  at: Date,
): Promise<readonly RecurringOccurrence[]>
async function customerPaymentOccurrences(
  source: RecurringCustomerPaymentSource,
  kind: typeof RECURRING_JOB_KINDS.customerPaymentLifecycle | typeof RECURRING_JOB_KINDS.customerPaymentCardRenewal,
  at?: Date,
): Promise<readonly RecurringOccurrence[]> {
  if (kind === RECURRING_JOB_KINDS.customerPaymentLifecycle) {
    return Object.freeze((await source.listLifecycleSites()).map((site) => Object.freeze({
      organizationId: site.organizationId,
      siteId: site.siteId,
      kind,
      payload: Object.freeze({ schemaVersion: 1, limit: 100, cursor: null }),
    })))
  }
  if (!at) throw new TypeError('Card-renewal discovery requires a trusted instant.')
  return Object.freeze((await source.listDueCardRenewals(at, 1_000)).map((renewal) => Object.freeze({
    organizationId: renewal.organizationId,
    siteId: renewal.siteId,
    kind,
    payload: renewal.command,
    maxAttempts: 12,
    priority: 10,
  })))
}

/**
 * Produces fresh durable occurrences rather than persisting stale timestamps or
 * tenant lists in `fuma_job_schedules`. Every occurrence is admission-checked
 * through the normal job service and receives a bucketed idempotency key.
 */
export function createRecurringJobProducers(input: Readonly<{
  jobs: RecurringJobEnqueuePort
  publicationSites: RecurringPublicationSiteSource
  protectedOrganizationId: string
  customerPayments?: RecurringCustomerPaymentSource
  cloudflare?: RecurringCloudflareSource
  publicMarketingRetentionEnabled?: boolean
}>): readonly FumaRecurringJobProducer[] {
  const definitions: readonly RecurringDefinition[] = [
    {
      id: 'meter-reconciliation-daily',
      intervalMs: RECURRING_JOB_INTERVALS.daily,
      occurrences: async (_at, bucket) => platformOccurrence(
        input.protectedOrganizationId,
        RECURRING_JOB_KINDS.meterReconciliation,
        previousUtcDay(bucket),
      ),
    },
    {
      id: 'billing-dunning-hourly',
      intervalMs: RECURRING_JOB_INTERVALS.hourly,
      occurrences: async (_at, bucket) => platformOccurrence(
        input.protectedOrganizationId,
        RECURRING_JOB_KINDS.billingDunning,
        { periodKey: bucket.slice(0, 13) },
      ),
    },
    {
      id: 'quota-usage-hourly',
      intervalMs: RECURRING_JOB_INTERVALS.hourly,
      occurrences: async (_at, bucket) => platformOccurrence(
        input.protectedOrganizationId,
        RECURRING_JOB_KINDS.quotaUsageCollection,
        { observedAt: bucket },
      ),
    },
    {
      id: 'ai-credit-expiry-five-minutes',
      intervalMs: RECURRING_JOB_INTERVALS.fiveMinutes,
      occurrences: async () => platformOccurrence(
        input.protectedOrganizationId,
        RECURRING_JOB_KINDS.aiCreditExpiry,
        { limit: 1_000 },
      ),
    },
    ...(input.customerPayments ? [
      {
        id: 'customer-payment-lifecycle-five-minutes',
        intervalMs: RECURRING_JOB_INTERVALS.fiveMinutes,
        occurrences: async () => await customerPaymentOccurrences(
          input.customerPayments!,
          RECURRING_JOB_KINDS.customerPaymentLifecycle,
        ),
      },
      {
        id: 'customer-payment-card-renewal-five-minutes',
        intervalMs: RECURRING_JOB_INTERVALS.fiveMinutes,
        occurrences: async (at: Date) => await customerPaymentOccurrences(
          input.customerPayments!,
          RECURRING_JOB_KINDS.customerPaymentCardRenewal,
          at,
        ),
      },
    ] : []),
    ...(input.cloudflare ? [{
      id: 'cloudflare-reconcile-five-minutes',
      intervalMs: RECURRING_JOB_INTERVALS.fiveMinutes,
      occurrences: async (_at: Date, bucket: string) => Object.freeze(
        (await input.cloudflare!.listPollableBindings(1_000)).map((binding) => Object.freeze({
          organizationId: binding.organizationId,
          siteId: binding.siteId,
          kind: RECURRING_JOB_KINDS.cloudflareReconcile,
          payload: Object.freeze({
            domainId: binding.domainId,
            reconcileId: `poll:${binding.domainId}:${bucket}`,
          }),
          maxAttempts: 12,
        })),
      ),
    }] : []),
    {
      id: 'publication-analytics-retention-daily',
      intervalMs: RECURRING_JOB_INTERVALS.daily,
      occurrences: async () => await publicationOccurrences(
        input.publicationSites,
        RECURRING_JOB_KINDS.publicationAnalyticsRetention,
        {},
      ),
    },
    {
      id: 'publication-revision-retention-daily',
      intervalMs: RECURRING_JOB_INTERVALS.daily,
      occurrences: async () => await publicationOccurrences(
        input.publicationSites,
        RECURRING_JOB_KINDS.publicationRevisionRetention,
        { limit: 500 },
      ),
    },
    {
      id: 'publication-revision-gc-hourly',
      intervalMs: RECURRING_JOB_INTERVALS.hourly,
      occurrences: async () => await publicationOccurrences(
        input.publicationSites,
        RECURRING_JOB_KINDS.publicationRevisionGc,
        { limit: 500, graceMs: 3_600_000 },
      ),
    },
    ...(input.publicMarketingRetentionEnabled ? [{
      id: 'public-marketing-analytics-retention-daily',
      intervalMs: RECURRING_JOB_INTERVALS.daily,
      occurrences: async () => platformOccurrence(
        input.protectedOrganizationId,
        RECURRING_JOB_KINDS.publicMarketingAnalyticsRetention,
        {},
      ),
    }] : []),
  ]
  return Object.freeze(definitions.map((definition) => new DerivedRecurringJobProducer(input.jobs, definition)))
}
