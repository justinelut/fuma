import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { createFumaRegistry, fumaLaunchRegistry } from '../../core/fuma'
import {
  CompleteProfileOnboardingStepCommandSchema,
  ProfileOnboardingProgressSchema,
  ProfileOnboardingStateSchema,
  completeProfileOnboardingStep,
  resolveProfileOnboarding,
  type CompleteProfileOnboardingStepCommand,
  type ProfileOnboardingAssignment,
  type ProfileOnboardingError,
  type ProfileOnboardingState,
} from '../../core/fuma/onboarding'

const EMPTY_OVERRIDES = { grant: [], revoke: [] }

function assignment(
  siteId: string,
  profileId: string,
  capabilityOverrides: ProfileOnboardingAssignment['capabilityOverrides'] = EMPTY_OVERRIDES,
  organizationId = 'organization-a',
  workspaceId = 'workspace-a',
): ProfileOnboardingAssignment {
  return { organizationId, workspaceId, siteId, profileId, capabilityOverrides }
}

function completion(
  state: ProfileOnboardingState,
  stepId: string = state.currentStepId ?? 'onboarding.unavailable',
): CompleteProfileOnboardingStepCommand {
  return {
    organizationId: state.progress.organizationId,
    workspaceId: state.progress.workspaceId,
    siteId: state.progress.siteId,
    profileId: state.progress.profileId,
    compositionFingerprint: state.progress.compositionFingerprint,
    stepId,
  }
}

function expectOnboardingError(run: () => unknown, code: ProfileOnboardingError['code']): void {
  expect(run).toThrow(expect.objectContaining({
    name: 'ProfileOnboardingError',
    code,
  }))
}

