import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  PlatformCheckoutRouteContent,
  PlatformCheckoutSurface,
  type PlatformCheckoutHttpClient,
  type PlatformCheckoutSource,
  type PlatformCheckoutWire,
} from '@admin/fuma/billing'
import type { FumaScopedShellReadyContext } from '@admin/fuma/FumaScopedShell'
import type { PermissionDecision } from '@core/fuma'

const checkout: PlatformCheckoutWire = {
  checkoutId: 'checkout:fixture',
  state: 'awaiting-payment',
  source: {
    kind: 'private-offer',
    offerId: 'offer-lawyer',
    offerVersion: 3,
  },
  destination: {
    organizationId: 'organization-a',
    workspaceId: 'workspace-a',
    siteId: 'site-a',
    profileId: 'website',
  },
  cadence: 'annual',
  currency: 'KES',
  setup: {
    kind: 'setup',
    amountMinor: 35_000,
    currency: 'KES',
    reference: 'pb_platform-setup_0000000000000001',
    authorizationUrl: 'https://checkout.paystack.test/setup',
    state: 'ready',
    callbackVerifiedAt: null,
  },
  recurring: {
    kind: 'recurring',
    amountMinor: 180_000,
    currency: 'KES',
    reference: 'pb_platform-recurring_0000000000000001',
    authorizationUrl: 'https://checkout.paystack.test/recurring',
    state: 'ready',
    callbackVerifiedAt: null,
  },
  createdAt: '2026-07-28T09:00:00.000Z',
  cancelledAt: null,
}

function client(overrides: Partial<{
  initialize(source: PlatformCheckoutSource): Promise<PlatformCheckoutWire>
  find(checkoutId: string): Promise<PlatformCheckoutWire>
  cancel(checkoutId: string): Promise<PlatformCheckoutWire>
  verifyCallback(checkoutId: string, reference: string): Promise<PlatformCheckoutWire>
}> = {}): PlatformCheckoutHttpClient {
  return {
    async initialize() { return checkout },
    async find() { return checkout },
    async cancel() { return { ...checkout, state: 'cancelled', cancelledAt: checkout.createdAt } },
    async verifyCallback() {
      return {
        ...checkout,
        recurring: {
          ...checkout.recurring,
          state: 'callback-verified',
          callbackVerifiedAt: checkout.createdAt,
        },
      }
    },
    ...overrides,
  } as unknown as PlatformCheckoutHttpClient
}

afterEach(cleanup)

