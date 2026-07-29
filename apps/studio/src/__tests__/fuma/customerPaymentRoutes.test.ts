import { describe, expect, it } from 'bun:test'
import type { FumaRequestContext, FumaScopedRouteHandlerInput } from '../../../server/fuma/context'
import type { CustomerMerchantPaymentService } from '../../../server/fuma/customerPayments/service'
import {
  CustomerMemberPaymentBoundary,
  CustomerMerchantWebhookBoundary,
  createCustomerMerchantCredentialRouteDeclarations,
} from '../../../server/fuma/customerPayments/routes'

const merchantScope = Object.freeze({
  platformId: 'platform-a', organizationId: 'organization-a', workspaceId: 'workspace-a',
  siteId: 'site-a', ownerKey: 'owner-a', ownerGeneration: 3,
})
const timestamp = '2026-07-28T10:00:00.000Z'

function context(profileId = 'publication'): FumaRequestContext {
  return {
    requestId: 'request-a',
    source: { kind: 'staff-session', correlationId: 'request-a', userId: 'user-a', sessionId: 'session-a', impersonatedBy: null },
    actor: { kind: 'staff', userId: 'user-a', sessionId: 'session-a', impersonator: null },
    scope: {
      platform: { id: merchantScope.platformId, status: 'active' },
      organization: { id: merchantScope.organizationId, platformId: merchantScope.platformId, status: 'active' },
      workspace: { id: merchantScope.workspaceId, platformId: merchantScope.platformId, organizationId: merchantScope.organizationId, status: 'active' },
      site: { id: merchantScope.siteId, platformId: merchantScope.platformId, organizationId: merchantScope.organizationId, workspaceId: merchantScope.workspaceId, profileId, status: 'active' },
    },
    profile: { id: profileId, status: 'active' },
    capabilities: profileId === 'publication' ? ['site.settings', 'publication.members'] : ['site.settings'],
    permissions: { subjectId: 'user-a', allow: ['site.settings.write'], deny: [] },
  }
}
function input(request: Request, profileId = 'publication'): FumaScopedRouteHandlerInput {
  return {
    request,
    context: context(profileId),
    repositoryScope: {
      platformId: merchantScope.platformId,
      organizationId: merchantScope.organizationId,
      workspaceId: merchantScope.workspaceId,
      siteId: merchantScope.siteId,
      ownerKey: merchantScope.ownerKey,
      generation: merchantScope.ownerGeneration,
      state: 'active',
      transferFence: null,
    },
    params: {},
  }
}
function post(path: string, body: unknown): Request {
  return new Request(`https://publication.example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://publication.example.test' },
    body: JSON.stringify(body),
  })
}

describe('FUMA-058 customer merchant route boundaries', () => {
  it('derives merchant ancestry from trusted scoped authority and returns no ciphertext or secret', async () => {
    const calls: unknown[] = []
    const service = {
      async attachCredential(scope: unknown, secret: unknown, credentialId: string) {
        calls.push({ scope, secret, credentialId })
        return {
          credentialId,
          scope: 'customer_merchant',
          merchantScope,
          version: 1,
          envelope: { ciphertext: 'ciphertext-not-for-wire', keyId: 'kms-key-not-for-wire' },
          state: 'active', createdAt: timestamp, updatedAt: timestamp,
        }
      },
    } as unknown as CustomerMerchantPaymentService
    const route = createCustomerMerchantCredentialRouteDeclarations(service)[0]!
    expect({ method: route.method, path: route.path, permission: route.permission }).toEqual({
      method: 'POST', path: '/publication/payments/merchant-credentials', permission: 'site.settings.write',
    })
    const response = await route.handler(input(post('/publication/payments/merchant-credentials', {
      credentialId: 'credential-one',
      secret: { scope: 'customer_merchant', publicKey: 'pk_customer', secretKey: 'sk_customer' },
    })))
    expect(response.status).toBe(201)
    expect(calls).toEqual([{
      scope: merchantScope,
      secret: { scope: 'customer_merchant', publicKey: 'pk_customer', secretKey: 'sk_customer' },
      credentialId: 'credential-one',
    }])
    const text = await response.text()
    expect(text).not.toMatch(/ciphertext|kms-key|secretKey|sk_customer|publicKey|pk_customer/)
  })

  it('rejects non-Publication profiles and caller-supplied authority or extra secret fields', async () => {
    const service = { async attachCredential() { throw new Error('must not run') } } as unknown as CustomerMerchantPaymentService
    const route = createCustomerMerchantCredentialRouteDeclarations(service)[0]!
    const wrongProfile = await route.handler(input(post('/publication/payments/merchant-credentials', {
      credentialId: 'credential-one',
      secret: { scope: 'customer_merchant', publicKey: 'pk', secretKey: 'sk' },
    }), 'website'))
    expect(wrongProfile.status).toBe(404)

    const injected = await route.handler(input(post('/publication/payments/merchant-credentials', {
      credentialId: 'credential-one',
      organizationId: 'attacker-organization',
      secret: { scope: 'customer_merchant', publicKey: 'pk', secretKey: 'sk', platformSecret: 'forbidden' },
    })))
    expect(injected.status).toBe(400)
    expect(await injected.text()).not.toContain('attacker-organization')
  })

  it('derives member/session/site authority outside the body for initialize and reconcile', async () => {
    const calls: unknown[] = []
    const service = {
      async initialize(authority: unknown, request: unknown) {
        calls.push({ authority, request })
        return {
          purchaseId: 'purchase:0000000000000000000000000000000000000000',
          reference: 'cm_publication-membership_0000000000000001',
          authorizationUrl: 'https://checkout.example.test/pay',
          channel: 'mobile_money', renewalMode: 'manual-mobile-money',
        }
      },
      async reconcile() { throw new Error('not used') },
    } as unknown as CustomerMerchantPaymentService
    const payer = Object.freeze({
      scope: merchantScope, memberId: 'member-a', memberSessionId: 'member-session-a', email: 'member@example.test',
    })
    const boundary = new CustomerMemberPaymentBoundary(service, { async resolve() { return payer } })
    const response = await boundary.handle(post('/__fuma/publication/payments/initialize', {
      requestId: 'request-mobile', tierId: 'tier-a', channel: 'mobile_money',
      mobileProvider: 'airtel', renewalOfMembershipId: null, renewalConfirmationId: 'confirmation-a',
    }))
    expect(response?.status).toBe(201)
    expect(calls).toEqual([{
      authority: payer,
      request: {
        requestId: 'request-mobile', tierId: 'tier-a', channel: 'mobile_money',
        mobileProvider: 'airtel', renewalOfMembershipId: null, renewalConfirmationId: 'confirmation-a',
      },
    }])
    expect(response?.headers.get('cache-control')).toBe('no-store')
  })

  it('fails member enumeration closed and rejects body authority injection before service access', async () => {
    let calls = 0
    const service = {
      async initialize() { calls += 1; throw new Error('must not run') },
      async reconcile() { calls += 1; throw new Error('must not run') },
    } as unknown as CustomerMerchantPaymentService
    const absent = new CustomerMemberPaymentBoundary(service, { async resolve() { return null } })
    const denied = await absent.handle(post('/__fuma/publication/payments/initialize', {
      requestId: 'request-a', tierId: 'tier-a', channel: 'card', mobileProvider: null,
      renewalOfMembershipId: null, renewalConfirmationId: null,
    }))
    expect(denied?.status).toBe(404)
    expect(await denied?.json()).toEqual({ error: 'Resource not found.' })

    const injected = new CustomerMemberPaymentBoundary(service, { async resolve() {
      return { scope: merchantScope, memberId: 'member-a', memberSessionId: 'session-a', email: 'member@example.test' }
    } })
    const invalid = await injected.handle(post('/__fuma/publication/payments/initialize', {
      requestId: 'request-a', tierId: 'tier-a', channel: 'card', mobileProvider: null,
      renewalOfMembershipId: null, renewalConfirmationId: null, organizationId: 'attacker', amountMinor: 1,
    }))
    expect(invalid?.status).toBe(400)
    expect(calls).toBe(0)
  })

  it('routes raw webhooks to one explicit customer credential and returns non-oracular acceptance', async () => {
    const calls: unknown[] = []
    const service = {
      async ingestWebhook(credentialId: string, raw: Uint8Array, signature: string) {
        calls.push({ credentialId, body: new TextDecoder().decode(raw), signature })
        if (signature !== 'valid') throw new Error('invalid signature')
        return { duplicate: false, eventId: 'event-a' }
      },
    } as unknown as CustomerMerchantPaymentService
    const boundary = new CustomerMerchantWebhookBoundary(service)
    const valid = await boundary.handle(new Request(
      'https://publication.example.test/_fuma/paystack/webhooks/customer-merchant/credential-one',
      { method: 'POST', headers: { 'x-paystack-signature': 'valid' }, body: '{"event":"one"}' },
    ))
    const invalid = await boundary.handle(new Request(
      'https://publication.example.test/_fuma/paystack/webhooks/customer-merchant/credential-two',
      { method: 'POST', headers: { 'x-paystack-signature': 'invalid' }, body: '{not-json' },
    ))
    expect(valid?.status).toBe(202)
    expect(await valid?.text()).toBe(await invalid?.text())
    expect(calls).toEqual([
      { credentialId: 'credential-one', body: '{"event":"one"}', signature: 'valid' },
      { credentialId: 'credential-two', body: '{not-json', signature: 'invalid' },
    ])
  })
})
