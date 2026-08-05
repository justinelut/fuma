import { describe, expect, it } from 'bun:test'
import {
  FumaRegistryError,
  LAUNCH_CAPABILITIES,
  LAUNCH_PROFILES,
  createFumaRegistry,
  fumaLaunchRegistry,
  type CapabilityDefinition,
  type FumaRegistryDefinition,
  type FumaRegistryErrorCode,
} from '@core/fuma'
import { createFumaFixtureSite } from '../helpers/fuma/fixtures'

const PUBLICATION_NAVIGATION = [
  'Home',
  'Posts',
  'Pages',
  'Tags',
  'Members',
  'Newsletters',
  'Analytics',
  'Design',
  'Domains',
  'Organization & team',
  'Settings',
] as const

function expectRegistryError(run: () => unknown, code: FumaRegistryErrorCode): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(FumaRegistryError)
    if (!(error instanceof FumaRegistryError)) throw error
    expect(error.code).toBe(code)
    return
  }
  throw new Error(`Expected FumaRegistryError with code ${code}`)
}

function capability(id: string, extra: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id,
    permissions: [{ id: `${id}.read`, label: `Read ${id}`, description: `Read ${id}.` }],
    ...extra,
  }
}

function definition(capabilities: readonly CapabilityDefinition[]): FumaRegistryDefinition {
  return {
    capabilities: [...capabilities],
    profiles: [{
      id: 'fixture',
      label: 'Fixture',
      capabilityPreset: capabilities.length === 0 ? ['missing'] : [capabilities[0].id],
      navigationPreset: [],
      onboardingPreset: [],
      starterTemplatePreset: [],
    }],
  }
}

