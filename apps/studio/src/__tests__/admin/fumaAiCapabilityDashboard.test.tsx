import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  CapabilityDashboardHttpClient,
  CustomerCapabilityDashboardRouteContent,
  PlatformCapabilityInventoryRouteContent,
  type PlatformCapabilityDashboardWire,
  type SiteCapabilityDashboardWire,
} from '@admin/fuma/aiCapabilities'
import type { FumaScopedShellReadyContext } from '@admin/fuma/FumaScopedShell'

const NOW = '2026-07-31T09:50:00.000Z'
const target = { organizationId: 'organization:a', workspaceId: 'workspace:a', siteId: 'site:a' }
const shell = {
  resolution: { selection: target },
  profileRelativeSubpath: '/admin/settings/capabilities',
  routeAccess: { kind: 'allowed', route: { id: 'route.settings' } },
} as FumaScopedShellReadyContext

function siteDashboard(state: 'active'|'revoked' = 'active'): SiteCapabilityDashboardWire {
  return {
    kind: 'site',
    capabilities: [{
      id: 'site.component-usage.insert', version: '1.0.0', title: 'Insert reviewed section',
      description: 'One exact reviewed backend function.', class: 'mutate', profileAvailable: true,
      state: 'degraded', requiredPermission: 'site.structure.edit', permissionGranted: true,
      confirmation: 'none', dataClassification: 'internal',
      exportAdapter: { id: 'fuma.adapter.component-usage', version: '1.0.0', available: false },
      channels: [
        { channel: 'site-ai', availability: 'enabled', requiredGrant: 'ai.tools.write', grants: [{ grantId: 'site-ai-permission', label: 'site.structure.edit', channel: 'site-ai', state: 'active', canRevoke: false }], reason: 'Permission-derived.', canGrant: false },
        { channel: 'mcp', availability: state === 'active' ? 'enabled' : 'revoked', requiredGrant: 'component.mutate', grants: [{ grantId: 'connector-a', label: 'MCP build connector', channel: 'mcp', state, canRevoke: state === 'active' }], reason: state === 'active' ? 'One active grant.' : 'All grants revoked.', canGrant: false },
        { channel: 'imported-runtime', availability: 'unavailable', requiredGrant: null, grants: [], reason: 'No reviewed adapter.', canGrant: false },
        { channel: 'export-adapter', availability: 'unavailable', requiredGrant: null, grants: [], reason: 'No reviewed adapter.', canGrant: false },
      ],
      limits: { inputBytes: 65_536, outputBytes: 131_072, resultItems: 1, requestsPerMinute: 60, timeoutMs: 10_000 },
      usage: { successfulOperations: 3, failedOperations: 1, logicalCredits: 3, providerCredits: 3, spendUsdMicros: '250000' },
      health: { state: 'degraded', checkedAt: NOW, detail: 'One successful operation lacks metering evidence.' },
      deprecation: { state: 'current', replacement: null, detail: 'Current exact version.' },
    }],
    recentReceipts: [{ receiptId: 'a'.repeat(64), capabilityId: 'site.component-usage.insert', capabilityVersion: '1.0.0', channel: 'site-ai', operationId: 'operation-a', outcome: 'succeeded', metered: false, audited: true, auditId: 'audit-a', occurredAt: NOW }],
    nextCursor: null,
    unsupportedGaps: [{ gapId: 'gap-export', channel: 'export-adapter', title: 'Standalone export adapter unavailable', reason: 'Direct database fallback remains blocked.', state: 'blocked' }],
    generatedAt: NOW,
  }
}

const platformDashboard: PlatformCapabilityDashboardWire = {
  kind: 'platform',
  inventory: [{
    id: 'site.component-usage.insert', version: '1.0.0', title: 'Insert reviewed section', registryState: 'active',
    health: { state: 'degraded', checkedAt: NOW, detail: 'One drifted receipt.' },
    adoption: { currentVersionOperations: 8, driftedReceipts: 1 },
    aggregate: { tenantCount: 4, successfulOperations: 8, failedOperations: 2, meteredOperations: 7, auditedOperations: 8, logicalCredits: 7, providerCredits: 7, spendUsdMicros: '900000', activeMcpGrants: 3, revokedMcpGrants: 2 },
    controls: [
      { kind: 'deprecate', state: 'blocked', reason: 'Reviewed release required.' },
      { kind: 'revoke', state: 'blocked', reason: 'Exact owner workflow required.' },
      { kind: 'incident', state: 'blocked', reason: 'FUMA-072 authority required.' },
    ],
  }],
  recentEvidence: [{ capabilityVersion: '1.0.0', channel: 'mcp', outcome: 'failed', metered: false, audited: true, occurredAt: NOW }],
  nextCursor: null,
  unsupportedGaps: [{ gapId: 'gap-import', channel: 'imported-runtime', title: 'Imported runtime unavailable', reason: 'No reviewed authority mapping.', state: 'blocked' }],
  generatedAt: NOW,
}

