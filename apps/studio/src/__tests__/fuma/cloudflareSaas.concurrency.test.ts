import { describe, expect, it } from 'bun:test'
import { CloudflareHostnameMeteringReconciler, MemoryCloudflareHostnameMeterRepository } from '../../../server/fuma/cloudflare/metering'
import {
  cloudflareDomain, cloudflareScope, createCloudflareFixture, subdomainCapability,
} from './cloudflareSaasTestFixture'

describe('FUMA-060 Cloudflare SaaS concurrency', () => {
  it('converges duplicate concurrent prevalidation to one provider create and one binding', async () => {
    const fixture = createCloudflareFixture()
    const domain = cloudflareDomain()
    const [first, second] = await Promise.all([
      fixture.reconciler.prevalidate(cloudflareScope, domain, subdomainCapability),
      fixture.reconciler.prevalidate(cloudflareScope, domain, subdomainCapability),
    ])
    expect(first).toEqual(second)
    expect(fixture.repository.bindings.size).toBe(1)
    expect(fixture.adapter.calls.filter(({ action }) => action === 'create')).toHaveLength(1)
  })

  it('converges concurrent polling under one operation fence without duplicate durable advancement', async () => {
    const fixture = createCloudflareFixture()
    const prevalidated = await fixture.reconciler.prevalidate(cloudflareScope, cloudflareDomain(), subdomainCapability)
    fixture.adapter.activate(prevalidated.binding.providerHostnameId)
    const domain = cloudflareDomain({ desired: 'validating', observed: 'dns-pending', certificate: 'provisioning', version: 2, operationFence: 2 })
    const [first, second] = await Promise.all([
      fixture.reconciler.reconcile(cloudflareScope, domain), fixture.reconciler.reconcile(cloudflareScope, domain),
    ])
    expect(first).toEqual(second)
    expect(first).toMatchObject({ lifecycle: 'ready', version: 2, reconcileFence: 2, lastEventSequence: '1' })
    expect(fixture.repository.operations.size).toBe(2)
  })

  it('allows one diagnostic winner and rejects changed evidence at the same reconcile fence', async () => {
    const fixture = createCloudflareFixture()
    const prevalidated = await fixture.reconciler.prevalidate(cloudflareScope, cloudflareDomain(), subdomainCapability)
    const results = await Promise.allSettled([
      fixture.reconciler.diagnose(cloudflareScope, cloudflareDomain(), []),
      fixture.reconciler.diagnose(cloudflareScope, cloudflareDomain(), prevalidated.records),
    ])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect((results.find(({ status }) => status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'stale' })
    expect((await fixture.reconciler.exact(cloudflareScope, 'domain-cloudflare'))?.version).toBe(2)
  })

  it('converges concurrent hostname-meter reconciliation to one immutable receipt', async () => {
    const fixture = createCloudflareFixture()
    await fixture.reconciler.prevalidate(cloudflareScope, cloudflareDomain(), subdomainCapability)
    const repository = new MemoryCloudflareHostnameMeterRepository()
    let ledgerReads = 0
    const metering = new CloudflareHostnameMeteringReconciler({
      state: fixture.repository, ledger: { async countActiveHostnames() { ledgerReads += 1; return 1 } },
      repository, pricing: fixture.reconciler, now: () => new Date('2026-07-28T13:00:00.000Z'),
    })
    const [first, second] = await Promise.all([metering.reconcile('meter-race'), metering.reconcile('meter-race')])
    expect(first).toEqual(second)
    expect(repository.values.size).toBe(1)
    expect(ledgerReads).toBe(2)
  })
})
