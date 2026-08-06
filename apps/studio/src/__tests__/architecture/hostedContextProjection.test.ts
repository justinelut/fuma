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
})