describe('Fuma profile and capability registry', () => {
  it('composes both launch profiles from the public contribution contracts', () => {
    const website = fumaLaunchRegistry.compose('website')
    const publication = fumaLaunchRegistry.compose('publication')

    expect(website.profile.label).toBe('Website')
    expect(publication.profile.subtitle).toBe('Blog, magazine, newsletter, or newsroom')
    expect(publication.navigation.map(({ label }) => label)).toEqual(PUBLICATION_NAVIGATION)

    for (const composed of [website, publication]) {
      expect(composed.capabilities.length).toBeGreaterThan(0)
      expect(composed.navigation.length).toBeGreaterThan(0)
      expect(composed.onboarding.length).toBeGreaterThan(0)
      expect(composed.starterTemplates.length).toBeGreaterThan(0)
      expect(composed.permissions.length).toBeGreaterThan(0)
      expect(composed.routes.length).toBeGreaterThan(0)
      expect(composed.jobs.length).toBeGreaterThan(0)
      expect(composed.transfer.length).toBeGreaterThan(0)
      expect(Object.isFrozen(composed)).toBe(true)
      expect(Object.isFrozen(composed.capabilities)).toBe(true)
    }
  })

  it('grants a Publication capability to a Website fixture without changing the registry', () => {
    const websiteFixture = createFumaFixtureSite({
      seed: 'fuma-004-demo',
      label: 'cross-profile-website',
      organizationId: 'fixture-organization',
      workspaceId: 'fixture-workspace',
      profileId: 'website',
      capabilityOverrides: {
        grant: ['publication.editorial.schedule'],
        revoke: [],
      },
    })

    const before = fumaLaunchRegistry.compose('website')
    const granted = fumaLaunchRegistry.compose(websiteFixture.profileId, websiteFixture.capabilityOverrides)

    expect(before.capabilities.some(({ id }) => id === 'publication.editorial.schedule')).toBe(false)
    expect(granted.capabilities.map(({ id }) => id)).toContain('publication.editorial.schedule')
    expect(granted.capabilities.map(({ id }) => id)).toContain('publication.editorial')
    expect(granted.jobs.map(({ id }) => id)).toContain('job.publication-publish-due')
    expect(granted.navigation.map(({ label }) => label)).toContain('Posts')
    expect(fumaLaunchRegistry.compose('website')).toEqual(before)
  })

  it('accepts the capability overrides emitted by the FUMA-002 launch fixtures', () => {
    expect(() => fumaLaunchRegistry.compose('website', {
      grant: ['publication.editorial.schedule'],
      revoke: ['website.analytics'],
    })).not.toThrow()
    expect(() => fumaLaunchRegistry.compose('publication', {
      grant: ['website.design'],
      revoke: ['publication.newsletters.send'],
    })).not.toThrow()
  })

  it('rejects duplicate capability, profile, and contribution IDs', () => {
    expectRegistryError(() => createFumaRegistry({
      capabilities: [capability('duplicate'), capability('duplicate')],
      profiles: [],
    }), 'duplicate-id')

    expectRegistryError(() => createFumaRegistry({
      capabilities: [capability('one')],
      profiles: [
        { id: 'duplicate', label: 'One', capabilityPreset: ['one'], navigationPreset: [], onboardingPreset: [], starterTemplatePreset: [] },
        { id: 'duplicate', label: 'Two', capabilityPreset: ['one'], navigationPreset: [], onboardingPreset: [], starterTemplatePreset: [] },
      ],
    }), 'duplicate-id')

    expectRegistryError(() => createFumaRegistry({
      capabilities: [
        capability('one', { navigation: [{ id: 'nav.shared', order: 1, label: 'One', path: '/one' }] }),
        capability('two', { navigation: [{ id: 'nav.shared', order: 2, label: 'Two', path: '/two' }] }),
      ],
      profiles: [],
    }), 'duplicate-id')
  })

  it('rejects missing, cyclic, and conflicting capability dependencies', () => {
    expectRegistryError(() => createFumaRegistry(definition([
      capability('dependent', { dependsOn: ['missing'] }),
    ])), 'dependency-collision')

    expectRegistryError(() => createFumaRegistry(definition([
      capability('cycle.one', { dependsOn: ['cycle.two'] }),
      capability('cycle.two', { dependsOn: ['cycle.one'] }),
    ])), 'dependency-collision')

    expectRegistryError(() => createFumaRegistry({
      capabilities: [
        capability('conflict.one', { conflictsWith: ['conflict.two'] }),
        capability('conflict.two'),
      ],
      profiles: [{
        id: 'fixture',
        label: 'Fixture',
        capabilityPreset: ['conflict.one', 'conflict.two'],
        navigationPreset: [],
        onboardingPreset: [],
        starterTemplatePreset: [],
      }],
    }), 'dependency-collision')
  })

  it('rejects exact and parameter-equivalent route collisions', () => {
    expectRegistryError(() => createFumaRegistry({
      capabilities: [
        capability('route.one', {
          routes: [{ id: 'route.one', method: 'GET', path: '/entries/:id', permission: 'route.one.read' }],
        }),
        capability('route.two', {
          routes: [{ id: 'route.two', method: 'GET', path: '/entries/:slug/', permission: 'route.two.read' }],
        }),
      ],
      profiles: [],
    }), 'route-collision')
  })

  it('rejects malformed, unknown, overlapping, and dependency-breaking overrides', () => {
    expectRegistryError(() => fumaLaunchRegistry.compose('website', {
      grant: ['unknown.capability'],
      revoke: [],
    }), 'invalid-capability-override')

    expectRegistryError(() => fumaLaunchRegistry.compose('website', {
      grant: ['website.design'],
      revoke: ['website.design'],
    }), 'invalid-capability-override')

    expectRegistryError(() => fumaLaunchRegistry.compose('publication', {
      grant: [],
      revoke: ['publication.editorial'],
    }), 'invalid-capability-override')

    const malformed = { grant: [], revoke: [], profileId: 'website' }
    expectRegistryError(
      () => fumaLaunchRegistry.compose('website', malformed),
      'invalid-capability-override',
    )
  })

  it('rejects profile-name switches encoded in declarations instead of capabilities', () => {
    const switchedDefinition = structuredClone({
      capabilities: LAUNCH_CAPABILITIES,
      profiles: LAUNCH_PROFILES,
    })
    const route = switchedDefinition.capabilities
      .flatMap(({ routes }) => routes ?? [])
      .find(({ id }) => id === 'route.home')
    if (!route) throw new Error('launch route fixture is missing')
    Object.assign(route, { profileId: 'website' })

    expectRegistryError(() => createFumaRegistry(switchedDefinition), 'invalid-definition')
  })

  it('rejects profile presets that name unavailable capability contributions', () => {
    expectRegistryError(() => createFumaRegistry({
      capabilities: [capability('available')],
      profiles: [{
        id: 'fixture',
        label: 'Fixture',
        capabilityPreset: ['available'],
        navigationPreset: ['nav.unavailable'],
        onboardingPreset: [],
        starterTemplatePreset: [],
      }],
    }), 'dependency-collision')
  })
})
