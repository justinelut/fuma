import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { AiCreditsHttpClient, CreditsLedger, CreditsLedgerRouteContent, creditsAdminRegistry, type AiCreditsLedgerWire } from '@admin/fuma/credits'
import type { FumaScopedShellReadyContext } from '@admin/fuma/FumaScopedShell'

const model: AiCreditsLedgerWire = {
  account: {
    accountId: 'account-a', balanceMicros: 4_000_000, reservedMicros: 500_000,
    spentMicros: 1_000_000, budgetMicros: 5_000_000, availableMicros: 3_500_000,
    version: 4,
    credentials: [{ credentialId: 'credential-a', providerId: 'provider-a', displayLabel: 'Primary provider', state: 'active', version: 1, keyCurrent: true, createdAt: '2026-08-04T10:00:00.000Z', updatedAt: '2026-08-04T10:00:00.000Z' }],
  },
  entries: [
    { entryId: 'usage-a', entryType: 'usage', state: 'settled', amountMicros: 1_000_000, remainingMicros: 0, mode: 'platform', providerId: 'provider-a', modelId: 'model-a', inputTokens: 120, outputTokens: 80, occurredAt: '2026-08-04T11:00:00.000Z', resolvedAt: '2026-08-04T11:00:00.000Z', expiresAt: '2026-08-04T11:30:00.000Z' },
    { entryId: 'grant-a', entryType: 'grant', state: 'partially-used', amountMicros: 5_000_000, remainingMicros: 4_000_000, mode: null, providerId: null, modelId: null, inputTokens: null, outputTokens: null, occurredAt: '2026-08-04T10:00:00.000Z', resolvedAt: null, expiresAt: null },
  ],
}

const shell = {
  resolution: {
    selection: { organizationId: 'organization-a', workspaceId: 'workspace-a', siteId: 'site-a' },
    profile: { capabilities: [{ id: 'ai.credits' }] },
  },
  routeAccess: { kind: 'allowed', route: { id: 'route.ai-credits' } },
} as unknown as FumaScopedShellReadyContext

afterEach(cleanup)

describe('scoped AI credits ledger workspace', () => {
  it('contributes one permission-gated route and navigation entry to both profiles while preserving bookings', () => {
    for (const profile of ['website', 'publication']) {
      const composed = creditsAdminRegistry.compose(profile, { grant: [], revoke: [] })
      expect(composed.navigation).toContainEqual(expect.objectContaining({ id: 'nav.ai-credits', path: '/admin/settings/credits', permission: 'ai.chat' }))
      expect(composed.routes).toContainEqual(expect.objectContaining({ id: 'route.ai-credits', path: '/admin/settings/credits', permission: 'ai.chat' }))
    }
    expect(creditsAdminRegistry.compose('website').navigation).toContainEqual(expect.objectContaining({ id: 'nav.bookings' }))
  })

  it('uses the exact scoped URL and validates the customer ledger response', async () => {
    const fetch = mock(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/fuma/organizations/org%2Fone/workspaces/work%20one/sites/site%3Fone/ai/credits')
      return Response.json(model)
    })
    const client = new AiCreditsHttpClient({ organizationId: 'org/one', workspaceId: 'work one', siteId: 'site?one', fetch })
    expect(await client.ledger()).toEqual(model)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('shows explicit loading and safe error states at the selected-site route boundary', async () => {
    const pending = new Promise<AiCreditsLedgerWire>(() => {})
    const first = render(<CreditsLedgerRouteContent shell={shell} client={{ ledger: () => pending }} />)
    expect(screen.getByRole('status').textContent).toContain('Loading AI credit ledger')
    first.unmount()

    render(<CreditsLedgerRouteContent shell={shell} client={{ ledger: async () => { throw new Error('database detail') } }} />)
    const error = await screen.findByRole('alert')
    expect(error.textContent).toBe('AI credit ledger could not be loaded.')
  })

  it('loads the ledger through the permission-selected route surface', async () => {
    render(<CreditsLedgerRouteContent shell={shell} client={{ ledger: async () => model }} />)
    expect(await screen.findByTestId('credits-ledger-route-content')).toBeTruthy()
    expect(screen.getByLabelText('3.5 credits available')).toBeTruthy()
  })

  it('renders budget state, chronological activity, token evidence, and opaque BYOK status', () => {
    render(<CreditsLedger model={model} />)
    expect(screen.getByRole('heading', { name: 'Credits, without guesswork.' })).toBeTruthy()
    expect(screen.getByLabelText('3.5 credits available')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('30')
    expect(screen.getByRole('heading', { name: 'Ledger activity' })).toBeTruthy()
    expect(screen.getByText('200 tokens')).toBeTruthy()
    expect(screen.getByText('Primary provider')).toBeTruthy()
    expect(screen.getByText(/opaque connection status/)).toBeTruthy()
  })
})
