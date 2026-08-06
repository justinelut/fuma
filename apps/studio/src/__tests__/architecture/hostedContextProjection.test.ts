import { describe, expect, it } from 'bun:test'

const read = (path: string) => Bun.file(new URL(`../../../${path}`, import.meta.url)).text()

describe('hosted accessible context projection', () => {
  it('mounts the catalog boundary in the production server', async () => {
    const [server, router] = await Promise.all([
      read('server/index.ts'),
      read('server/router.ts'),
    ])
    expect(server).toContain('createAccessibleContextCatalogBoundary')
    expect(server).toContain('new PostgresAccessibleContextCatalog')
    expect(server).toContain('accessibleContextCatalog,')
    expect(router).toContain('tryServeAccessibleContextCatalog')
    expect(router).toContain('accessibleContextCatalog?: AccessibleContextCatalogBoundary')
  })

  it('resolves real scope before choosing onboarding over the scoped workspace', async () => {
    const [entry, hook] = await Promise.all([
      read('src/admin/AdminEntry.tsx'),
      read('src/admin/preauth/hostedContextCatalog.ts'),
    ])
    expect(entry).toContain('useHostedContextCatalog')
    // An unresolved projection must never be read as "no sites".
    expect(entry).toContain("projection.status === 'loading'")
    expect(entry).toContain('hostedContextCatalog ?? projection.catalog ?? undefined')
    expect(hook).toContain("'/api/fuma/context-catalog'")
    expect(hook).toContain("credentials: 'same-origin'")
    expect(hook).toContain('Value.Check(AccessibleContextCatalogSchema, candidate)')
  })

  it('projects permissions from the same authority the scoped API enforces', async () => {
    const [server, hook, entry] = await Promise.all([
      read('server/index.ts'),
      read('src/admin/preauth/hostedContextCatalog.ts'),
      read('src/admin/AdminEntry.tsx'),
    ])
    expect(server).toContain('resolvePermissions:')
    expect(server).toContain('PostgresFumaSiteAuthorizationAuthority')
    expect(server).toContain('resolveLayeredPermissions')
    expect(server).toContain('allowedPermissionIds')
    // The projection must assemble resolver input exactly like enforcement;
    // passing authorization.permissions alone fails contract validation.
    expect(server).toContain('permissionInput(readAuthorization(authorization))')
    expect(server).not.toContain('{ permissions: unknown }).permissions)')
    expect(hook).toContain('permissionState[permissionId] = true')
    expect(hook).toContain("decision: 'allow' as const")
    expect(entry).toContain('permissionState={projection.permissionState}')
    expect(entry).toContain('permissionDecisions={projection.permissionDecisions}')
  })
})
