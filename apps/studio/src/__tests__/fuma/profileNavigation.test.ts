import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  createFumaRegistry,
  fumaLaunchRegistry,
  type CapabilityOverrides,
  type NavigationContribution,
} from '@core/fuma'
import {
  NavigationPermissionStateSchema,
  ProfileNavigationError,
  ProfileNavigationInputSchema,
  ProfileNavigationOutputSchema,
  composeProfileNavigation,
  type NavigationPermissionState,
  type ProfileNavigationErrorCode,
  type ProfileNavigationInput,
  type ProfileNavigationRegistry,
} from '@core/fuma/navigation'

const EMPTY_OVERRIDES: CapabilityOverrides = { grant: [], revoke: [] }

const PUBLICATION_NAVIGATION = [
  'Home',
  'Posts',
  'Pages',
  'Tags',
  'Members',
  'Newsletters',
  'Analytics',
  'Design',
  'Settings',
] as const

const WEBSITE_NAVIGATION = [
  'Home',
  'Content',
  'Pages',
  'Data',
  'Media',
  'Analytics',
  'Design',
  'Settings',
] as const

function grantedPermissions(profileId: string): NavigationPermissionState {
  return Object.fromEntries(
    fumaLaunchRegistry.compose(profileId).permissions.map(({ id }) => [id, true]),
  )
}

function input(
  profileId: string,
  permissionState: NavigationPermissionState,
  capabilityOverrides: CapabilityOverrides = EMPTY_OVERRIDES,
): ProfileNavigationInput {
  return { profileId, capabilityOverrides, permissionState }
}

function expectNavigationError(
  run: () => unknown,
  code: ProfileNavigationErrorCode,
): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ProfileNavigationError)
    if (!(error instanceof ProfileNavigationError)) throw error
    expect(error.code).toBe(code)
    return
  }
  throw new Error(`Expected ProfileNavigationError with code ${code}`)
}

function registryLike(
  navigation: readonly NavigationContribution[],
  navigationPreset: readonly string[] = [],
): ProfileNavigationRegistry {
  return {
    compose: () => ({
      profile: {
        id: 'fixture',
        label: 'Fixture',
        capabilityPreset: ['fixture.capability'],
        navigationPreset: [...navigationPreset],
        onboardingPreset: [],
        starterTemplatePreset: [],
      },
      navigation: [...navigation],
    }),
  }
}

