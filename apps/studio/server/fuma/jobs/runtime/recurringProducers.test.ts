import { describe, expect, it } from 'bun:test'
import type { EnqueueFumaJob } from '../contracts'
import type { FumaScopedJobHandlerContext } from '../integration'
import { FumaRedisCoordination } from '../../redis'
import { FumaJobScheduler, type FumaRecurringJobProducer } from '../scheduler'
import {
  DeterministicRedisDriver,
  DeterministicRedisServer,
} from '../../../../src/__tests__/helpers/fuma/deterministicRedis'
import {
  DeterministicJobReadyQueue,
  InMemoryFumaJobRepository,
} from '../../../../src/__tests__/helpers/fuma/deterministicJobs'
import {
  RECURRING_JOB_KINDS,
  createRecurringJobProducers,
  type RecurringCardRenewal,
  type RecurringCloudflareBinding,
  type RecurringCloudflareSource,
  type RecurringCustomerPaymentSource,
  type RecurringJobEnqueuePort,
  type RecurringPublicationSite,
  type RecurringPublicationSiteSource,
} from './recurringProducers'
import { publicMarketingAnalyticsRetentionJobRegistration } from './publicMarketingRetention'

class RecordingJobs implements RecurringJobEnqueuePort {
  readonly inputs: EnqueueFumaJob[] = []
  readonly #keys = new Set<string>()

  async enqueue(input: EnqueueFumaJob): Promise<Readonly<{ created: boolean }>> {
    this.inputs.push(structuredClone(input))
    const key = input.idempotencyKey
    if (!key) throw new Error('Recurring jobs must have an idempotency key.')
    const created = !this.#keys.has(key)
    this.#keys.add(key)
    return { created }
  }
}

class MutablePublicationSites implements RecurringPublicationSiteSource {
  sites: readonly RecurringPublicationSite[] = []
  calls = 0

  async listActivePublicationSites(): Promise<readonly RecurringPublicationSite[]> {
    this.calls += 1
    return structuredClone(this.sites)
  }
}

class MutableCustomerPayments implements RecurringCustomerPaymentSource {
  lifecycleSites: readonly RecurringPublicationSite[] = []
  renewals: readonly RecurringCardRenewal[] = []
  lifecycleCalls = 0
  renewalCalls = 0

  async listLifecycleSites(): Promise<readonly RecurringPublicationSite[]> {
    this.lifecycleCalls += 1
    return structuredClone(this.lifecycleSites)
  }

  async listDueCardRenewals(_at: Date, _limit: number): Promise<readonly RecurringCardRenewal[]> {
    this.renewalCalls += 1
    return structuredClone(this.renewals)
  }
}

class MutableCloudflare implements RecurringCloudflareSource {
  bindings: readonly RecurringCloudflareBinding[] = []
  calls = 0
  async listPollableBindings(_limit: number): Promise<readonly RecurringCloudflareBinding[]> {
    this.calls += 1
    return structuredClone(this.bindings)
  }
}

function producerMap(
  jobs: RecordingJobs,
  sites: MutablePublicationSites,
  customer = new MutableCustomerPayments(),
  cloudflare?: MutableCloudflare,
) {
  return new Map(createRecurringJobProducers({
    jobs,
    publicationSites: sites,
    customerPayments: customer,
    ...(cloudflare ? { cloudflare } : {}),
    protectedOrganizationId: 'fuma-platform',
    publicMarketingRetentionEnabled: true,
  }).map((producer) => [producer.id, producer]))
}

