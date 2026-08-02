import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { SupportOperationsHttpClient, SupportOperationsRouteContent } from '@admin/fuma/supportOperations'

const target = { organizationId: 'org/a', workspaceId: 'workspace a', siteId: 'site#a' }
const session = {
  supportSessionId: 'support-a',
  scope: { platformId: 'platform', organizationId: 'org/a', workspaceId: 'workspace a', siteId: 'site#a', ownerKey: 'owner', ownerGeneration: 2 },
  staffActorId: 'staff-a', staffSessionId: 'session-staff', targetUserId: 'customer-a',
  reason: 'Investigate a verified customer editor failure.', stepUpAt: '2026-08-01T10:00:00.000Z', startedAt: '2026-08-01T10:00:00.000Z', expiresAt: '2026-08-01T10:15:00.000Z',
  banner: 'Support session active — actions are performed as this account and are audited.',
  evidence: { objectKey: 'support/evidence/support-a.json', hashSha256: 'a'.repeat(64) },
}

afterEach(() => cleanup())

describe('FUMA-072 Studio support workspace', () => {
  it('renders internal-only support, moderation, and isolated recovery controls without Tailwind', () => {
    render(<SupportOperationsRouteContent target={target} pathname="/admin/internal/support" impersonatedBy={null} />)
    expect(screen.getByRole('heading', { name: 'Support, moderation and owner recovery' })).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Bounded support session' })).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Moderation lineage' })).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Isolated owner recovery' })).not.toBeNull()
    expect(screen.getByText(/Requester, two approvers, executor/)).not.toBeNull()
  })

  it('uses exact encoded tenant paths, same-origin credentials, and strict TypeBox response envelopes', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const client = new SupportOperationsHttpClient(target, async (input, init) => {
      calls.push({ url: String(input), init })
      return new Response(JSON.stringify({ result: session }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    expect(await client.current()).toEqual(session)
    expect(calls[0]?.url).toBe('/api/fuma/organizations/org%2Fa/workspaces/workspace%20a/sites/site%23a/support/sessions/current')
    expect(calls[0]?.init?.credentials).toBe('same-origin')
    const invalid = new SupportOperationsHttpClient(target, async () => new Response(JSON.stringify({ result: { supportSessionId: 'untrusted-only' } }), { status: 200 }))
    await expect(invalid.current()).rejects.toThrow('strict TypeBox')
  })

  it('loads immutable session bounds and shows the audited impersonation banner', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ result: session }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
    try {
      render(<SupportOperationsRouteContent target={target} pathname="/admin/internal/support" impersonatedBy="staff-a" />)
      expect(screen.getByRole('alert').textContent).toContain('Support session active')
      await waitFor(() => expect(screen.getByText('support-a')).not.toBeNull())
      expect(screen.getByText(session.reason)).not.toBeNull()
      expect((screen.getByRole('button', { name: 'End support and restore staff identity' }) as HTMLButtonElement).disabled).toBe(false)
    } finally { globalThis.fetch = original }
  })
})
