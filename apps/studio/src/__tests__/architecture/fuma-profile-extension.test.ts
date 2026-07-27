import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { extname, join } from 'path'
import * as ts from 'typescript'
import { Value } from '@sinclair/typebox/value'
import {
  CapabilityDefinitionSchema,
  ComposedProductProfileSchema,
  FumaRegistryError,
  LAUNCH_CAPABILITIES,
  LAUNCH_PROFILES,
  ProfileNavigationError,
  composeProfileNavigation,
  createFumaRegistry,
  resolveProfileOnboarding,
  type CapabilityDefinition,
  type CapabilityOverrides,
  type FumaRegistryErrorCode,
  type ProductProfile,
  type ProfileNavigationErrorCode,
} from '@core/fuma'

const ROOT = join(import.meta.dir, '../../..')
const TEST_PATH = 'src/__tests__/architecture/fuma-profile-extension.test.ts'
const EXTENSION_FIXTURE_PATH = 'src/__tests__/helpers/fuma/extensionProfile.ts'
const SHARED_COMPOSITION_PATHS = [
  'src/core/fuma/registry.ts',
  'src/core/fuma/navigation.ts',
  'src/core/fuma/onboarding.ts',
  'server/fuma/onboarding/starterTemplates.ts',
  'src/admin/fuma/FumaScopedShell.tsx',
] as const

const FIXTURE_CAPABILITY_ID = 'fixture.extension'
const REGISTERED_FIXTURE_PROFILE_ID = 'fixture.website-content-review'
const FIXTURE_NAVIGATION_ID = 'nav.fixture-extension'
const FIXTURE_ONBOARDING_ID = 'onboarding.fixture-extension'
const FIXTURE_STARTER_ID = 'starter.fixture-extension'
const FIXTURE_TEMPLATE_ID = 'fixture.extension.blank'
const FIXTURE_PERMISSION_ID = 'fixture.extension.read'
const EMPTY_OVERRIDES: CapabilityOverrides = { grant: [], revoke: [] }

/**
 * Deliberately local proof extension: this is consumer code outside src/core/fuma.
 * A real extension can provide the same public CapabilityDefinition contract.
 */
const FIXTURE_EXTENSION: CapabilityDefinition = {
  id: FIXTURE_CAPABILITY_ID,
  navigation: [{
    id: FIXTURE_NAVIGATION_ID,
    order: 95,
    label: 'Fixture extension',
    path: '/admin/fixture-extension',
    permission: FIXTURE_PERMISSION_ID,
  }],
  onboarding: [{
    id: FIXTURE_ONBOARDING_ID,
    order: 95,
    title: 'Configure the fixture extension',
    description: 'Prove that extension onboarding composes without a shared-core branch.',
  }],
  starterTemplates: [{
    id: FIXTURE_STARTER_ID,
    order: 95,
    label: 'Fixture extension',
    templateId: FIXTURE_TEMPLATE_ID,
  }],
  permissions: [{
    id: FIXTURE_PERMISSION_ID,
    label: 'View fixture extension',
    description: 'View the fixture extension surface.',
  }],
}

