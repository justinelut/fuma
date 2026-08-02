import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PaidHandoffHttpClient, PaidHandoffRouteContent, type PaidHandoffDashboardWire } from '@admin/fuma/paidHandoff'

const target = { organizationId: 'org:source', workspaceId: 'workspace:source', siteId: 'site:ke' }
const review: PaidHandoffDashboardWire['review'] = {
  commandId: 'paid-handoff:contract:ke', transferId: 'transfer:ke', contractId: 'contract:ke', offerId: 'offer:ke', offerVersion: 4,
  source: { platformId: 'platform-ke', organizationId: 'org-source', workspaceId: 'workspace-source', siteId: 'site-ke' },
  destination: { platformId: 'platform-ke', organizationId: 'org-destination', workspaceId: 'workspace-destination', siteId: 'site-ke' },
  outboxState: 'pending', paymentState: 'paid-transfer-pending', destinationActive: true, quotaAccepted: true, policyAcceptanceCurrent: true, meteringEvidenceCurrent: true,
  internalGrantExcluded: true, assetOwners: { domain: 'FUMA-062', ai: 'FUMA-064', mcp: 'FUMA-066', plugins: 'FUMA-067', payments: 'FUMA-069', collaborators: 'FUMA-023' },
  setupAmountMinor: 125000, recurringAmountMinor: 75000, currency: 'KES', cadence: 'monthly', locale: 'en-KE', timezone: 'Africa/Nairobi',
  activatedAt: '2026-07-31T06:00:00.000Z', setupAmount: 'KES 1,250.00', recurringAmount: 'KES 750.00', activatedAtLocal: '31 Jul 2026, 09:00',
  canPrepare: true, canRecover: false, blockedReasons: [],
}
const dashboard: PaidHandoffDashboardWire = { review, transfer: null, progressPercent: 0, nextAction: 'choose-assets', managedOwnership: 'retained', customerQuotaApplication: 'pending', internalGrantExcluded: true }

afterEach(cleanup)
describe('FUMA-074 Studio paid handoff', () => {
  it('shows Kenya contract authority, exact destination, all asset owners and recovery controls', async () => {
    const calls: string[] = []
    const client = { dashboard: async () => dashboard, prepare: async () => { calls.push('prepare'); return {} } } as unknown as PaidHandoffHttpClient
    render(<PaidHandoffRouteContent target={target} client={client} />)
    expect(screen.getByRole('status').textContent).toContain('en-KE · KES · Africa/Nairobi')
    fireEvent.change(screen.getByLabelText('Paid handoff command ID'), { target: { value: review.commandId } })
    fireEvent.click(screen.getByRole('button', { name: 'Load handoff' }))
    await waitFor(() => expect(screen.getByText('contract:ke')).not.toBeNull())
    expect(screen.getByText('org-destination / workspace-destination / site-ke')).not.toBeNull()
    for (const label of ['Domain choice', 'AI/BYOK choice', 'MCP connectors', 'Plugin settings and secrets', 'Payment merchant', 'Collaborators']) expect(screen.getByLabelText(label)).not.toBeNull()
    expect(screen.getByText(/internal grant excluded/i)).not.toBeNull()
    expect((screen.getByRole('button', { name: 'Reconcile current state' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Record choices and request confirmation' }))
    await waitFor(() => expect(calls).toEqual(['prepare']))
  })

  it('uses encoded same-origin intent-only routes and rejects malformed envelopes', async () => {
    const calls: Array<{ url: string; body: unknown; credentials?: RequestCredentials }> = []
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null, credentials: init?.credentials })
      return new Response(JSON.stringify({ result: dashboard }), { status: 200 })
    }
    const client = new PaidHandoffHttpClient(target, fetcher)
    expect((await client.dashboard('paid-handoff:contract:ke')).review.currency).toBe('KES')
    expect(calls[0]?.url).toBe('/api/fuma/organizations/org%3Asource/workspaces/workspace%3Asource/sites/site%3Ake/transfers/paid-handoffs/paid-handoff%3Acontract%3Ake')
    expect(calls[0]?.credentials).toBe('same-origin')
    const invalid = new PaidHandoffHttpClient(target, async () => new Response(JSON.stringify({ result: { review: { commandId: 'leak' } } }), { status: 200 }))
    await expect(invalid.dashboard('paid-handoff:contract:ke')).rejects.toThrow('strict TypeBox')
  })
})
