import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../..')
const ROUTE_CONTENT_PATH = 'apps/studio/src/admin/fuma/publication/PublicationRouteContent.tsx'

type Sources = Readonly<{ routeContent: string }>

function productionSources(): Sources {
  return {
    routeContent: readFileSync(join(ROOT, ROUTE_CONTENT_PATH), 'utf8'),
  }
}

function audit({ routeContent }: Sources): string[] {
  const violations: string[] = []
  if (!routeContent.includes('PUBLICATION_ROUTE_BY_ID')
    || !routeContent.includes('shell.resolution.profile.capabilities.some')
    || routeContent.includes("shell.navigation.some((entry) => entry.id === 'nav.posts')")) {
    violations.push('Publication child ownership is inferred from filtered navigation instead of active capability composition')
  }
  if (!routeContent.includes("decision.scope.kind === 'site'")
    || !routeContent.includes('decision.scope.organizationId === selection.organizationId')
    || !routeContent.includes('decision.scope.workspaceId === selection.workspaceId')
    || !routeContent.includes('decision.scope.siteId === selection.siteId')) {
    violations.push('Publication write authority is not bound to the exact active site scope')
  }
  if (/profile(?:\.id|Id)?\s*={2,3}\s*['"](?:website|publication)['"]/.test(routeContent)) {
    violations.push('Publication route content branches on a launch profile ID')
  }
  return violations
}

function replace(source: Sources, before: string, after: string): Sources {
  if (!source.routeContent.includes(before)) throw new Error(`Hostile fixture cannot find ${before}`)
  return { routeContent: source.routeContent.replace(before, after) }
}

describe('FUMA-032 Publication route-content architecture', () => {
  it('audits capability-owned and exact-scope child mounting', () => {
    expect(audit(productionSources())).toEqual([])
  })

  it('rejects filtered-navigation ownership and foreign-scope permission acceptance', () => {
    const sources = productionSources()
    expect(audit(replace(
      sources,
      'shell.resolution.profile.capabilities.some',
      'shell.navigation.some',
    ))).toContain(
      'Publication child ownership is inferred from filtered navigation instead of active capability composition',
    )
    expect(audit(replace(
      sources,
      'decision.scope.siteId === selection.siteId',
      'true',
    ))).toContain('Publication write authority is not bound to the exact active site scope')
  })

  it('rejects a named-profile route-content branch', () => {
    const sources = productionSources()
    expect(audit({
      routeContent: `${sources.routeContent}\nif (shell.resolution.site.profileId === 'publication') return null`,
    })).toContain('Publication route content branches on a launch profile ID')
  })
})
