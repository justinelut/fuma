import { describe, expect, it } from 'bun:test'
import { CloudflareForSaasApiAdapter, CloudflareTransportError, type CloudflareHttpRequest } from '../../../server/fuma/cloudflare/adapter'
import { createCloudflareRouteDeclarations } from '../../../server/fuma/cloudflare/routes'
import { cloudflareDomain, cloudflareScope, createCloudflareFixture, subdomainCapability } from './cloudflareSaasTestFixture'

function providerEnvelope() {
  return {
    success: true,
    result: {
      id: 'provider-hostname-1', hostname: 'www.customer.example', status: 'pending', ownership_verified: false,
      ownership_verification: { type: 'txt', name: '_cf-custom-hostname.www.customer.example', value: 'ownership-proof' },
      ssl: { status: 'pending', validation_records: [{ type: 'txt', name: '_acme-challenge.www.customer.example', value: 'tls-proof' }] },
    },
  }
}

describe('FUMA-060 Cloudflare SaaS security', () => {
  it('keeps production network execution injected, uses only the platform bearer token, and fails closed after disposal', async () => {
    const requests: CloudflareHttpRequest[] = []
    const adapter = new CloudflareForSaasApiAdapter({
      apiOrigin: 'https://api.cloudflare.example', zoneId: 'zone_1',
      apiToken: new TextEncoder().encode('platform-token-1234567890'),
      http: { async request(input) { requests.push(input); return { status: 200, body: providerEnvelope() } } },
    })
    const result = await adapter.create('WWW.CUSTOMER.EXAMPLE', 'create-idempotency-1')
    expect(result.hostname).toBe('www.customer.example')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      method: 'POST', url: 'https://api.cloudflare.example/client/v4/zones/zone_1/custom_hostnames',
      headers: { authorization: 'Bearer platform-token-1234567890', 'x-fuma-idempotency-key': 'create-idempotency-1' },
    })
    expect(JSON.stringify(result)).not.toContain('platform-token-1234567890')
    adapter.close()
    await expect(adapter.read('provider-hostname-1')).rejects.toBeInstanceOf(CloudflareTransportError)
    expect(requests).toHaveLength(1)
  })

  it('isolates bindings by complete domain authority and rejects crossed domain scope', async () => {
    const fixture = createCloudflareFixture()
    await fixture.reconciler.prevalidate(cloudflareScope, cloudflareDomain(), subdomainCapability)
    const foreignScope = { ...cloudflareScope, organizationId: 'org-foreign', workspaceId: 'workspace-foreign', siteId: 'site-foreign', ownerKey: 'owner-foreign' }
    expect(await fixture.reconciler.exact(foreignScope, 'domain-cloudflare')).toBeNull()
    await expect(fixture.reconciler.prevalidate(foreignScope, cloudflareDomain(), subdomainCapability)).rejects.toMatchObject({ code: 'scope' })
  })

  it('rejects malformed and foreign provider events without advancing durable state', async () => {
    const fixture = createCloudflareFixture()
    const prevalidated = await fixture.reconciler.prevalidate(cloudflareScope, cloudflareDomain(), subdomainCapability)
    await expect(fixture.reconciler.reconcileEvent(cloudflareScope, cloudflareDomain(), {
      sequence: '1', observedAt: '2026-07-28T12:01:00.000Z',
      provider: { ...fixture.adapter.records.get(prevalidated.binding.providerHostnameId), id: 'provider-foreign' },
    })).rejects.toMatchObject({ code: 'scope' })
    await expect(fixture.reconciler.reconcileEvent(cloudflareScope, cloudflareDomain(), {
      sequence: '1', observedAt: '2026-07-28T12:01:00.000Z', unexpectedAuthority: 'org-foreign',
      provider: fixture.adapter.records.get(prevalidated.binding.providerHostnameId),
    })).rejects.toThrow('strict TypeBox validation')
    expect((await fixture.reconciler.exact(cloudflareScope, 'domain-cloudflare'))?.version).toBe(1)
  })

  it('returns no-store redacted route failures and never leaks provider errors or foreign records', async () => {
    const fixture = createCloudflareFixture()
    const routes = createCloudflareRouteDeclarations({ reconciler: fixture.reconciler, domains: { async exact() { return null } } })
    const get = routes.find((route) => route.method === 'GET')!
    const { profileId: _profileId, ...repositoryScope } = cloudflareScope
    const request = {
      request: new Request('https://5174.blyss.co.ke/settings/domains/domain-cloudflare/cloudflare'),
      params: { domainId: 'domain-cloudflare' }, repositoryScope, context: { profile: { id: 'website' } },
    }
    const response = await get.handler(request as never)
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'Resource not found.', alternatives: [] })

    await fixture.reconciler.prevalidate(cloudflareScope, cloudflareDomain(), subdomainCapability)
    const providerRoutes = createCloudflareRouteDeclarations({
      reconciler: fixture.reconciler, domains: { async exact() { return cloudflareDomain() } },
    })
    const reconcile = providerRoutes.find((route) => route.path.endsWith('/reconcile'))!
    fixture.adapter.failNext('read')
    const providerFailure = await reconcile.handler({ ...request, request: new Request(request.request.url, { method: 'POST', body: '{}' }) } as never)
    expect(providerFailure.status).toBe(502)
    expect(await providerFailure.json()).toEqual({ error: 'Cloudflare is temporarily unavailable.', alternatives: [] })
  })
})
