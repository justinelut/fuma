import {
  DunningJobService,
  MemoryQuotaRepository,
  QuotaCampaignAuthority,
  QuotaError,
  QuotaService,
  QuotaUsageCollector,
  type DunningAccount,
  type DunningRepository,
  type QuotaEnvelope,
  type QuotaState,
} from '../../../server/fuma/quotas'
import { METER_CLASSES, type WorkloadAssumptions } from '../../../server/fuma/metering'

const limits: QuotaEnvelope = Object.freeze({
  sites: 4,
  pages: 4,
  cmsItems: 4,
  members: 4,
  storageBytes: 4,
  bandwidthBytes: 4,
  emailRecipientsDay: 4,
  emailRecipientsMonth: 4,
  buildPublishMinutes: 4,
  pluginComputeMinutes: 4,
  aiCredits: 4,
  releaseRetentionBytes: 4,
  collaborators: 4,
  customDomains: 4,
})

function state(source: QuotaState['source'] = 'public-contract'): QuotaState {
  return {
    limits,
    used: {} as QuotaState['used'],
    reserved: {} as QuotaState['reserved'],
    topUps: {} as QuotaState['topUps'],
    source,
    sourceId: source === 'platform-internal' ? 'platform-internal' : 'contract-a',
    sourceVersion: 'v1',
  }
}

class MemoryDunning implements DunningRepository {
  account: DunningAccount
  notices: string[] = []

  constructor(account: DunningAccount) {
    this.account = account
  }

  async due(): Promise<readonly DunningAccount[]> { return [this.account] }
  async save(account: DunningAccount): Promise<void> { this.account = account }
  async notify(_account: DunningAccount, kind: 'past-due' | 'grace-expiring' | 'cancelled'): Promise<void> {
    this.notices.push(kind)
  }
}

describe('FUMA-057 centralized quota enforcement', () => {
  it('emits 50/75/90/100 notices once, enforces hard limits, and preserves existing state', async () => {
    const repository = new MemoryQuotaRepository()
    repository.states.set('org-a', state())
    const service = new QuotaService(repository)
    const emitted: number[] = []
    for (let index = 1; index <= 4; index += 1) {
      const idempotencyKey = `pages:${index}`
      const reserved = await service.admit({
        idempotencyKey,
        organizationId: 'org-a',
        workspaceId: null,
        siteId: null,
        quotaClass: 'pages',
        units: 1,
        operation: 'create',
      })
      emitted.push(...reserved.notices.map(({ percent }) => percent))
      await service.settleReservation({
        idempotencyKey,
        actual: [{ quotaClass: 'pages', units: 1 }],
      })
    }
    expect(emitted).toEqual([50, 75, 90, 100])
    await expect(service.admit({
      idempotencyKey: 'pages:exhausted',
      organizationId: 'org-a',
      workspaceId: null,
      siteId: null,
      quotaClass: 'pages',
      units: 1,
      operation: 'create',
    })).rejects.toMatchObject({ code: 'exhausted', preserveExisting: true })
    expect((await service.state('org-a')).used.pages).toBe(4)
  })

  it('atomically prevents day/month campaign oversubscription under concurrency', async () => {
    const repository = new MemoryQuotaRepository()
    repository.states.set('org-campaign', state())
    const service = new QuotaService(repository)
    const campaign = new QuotaCampaignAuthority(service)
    const scope = { organizationId: 'org-campaign', workspaceId: 'workspace-a', siteId: 'site-a' }
    const results = await Promise.allSettled([
      campaign.reserve(scope, 'campaign-a', 'a'.repeat(64), 3),
      campaign.reserve(scope, 'campaign-b', 'b'.repeat(64), 3),
    ])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ code: 'exhausted' }),
    })
    const current = await service.state('org-campaign')
    expect(current.reserved.emailRecipientsDay).toBe(3)
    expect(current.reserved.emailRecipientsMonth).toBe(3)
  })

  it('forecasts setup/import and continuously reconciles all 14 explicit classes', async () => {
    const repository = new MemoryQuotaRepository()
    repository.states.set('org-collector', state())
    const service = new QuotaService(repository)
    const collector = new QuotaUsageCollector(service)
    const workload = Object.freeze(Object.fromEntries(METER_CLASSES.map((meter) => [
      meter,
      meter.endsWith('_milliseconds') ? 60_000 : 1,
    ]))) as WorkloadAssumptions
    const forecast = await collector.forecast({
      organizationId: 'org-collector',
      kind: 'import',
      workload,
      collaborators: 1,
    })
    expect(forecast.allowed).toBe(false)
    expect(forecast.shortfalls.map(({ quotaClass }) => quotaClass)).toContain('storageBytes')
    const exact = Object.freeze(Object.fromEntries(Object.keys(limits).map((quotaClass) => [quotaClass, 1])))
    const observed = await collector.collect({
      idempotencyKey: 'continuous:all-classes',
      organizationId: 'org-collector',
      observedAt: '2026-07-29T10:00:00.000Z',
      usage: exact,
    })
    expect(observed.duplicate).toBe(false)
    const current = await service.state('org-collector')
    expect(Object.keys(current.used)).toHaveLength(14)
    expect(Object.values(current.used).every((value) => value === 1)).toBe(true)
    expect((await collector.collect({
      idempotencyKey: 'continuous:all-classes',
      organizationId: 'org-collector',
      observedAt: '2026-07-29T10:00:00.000Z',
      usage: exact,
    })).duplicate).toBe(true)
  })

  it('does not invent quota state for unknown or unverified organizations', async () => {
    const service = new QuotaService(new MemoryQuotaRepository())
    await expect(service.admit({
      idempotencyKey: 'unknown',
      organizationId: 'unknown',
      workspaceId: null,
      siteId: null,
      quotaClass: 'sites',
      units: 1,
      operation: 'create',
    })).rejects.toBeInstanceOf(QuotaError)
  })

  it('ignores protected internal accounts and transitions customer dunning through grace', async () => {
    const internal = new MemoryDunning({
      organizationId: 'fuma-platform',
      source: 'platform-internal',
      paymentState: 'past-due',
      graceEndsAt: null,
    })
    expect(await new DunningJobService(internal, () => new Date('2026-07-29T00:00:00Z')).run()).toEqual({ transitioned: 0, notified: 0 })
    expect(internal.notices).toEqual([])

    const customer = new MemoryDunning({
      organizationId: 'org-a',
      source: 'public-contract',
      paymentState: 'past-due',
      graceEndsAt: null,
    })
    expect(await new DunningJobService(customer, () => new Date('2026-07-29T00:00:00Z')).run()).toEqual({ transitioned: 1, notified: 1 })
    expect(customer.account).toMatchObject({ paymentState: 'grace', graceEndsAt: '2026-08-05T00:00:00.000Z' })
    customer.account = { ...customer.account, graceEndsAt: '2026-07-28T00:00:00.000Z' }
    await new DunningJobService(customer, () => new Date('2026-07-29T00:00:00Z')).run()
    expect(customer.account).toMatchObject({ paymentState: 'cancelled', graceEndsAt: null })
    expect(customer.notices).toEqual(['past-due', 'cancelled'])
  })
})
