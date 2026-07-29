import { describe, expect, it } from 'bun:test'
import {
  cloudflareDomain, cloudflareScope, createCloudflareFixture, makeCloudflareActive,
  makeCloudflareReady, subdomainCapability,
} from './cloudflareSaasTestFixture'

describe('FUMA-060 Cloudflare SaaS fault handling', () => {
  it('leaves no durable binding on create failure and converges under the same retry identity', async () => {
    const fixture = createCloudflareFixture()
    fixture.adapter.failNext('create')
    await expect(fixture.reconciler.prevalidate(cloudflareScope, cloudflareDomain(), subdomainCapability)).rejects.toMatchObject({ code: 'provider' })
    expect(await fixture.reconciler.exact(cloudflareScope, 'domain-cloudflare')).toBeNull()
    const retry = await fixture.reconciler.prevalidate(cloudflareScope, cloudflareDomain(), subdomainCapability)
    const replay = await fixture.reconciler.prevalidate(cloudflareScope, cloudflareDomain(), subdomainCapability)
    expect(replay).toEqual(retry)
    expect(fixture.adapter.calls.filter(({ action }) => action === 'create')).toHaveLength(1)
  })

  it('keeps TLS-delayed hosts non-routable and blocks cutover until the certificate is active', async () => {
    const fixture = createCloudflareFixture()
    const prevalidated = await fixture.reconciler.prevalidate(cloudflareScope, cloudflareDomain(), subdomainCapability)
    fixture.adapter.setState(prevalidated.binding.providerHostnameId, { status: 'active', ownershipVerified: true, sslStatus: 'pending' })
    const delayed = await fixture.reconciler.reconcile(cloudflareScope, cloudflareDomain({ desired: 'validating', observed: 'dns-pending', certificate: 'provisioning', version: 2, operationFence: 2 }))
    expect(delayed.lifecycle).toBe('awaiting-tls')
    await expect(fixture.reconciler.cutover(cloudflareScope, cloudflareDomain({ desired: 'validating', observed: 'dns-valid', certificate: 'provisioning' }))).rejects.toMatchObject({ code: 'tls-pending' })
  })

  it('ignores duplicate and stale events while accepting one newer provider event', async () => {
    const fixture = createCloudflareFixture()
    const prevalidated = await fixture.reconciler.prevalidate(cloudflareScope, cloudflareDomain(), subdomainCapability)
    fixture.adapter.activate(prevalidated.binding.providerHostnameId)
    const provider = fixture.adapter.records.get(prevalidated.binding.providerHostnameId)!
    const domain = cloudflareDomain({ desired: 'validating', observed: 'dns-pending', certificate: 'provisioning', version: 2, operationFence: 2 })
    const accepted = await fixture.reconciler.reconcileEvent(cloudflareScope, domain, { sequence: '7', provider, observedAt: '2026-07-28T12:07:00.000Z' })
    const duplicate = await fixture.reconciler.reconcileEvent(cloudflareScope, domain, { sequence: '7', provider: { ...provider, status: 'blocked' }, observedAt: '2026-07-28T12:08:00.000Z' })
    const stale = await fixture.reconciler.reconcileEvent(cloudflareScope, domain, { sequence: '6', provider: { ...provider, status: 'blocked' }, observedAt: '2026-07-28T12:09:00.000Z' })
    expect(duplicate).toEqual(accepted)
    expect(stale).toEqual(accepted)
    expect(accepted).toMatchObject({ lifecycle: 'ready', lastEventSequence: '7', version: 2 })
  })

  it('persists rollback intent before purge failure and safely resumes to detached', async () => {
    const fixture = await makeCloudflareActive()
    const domain = cloudflareDomain({ desired: 'active', observed: 'active', certificate: 'active', version: 4, operationFence: 4 })
    fixture.adapter.failNext('purge')
    await expect(fixture.reconciler.rollback(cloudflareScope, domain)).rejects.toMatchObject({ code: 'provider' })
    expect(await fixture.reconciler.exact(cloudflareScope, domain.domainId)).toMatchObject({ lifecycle: 'rolling-back' })
    const resumed = await fixture.reconciler.rollback(cloudflareScope, domain)
    expect(resumed.lifecycle).toBe('detached')
    expect(fixture.adapter.purged).toEqual(['www.customer.example'])
  })

  it('persists deletion intent before provider failure and resumes deletion and purge exactly once', async () => {
    const fixture = await makeCloudflareReady()
    const domain = cloudflareDomain({ desired: 'validating', observed: 'dns-valid', certificate: 'active', version: 3, operationFence: 3 })
    fixture.adapter.failNext('delete')
    await expect(fixture.reconciler.remove(cloudflareScope, domain)).rejects.toMatchObject({ code: 'provider' })
    expect(await fixture.reconciler.exact(cloudflareScope, domain.domainId)).toMatchObject({ lifecycle: 'deleting' })
    const deleted = await fixture.reconciler.remove(cloudflareScope, domain)
    expect(deleted).toMatchObject({ lifecycle: 'deleted', providerStatus: 'deleted' })
    expect(fixture.adapter.calls.filter(({ action }) => action === 'delete')).toHaveLength(1)
    expect(fixture.adapter.purged).toEqual(['www.customer.example'])
  })
})
