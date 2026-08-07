import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../../..')
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('FUMA-072 production architecture', () => {
  test('mounts one production support graph in the existing hosted scoped API boundary', () => {
    const hosted = source('apps/studio/server/auth/hosted/runtime.ts')
    const server = source('apps/studio/server/index.ts')
    expect(hosted).toContain('supportRoutes?: readonly FumaScopedRouteDeclaration[]')
    expect(hosted).toContain('...(input.supportRoutes ?? [])')
    expect(server).toContain('createHostedSupportOperationsRuntime')
    expect(server).toContain('supportRoutes: hostedSupportOperationsRuntime.scopedRoutes')
    expect(server.match(/createHostedFumaScopedApi\(/g)).toHaveLength(1)
  })

  test('reuses Better Auth impersonation/admin cookies and tightens canonical session expiry', () => {
    const auth = source('apps/studio/server/auth/hosted/auth.ts')
    const production = source('apps/studio/server/fuma/supportOperations/production.ts')
    expect(auth).toContain('supportApi.impersonateUser')
    expect(auth).toContain('supportApi.stopImpersonating')
    expect(auth).toContain('update auth_sessions set expires_at=')
    expect(auth).toContain('impersonationSessionDuration: 30 * 60')
    expect(production).toContain('BetterAuthSupportImpersonationAuthority')
    expect(production).not.toMatch(/Memory.*Identity|parallel.*identity store/i)
  })

  test('takes identity only from trusted request headers and returns Better Auth Set-Cookie values', () => {
    const routes = source('apps/studio/server/fuma/supportOperations/routes.ts')
    const service = source('apps/studio/server/fuma/supportOperations/service.ts')
    expect(routes).toContain('requestHeaders: new Headers(input.request.headers)')
    expect(routes).toContain("headers.append('set-cookie', cookie)")
    expect(service).toContain('requestHeaders: new Headers(request.requestHeaders)')
    expect(service).not.toContain('caller-supplied')
    expect(service).not.toContain('#impersonation.execute')
  })

  test('registers FUMA-072, FUMA-073 and dependency-ready FUMA-074 contributions', () => {
    const composition = source('apps/studio/server/fuma/platformConsole/composition.ts')
    const contribution = source('apps/studio/server/fuma/supportOperations/consoleContribution.ts')
    expect(composition).toContain('registry.register(supportOperationsConsoleContribution)')
    expect(composition).toContain('registry.register(expertDiscoveryConsoleContribution)')
    expect(composition).not.toContain("ownerTicket: 'FUMA-072' as const")
    expect(composition).not.toContain("ownerTicket: 'FUMA-073' as const")
    expect(composition).toContain('registry.register(paidHandoffConsoleContribution)')
    expect(contribution).toContain("ownerTicket: 'FUMA-072'")
    expect(contribution).toContain('mounted: false')
  })

  test('mounts a Studio-local internal UI and a persistent audited impersonation banner', () => {
    const shell = source('apps/studio/src/admin/preauth/HostedStaffShell.tsx')
    const ui = source('apps/studio/src/admin/fuma/supportOperations/SupportOperationsRouteContent.tsx')
    expect(shell).toContain('<SupportOperationsRouteContent')
    expect(shell).toContain('currentSession.session.impersonatedBy')
    expect(ui).toContain('Support session active')
    expect(ui).toContain('Isolated owner recovery')
    // This asserted the surface stayed Tailwind-free, which held while Studio styled with CSS
    // modules. Everything outside the visual builder is Tailwind now, so the property still worth
    // holding is that the surface carries no stylesheet of its own.
    expect(ui).not.toContain('module.css')
  })

  test('uses strict TypeBox only in the complete support graph', () => {
    for (const path of [
      'apps/studio/server/fuma/supportOperations/contracts.ts',
      'apps/studio/server/fuma/supportOperations/routes.ts',
      'apps/studio/server/fuma/supportOperations/production.ts',
      'apps/studio/src/admin/fuma/supportOperations/client.ts',
    ]) {
      const text = source(path)
      expect(text).not.toMatch(/from ['"]zod['"]|require\(['"]zod['"]\)/)
    }
  })

  test('uses a route-local support overlay without broad site or protected-owner grants', () => {
    const middleware = source('apps/studio/server/fuma/context/middleware.ts')
    const production = source('apps/studio/server/fuma/supportOperations/production.ts')
    const service = source('apps/studio/server/fuma/supportOperations/service.ts')
    const routes = source('apps/studio/server/fuma/supportOperations/routes.ts')
    expect(middleware).toContain('selected.route.authorization')
    expect(routes).toContain('...(authorization ? { authorization } : {})')
    expect(production).toContain('PostgresSupportRouteAuthorizationAuthority')
    expect(production).toContain("role: { kind: 'launch-persona' as const, persona: 'viewer' as const }")
    expect(production).toContain('normalizedEmail(row.email) === this.#protectedOwnerEmail')
    expect(service).toContain('The originating direct staff authority is no longer current.')
    expect(routes).toContain("permission: 'site.read'")
    expect(routes).not.toContain("permission: 'support.access'")
  })

  test('uses OCI Email Delivery for production owner recovery and fake delivery only outside production', () => {
    const server = source('apps/studio/server/index.ts')
    const delivery = source('apps/studio/server/auth/hosted/ociDelivery.ts')
    expect(server).toContain("fumaConfig.environment === 'production'")
    expect(server).toContain('createHostedAuthOciDelivery({ config: fumaConfig })')
    expect(server).toContain(': createHostedAuthFakeInbox()')
    expect(delivery).toContain("'X-Fuma-Auth-Message': kind")
    expect(delivery).toContain("url.hostname !== linkHost")
    expect(delivery).toContain("url.protocol !== 'https:'")
    expect(delivery).toContain("url.port !== ''")
    expect(delivery).not.toMatch(/console\.(?:log|info|debug)/)
  })
})