import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import {
  CapabilityDefinitionSchema,
  FumaRegistryError,
  LAUNCH_CAPABILITIES,
  LAUNCH_PROFILES,
  ProductProfileSchema,
  createFumaRegistry,
  fumaLaunchRegistry,
  type CapabilityDefinition,
  type FumaRegistryErrorCode,
} from '@core/fuma'
import {
  FUMA_EXTENSION_CAPABILITY,
  FUMA_EXTENSION_CAPABILITY_GRANT,
  FUMA_EXTENSION_PROFILE,
  fumaExtensionRegistry,
} from '../helpers/fuma'

const EXTENSION_PROFILE_ID = 'fixture.website-content-review'

const EXTENSION_CONTRIBUTIONS = {
  navigation: {
    id: 'nav.fixture-content-review',
    order: 35,
    label: 'Content review',
    path: '/admin/content-review',
    permission: 'fixture.content-review.read',
  },
  onboarding: {
    id: 'onboarding.fixture-content-review',
    order: 35,
    title: 'Configure content review',
    description: 'Choose the review policy applied before content is published.',
  },
  starterTemplate: {
    id: 'starter.fixture-content-review',
    order: 35,
    label: 'Content review',
    templateId: 'fixture.content-review',
  },
  permission: {
    id: 'fixture.content-review.read',
    label: 'View content review',
    description: 'View content review status and policy.',
  },
  route: {
    id: 'route.fixture-content-review',
    method: 'GET',
    path: '/admin/content-review',
    permission: 'fixture.content-review.read',
  },
  job: {
    id: 'job.fixture-content-review',
    handlerId: 'fixture.content-review',
    permission: 'fixture.content-review.read',
  },
  transfer: {
    id: 'transfer.fixture-content-review',
    stepId: 'transfer.fixture.content-review',
    permission: 'fixture.content-review.read',
  },
} as const

const EXTENSION_CONTRIBUTION_IDS = {
  navigation: EXTENSION_CONTRIBUTIONS.navigation.id,
  onboarding: EXTENSION_CONTRIBUTIONS.onboarding.id,
  starterTemplate: EXTENSION_CONTRIBUTIONS.starterTemplate.id,
  permission: EXTENSION_CONTRIBUTIONS.permission.id,
  route: EXTENSION_CONTRIBUTIONS.route.id,
  job: EXTENSION_CONTRIBUTIONS.job.id,
  transfer: EXTENSION_CONTRIBUTIONS.transfer.id,
} as const

function websiteLaunchProfile() {
  const profile = LAUNCH_PROFILES.find(({ id }) => id === 'website')
  if (!profile) throw new Error('Website launch profile is unavailable')
  return profile
}

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

