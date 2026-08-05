import { describe, expect, it, mock } from 'bun:test'
import { createDomainOperationsScopedRoutes } from '../../../server/fuma/domainOperations/routes'
import type { DomainOperationsService } from '../../../server/fuma/domainOperations/service'
import { createRegistrarScopedRouteDeclarations } from '../../../server/fuma/registrar/routes'
import type { RegistrarWorkflow } from '../../../server/fuma/registrar/workflow'
import type { FumaScopedRouteHandlerInput } from '../../../server/fuma/context'
import { cloudflareScope } from './cloudflareSaasTestFixture'
import { prevalidation } from './domainOperationsTestFixture'

function input(method: string, path: string, body?: unknown, params: Record<string, string> = {}): FumaScopedRouteHandlerInput {
  const { profileId: _profileId, ...repositoryScope } = cloudflareScope
  return {
    request: new Request(`https://app.trimly.co.ke${path}`, {
      method, headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    params,
    repositoryScope,
    context: {
      capabilities: ['site.settings'], profile: { id: 'website' }, scope: { site: { profileId: 'website' } },
      actor: { kind: 'staff', userId: 'user-a', sessionId: 'session-a', impersonator: null },
    },
  } as unknown as FumaScopedRouteHandlerInput
}

describe('hosted registrar and domain operations composition', () => {
  it('mounts routes and jobs in web/worker without creating a second domain runtime', async () => {
    const [server, worker] = await Promise.all([
      Bun.file(new URL('../../../server/index.ts', import.meta.url)).text(),
      Bun.file(new URL('../../../server/fuma/publication/workerComposition.ts', import.meta.url)).text(),
    ])
    expect(server).toContain('...hostedDomainCommerce.registrar.scopedRoutes')
    expect(server).toContain('...hostedDomainCommerce.operations.scopedRoutes')
    expect(worker).toContain('...(registrar?.jobs ?? {})')
    expect(worker).toContain('...(domainOperations?.jobs ?? {})')
  })

  it('returns redacted domain settings without owner-key or transfer-fence coordinates', async () => {
    const service = {
      exactSettings: mock(async () => ({
        ...cloudflareScope,
        domainId: 'domain-a', hostname: 'www.example.co.ke', records: prevalidation.records,
        authoritativeDnsRetainedByCustomer: true, customerCloudflareAccountRequired: false, customerCloudflareTokenRequired: false,
        automation: { mode: 'manual', credentialId: null, credentialState: null },
        apexAlternatives: [{ kind: 'www-cname', available: true, instruction: 'Use www.' }],
        launchState: 'awaiting-records', version: 1, operationFence: 1, updatedAt: '2026-08-04T12:00:00.000Z',
      })),
    } as unknown as DomainOperationsService
    const route = createDomainOperationsScopedRoutes(service).find(({ method, path }) => method === 'GET' && path.endsWith('/operations'))!
    const response = await route.handler(input('GET', '/settings/domains/domain-a/operations', undefined, { domainId: 'domain-a' }))
    const value = await response.json()
    expect(response.status).toBe(200)
    expect(value).toMatchObject({ domainId: 'domain-a', hostname: 'www.example.co.ke' })
    expect(JSON.stringify(value)).not.toMatch(/ownerKey|generation|transferFence|organizationId|workspaceId|siteId/)
  })

  it('replaces browser step-up text with the exact server-issued proof', async () => {
    const purchase = mock(async (_scope, command) => ({ command }))
    const workflow = { purchase } as unknown as RegistrarWorkflow
    const routes = createRegistrarScopedRouteDeclarations(workflow, { async registrations() { return [] } }, {
      async issue(_request, purpose) { return `signed:${purpose}` },
    })
    const route = routes.find(({ path }) => path.endsWith('/purchase'))!
    const body = {
      requestId: 'request-a', quoteId: 'quote-a', expectedHostname: 'example.co.ke', expectedAmountMinor: 1000,
      currency: 'KES', expectedTermsHash: 'a'.repeat(64),
      contacts: Object.fromEntries(['registrant','administrative','technical','billing'].map((key) => [key, { name: 'A', email: 'a@example.test', phoneE164: '+254700000000', address: 'Nairobi', country: 'KE' }])),
      confirmation: 'PURCHASE example.co.ke', stepUpProof: 'browser-controlled',
    }
    await route.handler(input('POST', '/settings/domains/registrar/purchase', body))
    expect(purchase.mock.calls[0]?.[1]).toMatchObject({ stepUpProof: `signed:registrar-purchase:quote-a:${'a'.repeat(64)}` })
  })
})