afterEach(cleanup)

describe('FUMA-087 Studio capability dashboard', () => {
  it('renders loading, degraded evidence, minimized audit links, unsupported gaps, and canonical MCP revocation', async () => {
    let resolveInitial!: (value: SiteCapabilityDashboardWire) => void
    const initial = new Promise<SiteCapabilityDashboardWire>((resolve) => { resolveInitial = resolve })
    let loads = 0
    const revoked: unknown[] = []
    const client = {
      async site() { loads += 1; return loads === 1 ? await initial : siteDashboard('revoked') },
      async revoke(input: unknown) { revoked.push(input); return { state: 'revoked' } },
    } as unknown as CapabilityDashboardHttpClient
    render(<CustomerCapabilityDashboardRouteContent shell={shell} client={client} />)
    expect(screen.getByRole('status').textContent).toContain('Loading site capability evidence')
    resolveInitial(siteDashboard())
    await waitFor(() => expect(screen.getByRole('heading', { name: 'AI backend capabilities' })).not.toBeNull())
    expect(screen.getAllByText('Degraded').length).toBeGreaterThan(0)
    expect(screen.getByText('Standalone export adapter unavailable')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Audit' }).getAttribute('href')).toBe('/admin/audit?eventId=audit-a')
    const revoke = screen.getByRole('button', { name: 'Revoke' })
    revoke.focus()
    expect(document.activeElement).toBe(revoke)
    fireEvent.click(revoke)
    await waitFor(() => expect(screen.getAllByText('Revoked').length).toBeGreaterThan(0))
    expect(revoked).toEqual([{ capabilityId: 'site.component-usage.insert', capabilityVersion: '1.0.0', channel: 'mcp', grantId: 'connector-a' }])
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
  })

  it('renders the protected aggregate and denies support impersonation without network contact', async () => {
    let calls = 0
    const client = { async platform() { calls += 1; return platformDashboard } } as unknown as CapabilityDashboardHttpClient
    const { rerender } = render(<PlatformCapabilityInventoryRouteContent target={target} impersonatedBy={null} client={client} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Backend capability inventory' })).not.toBeNull())
    expect(screen.getByText('4')).not.toBeNull()
    expect(screen.getAllByRole('button', { name: /Deprecate|Revoke|Incident/ }).every((button) => button.hasAttribute('disabled'))).toBe(true)
    rerender(<PlatformCapabilityInventoryRouteContent target={target} impersonatedBy="support-a" client={client} />)
    expect(screen.getByRole('alert').textContent).toContain('Support impersonation cannot inherit capability')
    expect(calls).toBe(1)
  })

  it('shows an accessible empty state and uses exact encoded same-origin scoped requests with no authority body fields', async () => {
    const empty = { ...siteDashboard(), capabilities: [], recentReceipts: [], unsupportedGaps: [] }
    const emptyClient = { site: async () => empty } as unknown as CapabilityDashboardHttpClient
    render(<CustomerCapabilityDashboardRouteContent shell={shell} client={emptyClient} />)
    await waitFor(() => expect(screen.getByText('No reviewed capability is available for this profile.')).not.toBeNull())
    cleanup()

    const calls: Array<{ url: string; init?: RequestInit }> = []
    const client = new CapabilityDashboardHttpClient(target, async (input, init) => {
      calls.push({ url: String(input), init })
      const result = String(input).endsWith('/revocations')
        ? { capabilityId: 'site.component-usage.insert', capabilityVersion: '1.0.0', channel: 'mcp', grantId: 'connector-a', state: 'revoked' }
        : siteDashboard()
      return new Response(JSON.stringify({ result }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    await client.site()
    await client.revoke({ capabilityId: 'site.component-usage.insert', capabilityVersion: '1.0.0', channel: 'mcp', grantId: 'connector-a' })
    expect(calls[0]?.url).toBe('/api/fuma/organizations/organization%3Aa/workspaces/workspace%3Aa/sites/site%3Aa/ai/backend-capabilities?limit=20')
    expect(calls.every(({ init }) => init?.credentials === 'same-origin')).toBe(true)
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ capabilityId: 'site.component-usage.insert', capabilityVersion: '1.0.0', channel: 'mcp', grantId: 'connector-a' })
  })
})