describe('FUMA-019 profile extension fixture', () => {
  it('publishes exact immutable declarations backed by the public TypeBox contracts', () => {
    expect(Value.Check(CapabilityDefinitionSchema, FUMA_EXTENSION_CAPABILITY)).toBe(true)
    expect(Value.Check(ProductProfileSchema, FUMA_EXTENSION_PROFILE)).toBe(true)
    expect(FUMA_EXTENSION_CAPABILITY).toEqual({
      id: 'fixture.content-review',
      dependsOn: ['content.pages'],
      navigation: [EXTENSION_CONTRIBUTIONS.navigation],
      onboarding: [EXTENSION_CONTRIBUTIONS.onboarding],
      starterTemplates: [EXTENSION_CONTRIBUTIONS.starterTemplate],
      permissions: [EXTENSION_CONTRIBUTIONS.permission],
      routes: [EXTENSION_CONTRIBUTIONS.route],
      jobs: [EXTENSION_CONTRIBUTIONS.job],
      transfer: [EXTENSION_CONTRIBUTIONS.transfer],
    })
    expect(FUMA_EXTENSION_PROFILE).toMatchObject({
      id: EXTENSION_PROFILE_ID,
      label: 'Website with content review',
      subtitle: 'Website launch profile extended entirely through registry declarations',
    })
    expect(Object.isFrozen(FUMA_EXTENSION_CAPABILITY)).toBe(true)
    expect(Object.isFrozen(FUMA_EXTENSION_CAPABILITY.navigation)).toBe(true)
    expect(Object.isFrozen(FUMA_EXTENSION_CAPABILITY.navigation?.[0])).toBe(true)
    expect(Object.isFrozen(FUMA_EXTENSION_PROFILE)).toBe(true)
    expect(Object.isFrozen(FUMA_EXTENSION_PROFILE.capabilityPreset)).toBe(true)
    expect(Object.isFrozen(FUMA_EXTENSION_CAPABILITY_GRANT.grant)).toBe(true)
  })

  it('composes the fixture profile from Website launch declarations plus one capability', () => {
    const website = websiteLaunchProfile()

    expect(FUMA_EXTENSION_PROFILE.capabilityPreset).toEqual([
      ...website.capabilityPreset,
      FUMA_EXTENSION_CAPABILITY.id,
    ])
    expect(FUMA_EXTENSION_PROFILE.navigationPreset).toEqual([
      ...website.navigationPreset,
      EXTENSION_CONTRIBUTION_IDS.navigation,
    ])
    expect(FUMA_EXTENSION_PROFILE.onboardingPreset).toEqual([
      ...website.onboardingPreset,
      EXTENSION_CONTRIBUTION_IDS.onboarding,
    ])
    expect(FUMA_EXTENSION_PROFILE.starterTemplatePreset).toEqual([
      ...website.starterTemplatePreset,
      EXTENSION_CONTRIBUTION_IDS.starterTemplate,
    ])
  })

  it('includes every extension contribution with deterministic dependency and preset order', () => {
    const first = fumaExtensionRegistry.compose(FUMA_EXTENSION_PROFILE.id)
    const second = fumaExtensionRegistry.compose(FUMA_EXTENSION_PROFILE.id)

    expect(second).toEqual(first)
    expect(FUMA_EXTENSION_CAPABILITY.dependsOn).toEqual(['content.pages'])
    expect(first.capabilities.map(({ id }) => id)).toEqual(FUMA_EXTENSION_PROFILE.capabilityPreset)
    expect(first.capabilities.findIndex(({ id }) => id === 'content.pages'))
      .toBeLessThan(first.capabilities.findIndex(({ id }) => id === FUMA_EXTENSION_CAPABILITY.id))
    expect(first.navigation.map(({ id }) => id)).toEqual(FUMA_EXTENSION_PROFILE.navigationPreset)
    expect(first.onboarding.map(({ id }) => id)).toEqual(FUMA_EXTENSION_PROFILE.onboardingPreset)
    expect(first.starterTemplates.map(({ id }) => id))
      .toEqual(FUMA_EXTENSION_PROFILE.starterTemplatePreset)
    expect(first.navigation).toContainEqual(EXTENSION_CONTRIBUTIONS.navigation)
    expect(first.onboarding).toContainEqual(EXTENSION_CONTRIBUTIONS.onboarding)
    expect(first.starterTemplates).toContainEqual(
      EXTENSION_CONTRIBUTIONS.starterTemplate,
    )
    expect(first.permissions).toContainEqual(EXTENSION_CONTRIBUTIONS.permission)
    expect(first.routes).toContainEqual(EXTENSION_CONTRIBUTIONS.route)
    expect(first.jobs).toContainEqual(EXTENSION_CONTRIBUTIONS.job)
    expect(first.transfer).toContainEqual(EXTENSION_CONTRIBUTIONS.transfer)
  })

  it('grants the extension capability across Website and Publication without changing the launch registry', () => {
    const launchWebsiteBefore = fumaLaunchRegistry.compose('website')
    const launchPublicationBefore = fumaLaunchRegistry.compose('publication')

    for (const profileId of ['website', 'publication'] as const) {
      const extended = fumaExtensionRegistry.compose(
        profileId,
        FUMA_EXTENSION_CAPABILITY_GRANT,
      )

      expect(extended.capabilities.map(({ id }) => id))
        .toContain(FUMA_EXTENSION_CAPABILITY.id)
      expect(extended.navigation).toContainEqual(EXTENSION_CONTRIBUTIONS.navigation)
      expect(extended.onboarding).toContainEqual(EXTENSION_CONTRIBUTIONS.onboarding)
      expect(extended.starterTemplates).toContainEqual(
        EXTENSION_CONTRIBUTIONS.starterTemplate,
      )
      expect(extended.permissions).toContainEqual(EXTENSION_CONTRIBUTIONS.permission)
      expect(extended.routes).toContainEqual(EXTENSION_CONTRIBUTIONS.route)
      expect(extended.jobs).toContainEqual(EXTENSION_CONTRIBUTIONS.job)
      expect(extended.transfer).toContainEqual(EXTENSION_CONTRIBUTIONS.transfer)
    }

    expect(fumaLaunchRegistry.getCapability(FUMA_EXTENSION_CAPABILITY.id)).toBeUndefined()
    expect(fumaLaunchRegistry.getProfile(FUMA_EXTENSION_PROFILE.id)).toBeUndefined()
    expect(fumaLaunchRegistry.compose('website')).toEqual(launchWebsiteBefore)
    expect(fumaLaunchRegistry.compose('publication')).toEqual(launchPublicationBefore)
    expect(LAUNCH_CAPABILITIES.map(({ id }) => id)).not.toContain(FUMA_EXTENSION_CAPABILITY.id)
    expect(LAUNCH_PROFILES.map(({ id }) => id)).not.toContain(FUMA_EXTENSION_PROFILE.id)
  })

  it('rejects malformed and colliding fixture registrations through public registry errors', () => {
    const malformedCapability: CapabilityDefinition = {
      id: 'fixture.malformed',
      navigation: [{
        id: 'nav.fixture-malformed',
        order: -1,
        label: 'Malformed fixture',
        path: '/admin/malformed-fixture',
      }],
    }
    expectRegistryError(() => createFumaRegistry({
      capabilities: [...LAUNCH_CAPABILITIES, malformedCapability],
      profiles: [...LAUNCH_PROFILES],
    }), 'invalid-definition')

    const collidingCapability: CapabilityDefinition = {
      id: 'fixture.route-collision',
      permissions: [{
        id: 'fixture.route-collision.read',
        label: 'View collision fixture',
        description: 'View the deliberately colliding fixture.',
      }],
      routes: [{
        id: 'route.fixture-collision',
        method: 'GET',
        path: '/admin/',
        permission: 'fixture.route-collision.read',
      }],
    }
    expectRegistryError(() => createFumaRegistry({
      capabilities: [...LAUNCH_CAPABILITIES, collidingCapability],
      profiles: [...LAUNCH_PROFILES],
    }), 'route-collision')
  })
})
