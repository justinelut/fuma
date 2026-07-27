import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from '@admin/lib/routing'
import { ProfileNavigation, ProfileOnboarding } from '@admin/fuma'
import {
  completeProfileOnboardingStep,
  composeProfileNavigation,
  fumaLaunchRegistry,
  resolveProfileOnboarding,
  type CapabilityOverrides,
  type CompleteProfileOnboardingStepCommand,
  type NavigationPermissionState,
  type ProfileNavigationEntry,
  type ProfileOnboardingAssignment,
  type ProfileOnboardingState,
} from '@core/fuma'

const EMPTY_OVERRIDES: CapabilityOverrides = { grant: [], revoke: [] }

afterEach(cleanup)

function grantedPermissions(profileId: string): NavigationPermissionState {
  return Object.fromEntries(
    fumaLaunchRegistry.compose(profileId).permissions.map(({ id }) => [id, true]),
  )
}

function assignment(
  profileId: string,
  capabilityOverrides: CapabilityOverrides = EMPTY_OVERRIDES,
): ProfileOnboardingAssignment {
  return {
    organizationId: 'organization-a',
    workspaceId: 'workspace-a',
    siteId: `${profileId}-site`,
    profileId,
    capabilityOverrides,
  }
}

function completion(state: ProfileOnboardingState): CompleteProfileOnboardingStepCommand {
  if (!state.currentStepId) throw new Error('Expected an active onboarding step')
  return {
    organizationId: state.progress.organizationId,
    workspaceId: state.progress.workspaceId,
    siteId: state.progress.siteId,
    profileId: state.progress.profileId,
    compositionFingerprint: state.progress.compositionFingerprint,
    stepId: state.currentStepId,
  }
}

function renderProfile(profileId: string) {
  const navigation = composeProfileNavigation({
    profileId,
    capabilityOverrides: EMPTY_OVERRIDES,
    permissionState: grantedPermissions(profileId),
  }, fumaLaunchRegistry)
  const onboarding = resolveProfileOnboarding(
    fumaLaunchRegistry,
    assignment(profileId),
  )

  render(
    <MemoryRouter>
      <ProfileNavigation entries={navigation} ariaLabel={`${profileId} navigation`} />
      <ProfileOnboarding state={onboarding} ariaLabel={`${profileId} onboarding`} />
    </MemoryRouter>,
  )

  return {
    navigation,
    onboarding,
    renderedNavigation: within(screen.getByRole('navigation', {
      name: `${profileId} navigation`,
    })).getAllByRole('link').map((link) => link.textContent),
    renderedOnboarding: within(screen.getByRole('region', {
      name: `${profileId} onboarding`,
    })).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
  }
}

describe('FUMA-017 reusable profile composition UI', () => {
  it('renders distinct Website and Publication shells only from resolved models', () => {
    const website = renderProfile('website')
    expect(website.renderedNavigation).toEqual(
      website.navigation.map(({ label }) => label),
    )
    expect(website.renderedOnboarding).toEqual(
      website.onboarding.steps.map(({ title }) => title),
    )
    cleanup()

    const publication = renderProfile('publication')
    expect(publication.renderedNavigation).toEqual(
      publication.navigation.map(({ label }) => label),
    )
    expect(publication.renderedOnboarding).toEqual(
      publication.onboarding.steps.map(({ title }) => title),
    )
    expect(publication.renderedNavigation).not.toEqual(website.renderedNavigation)
    expect(publication.renderedOnboarding).not.toEqual(website.renderedOnboarding)
  })

  it('omits permission-denied navigation and capability-unavailable onboarding actions', async () => {
    const entries = composeProfileNavigation({
      profileId: 'publication',
      capabilityOverrides: EMPTY_OVERRIDES,
      permissionState: {
        'publication.posts.read': true,
        'publication.tags.read': false,
      },
    }, fumaLaunchRegistry)
    const onboarding = resolveProfileOnboarding(
      fumaLaunchRegistry,
      assignment('website', { grant: [], revoke: ['website.media'] }),
    )

    render(
      <MemoryRouter>
        <ProfileNavigation entries={entries} />
        <ProfileOnboarding state={onboarding} onCompleteStep={() => undefined} />
      </MemoryRouter>,
    )

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Home', 'Posts'])
    expect(screen.queryByRole('link', { name: 'Tags' })).toBeNull()
    expect(screen.queryByText('Add media')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)

    const navigationSource = await Bun.file(new URL(
      '../../admin/fuma/ProfileNavigation.tsx',
      import.meta.url,
    )).text()
    const onboardingSource = await Bun.file(new URL(
      '../../admin/fuma/ProfileOnboarding.tsx',
      import.meta.url,
    )).text()
    expect(navigationSource).not.toMatch(/['"](?:website|publication)['"]|['"]\/admin/)
    expect(onboardingSource).not.toMatch(/['"](?:website|publication)['"]|['"]\/admin/)
  })

  it('shows the durable resume cursor, emits a scoped completion command, and hides completed actions', () => {
    const site = assignment('website')
    const started = resolveProfileOnboarding(fumaLaunchRegistry, site)
    const resumed = completeProfileOnboardingStep(
      fumaLaunchRegistry,
      site,
      started.progress,
      completion(started),
    )
    let received: CompleteProfileOnboardingStepCommand | undefined
    const view = render(
      <ProfileOnboarding
        state={resumed}
        onCompleteStep={(command) => {
          received = command
        }}
      />,
    )

    expect(screen.getByText(`Resume at step 2 of ${resumed.steps.length}.`)).toBeDefined()
    expect(screen.getByText(`1 of ${resumed.steps.length} steps complete`)).toBeDefined()
    fireEvent.click(screen.getByRole('button', {
      name: `Complete ${resumed.steps[1].title}`,
    }))
    expect(received).toEqual(completion(resumed))

    let completed = resumed
    while (!completed.complete) {
      completed = completeProfileOnboardingStep(
        fumaLaunchRegistry,
        site,
        completed.progress,
        completion(completed),
      )
    }
    view.rerender(
      <ProfileOnboarding state={completed} onCompleteStep={() => undefined} />,
    )
    expect(screen.getByText('Your setup is complete')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe(String(completed.steps.length))
  })

  it('uses in-house links and invokes the typed navigation callback with the approved entry', () => {
    const entries = composeProfileNavigation({
      profileId: 'publication',
      capabilityOverrides: EMPTY_OVERRIDES,
      permissionState: grantedPermissions('publication'),
    }, fumaLaunchRegistry)
    let received: ProfileNavigationEntry | undefined

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <ProfileNavigation
          entries={entries}
          currentPath={entries[0].path}
          onNavigate={(entry) => {
            received = entry
          }}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: entries[0].label }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('link', { name: entries[1].label }))
    expect(received).toEqual(entries[1])
  })
})
