import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import { CloudflareHostnameMeteringReconciler, MemoryCloudflareHostnameMeterRepository } from '../../../server/fuma/cloudflare/metering'
import { assertDomainRouteActive, CloudflareReconcileError } from '../../../server/fuma/cloudflare/reconciler'
import { CloudflareBindingSchema } from '../../../server/fuma/cloudflare/contracts'
import {
  cloudflareDomain, cloudflareScope, createCloudflareFixture, makeCloudflareActive,
  makeCloudflareReady, subdomainCapability,
} from './cloudflareSaasTestFixture'

describe('FUMA-060 Cloudflare SaaS unit', () => {
  it('prevalidates a customer-owned www host with exact records and no customer Cloudflare credentials', async () => {
    const fixture = createCloudflareFixture()
    const result = await fixture.reconciler.prevalidate(cloudflareScope, cloudflareDomain(), subdomainCapability)
    expect(result).toMatchObject({
      customerAccountRequired: false, customerTokenRequired: false, authoritativeDnsRetainedByCustomer: true,
      binding: { lifecycle: 'awaiting-dns', providerStatus: 'pending', sslStatus: 'pending', ownershipVerified: false },
    })
    expect(result.records).toEqual([
      { type: 'CNAME', name: 'www.customer.example', value: 'customers.trimly.co.ke', purpose: 'routing' },
      { type: 'TXT', name: '_cf-custom-hostname.www.customer.example', value: 'verify-www.customer.example', purpose: 'ownership' },
      { type: 'TXT', name: '_acme-challenge.www.customer.example', value: 'tls-www.customer.example', purpose: 'tls-validation' },
    ])
    expect(JSON.stringify(result)).not.toMatch(/authorization|bearer|api.?token|credential/i)
    expect(Value.Check(CloudflareBindingSchema, result.binding)).toBe(true)
  })

  it('polls ownership and TLS, then permits explicit cutover and active-only routing', async () => {
    const fixture = await makeCloudflareReady()
    expect(fixture.ready).toMatchObject({ lifecycle: 'ready', providerStatus: 'active', sslStatus: 'active', ownershipVerified: true })
    expect(() => assertDomainRouteActive(fixture.validating)).toThrow(CloudflareReconcileError)
    const cutoverDomain = cloudflareDomain({
      desired: 'validating', observed: 'dns-valid', certificate: 'active', version: 3, operationFence: 3,
    })
    const active = await fixture.reconciler.cutover(cloudflareScope, cutoverDomain)
    expect(active.lifecycle).toBe('active')
    expect(fixture.transitions.calls.at(-1)).toMatchObject({ desired: 'active', observed: 'active', certificate: 'active', reasonCode: 'cutover-approved' })
    expect(() => assertDomainRouteActive(cloudflareDomain({ desired: 'active', observed: 'active', certificate: 'active' }))).not.toThrow()
  })

  it('diagnoses exact record drift and deletes provider state with cache purge', async () => {
    const fixture = await makeCloudflareActive()
    const activeDomain = cloudflareDomain({ desired: 'active', observed: 'active', certificate: 'active', version: 4, operationFence: 4 })
    const diagnosed = await fixture.reconciler.diagnose(cloudflareScope, activeDomain, [])
    expect(diagnosed.diagnostics.map(({ code }) => code)).toEqual(['cname-missing', 'ownership-missing', 'tls-validation-missing'])
    const removed = await fixture.reconciler.remove(cloudflareScope, activeDomain)
    expect(removed).toMatchObject({ lifecycle: 'deleted', providerStatus: 'deleted' })
    expect(fixture.adapter.purged).toEqual(['www.customer.example'])
    expect(fixture.transitions.calls.at(-1)).toMatchObject({ desired: 'deleted', observed: 'deleted', certificate: 'revoked' })
  })

  it('blocks universal apex and exposes supported alternatives until every Enterprise gate passes', () => {
    const fixture = createCloudflareFixture()
    const capability = { ...subdomainCapability, alias: true, aname: true, cnameFlattening: true }
    expect(() => fixture.reconciler.assertApex('customer.co.ke', capability)).toThrow(CloudflareReconcileError)
    try { fixture.reconciler.assertApex('customer.co.ke', capability) } catch (error) {
      expect(error).toMatchObject({ code: 'unsupported-apex' })
      expect((error as CloudflareReconcileError).alternatives).toEqual([
        'Use www.customer.co.ke with the CNAME-first launch path', 'Use provider-supported ALIAS',
        'Use provider-supported ANAME', 'Use provider-supported CNAME flattening',
        'Redirect the apex to www.customer.co.ke at the registrar',
      ])
    }
    expect(() => fixture.reconciler.assertApex('customer.co.ke', {
      ...capability, enterpriseApex: true, actualQuoteApproved: true, securityReviewApproved: true, marginGatePassed: true,
    })).not.toThrow()
  })

  it('uses the dated finite Cloudflare baseline and reconciles provider count against the usage ledger', async () => {
    const fixture = createCloudflareFixture()
    expect(fixture.reconciler.hostnameCost(100)).toEqual({ included: 100, paygMaximum: 50_000, additional: 0, unitUsdCents: 10, totalUsdCents: 0, baselineDate: '2026-07-23' })
    expect(fixture.reconciler.hostnameCost(105)).toMatchObject({ additional: 5, totalUsdCents: 50 })
    expect(() => fixture.reconciler.hostnameCost(50_001)).toThrow(CloudflareReconcileError)
    await fixture.reconciler.prevalidate(cloudflareScope, cloudflareDomain(), subdomainCapability)
    const repository = new MemoryCloudflareHostnameMeterRepository()
    const metering = new CloudflareHostnameMeteringReconciler({
      state: fixture.repository, ledger: { async countActiveHostnames() { return 3 } }, repository,
      pricing: fixture.reconciler, now: () => new Date('2026-07-28T13:00:00.000Z'),
    })
    const result = await metering.reconcile('meter-2026-07-28')
    expect(result).toEqual({
      reconciliationId: 'meter-2026-07-28', observedHostnames: 1, ledgerHostnames: 3, delta: -2,
      included: 100, paygMaximum: 50_000, unitUsdCents: 10, totalUsdCents: 0,
      baselineDate: '2026-07-23', observedAt: '2026-07-28T13:00:00.000Z',
    })
    expect(await metering.reconcile('meter-2026-07-28')).toEqual(result)
  })
})
