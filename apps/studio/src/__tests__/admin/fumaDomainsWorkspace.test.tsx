import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { creditsAdminRegistry } from '@admin/fuma/credits'
import { CloudflareDomainsHttpClient, DomainsWorkspace, type CloudflareBindingWire, type CloudflareDomainCatalogWire, type CloudflarePrevalidationWire } from '@admin/fuma/domains'

const binding: CloudflareBindingWire = {
  platformId: 'fuma', organizationId: 'organization-a', workspaceId: 'workspace-a', siteId: 'site-a',
  ownerKey: 'owner-a', generation: 1, state: 'active', transferFence: null, profileId: 'website',
  domainId: 'domain-a', hostname: 'www.example.co.ke', providerHostnameId: 'cf-host-a',
  lifecycle: 'ready', providerStatus: 'active', sslStatus: 'active', ownershipVerified: true,
  instructions: [
    { type: 'CNAME', name: 'www.example.co.ke', value: 'customers.trimly.co.ke', purpose: 'routing' },
    { type: 'TXT', name: '_cf-custom-hostname.www.example.co.ke', value: 'verify-value', purpose: 'ownership' },
  ],
  diagnostics: [], version: 2, reconcileFence: 2, lastEventSequence: '1',
  lastOperationId: 'cf.poll.domain-a.1', lastOperationSha256: 'a'.repeat(64),
  createdAt: '2026-08-04T12:00:00.000Z', updatedAt: '2026-08-04T12:01:00.000Z',
}
const catalog: CloudflareDomainCatalogWire = {
  domains: [{
    domain: {
      domainId: 'domain-a', hostname: 'www.example.co.ke', unicodeHostname: 'www.example.co.ke',
      kind: 'customer-dns', desired: 'validating', observed: 'dns-valid', certificate: 'active',
      version: 3, updatedAt: '2026-08-04T12:01:00.000Z', credential: null,
    },
    binding,
  }],
}

function client(overrides: Partial<{
  list: () => Promise<CloudflareDomainCatalogWire>
  create: () => Promise<CloudflarePrevalidationWire>
}> = {}) {
  return {
    list: mock(overrides.list ?? (async () => catalog)),
    create: mock(overrides.create ?? (async () => ({
      binding, records: binding.instructions, customerAccountRequired: false,
      customerTokenRequired: false, authoritativeDnsRetainedByCustomer: true,
    }))),
    reconcile: mock(async () => binding),
    cutover: mock(async () => ({ ...binding, lifecycle: 'active' as const })),
    rollback: mock(async () => ({ ...binding, lifecycle: 'detached' as const })),
    remove: mock(async () => ({ ...binding, lifecycle: 'deleted' as const, providerStatus: 'deleted' as const })),
  }
}

afterEach(cleanup)

describe('Cloudflare custom hostname workspace', () => {
  it('registers the domains page and reconcile job in both selected-site profiles', () => {
    for (const profile of ['website', 'publication']) {
      const composed = creditsAdminRegistry.compose(profile)
      expect(composed.navigation).toContainEqual(expect.objectContaining({ id: 'nav.domains', path: '/admin/settings/domains' }))
      expect(composed.routes).toContainEqual(expect.objectContaining({ id: 'route.domains', path: '/admin/settings/domains' }))
      expect(composed.jobs).toContainEqual(expect.objectContaining({ handlerId: 'fuma.cloudflare-reconcile' }))
    }
  })

  it('uses the exact selected-site catalog URL and strict response schema', async () => {
    const fetch = mock(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/fuma/organizations/org%2Fone/workspaces/work%20one/sites/site%3Fone/settings/domains/cloudflare')
      return Response.json({ domains: [] })
    })
    const scoped = new CloudflareDomainsHttpClient({ organizationId: 'org/one', workspaceId: 'work one', siteId: 'site?one', fetch })
    expect(await scoped.list()).toEqual({ domains: [] })
  })

  it('guides empty-state onboarding and refreshes after prevalidation without customer credentials', async () => {
    let reads = 0
    const scoped = client({ list: async () => reads++ === 0 ? { domains: [] } : catalog })
    render(<DomainsWorkspace client={scoped} canWrite />)
    expect(await screen.findByText('No custom domains yet')).toBeTruthy()
    expect(screen.getByText(/without moving nameservers or sharing a Cloudflare account/i)).toBeTruthy()
    expect(screen.queryByLabelText(/Cloudflare.*token/i)).toBeNull()

    fireEvent.change(screen.getByLabelText('Add a hostname'), { target: { value: 'www.example.co.ke' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(scoped.create).toHaveBeenCalledTimes(1))
    expect(scoped.create).toHaveBeenCalledWith(expect.objectContaining({
      hostname: 'www.example.co.ke',
      capability: expect.objectContaining({ enterpriseApex: false, registrarRedirect: true }),
    }))
    expect(await screen.findByText('Domain added. Publish the exact DNS records before cutover.')).toBeTruthy()
    expect(screen.getByText('1 connected')).toBeTruthy()
  })

  it('enables verified cutover, exposes rollback, and requires review before removal', async () => {
    const scoped = client()
    render(<DomainsWorkspace client={scoped} canWrite />)
    expect(await screen.findByRole('heading', { name: 'www.example.co.ke' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cut over' }))
    await waitFor(() => expect(scoped.cutover).toHaveBeenCalledWith('domain-a'))
    expect(await screen.findByText(/Cutover completed/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByRole('alert').textContent).toContain('Remove this hostname')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Confirm removal' })).toBeNull()
  })

  it('keeps every mutation disabled for read-only staff', async () => {
    render(<DomainsWorkspace client={client()} canWrite={false} />)
    expect(await screen.findByText(/cannot change routing/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Cut over' }).hasAttribute('disabled')).toBe(true)
  })
})