describe('FUMA-017 profile navigation composer', () => {
  it('publishes strict TypeBox-derived permission-state input and output contracts', () => {
    const publicationInput = input('publication', {
      'publication.posts.read': true,
      'publication.tags.read': false,
    })

    expect(Value.Check(NavigationPermissionStateSchema, publicationInput.permissionState)).toBe(true)
    expect(Value.Check(ProfileNavigationInputSchema, publicationInput)).toBe(true)
    expect(Value.Check(ProfileNavigationInputSchema, {
      ...publicationInput,
      permissionState: { 'Not a permission ID': true },
    })).toBe(false)
    expect(Value.Check(ProfileNavigationInputSchema, {
      ...publicationInput,
      unexpected: true,
    })).toBe(false)

    const output = composeProfileNavigation(
      input('publication', grantedPermissions('publication')),
      fumaLaunchRegistry,
    )
    expect(Value.Check(ProfileNavigationOutputSchema, output)).toBe(true)
  })

  it('returns the exact Publication launch labels in preset order', () => {
    const navigation = composeProfileNavigation(
      input('publication', grantedPermissions('publication')),
      fumaLaunchRegistry,
    )

    expect(navigation.map(({ label }) => label)).toEqual(PUBLICATION_NAVIGATION)
  })

  it('composes the Website shell entirely from its registered contributions', () => {
    const navigation = composeProfileNavigation(
      input('website', grantedPermissions('website')),
      fumaLaunchRegistry,
    )

    expect(navigation.map(({ label }) => label)).toEqual(WEBSITE_NAVIGATION)
  })

  it('omits absent and denied required permissions while retaining permissionless entries', () => {
    const navigation = composeProfileNavigation(
      input('publication', {
        'publication.posts.read': true,
        'publication.tags.read': false,
      }),
      fumaLaunchRegistry,
    )

    expect(navigation.map(({ label }) => label)).toEqual(['Home', 'Posts'])
    expect(navigation.every((entry) => !('disabled' in entry))).toBe(true)
  })

  it('rejects duplicate IDs and normalized path collisions before permission filtering', () => {
    expectNavigationError(() => composeProfileNavigation(
      input('fixture', {}),
      registryLike([
        { id: 'nav.duplicate', order: 1, label: 'One', path: '/one' },
        { id: 'nav.duplicate', order: 2, label: 'Two', path: '/two' },
      ]),
    ), 'duplicate-id')

    expectNavigationError(() => composeProfileNavigation(
      input('fixture', {}),
      registryLike([
        {
          id: 'nav.first',
          order: 1,
          label: 'First',
          path: '/admin//extension/',
          permission: 'fixture.denied',
        },
        { id: 'nav.second', order: 2, label: 'Second', path: '/admin/extension' },
      ]),
    ), 'path-collision')
  })

  it('preserves preset order and deterministically sorts unordered fallback contributions', () => {
    const navigation = composeProfileNavigation(
      input('fixture', {}),
      registryLike([
        { id: 'nav.fallback-z', order: 20, label: 'Fallback Z', path: '/fallback/z' },
        { id: 'nav.preset-a', order: 90, label: 'Preset A', path: '/preset/a' },
        { id: 'nav.fallback-a', order: 20, label: 'Fallback A', path: '/fallback/a' },
        { id: 'nav.preset-b', order: 10, label: 'Preset B', path: '/preset/b' },
      ], ['nav.preset-a', 'nav.preset-b']),
    )

    expect(navigation.map(({ label }) => label)).toEqual([
      'Preset A',
      'Preset B',
      'Fallback A',
      'Fallback Z',
    ])
  })

  it('supports granted extension capabilities and deterministic fallback order without core edits', () => {
    const extensionRegistry = createFumaRegistry({
      capabilities: [
        {
          id: 'fixture.base',
          navigation: [{ id: 'nav.base', order: 90, label: 'Base', path: '/base' }],
        },
        {
          id: 'fixture.extension',
          navigation: [
            {
              id: 'nav.extension-z',
              order: 20,
              label: 'Extension Z',
              path: '/extension/z',
              permission: 'fixture.extension.read',
            },
            {
              id: 'nav.extension-a',
              order: 20,
              label: 'Extension A',
              path: '/extension/a',
              permission: 'fixture.extension.read',
            },
          ],
          permissions: [{
            id: 'fixture.extension.read',
            label: 'Read extension',
            description: 'View the fixture extension.',
          }],
        },
      ],
      profiles: [{
        id: 'fixture-profile',
        label: 'Fixture profile',
        capabilityPreset: ['fixture.base'],
        navigationPreset: ['nav.base'],
        onboardingPreset: [],
        starterTemplatePreset: [],
      }],
    })

    const navigation = composeProfileNavigation(
      input(
        'fixture-profile',
        { 'fixture.extension.read': true },
        { grant: ['fixture.extension'], revoke: [] },
      ),
      extensionRegistry,
    )

    expect(navigation.map(({ label }) => label)).toEqual([
      'Base',
      'Extension A',
      'Extension Z',
    ])
  })

  it('returns immutable clones without changing registry composition or caller state', () => {
    const permissionState = grantedPermissions('publication')
    const before = fumaLaunchRegistry.compose('publication')
    const beforeSnapshot = structuredClone(before.navigation)

    const navigation = composeProfileNavigation(
      input('publication', permissionState),
      fumaLaunchRegistry,
    )

    expect(Object.isFrozen(navigation)).toBe(true)
    expect(navigation.every(Object.isFrozen)).toBe(true)
    expect(navigation[0]).not.toBe(before.navigation[0])
    expect(permissionState).toEqual(grantedPermissions('publication'))
    expect(fumaLaunchRegistry.compose('publication').navigation).toEqual(beforeSnapshot)
  })

  it('contains no Website or Publication profile-ID decision branches', async () => {
    const source = await Bun.file(new URL('../../core/fuma/navigation.ts', import.meta.url)).text()

    expect(source).not.toMatch(/profileId\s*={2,3}\s*['"](?:website|publication)['"]/)
    expect(source).not.toMatch(/switch\s*\(\s*(?:input\.)?profileId\s*\)/)
    expect(source).not.toMatch(/['"](?:website|publication)['"]\s*\.includes\s*\(/)
  })
})
