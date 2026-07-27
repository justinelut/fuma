import {
  createPlatformCheckoutScopedRouteDeclarations,
  type PlatformCheckoutDestination,
  type PlatformCheckoutView,
} from '../../../server/fuma/checkout'
import type { PlatformCheckoutService } from '../../../server/fuma/checkout/service'
import type {
  FumaRequestContext,
  FumaScopedRouteHandlerInput,
} from '../../../server/fuma/context'

const destination: PlatformCheckoutDestination = {
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  profileId: 'website',
}
const checkout: PlatformCheckoutView = {
  checkoutId: 'checkout:fixture',
  state: 'awaiting-payment',
  source: {
    kind: 'public-plan',
    planId: 'business',
    priceBookVersion: 'book-v1',
    cadence: 'annual',
  },
  destination,
  cadence: 'annual',
  currency: 'KES',
  setup: null,
  recurring: {
    kind: 'recurring',
    amountMinor: 120_000,
    currency: 'KES',
    reference: 'pb_platform-recurring_0000000000000001',
    authorizationUrl: 'https://checkout.paystack.test/pay',
    state: 'ready',
    callbackVerifiedAt: null,
  },
  createdAt: '2026-07-28T09:00:00.000Z',
  cancelledAt: null,
}

function context(): FumaRequestContext {
  return {
    requestId: 'request-a',
    source: {
      kind: 'staff-session',
      correlationId: 'request-a',
      userId: 'user-a',
      sessionId: 'session-a',
      impersonatedBy: null,
    },
    actor: {
      kind: 'staff',
      userId: 'user-a',
      sessionId: 'session-a',
      impersonator: null,
    },
    scope: {
      platform: { id: 'platform-a', status: 'active' },
      organization: { id: destination.organizationId, platformId: 'platform-a', status: 'active' },
      workspace: {
        id: destination.workspaceId,
        platformId: 'platform-a',
        organizationId: destination.organizationId,
        status: 'active',
      },
      site: {
        id: destination.siteId,
        platformId: 'platform-a',
        organizationId: destination.organizationId,
        workspaceId: destination.workspaceId,
        profileId: destination.profileId,
        status: 'active',
      },
    },
    profile: { id: destination.profileId, status: 'active' },
    capabilities: ['site.settings'],
    permissions: {
      subjectId: 'user-a',
      allow: ['site.settings.read', 'site.settings.write'],
      deny: [],
    },
  }
}
function input(request: Request, params: Record<string, string> = {}): FumaScopedRouteHandlerInput {
  return {
    request,
    context: context(),
    repositoryScope: {
      platformId: 'platform-a',
      organizationId: destination.organizationId,
      workspaceId: destination.workspaceId,
      siteId: destination.siteId,
      ownerKey: 'owner-key-a',
      generation: 1,
      state: 'active',
      transferFence: null,
    },
    params,
  }
}
function jsonRequest(path: string, body: unknown): Request {
  return new Request(`https://app.fuma.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.fuma.test' },
    body: JSON.stringify(body),
  })
}

describe('FUMA-055 scoped checkout handlers', () => {
  it('declares least-privilege read/write routes and derives customer/destination from trusted authority', async () => {
    const calls: unknown[] = []
    const service = {
      async initialize(intent: unknown, customer: unknown) {
        calls.push({ intent, customer })
        return checkout
      },
      async find() { return checkout },
      async cancel() { return { ...checkout, state: 'cancelled', cancelledAt: checkout.createdAt } },
      async verifyCallback() { return checkout },
    } as unknown as PlatformCheckoutService
    const routes = createPlatformCheckoutScopedRouteDeclarations({
      service,
      async resolvePayer() {
        return {
          userId: 'user-a',
          sessionId: 'session-a',
          email: 'owner@example.test',
          impersonatedBy: null,
        }
      },
    })
    expect(routes.map(({ method, path, permission }) => ({ method, path, permission }))).toEqual([
      { method: 'POST', path: '/billing/checkouts', permission: 'site.settings.write' },
      { method: 'GET', path: '/billing/checkouts/:checkoutId', permission: 'site.settings.read' },
      { method: 'POST', path: '/billing/checkouts/:checkoutId/cancel', permission: 'site.settings.write' },
      { method: 'POST', path: '/billing/checkouts/:checkoutId/callback', permission: 'site.settings.write' },
    ])
    const response = await routes[0]!.handler(input(jsonRequest('/billing/checkouts', {
      source: {
        kind: 'public-plan',
        planId: 'business',
        priceBookVersion: 'book-v1',
        cadence: 'annual',
      },
    })))
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual(checkout)
    expect(calls).toEqual([{
      intent: { source: checkout.source },
      customer: {
        destination,
        customerActorId: 'user-a',
        payerEmail: 'owner@example.test',
      },
    }])
  })

  it('rejects caller authority fields and session/scope substitution without exposing details', async () => {
    const service = {
      async initialize() { throw new Error('must not run') },
      async find() { return checkout },
      async cancel() { return checkout },
      async verifyCallback() { return checkout },
    } as unknown as PlatformCheckoutService
    const routes = createPlatformCheckoutScopedRouteDeclarations({
      service,
      async resolvePayer() {
        return {
          userId: 'another-user',
          sessionId: 'session-a',
          email: 'secret@example.test',
          impersonatedBy: null,
        }
      },
    })
    const injected = await routes[0]!.handler(input(jsonRequest('/billing/checkouts', {
      source: {
        kind: 'public-plan',
        planId: 'business',
        priceBookVersion: 'book-v1',
        cadence: 'annual',
      },
      organizationId: 'other-organization',
      amountMinor: 1,
      email: 'attacker@example.test',
    })))
    expect(injected.status).toBe(400)
    expect(await injected.json()).toEqual({ error: 'Checkout intent is invalid.' })

    const denied = await routes[0]!.handler(input(jsonRequest('/billing/checkouts', {
      source: checkout.source,
    })))
    expect(denied.status).toBe(404)
    const deniedBody = await denied.json()
    expect(deniedBody).toEqual({ error: 'Resource not found.' })
    expect(JSON.stringify(deniedBody)).not.toContain('secret@example.test')
  })

  it('verifies callbacks only through same-origin POST intent and never returns provider-private fields', async () => {
    const callbackCalls: unknown[] = []
    const service = {
      async initialize() { return checkout },
      async find() { return checkout },
      async cancel() { return checkout },
      async verifyCallback(...args: unknown[]) {
        callbackCalls.push(args)
        return checkout
      },
    } as unknown as PlatformCheckoutService
    const routes = createPlatformCheckoutScopedRouteDeclarations({
      service,
      async resolvePayer() {
        return {
          userId: 'user-a',
          sessionId: 'session-a',
          email: 'owner@example.test',
          impersonatedBy: null,
        }
      },
    })
    const callback = routes[3]!
    const response = await callback.handler(input(
      jsonRequest('/billing/checkouts/checkout%3Afixture/callback', {
        reference: checkout.recurring.reference,
      }),
      { checkoutId: checkout.checkoutId },
    ))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(callbackCalls).toEqual([[
      destination,
      checkout.checkoutId,
      checkout.recurring.reference,
    ]])
    expect(await response.text()).not.toMatch(/customer_code|authorization_code|owner@example/i)
  })
})
