import { describe, expect, it } from 'bun:test'
import type { FumaScopedRouteHandlerInput } from '../../../server/fuma/context'
import { createAiCreditScopedRouteDeclarations } from '../../../server/fuma/aiCredits/routes'
import { createAiCreditFixture, aiCreditScope, grantCommand } from './aiCreditsTestFixture'

function routeInput(changes: Readonly<{
  siteId?: string
  ownerKey?: string
  accountId?: string
}> = {}): FumaScopedRouteHandlerInput {
  return {
    request: new Request('https://product.example/api/fuma/organizations/organization-a/workspaces/workspace-a/sites/site-a/ai/credits'),
    params: changes.accountId ? { accountId: changes.accountId } : {},
    repositoryScope: Object.freeze({
      platformId: aiCreditScope.platformId,
      organizationId: aiCreditScope.organizationId,
      workspaceId: aiCreditScope.workspaceId,
      siteId: changes.siteId ?? aiCreditScope.siteId,
      ownerKey: changes.ownerKey ?? aiCreditScope.ownerKey,
      generation: aiCreditScope.ownerGeneration,
      state: 'active' as const,
      transferFence: null,
    }),
  } as unknown as FumaScopedRouteHandlerInput
}

describe('FUMA-064 scoped AI credit ledger routes', () => {
  it('resolves the account from trusted scope and returns only customer ledger evidence', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand())
    await fixture.service.attachByok({
      credentialId: 'byok-ledger', scope: aiCreditScope, providerId: 'provider-a',
      existingCredentialId: 'native-secret-reference', displayLabel: 'Primary provider', idempotencyKey: 'byok-ledger',
    })
    const routes = createAiCreditScopedRouteDeclarations({ service: fixture.service, repository: fixture.repository })
    const ledger = routes.find(({ method, path }) => method === 'GET' && path === '/ai/credits')!
    const response = await ledger.handler(routeInput())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      account: { accountId: 'account-a', availableMicros: 5_000_000 },
      entries: [{ entryType: 'grant', state: 'available', amountMicros: 5_000_000 }],
    })
    expect(JSON.stringify(body)).not.toMatch(/ownerKey|ownerGeneration|evidenceId|idempotency|providerCost|markup|bindingSha256|ciphertext|envelope|native-secret-reference/i)
  })

  it('denies site, owner, and caller-selected account substitution without an account oracle', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand())
    const routes = createAiCreditScopedRouteDeclarations({ service: fixture.service, repository: fixture.repository })
    const ledger = routes.find(({ method, path }) => method === 'GET' && path === '/ai/credits')!
    const selected = routes.find(({ method, path }) => method === 'GET' && path === '/ai/credits/:accountId')!

    for (const input of [routeInput({ siteId: 'site-attacker' }), routeInput({ ownerKey: 'owner-attacker' })]) {
      const response = await ledger.handler(input)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'AI credit scope unavailable.' })
    }
    const response = await selected.handler(routeInput({ accountId: 'account-attacker' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'AI credit scope unavailable.' })
  })
})