describe('FUMA-055 platform checkout UI', () => {
  it('submits only public plan intent and presents setup and annual recurring consideration separately', async () => {
    const sources: PlatformCheckoutSource[] = []
    const publicCheckout: PlatformCheckoutWire = {
      ...checkout,
      source: {
        kind: 'public-plan',
        planId: 'business',
        priceBookVersion: 'book-v1',
        cadence: 'annual',
      },
      setup: null,
      recurring: { ...checkout.recurring, amountMinor: 120_000 },
    }
    render(<PlatformCheckoutSurface
      client={client({ async initialize(source) { sources.push(source); return publicCheckout } })}
      canCheckout
    />)
    fireEvent.change(screen.getByLabelText('Plan ID'), { target: { value: 'business' } })
    fireEvent.change(screen.getByLabelText('Price-book version'), { target: { value: 'book-v1' } })
    fireEvent.change(screen.getByLabelText('Recurring cadence'), { target: { value: 'annual' } })
    fireEvent.click(screen.getByRole('button', { name: 'Initialize plan checkout' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Bound consideration' })).toBeTruthy())
    expect(sources).toEqual([{
      kind: 'public-plan',
      planId: 'business',
      priceBookVersion: 'book-v1',
      cadence: 'annual',
    }])
    expect(screen.getByRole('heading', { name: 'Setup/import fee' })).toBeTruthy()
    expect(screen.getByText('No setup fee for this plan')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Recurring consideration' })).toBeTruthy()
    expect(screen.getByText(/KES\s+1,200\.00/)).toBeTruthy()
    expect(screen.getByText(/does not settle either obligation, activate a contract/i)).toBeTruthy()
  })

  it('initializes an exact private offer, exposes safe payment links, and redacts provider-private data', async () => {
    const sources: PlatformCheckoutSource[] = []
    render(<PlatformCheckoutSurface
      client={client({ async initialize(source) { sources.push(source); return checkout } })}
      canCheckout
    />)
    fireEvent.change(screen.getByLabelText('Offer ID'), { target: { value: 'offer-lawyer' } })
    fireEvent.change(screen.getByLabelText('Offer version'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Initialize offer checkout' }))

    await waitFor(() => expect(screen.getByText(/KES\s+350\.00/)).toBeTruthy())
    expect(screen.getByText(/KES\s+1,800\.00/)).toBeTruthy()
    expect(sources).toEqual([{ kind: 'private-offer', offerId: 'offer-lawyer', offerVersion: 3 }])
    const links = screen.getAllByRole('link', { name: 'Continue to secure payment' })
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
      expect(link.getAttribute('href')).toMatch(/^https:\/\/checkout\.paystack\.test\//)
    }
    expect(document.body.textContent).not.toMatch(/CUS_|AUTH_|customer code|authorization code/i)
  })

  it('verifies a callback while explicitly keeping settlement and activation pending', async () => {
    const callbacks: unknown[] = []
    render(<PlatformCheckoutSurface
      client={client({
        async verifyCallback(checkoutId, reference) {
          callbacks.push({ checkoutId, reference })
          return {
            ...checkout,
            recurring: {
              ...checkout.recurring,
              state: 'callback-verified',
              callbackVerifiedAt: checkout.createdAt,
            },
          }
        },
      })}
      canCheckout
      initialCheckoutId={checkout.checkoutId}
      callbackReference={checkout.recurring.reference}
    />)
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Settlement and activation are still pending')
    })
    expect(callbacks).toEqual([{
      checkoutId: checkout.checkoutId,
      reference: checkout.recurring.reference,
    }])
    expect(screen.getByText('Callback verified — settlement pending')).toBeTruthy()
  })

  it('announces provider failures and keeps controls read-only without exact write authority', async () => {
    render(<PlatformCheckoutSurface
      client={client({ async initialize() { throw new Error('Payment provider is temporarily unavailable.') } })}
      canCheckout
    />)
    fireEvent.change(screen.getByLabelText('Plan ID'), { target: { value: 'business' } })
    fireEvent.change(screen.getByLabelText('Price-book version'), { target: { value: 'book-v1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Initialize plan checkout' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('temporarily unavailable'))
    cleanup()

    render(<PlatformCheckoutSurface client={client()} canCheckout={false} />)
    expect(screen.getByRole('status').textContent).toContain('site settings write permission')
    expect((screen.getByRole('button', { name: 'Initialize plan checkout' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Initialize offer checkout' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('mounts only on the capability-owned billing settings descendant with exact-site write permission', () => {
    const shell = {
      resolution: {
        selection: {
          organizationId: checkout.destination.organizationId,
          workspaceId: checkout.destination.workspaceId,
          siteId: checkout.destination.siteId,
        },
        profile: { capabilities: [{ id: 'site.settings' }] },
      },
      profileRelativeSubpath: '/admin/settings/billing',
      routeAccess: {
        kind: 'allowed',
        route: {
          id: 'route.settings',
          method: 'GET',
          path: '/admin/settings',
          permission: 'site.settings.read',
        },
      },
    } as unknown as FumaScopedShellReadyContext
    const decisions = [{
      permissionId: 'site.settings.write',
      scope: {
        kind: 'site',
        platformId: 'platform-a',
        organizationId: checkout.destination.organizationId,
        workspaceId: checkout.destination.workspaceId,
        siteId: checkout.destination.siteId,
      },
      decision: 'allow',
      precedence: 'launch-persona',
      source: {
        kind: 'launch-persona-assignment',
        assignmentId: 'owner-a',
        persona: 'owner',
      },
    }] as const satisfies readonly PermissionDecision[]
    const { rerender } = render(<PlatformCheckoutRouteContent
      shell={shell}
      permissionDecisions={decisions}
      search=""
    />)
    expect(screen.getByTestId('platform-checkout-route-content')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Initialize plan checkout' }).hasAttribute('disabled')).toBe(false)

    rerender(<PlatformCheckoutRouteContent
      shell={{ ...shell, profileRelativeSubpath: '/admin/settings' }}
      permissionDecisions={decisions}
      search=""
    />)
    expect(screen.queryByTestId('platform-checkout-route-content')).toBeNull()
  })
})
