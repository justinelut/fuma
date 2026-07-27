import { describe, expect, it } from 'bun:test'
import type { FumaScopedJobHandlerContext } from '../../../server/fuma/jobs/integration'
import {
  HOSTED_COST_BASELINE_V1,
  METER_CLASSES,
  METER_RECONCILE_JOB_KIND,
  MemoryUsageLedger,
  MeteringService,
  VersionedCostCatalog,
  meteringJobRegistration,
  type MeterClass,
  type MeterReconciliation,
  type ProviderUsageAuthority,
} from '../../../server/fuma/metering'

const PERIOD = { periodStart: '2026-07-01T00:00:00.000Z', periodEnd: '2026-08-01T00:00:00.000Z' }
const PLATFORM_ORGANIZATION_ID = 'organization-platform'

async function harness() {
  const catalog = new VersionedCostCatalog(HOSTED_COST_BASELINE_V1, () => new Date('2026-07-27T00:00:00.000Z'))
  const totals = Object.fromEntries(await Promise.all(METER_CLASSES.map(async (meter) => [meter, (await catalog.cost(meter, 0)).fixed]))) as Record<MeterClass, bigint>
  let totalReads = 0
  const reconciliations: MeterReconciliation[] = []
  const authority: ProviderUsageAuthority = {
    async totalsForPeriod() { totalReads += 1; return totals },
    async recordReconciliation(value) { reconciliations.push(value); return reconciliations.length === 1 },
  }
  const service = new MeteringService(new MemoryUsageLedger(), catalog)
  const handler = meteringJobRegistration({ service, providerUsage: authority, protectedOrganizationId: PLATFORM_ORGANIZATION_ID })[METER_RECONCILE_JOB_KIND]
  const durable = new Map<string, unknown>()
  const context = {
    job: {
      id: 'job-meter-1', organizationId: PLATFORM_ORGANIZATION_ID, siteId: null,
      kind: METER_RECONCILE_JOB_KIND, payload: PERIOD,
    },
    jobContext: { kind: 'organization', scope: { organization: { id: PLATFORM_ORGANIZATION_ID } } },
    repositoryScope: null,
    siteRepository: null,
    readDurableResult: async (key: string) => durable.has(key) ? { result: durable.get(key) } : null,
    commitDurableResult: async (key: string, result: unknown) => { durable.set(key, result); return { result } },
  } as unknown as FumaScopedJobHandlerContext
  return { handler, context, durable, reconciliations, reads: () => totalReads }
}

describe('FUMA-052 durable reconciliation job', () => {
  it('derives protected organization authority, persists evidence, and replays the strict durable result', async () => {
    const h = await harness()
    const first = await h.handler(h.context)
    const replay = await h.handler(h.context)
    expect(replay).toEqual(first)
    expect(h.reads()).toBe(1)
    expect(h.reconciliations).toHaveLength(1)
    expect(first).toMatchObject({
      idempotencyKey: `fuma.meter-reconcile:v1:${PERIOD.periodStart}:${PERIOD.periodEnd}`,
      balanced: true,
      internalShadow: '0',
    })
  })

  it('rejects caller scope substitution and malformed durable evidence', async () => {
    const h = await harness()
    await expect(h.handler({
      ...h.context,
      job: { ...h.context.job, organizationId: 'organization-attacker' },
    } as FumaScopedJobHandlerContext)).rejects.toThrow('protected platform organization')
    const key = `fuma.meter-reconcile:v1:${PERIOD.periodStart}:${PERIOD.periodEnd}`
    h.durable.set(key, { balanced: true, injected: true })
    await expect(h.handler(h.context)).rejects.toThrow('Durable meter reconciliation result is invalid')
  })
})
