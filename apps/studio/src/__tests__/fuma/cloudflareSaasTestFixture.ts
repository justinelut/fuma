import type { DomainRecord, DomainScope } from '../../../server/fuma/domains/contracts'
import { FakeCloudflareSaasAdapter } from '../../../server/fuma/cloudflare/adapter'
import type { ApexCapability, CloudflareBinding } from '../../../server/fuma/cloudflare/contracts'
import { CloudflareSaasReconciler, type CloudflareDomainTransition } from '../../../server/fuma/cloudflare/reconciler'
import { MemoryCloudflareStateRepository } from '../../../server/fuma/cloudflare/repository'

export const CLOUDFLARE_T0 = '2026-07-28T12:00:00.000Z'
export const cloudflareScope: DomainScope = Object.freeze({
  platformId: 'fuma', organizationId: 'org-cloudflare', workspaceId: 'workspace-cloudflare',
  siteId: 'site-cloudflare', ownerKey: 'owner-cloudflare', generation: 1,
  state: 'active', transferFence: null, profileId: 'website',
})
export const subdomainCapability: ApexCapability = Object.freeze({
  alias: false, aname: false, cnameFlattening: false, registrarRedirect: true,
  enterpriseApex: false, actualQuoteApproved: false, securityReviewApproved: false, marginGatePassed: false,
})

export function cloudflareDomain(overrides: Partial<DomainRecord> = {}): DomainRecord {
  return Object.freeze({
    ...cloudflareScope, domainId: 'domain-cloudflare', hostname: 'www.customer.example',
    unicodeHostname: 'www.customer.example', kind: 'customer-dns', desired: 'detached',
    observed: 'unknown', certificate: 'none', credentialId: null, version: 1,
    operationFence: 1, createdAt: CLOUDFLARE_T0, updatedAt: CLOUDFLARE_T0,
    ...overrides,
  }) as DomainRecord
}

export class RecordingCloudflareDomainTransitions {
  readonly calls: CloudflareDomainTransition[] = []
  async transition(input: CloudflareDomainTransition): Promise<void> {
    this.calls.push(structuredClone(input))
  }
}

export function createCloudflareFixture() {
  const adapter = new FakeCloudflareSaasAdapter()
  const repository = new MemoryCloudflareStateRepository()
  const transitions = new RecordingCloudflareDomainTransitions()
  const reconciler = new CloudflareSaasReconciler(adapter, transitions, repository, () => new Date(CLOUDFLARE_T0))
  return { adapter, repository, transitions, reconciler }
}

export async function makeCloudflareReady() {
  const fixture = createCloudflareFixture()
  const initial = cloudflareDomain()
  const prevalidation = await fixture.reconciler.prevalidate(cloudflareScope, initial, subdomainCapability)
  fixture.adapter.activate(prevalidation.binding.providerHostnameId)
  const validating = cloudflareDomain({
    desired: 'validating', observed: 'dns-pending', certificate: 'provisioning', version: 2, operationFence: 2,
  })
  const ready = await fixture.reconciler.reconcile(cloudflareScope, validating)
  return { ...fixture, initial, validating, ready }
}

export async function makeCloudflareActive(): Promise<ReturnType<typeof createCloudflareFixture> & Readonly<{ ready: CloudflareBinding; active: CloudflareBinding; domain: DomainRecord }>> {
  const fixture = await makeCloudflareReady()
  const domain = cloudflareDomain({
    desired: 'validating', observed: 'dns-valid', certificate: 'active', version: 3, operationFence: 3,
  })
  const active = await fixture.reconciler.cutover(cloudflareScope, domain)
  return { ...fixture, ready: fixture.ready, active, domain }
}