describe('FUMA-017 profile onboarding', () => {
  it('resolves Website and Publication steps in registry-composed order', () => {
    const website = resolveProfileOnboarding(
      fumaLaunchRegistry,
      assignment('website-site', 'website'),
    )
    const publication = resolveProfileOnboarding(
      fumaLaunchRegistry,
      assignment('publication-site', 'publication'),
    )

    expect(website.steps.map(({ id }) => id)).toEqual([
      'onboarding.identity',
      'onboarding.design',
      'onboarding.pages',
      'onboarding.media',
    ])
    expect(publication.steps.map(({ id }) => id)).toEqual([
      'onboarding.identity',
      'onboarding.publication',
      'onboarding.pages',
      'onboarding.members',
      'onboarding.newsletters',
      'onboarding.design',
    ])
    expect(website.currentStepId).toBe('onboarding.identity')
    expect(website.progress.cursor).toBe(0)
    expect(website.progress.completedStepIds).toEqual([])
    expect(Value.Check(ProfileOnboardingProgressSchema, website.progress)).toBe(true)
    expect(Value.Check(ProfileOnboardingStateSchema, website)).toBe(true)
    expect(Object.isFrozen(website)).toBe(true)
    expect(Object.isFrozen(website.progress.completedStepIds)).toBe(true)
  })

  it('resumes deterministically and treats already-completed commands as idempotent replays', () => {
    const site = assignment('resume-site', 'website')
    const started = resolveProfileOnboarding(fumaLaunchRegistry, site)
    const firstCommand = completion(started)
    const afterFirst = completeProfileOnboardingStep(
      fumaLaunchRegistry,
      site,
      started.progress,
      firstCommand,
    )

    expect(afterFirst.progress).toEqual({
      ...started.progress,
      completedStepIds: ['onboarding.identity'],
      cursor: 1,
    })
    expect(afterFirst.currentStepId).toBe('onboarding.design')

    const durableRoundTrip = structuredClone(afterFirst.progress)
    const resumed = resolveProfileOnboarding(fumaLaunchRegistry, site, durableRoundTrip)
    expect(resumed).toEqual(afterFirst)

    const replayed = completeProfileOnboardingStep(
      fumaLaunchRegistry,
      site,
      durableRoundTrip,
      firstCommand,
    )
    expect(replayed).toEqual(afterFirst)

    let completed = resumed
    while (!completed.complete) {
      completed = completeProfileOnboardingStep(
        fumaLaunchRegistry,
        site,
        completed.progress,
        completion(completed),
      )
    }
    expect(completed.progress.cursor).toBe(completed.steps.length)
    expect(completed.currentStepId).toBeNull()
    expect(completed.progress.completedStepIds).toEqual(completed.steps.map(({ id }) => id))
  })

  it('uses active capability composition to hide revoked steps and fail closed on completion', () => {
    const site = assignment('limited-site', 'website', {
      grant: [],
      revoke: ['website.media'],
    })
    const state = resolveProfileOnboarding(fumaLaunchRegistry, site)

    expect(state.steps.map(({ id }) => id)).toEqual([
      'onboarding.identity',
      'onboarding.design',
      'onboarding.pages',
    ])
    expectOnboardingError(
      () => completeProfileOnboardingStep(
        fumaLaunchRegistry,
        site,
        state.progress,
        completion(state, 'onboarding.media'),
      ),
      'unavailable-step',
    )
    expectOnboardingError(
      () => completeProfileOnboardingStep(
        fumaLaunchRegistry,
        site,
        state.progress,
        completion(state, 'onboarding.unknown'),
      ),
      'unavailable-step',
    )
    expectOnboardingError(
      () => completeProfileOnboardingStep(
        fumaLaunchRegistry,
        site,
        state.progress,
        completion(state, 'onboarding.pages'),
      ),
      'out-of-order-step',
    )
  })

  it('rejects progress and commands from another site, profile, or composition', () => {
    const original = assignment('original-site', 'website')
    const state = resolveProfileOnboarding(fumaLaunchRegistry, original)

    expectOnboardingError(
      () => resolveProfileOnboarding(
        fumaLaunchRegistry,
        assignment('original-site', 'website', EMPTY_OVERRIDES, 'organization-b', 'workspace-a'),
        state.progress,
      ),
      'site-mismatch',
    )
    expectOnboardingError(
      () => resolveProfileOnboarding(
        fumaLaunchRegistry,
        assignment('original-site', 'website', EMPTY_OVERRIDES, 'organization-a', 'workspace-b'),
        state.progress,
      ),
      'site-mismatch',
    )
    expectOnboardingError(
      () => resolveProfileOnboarding(
        fumaLaunchRegistry,
        assignment('other-site', 'website'),
        state.progress,
      ),
      'site-mismatch',
    )
    expectOnboardingError(
      () => resolveProfileOnboarding(
        fumaLaunchRegistry,
        assignment('original-site', 'publication'),
        state.progress,
      ),
      'profile-switch',
    )
    expectOnboardingError(
      () => resolveProfileOnboarding(
        fumaLaunchRegistry,
        assignment('original-site', 'website', { grant: [], revoke: ['website.media'] }),
        state.progress,
      ),
      'composition-drift',
    )

    expectOnboardingError(
      () => completeProfileOnboardingStep(
        fumaLaunchRegistry,
        original,
        state.progress,
        { ...completion(state), organizationId: 'organization-b' },
      ),
      'site-mismatch',
    )
    expectOnboardingError(
      () => completeProfileOnboardingStep(
        fumaLaunchRegistry,
        original,
        state.progress,
        { ...completion(state), workspaceId: 'workspace-b' },
      ),
      'site-mismatch',
    )
    expectOnboardingError(
      () => completeProfileOnboardingStep(
        fumaLaunchRegistry,
        original,
        state.progress,
        { ...completion(state), siteId: 'other-site' },
      ),
      'site-mismatch',
    )
    expectOnboardingError(
      () => completeProfileOnboardingStep(
        fumaLaunchRegistry,
        original,
        state.progress,
        { ...completion(state), profileId: 'publication' },
      ),
      'profile-switch',
    )
    expectOnboardingError(
      () => completeProfileOnboardingStep(
        fumaLaunchRegistry,
        original,
        state.progress,
        { ...completion(state), compositionFingerprint: 'stale-composition' },
      ),
      'composition-drift',
    )
  })

  it('rejects malformed or non-prefix durable progress instead of guessing a cursor', () => {
    const site = assignment('corrupt-site', 'website')
    const state = resolveProfileOnboarding(fumaLaunchRegistry, site)

    expect(Value.Check(CompleteProfileOnboardingStepCommandSchema, completion(state))).toBe(true)
    expectOnboardingError(
      () => resolveProfileOnboarding(fumaLaunchRegistry, site, {
        ...state.progress,
        completedStepIds: ['onboarding.pages'],
        cursor: 1,
      }),
      'invalid-progress',
    )
    expectOnboardingError(
      () => resolveProfileOnboarding(fumaLaunchRegistry, site, {
        ...state.progress,
        completedStepIds: [],
        cursor: state.steps.length + 1,
      }),
      'invalid-progress',
    )
  })

  it('composes an injected profile without shared profile-ID branches', async () => {
    const registry = createFumaRegistry({
      capabilities: [{
        id: 'custom.setup',
        onboarding: [{
          id: 'onboarding.custom',
          order: 1,
          title: 'Custom setup',
          description: 'Configure the custom capability.',
        }],
      }],
      profiles: [{
        id: 'custom',
        label: 'Custom',
        capabilityPreset: ['custom.setup'],
        navigationPreset: [],
        onboardingPreset: ['onboarding.custom'],
        starterTemplatePreset: [],
      }],
    })

    expect(resolveProfileOnboarding(
      registry,
      assignment('custom-site', 'custom'),
    ).steps.map(({ id }) => id)).toEqual(['onboarding.custom'])

    const source = await Bun.file(new URL(
      '../../core/fuma/onboarding.ts',
      import.meta.url,
    )).text()
    expect(source).not.toMatch(/profileId\s*={2,3}\s*['"](?:website|publication)['"]/)
    expect(source).not.toMatch(/switch\s*\(\s*(?:assignment\.)?profileId\s*\)/)
    expect(source.match(/\.compose\(/g)).toHaveLength(1)
  })
})
