import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../..')

type Sources = Readonly<{
  contracts: string
  launch: string
  navigation: string
  routes: string
  shell: string
  component: string
  studioManifest: string
}>

function productionSources(): Sources {
  const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
  return {
    contracts: read('apps/studio/src/core/fuma/contracts.ts'),
    launch: read('apps/studio/src/core/fuma/launchProfiles.ts'),
    navigation: read('apps/studio/src/core/fuma/navigation.ts'),
    routes: read('apps/studio/src/core/fuma/routes.ts'),
    shell: read('apps/studio/src/admin/fuma/FumaScopedShell.tsx'),
    component: read('apps/studio/src/admin/fuma/ProfileNavigation.tsx'),
    studioManifest: read('apps/studio/package.json'),
  }
}

function audit(sources: Sources): string[] {
  const violations: string[] = []
  const publicationBlock = sources.launch.match(/id: 'publication',[\s\S]*?starterTemplatePreset:/)?.[0] ?? ''
  const navigationPreset = publicationBlock.match(/navigationPreset: \[([\s\S]*?)\],/)?.[1] ?? ''
  const labels = [...navigationPreset.matchAll(/'nav\.(home|posts|pages|tags|members|newsletters|publication-analytics|design|settings)'/g)]
    .map((match) => match[1])

  if (!publicationBlock.includes("subtitle: 'Blog, magazine, newsletter, or newsroom'")) {
    violations.push('Publication subtitle drifted from the exact launch contract')
  }
  if (labels.join(',') !== 'home,posts,pages,tags,members,newsletters,publication-analytics,design,settings') {
    violations.push('Publication navigation preset is not the exact required order')
  }
  if (!/label: 'Editor',[\s\S]*?defaultCollapsed: true,[\s\S]*?navigationIds: \['nav\.design'\]/.test(publicationBlock)) {
    violations.push('Design is not present in the default-collapsed Editor disclosure')
  }
  if (!sources.contracts.includes('navigationSections: Type.Optional(Type.Array(NavigationSectionSchema))')
    || !sources.navigation.includes('disclosureByNavigationId')) {
    violations.push('navigation disclosure is not composed from validated profile data')
  }
  if (!sources.routes.includes('registry.compose(input.profileId, input.capabilityOverrides)')
    || !sources.routes.includes('input.permissionState[activeRoute.permission] === true')
    || !sources.routes.includes("reason: 'capability-disabled'")) {
    violations.push('direct route access bypasses capability composition or exact permission allow')
  }
  if (!sources.shell.includes("const renderedChildren = showingManagedClients || model.routeAccess.kind === 'denied'")
    || !sources.shell.includes('resolveProfileRouteAccess({')) {
    violations.push('scoped shell does not fail closed before mounting denied route content')
  }
  if (!sources.component.includes('<details') || !sources.component.includes('<summary')) {
    violations.push('Editor disclosure lacks native keyboard and screen-reader semantics')
  }

  const sharedDecisionSources = [sources.navigation, sources.routes, sources.shell, sources.component]
  if (sharedDecisionSources.some((source) => /profile(?:\.id|Id)?\s*={2,3}\s*['"](?:website|publication)['"]/.test(source))) {
    violations.push('shared shell implementation branches on a launch profile ID')
  }
  if (/\b(?:tailwindcss|tailwind-merge|shadcn|class-variance-authority|zod)\b/.test(
    `${sources.navigation}\n${sources.routes}\n${sources.shell}\n${sources.component}\n${sources.studioManifest}`,
  )) {
    violations.push('Publication shell contaminates Studio with Fuma Web styling or Zod dependencies')
  }
  return violations
}

function replace(sources: Sources, key: keyof Sources, before: string, after: string): Sources {
  if (!sources[key].includes(before)) throw new Error(`Hostile fixture cannot find ${before}`)
  return { ...sources, [key]: sources[key].replace(before, after) }
}

describe('FUMA-032 Publication shell architecture', () => {
  it('audits the complete production shell boundary', () => {
    expect(audit(productionSources())).toEqual([])
  })

  it('rejects subtitle, order, and collapsed Design declaration drift', () => {
    const sources = productionSources()
    expect(audit(replace(
      sources,
      'launch',
      'Blog, magazine, newsletter, or newsroom',
      'Publication',
    ))).toContain('Publication subtitle drifted from the exact launch contract')
    expect(audit(replace(
      sources,
      'launch',
      "      'nav.posts',\n      'nav.pages',",
      "      'nav.pages',\n      'nav.posts',",
    ))).toContain('Publication navigation preset is not the exact required order')
    expect(audit(replace(
      sources,
      'launch',
      'defaultCollapsed: true',
      'defaultCollapsed: false',
    ))).toContain('Design is not present in the default-collapsed Editor disclosure')
  })

  it('rejects capability, permission, and denied-child route bypasses', () => {
    const sources = productionSources()
    expect(audit(replace(
      sources,
      'routes',
      'input.permissionState[activeRoute.permission] === true',
      'true',
    ))).toContain('direct route access bypasses capability composition or exact permission allow')
    expect(audit(replace(
      sources,
      'shell',
      "model.routeAccess.kind === 'denied'",
      'false',
    ))).toContain('scoped shell does not fail closed before mounting denied route content')
  })

  it('rejects inaccessible disclosure markup, named-profile branches, and Studio dependency contamination', () => {
    const sources = productionSources()
    expect(audit(replace(sources, 'component', '<summary', '<div')))
      .toContain('Editor disclosure lacks native keyboard and screen-reader semantics')
    expect(audit({
      ...sources,
      routes: `${sources.routes}\nif (input.profileId === 'publication') return publicationRoutes`,
    })).toContain('shared shell implementation branches on a launch profile ID')
    expect(audit({
      ...sources,
      component: `${sources.component}\nimport { cn } from 'tailwind-merge'`,
    })).toContain('Publication shell contaminates Studio with Fuma Web styling or Zod dependencies')
  })
})