describe('recurring durable job producers', () => {
  it('derives exact UTC periods and stable occurrence keys without stale schedule payloads', async () => {
    const jobs = new RecordingJobs()
    const sites = new MutablePublicationSites()
    sites.sites = [
      { organizationId: 'organization-a', siteId: 'site-a' },
      { organizationId: 'organization-b', siteId: 'site-b' },
    ]
    const producers = producerMap(jobs, sites)
    const now = new Date('2026-08-04T06:58:10.008Z')

    for (const producer of producers.values()) await producer.produce(now)

    expect(jobs.inputs).toHaveLength(11)
    expect(jobs.inputs.find(({ kind }) => kind === RECURRING_JOB_KINDS.meterReconciliation)?.payload).toEqual({
      periodStart: '2026-08-03T00:00:00.000Z',
      periodEnd: '2026-08-04T00:00:00.000Z',
    })
    expect(jobs.inputs.find(({ kind }) => kind === RECURRING_JOB_KINDS.billingDunning)?.payload)
      .toEqual({ periodKey: '2026-08-04T06' })
    expect(jobs.inputs.find(({ kind }) => kind === RECURRING_JOB_KINDS.quotaUsageCollection)?.payload)
      .toEqual({ observedAt: '2026-08-04T06:00:00.000Z' })
    expect(jobs.inputs.find(({ kind }) => kind === RECURRING_JOB_KINDS.aiCreditExpiry)?.payload)
      .toEqual({ limit: 1_000 })

    for (const input of jobs.inputs) {
      expect(input.idempotencyKey).toMatch(/^recurring:v1:/)
      expect(JSON.stringify(input.payload)).not.toContain(input.organizationId)
      if (input.siteId) expect(JSON.stringify(input.payload)).not.toContain(input.siteId)
    }

    const firstKeys = jobs.inputs.map(({ idempotencyKey }) => idempotencyKey)
    for (const producer of producers.values()) expect((await producer.produce(now)).created).toBe(0)
    expect(jobs.inputs.slice(firstKeys.length).map(({ idempotencyKey }) => idempotencyKey)).toEqual(firstKeys)
  })

  it('enumerates current active publication scopes independently at each due bucket', async () => {
    const jobs = new RecordingJobs()
    const sites = new MutablePublicationSites()
    sites.sites = [{ organizationId: 'organization-a', siteId: 'site-a' }]
    const producers = producerMap(jobs, sites)
    const analytics = producers.get('publication-analytics-retention-daily')!

    expect(await analytics.produce(new Date('2026-08-04T08:00:00.000Z'))).toEqual({ attempted: 1, created: 1 })
    sites.sites = [{ organizationId: 'organization-b', siteId: 'site-b' }]
    expect(await analytics.produce(new Date('2026-08-05T08:00:00.000Z'))).toEqual({ attempted: 1, created: 1 })

    expect(sites.calls).toBe(2)
    expect(jobs.inputs.map(({ organizationId, siteId }) => ({ organizationId, siteId }))).toEqual([
      { organizationId: 'organization-a', siteId: 'site-a' },
      { organizationId: 'organization-b', siteId: 'site-b' },
    ])
  })

  it('emits site-scoped lifecycle work and exact collision-safe due-card revisions', async () => {
    const jobs = new RecordingJobs()
    const sites = new MutablePublicationSites()
    const customer = new MutableCustomerPayments()
    customer.lifecycleSites = [{ organizationId: 'organization-a', siteId: 'site-a' }]
    const scope = {
      platformId: 'fuma', organizationId: 'organization-a', workspaceId: 'workspace-a',
      siteId: 'site-a', ownerKey: 'owner-a', ownerGeneration: 4,
    } as const
    customer.renewals = [
      { organizationId: 'organization-a', siteId: 'site-a', command: { schemaVersion: 1, scope, memberId: 'member-a', membershipId: 'membership-a', expectedRevision: 3 } },
      { organizationId: 'organization-a', siteId: 'site-a', command: { schemaVersion: 1, scope, memberId: 'member-b', membershipId: 'membership-b', expectedRevision: 8 } },
    ]
    const producers = producerMap(jobs, sites, customer)
    const now = new Date('2026-08-04T07:00:00.000Z')

    expect(await producers.get('customer-payment-lifecycle-five-minutes')!.produce(now)).toEqual({ attempted: 1, created: 1 })
    expect(await producers.get('customer-payment-card-renewal-five-minutes')!.produce(now)).toEqual({ attempted: 2, created: 2 })

    expect(jobs.inputs.map(({ kind, organizationId, siteId }) => ({ kind, organizationId, siteId }))).toEqual([
      { kind: RECURRING_JOB_KINDS.customerPaymentLifecycle, organizationId: 'organization-a', siteId: 'site-a' },
      { kind: RECURRING_JOB_KINDS.customerPaymentCardRenewal, organizationId: 'organization-a', siteId: 'site-a' },
      { kind: RECURRING_JOB_KINDS.customerPaymentCardRenewal, organizationId: 'organization-a', siteId: 'site-a' },
    ])
    expect(jobs.inputs[0]?.payload).toEqual({ schemaVersion: 1, limit: 100, cursor: null })
    expect(jobs.inputs[1]?.payload).toMatchObject({ membershipId: 'membership-a', expectedRevision: 3 })
    expect(jobs.inputs[2]?.payload).toMatchObject({ membershipId: 'membership-b', expectedRevision: 8 })
    expect(new Set(jobs.inputs.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(3)
    expect(customer.lifecycleCalls).toBe(1)
    expect(customer.renewalCalls).toBe(1)
  })

  it('emits exact site-scoped Cloudflare polling identities for current bindings', async () => {
    const jobs = new RecordingJobs()
    const sites = new MutablePublicationSites()
    const cloudflare = new MutableCloudflare()
    cloudflare.bindings = [{ organizationId: 'organization-a', siteId: 'site-a', domainId: 'domain-a' }]
    const producers = producerMap(jobs, sites, new MutableCustomerPayments(), cloudflare)
    const now = new Date('2026-08-04T07:03:00.000Z')

    expect(await producers.get('cloudflare-reconcile-five-minutes')!.produce(now)).toEqual({ attempted: 1, created: 1 })
    expect(jobs.inputs[0]).toMatchObject({
      organizationId: 'organization-a',
      siteId: 'site-a',
      kind: RECURRING_JOB_KINDS.cloudflareReconcile,
      payload: { domainId: 'domain-a', reconcileId: 'poll:domain-a:2026-08-04T07:00:00.000Z' },
    })
    expect(cloudflare.calls).toBe(1)
  })

  it('covers only recurring maintenance kinds and leaves event-driven handlers unproduced', () => {
    expect(Object.values(RECURRING_JOB_KINDS).toSorted()).toEqual([
      'fuma.ai-credit-expiry',
      'fuma.billing-dunning',
      'fuma.cloudflare-reconcile',
      'fuma.customer-payment-card-renewal',
      'fuma.customer-payment-lifecycle',
      'fuma.meter-reconcile',
      'fuma.public-marketing-analytics-retention',
      'fuma.quota-usage-collection',
      'publication.analytics-retention',
      'publication.revision-gc',
      'publication.revision-retention',
    ])
    for (const eventDriven of [
      'fuma.billing-reconcile',
      'fuma.publish-release',
      'publication.newsletter-send',
      'publication.publish-due',
      'publication.schedule-due',
      'publication.revision-periodic',
      'fuma.registrar-renew',
      'fuma.domain-transfer',
      'transfer.execute',
    ]) {
      expect(Object.values(RECURRING_JOB_KINDS)).not.toContain(eventDriven)
    }
  })

  it('runs each producer once per local bucket under the scheduler Redis lease', async () => {
    let now = new Date('2026-08-04T06:58:10.008Z')
    let executions = 0
    const producer: FumaRecurringJobProducer = {
      id: 'focused-hourly-producer',
      intervalMs: 3_600_000,
      bucket: (at) => new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000).toISOString(),
      async produce() {
        executions += 1
        return { attempted: 1, created: 1 }
      },
    }
    const repository = new InMemoryFumaJobRepository()
    const readyQueue = new DeterministicJobReadyQueue()
    const redis = new DeterministicRedisServer(() => now.getTime())
    const coordination = new FumaRedisCoordination({
      namespace: 'recurring-producer-test',
      driver: new DeterministicRedisDriver(redis),
      nowMs: () => now.getTime(),
    })
    await coordination.connect()
    const scheduler = new FumaJobScheduler({
      repository,
      readyQueue,
      coordination,
      admission: { maxActivePerOrganization: 100, maxActivePerSite: 100 },
      schedulerId: 'scheduler-recurring-test',
      producers: [producer],
      now: () => now,
    })

    expect(await scheduler.runOnce()).toBe(1)
    expect(await scheduler.runOnce()).toBe(0)
    now = new Date('2026-08-04T07:00:00.000Z')
    expect(await scheduler.runOnce()).toBe(1)
    expect(executions).toBe(2)
    await coordination.close()
  })

  it('adapts public marketing retention to strict protected durable replay', async () => {
    let executions = 0
    const effects = new Map<string, unknown>()
    const handler = publicMarketingAnalyticsRetentionJobRegistration({
      protectedOrganizationId: 'fuma-platform',
    publicMarketingRetentionEnabled: true,
      retention: {
        async run(payload) {
          expect(payload).toEqual({})
          executions += 1
          return {
            rawEventsDeleted: 2,
            aggregatesDeleted: 1,
            rawBefore: '2026-07-05T00:00:00.000Z',
            aggregatesBefore: '2025-07-01',
          }
        },
      },
    })[RECURRING_JOB_KINDS.publicMarketingAnalyticsRetention]
    const context = {
      job: {
        id: 'public-retention-2026-08-04',
        organizationId: 'fuma-platform',
        siteId: null,
        kind: RECURRING_JOB_KINDS.publicMarketingAnalyticsRetention,
        payload: {},
      },
      jobContext: { kind: 'organization', scope: { organization: { id: 'fuma-platform' } } },
      repositoryScope: null,
      siteRepository: null,
      readDurableResult: async (key: string) => effects.has(key) ? { result: effects.get(key) } : null,
      commitDurableResult: async (key: string, result: unknown) => {
        effects.set(key, result)
        return { result, created: true }
      },
    } as unknown as FumaScopedJobHandlerContext

    expect(await handler(context)).toMatchObject({ rawEventsDeleted: 2, aggregatesDeleted: 1 })
    expect(await handler(context)).toMatchObject({ rawEventsDeleted: 2, aggregatesDeleted: 1 })
    expect(executions).toBe(1)
  })
})
