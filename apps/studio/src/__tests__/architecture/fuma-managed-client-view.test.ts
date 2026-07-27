import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../..')

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

describe('FUMA-018 managed-client app boundary', () => {
  it('projects managed workspaces from the validated public context contract', () => {
    const contracts = read('src/core/fuma/managedClientContracts.ts')
    const projection = read('src/core/fuma/managedClients.ts')

    expect(contracts).toContain('ManagedClientCatalogEntrySchema')
    expect(contracts).toContain('ManagedClientsViewSchema')
    expect(projection).toContain('export function composeManagedClientsView(')
    expect(projection).toContain('catalog.managedClients ?? []')
    expect(projection).toContain('buildScopedAdminUrl(selection)')
    expect(projection).not.toMatch(/profileId\s*(?:===|!==)/)
  })

  it('keeps the app view read-only and free of admin-only commercial authority', () => {
    const view = read('src/admin/fuma/FumaManagedClientsView.tsx')

    expect(view).toContain("import { Link } from '@admin/lib/routing'")
    expect(view).toContain("import type { ManagedClientsView } from '@core/fuma'")
    expect(view).not.toMatch(/<\s*(?:button|select|a)\b/)
    expect(view).not.toMatch(/\b(?:offer|grant|billing|price|quota|entitlement|payment|transfer)\b/i)
    expect(view).not.toMatch(/['"](?:website|publication)['"]/)
  })

  it('keeps saved-context restoration wired through hosted unscoped routes', () => {
    const router = read('src/admin/router.tsx')
    const catalogProp = 'hostedContextCatalog={hosted ? hostedContextCatalog : undefined}'

    expect(router).toContain('<Route path="/admin/dashboard"')
    expect(router).toContain('<Route path="/admin/site"')
    expect(router).toContain('<Route path="/admin/content"')
    expect(router).toContain(catalogProp)
    expect(router.match(new RegExp(catalogProp.replace(/[{}?]/g, '\\$&'), 'g'))?.length)
      .toBeGreaterThanOrEqual(5)
  })
})