const FIXTURE_OVERRIDES: CapabilityOverrides = {
  grant: [FIXTURE_CAPABILITY_ID],
  revoke: [],
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

function scriptKind(path: string): ts.ScriptKind {
  return extname(path) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

function branchTexts(path: string): string[] {
  const source = read(path)
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  )
  const branches: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isIfStatement(node)
      || ts.isSwitchStatement(node)
      || ts.isConditionalExpression(node)
    ) {
      branches.push(node.getText(sourceFile))
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return branches
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

function missingContributionProfile(
  preset: 'navigationPreset' | 'onboardingPreset' | 'starterTemplatePreset',
): ProductProfile {
  return {
    id: `fixture.missing-${preset.replace('Preset', '').toLowerCase()}`,
    label: 'Hostile missing contribution fixture',
    capabilityPreset: ['fixture.empty'],
    navigationPreset: preset === 'navigationPreset' ? ['fixture.missing'] : [],
    onboardingPreset: preset === 'onboardingPreset' ? ['fixture.missing'] : [],
    starterTemplatePreset: preset === 'starterTemplatePreset' ? ['fixture.missing'] : [],
  }
}

describe('FUMA-019 profile extension architecture proof', () => {
  it('composes Website, Publication, and a fixture extension through public contracts', () => {
    expect(Value.Check(CapabilityDefinitionSchema, FIXTURE_EXTENSION)).toBe(true)

    const registry = createFumaRegistry({
      capabilities: [...LAUNCH_CAPABILITIES, FIXTURE_EXTENSION],
      profiles: LAUNCH_PROFILES,
    })

    for (const profileId of ['website', 'publication'] as const) {
      const base = registry.compose(profileId, EMPTY_OVERRIDES)
      const extended = registry.compose(profileId, FIXTURE_OVERRIDES)

      expect(Value.Check(ComposedProductProfileSchema, extended)).toBe(true)
      expect(extended.profile.id).toBe(profileId)
      expect(extended.capabilities.map(({ id }) => id)).toContain(FIXTURE_CAPABILITY_ID)
      expect(base.capabilities.map(({ id }) => id)).not.toContain(FIXTURE_CAPABILITY_ID)
      expect(extended.navigation.map(({ id }) => id)).toContain(FIXTURE_NAVIGATION_ID)
      expect(extended.onboarding.map(({ id }) => id)).toContain(FIXTURE_ONBOARDING_ID)
      expect(extended.starterTemplates.map(({ id }) => id)).toContain(FIXTURE_STARTER_ID)
      expect(extended.permissions.map(({ id }) => id)).toContain(FIXTURE_PERMISSION_ID)

      const navigation = composeProfileNavigation({
        profileId,
        capabilityOverrides: FIXTURE_OVERRIDES,
        permissionState: { [FIXTURE_PERMISSION_ID]: true },
      }, registry)
      expect(navigation.map(({ id }) => id)).toContain(FIXTURE_NAVIGATION_ID)

      const onboarding = resolveProfileOnboarding(registry, {
        organizationId: 'fixture-organization',
        workspaceId: 'fixture-workspace',
        siteId: `fixture-${profileId}-site`,
        profileId,
        capabilityOverrides: FIXTURE_OVERRIDES,
      })
      expect(onboarding.steps.map(({ id }) => id)).toContain(FIXTURE_ONBOARDING_ID)
    }
  })

  it('keeps fixture code outside shared core and every shared consumer fixture-blind', () => {
    expect(TEST_PATH.startsWith('src/core/')).toBe(false)
    expect(EXTENSION_FIXTURE_PATH.startsWith('src/core/')).toBe(false)
    expect(read(TEST_PATH)).toContain(`const FIXTURE_CAPABILITY_ID = '${FIXTURE_CAPABILITY_ID}'`)

    const registeredFixtureSource = read(EXTENSION_FIXTURE_PATH)
    expect(registeredFixtureSource).toContain("from '@core/fuma'")
    expect(registeredFixtureSource).not.toMatch(/from ['"]@core\/fuma\//)
    expect(registeredFixtureSource).toContain("id: 'fixture.content-review'")
    expect(registeredFixtureSource).toContain(
      `id: '${REGISTERED_FIXTURE_PROFILE_ID}'`,
    )

    for (const path of SHARED_COMPOSITION_PATHS) {
      const source = read(path)
      expect(source, `${path} must not know the fixture capability`).not.toContain(FIXTURE_CAPABILITY_ID)
      expect(source, `${path} must not know the registered fixture capability`).not.toContain('fixture.content-review')
      expect(source, `${path} must not know the registered fixture profile`).not.toContain(
        REGISTERED_FIXTURE_PROFILE_ID,
      )
      expect(source, `${path} must not know the fixture navigation`).not.toContain(FIXTURE_NAVIGATION_ID)
      expect(source, `${path} must not know the fixture onboarding step`).not.toContain(FIXTURE_ONBOARDING_ID)
      expect(source, `${path} must not know the fixture starter`).not.toContain(FIXTURE_STARTER_ID)
      expect(source, `${path} must not know the fixture permission`).not.toContain(FIXTURE_PERMISSION_ID)
    }
  })

  it('proves the registry and consumers use generic composition instead of named-profile branches', () => {
    const registrySource = read('src/core/fuma/registry.ts')
    expect(registrySource).toContain('assertSchema(FumaRegistryDefinitionSchema, definition')
    expect(registrySource).toContain('definition.capabilities')
    expect(registrySource).toContain('definition.profiles')
    expect(registrySource).toContain('profile.capabilityPreset')
    expect(registrySource).toContain('({ navigation }) => navigation ?? []')
    expect(registrySource).toContain('({ onboarding }) => onboarding ?? []')
    expect(registrySource).toContain('({ starterTemplates }) => starterTemplates ?? []')
    expect(registrySource).toContain('({ permissions }) => permissions ?? []')

    const namedProfileLiteral = /['"](?:website|publication|fixture\.extension|fixture\.website-content-review)['"]/
    expect(registrySource).not.toMatch(namedProfileLiteral)
    for (const path of SHARED_COMPOSITION_PATHS) {
      for (const branch of branchTexts(path)) {
        expect(branch, `${path} contains a named-profile decision`).not.toMatch(namedProfileLiteral)
      }
    }

    expect(read('src/core/fuma/navigation.ts')).toContain(
      'registry.compose(input.profileId, input.capabilityOverrides)',
    )
    expect(read('src/core/fuma/onboarding.ts')).toContain(
      'registry.compose(assignment.profileId, assignment.capabilityOverrides)',
    )
    expect(read('server/fuma/onboarding/starterTemplates.ts')).toContain(
      'registry.compose(site.profileId, site.capabilityOverrides)',
    )
    expect(read('server/fuma/onboarding/starterTemplates.ts')).toContain(
      'composition.starterTemplates',
    )

    const shellSource = read('src/admin/fuma/FumaScopedShell.tsx')
    expect(shellSource).toContain('registry?: FumaRegistry')
    expect(shellSource).toMatch(/composeProfileNavigation\([\s\S]*?\}, registry\)/)
    expect(shellSource).toMatch(/resolveProfileOnboarding\(registry, \{/)
  })

  it('registers the fixture capability without creating speculative production profiles', () => {
    const registry = createFumaRegistry({
      capabilities: [...LAUNCH_CAPABILITIES, FIXTURE_EXTENSION],
      profiles: LAUNCH_PROFILES,
    })

    expect(LAUNCH_PROFILES.map(({ id }) => id)).toEqual(['website', 'publication'])
    expect(registry.profiles.map(({ id }) => id)).toEqual(['website', 'publication'])
    expect(registry.getProfile(FIXTURE_CAPABILITY_ID)).toBeUndefined()
    expect(registry.getCapability(FIXTURE_CAPABILITY_ID)).toEqual(FIXTURE_EXTENSION)
    expect(registry.profiles.map(({ id }) => id)).not.toContain(FIXTURE_CAPABILITY_ID)
  })

  it('rejects a hostile extension that duplicates a contribution ID', () => {
    const duplicateContribution: CapabilityDefinition = {
      id: 'fixture.duplicate-contribution',
      navigation: [{
        id: FIXTURE_NAVIGATION_ID,
        order: 96,
        label: 'Duplicate fixture navigation',
        path: '/admin/duplicate-fixture-extension',
      }],
    }

    expectRegistryError(() => createFumaRegistry({
      capabilities: [
        ...LAUNCH_CAPABILITIES,
        FIXTURE_EXTENSION,
        duplicateContribution,
      ],
      profiles: LAUNCH_PROFILES,
    }), 'duplicate-id')
  })

  it('rejects a hostile extension with a normalized navigation-path collision', () => {
    const pathCollision: CapabilityDefinition = {
      id: 'fixture.path-collision',
      navigation: [{
        id: 'nav.fixture-path-collision',
        order: 96,
        label: 'Colliding pages path',
        path: '/admin//pages/',
      }],
    }
    const registry = createFumaRegistry({
      capabilities: [...LAUNCH_CAPABILITIES, pathCollision],
      profiles: LAUNCH_PROFILES,
    })

    expectNavigationError(() => composeProfileNavigation({
      profileId: 'website',
      capabilityOverrides: { grant: [pathCollision.id], revoke: [] },
      permissionState: {},
    }, registry), 'path-collision')
  })

  it('rejects hostile profiles whose presets name missing contributions', () => {
    const presets = [
      'navigationPreset',
      'onboardingPreset',
      'starterTemplatePreset',
    ] as const

    for (const preset of presets) {
      expectRegistryError(() => createFumaRegistry({
        capabilities: [{ id: 'fixture.empty' }],
        profiles: [missingContributionProfile(preset)],
      }), 'dependency-collision')
    }
  })
})
