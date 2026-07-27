import {
  LAUNCH_CAPABILITIES,
  LAUNCH_PROFILES,
  createFumaRegistry,
  type CapabilityDefinition,
  type CapabilityOverrides,
  type ProductProfile,
} from '@core/fuma'

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) immutable(nested)
    Object.freeze(value)
  }
  return value
}

function launchProfile(profileId: string): ProductProfile {
  const profile = LAUNCH_PROFILES.find(({ id }) => id === profileId)
  if (!profile) throw new Error(`Fuma launch profile "${profileId}" is unavailable`)
  return profile
}

const WEBSITE_LAUNCH_PROFILE = launchProfile('website')

export const FUMA_EXTENSION_CAPABILITY: CapabilityDefinition = immutable({
  id: 'fixture.content-review',
  dependsOn: ['content.pages'],
  navigation: [{
    id: 'nav.fixture-content-review',
    order: 35,
    label: 'Content review',
    path: '/admin/content-review',
    permission: 'fixture.content-review.read',
  }],
  onboarding: [{
    id: 'onboarding.fixture-content-review',
    order: 35,
    title: 'Configure content review',
    description: 'Choose the review policy applied before content is published.',
  }],
  starterTemplates: [{
    id: 'starter.fixture-content-review',
    order: 35,
    label: 'Content review',
    templateId: 'fixture.content-review',
  }],
  permissions: [{
    id: 'fixture.content-review.read',
    label: 'View content review',
    description: 'View content review status and policy.',
  }],
  routes: [{
    id: 'route.fixture-content-review',
    method: 'GET',
    path: '/admin/content-review',
    permission: 'fixture.content-review.read',
  }],
  jobs: [{
    id: 'job.fixture-content-review',
    handlerId: 'fixture.content-review',
    permission: 'fixture.content-review.read',
  }],
  transfer: [{
    id: 'transfer.fixture-content-review',
    stepId: 'transfer.fixture.content-review',
    permission: 'fixture.content-review.read',
  }],
})

export const FUMA_EXTENSION_PROFILE: ProductProfile = immutable({
  id: 'fixture.website-content-review',
  label: 'Website with content review',
  subtitle: 'Website launch profile extended entirely through registry declarations',
  capabilityPreset: [
    ...WEBSITE_LAUNCH_PROFILE.capabilityPreset,
    FUMA_EXTENSION_CAPABILITY.id,
  ],
  navigationPreset: [
    ...WEBSITE_LAUNCH_PROFILE.navigationPreset,
    'nav.fixture-content-review',
  ],
  onboardingPreset: [
    ...WEBSITE_LAUNCH_PROFILE.onboardingPreset,
    'onboarding.fixture-content-review',
  ],
  starterTemplatePreset: [
    ...WEBSITE_LAUNCH_PROFILE.starterTemplatePreset,
    'starter.fixture-content-review',
  ],
})

export const FUMA_EXTENSION_CAPABILITY_GRANT: CapabilityOverrides = immutable({
  grant: [FUMA_EXTENSION_CAPABILITY.id],
  revoke: [],
})

export const fumaExtensionRegistry = createFumaRegistry({
  capabilities: [...LAUNCH_CAPABILITIES, FUMA_EXTENSION_CAPABILITY],
  profiles: [...LAUNCH_PROFILES, FUMA_EXTENSION_PROFILE],
})
