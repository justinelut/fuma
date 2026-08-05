import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AccessibleContextCatalog } from '@core/fuma'
import { HostedSiteOnboarding } from '../../admin/fuma/HostedSiteOnboarding'

const empty: AccessibleContextCatalog = { organizations: [], workspaces: [], sites: [] }

afterEach(cleanup)

describe('hosted first-site onboarding', () => {
  test('creates a customer organization, provisions its site, and opens the canonical scoped editor', async () => {
    const requests: Array<{ path: string; body: unknown }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const path = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) : null
      requests.push({ path, body })
      if (path.endsWith('/check-slug')) return Response.json({ status: true })
      if (path.endsWith('/organization/create')) return Response.json({ id: 'org-1', name: 'Acme Studio', slug: 'acme-studio' })
      return Response.json({
        result: {
          organizationId: 'org-1', workspaceId: 'workspace-1', siteId: 'site-1',
          siteSlug: 'acme-site', host: 'acme-site.trimly.co.ke', profileId: 'publication',
          created: { workspace: true, site: true, ownerKey: true, freeHost: true },
        },
      })
    }
    const targets: string[] = []
    render(<HostedSiteOnboarding catalog={empty} fetchImpl={fetchImpl} navigate={(target) => targets.push(target)} />)

    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Acme Studio' } })
    fireEvent.change(screen.getByLabelText('Site name'), { target: { value: 'Acme Site' } })
    fireEvent.click(screen.getByLabelText(/Publication/))
    fireEvent.click(screen.getByRole('button', { name: 'Create site and open editor' }))

    await waitFor(() => expect(targets).toHaveLength(1))
    expect(requests.map((request) => request.path)).toEqual([
      '/api/auth/organization/check-slug',
      '/api/auth/organization/create',
      '/api/fuma/onboarding/site',
    ])
    expect(requests[1]?.body).toEqual({ name: 'Acme Studio', slug: 'acme-studio' })
    expect(requests[2]?.body).toEqual({
      organizationId: 'org-1', siteName: 'Acme Site', siteSlug: 'acme-site', profileId: 'publication',
    })
    expect(targets[0]).toBe('/admin/organizations/org-1/workspaces/workspace-1/sites/site-1/pages')
  })

  test('reuses an existing customer organization rather than creating another', async () => {
    const catalog: AccessibleContextCatalog = {
      organizations: [{ id: 'org-existing', name: 'Existing', status: 'active' }],
      workspaces: [],
      sites: [],
    }
    const requests: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      requests.push(String(input))
      return Response.json({
        result: {
          organizationId: 'org-existing', workspaceId: 'workspace-1', siteId: 'site-1',
          siteSlug: 'portfolio', host: 'portfolio.trimly.co.ke', profileId: 'website',
          created: { workspace: true, site: true, ownerKey: true, freeHost: true },
        },
      })
    }
    const targets: string[] = []
    render(<HostedSiteOnboarding catalog={catalog} fetchImpl={fetchImpl} navigate={(target) => targets.push(target)} />)
    expect(screen.queryByLabelText('Organization name')).toBeNull()
    expect(screen.getByText('Existing')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Site name'), { target: { value: 'Portfolio' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create site and open editor' }))
    await waitFor(() => expect(targets).toHaveLength(1))
    expect(requests).toEqual(['/api/fuma/onboarding/site'])
  })
})
