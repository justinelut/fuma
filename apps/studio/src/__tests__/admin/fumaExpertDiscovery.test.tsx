import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ExpertDiscoveryHttpClient, ExpertDiscoveryRouteContent } from '@admin/fuma/expertDiscovery'

const target = { organizationId: 'org:a', workspaceId: 'workspace:a', siteId: 'site:a' }
const profile = { expertId: 'expert-a', organizationId: 'org:a', sourceScope: { platformId: 'platform', organizationId: 'org:a', workspaceId: 'workspace:a', siteId: 'site:a', ownerKey: 'owner-a', ownerGeneration: 2 }, supportedProfiles: ['website','publication'], public: { id: 'expert_public_a', slug: 'expert-a', publicName: 'A Kenyan Builder', summary: 'Accessible sites and publications.', expertType: 'developer', location: 'Nairobi', skills: ['fuma'], services: ['design'], showcaseIds: [], mediatedInquiryAvailable: true, imageUrl: null, approvedAt: '2026-07-30T15:00:00.000Z' }, availability: 'available', approvedReleaseId: 'release-a', optedIn: true, consentVersion: 2, publicRevision: 2, createdAt: '2026-07-30T15:00:00.000Z', updatedAt: '2026-07-30T15:00:00.000Z' }
const management = { profile, pluginLinks: [], inquiryCount: 2, integration: { ownerTicket: 'FUMA-073', mounted: true, schemaAuthority: '000037_operations_experts_transfer' } }
afterEach(cleanup)
describe('FUMA-073 Studio expert discovery', () => {
  it('shows production authority and complete management actions without Tailwind', async () => {
    const client = { management: async () => management } as unknown as ExpertDiscoveryHttpClient
    render(<ExpertDiscoveryRouteContent target={target} client={client} />)
    expect(screen.getByRole('status').textContent).toContain('000037_operations_experts_transfer')
    fireEvent.change(screen.getByLabelText('Expert ID'), { target: { value: 'expert-a' } }); fireEvent.click(screen.getByRole('button', { name: 'Load management record' }))
    await waitFor(() => expect(screen.getByText('A Kenyan Builder')).not.toBeNull())
    expect(screen.getByRole('button', { name: 'Opt out and hide' })).not.toBeNull(); expect(screen.getByRole('button', { name: 'Encrypt and queue inquiry' })).not.toBeNull(); expect(screen.getByRole('button', { name: 'Verify and link' })).not.toBeNull(); expect(screen.getByRole('button', { name: 'Revalidate and transfer' })).not.toBeNull()
  })
  it('uses exact encoded same-origin routes and rejects malformed response envelopes', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const client = new ExpertDiscoveryHttpClient(target, async (input, init) => { calls.push({ url: String(input), init }); return new Response(JSON.stringify({ result: management }), { status: 200 }) })
    expect((await client.management('expert:a')).profile?.expertId).toBe('expert-a'); expect(calls[0]?.url).toBe('/api/fuma/organizations/org%3Aa/workspaces/workspace%3Aa/sites/site%3Aa/experts/expert%3Aa/management'); expect(calls[0]?.init?.credentials).toBe('same-origin')
    const invalid = new ExpertDiscoveryHttpClient(target, async () => new Response(JSON.stringify({ result: { profile: { expertId: 'leaked-only' } } }), { status: 200 }))
    await expect(invalid.management('expert-a')).rejects.toThrow('strict TypeBox')
  })
})
