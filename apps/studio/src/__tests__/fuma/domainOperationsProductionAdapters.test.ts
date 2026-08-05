import { describe, expect, it } from 'bun:test'
import { ProductionDomainDnsObserver } from '../../../server/fuma/domainOperations/productionAdapters'
import { RegistrarTransferGatewayAdapter } from '../../../server/fuma/domainOperations/productionRegistrarTransfer'
import type { CustomerDnsSettings } from '../../../server/fuma/domainOperations/contracts'
import type { RegistrarGatewayRequest } from '../../../server/fuma/registrar/productionGateway'

const settings: CustomerDnsSettings = {
  platformId: 'fuma', organizationId: 'organization-a', workspaceId: 'workspace-a', siteId: 'site-a',
  ownerKey: 'owner-a', generation: 1, state: 'active', transferFence: null, profileId: 'website',
  domainId: 'domain-a', hostname: 'www.example.co.ke',
  records: [
    { type: 'CNAME', name: 'www.example.co.ke', value: 'customers.trimly.co.ke', purpose: 'routing' },
    { type: 'TXT', name: '_cf-custom-hostname.www.example.co.ke', value: 'verify-a', purpose: 'ownership' },
  ],
  authoritativeDnsRetainedByCustomer: true, customerCloudflareAccountRequired: false, customerCloudflareTokenRequired: false,
  automation: { mode: 'manual', credentialId: null, credentialState: null },
  apexAlternatives: [{ kind: 'www-cname', available: true, instruction: 'Use www.' }],
  launchState: 'awaiting-records', version: 1, operationFence: 1, updatedAt: '2026-08-04T12:00:00.000Z',
}

describe('domain operations production adapters', () => {
  it('observes public DNS independently and uses the exact Cloudflare binding for TLS state', async () => {
    const observer = new ProductionDomainDnsObserver({
      now: () => new Date('2026-08-04T12:05:00.000Z'),
      dns: {
        async resolveCname() { return ['customers.trimly.co.ke.'] },
        async resolveTxt() { return [['verify-', 'a']] },
        async resolve4() { return [] },
      },
      cloudflare: { async exact() { return { sslStatus: 'active' } as never } },
    })
    expect(await observer.observe(settings)).toEqual({
      records: settings.records,
      tls: 'active',
      observedAt: '2026-08-04T12:05:00.000Z',
    })
  })

  it('submits and returns registrar transfer secrets only through strict gateway envelopes', async () => {
    const requests: RegistrarGatewayRequest[] = []
    const adapter = new RegistrarTransferGatewayAdapter({
      origin: 'https://registrar.example',
      token: new TextEncoder().encode('registrar-token-123456789'),
      http: {
        async request(input) {
          requests.push(input)
          if (input.url.endsWith('/outbound')) return { status: 200, body: { providerReference: 'transfer-a', authCode: 'secret-code', expiresAt: '2026-08-04T13:00:00.000Z' } }
          if (input.url.endsWith('/status')) return { status: 200, body: { state: 'completed', ownership: 'external', failureCode: null } }
          return { status: 200, body: {} }
        },
      },
    })
    const outbound = await adapter.submitOutbound('www.example.co.ke', 'outbound-a')
    expect(new TextDecoder().decode(outbound.authCode)).toBe('secret-code')
    outbound.authCode.fill(0)
    expect(await adapter.status('transfer-a')).toEqual({ state: 'completed', ownership: 'external', failureCode: null })
    expect(requests[0]?.headers.authorization).toBe('Bearer registrar-token-123456789')
    adapter.close()
    await expect(adapter.status('transfer-a')).rejects.toThrow('closed')
  })
})
