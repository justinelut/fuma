import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import {
  CapabilityOverridesSchema,
  NavigationContributionSchema,
  NavigationSectionSchema,
  PermissionIdSchema,
  type CapabilityOverrides,
  type ComposedProductProfile,
} from './contracts'

const RegistryIdSchema = Type.String({
  minLength: 1,
  pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
})

export const NavigationPermissionStateSchema = Type.Record(
  PermissionIdSchema,
  Type.Boolean(),
  { additionalProperties: false },
)
export type NavigationPermissionState = Readonly<Static<typeof NavigationPermissionStateSchema>>

export const ProfileNavigationInputSchema = Type.Object({
  profileId: RegistryIdSchema,
  capabilityOverrides: CapabilityOverridesSchema,
  permissionState: NavigationPermissionStateSchema,
}, { additionalProperties: false })
export type ProfileNavigationInput = Static<typeof ProfileNavigationInputSchema>

export const ProfileNavigationDisclosureSchema = Type.Omit(NavigationSectionSchema, ['navigationIds'])
export type ProfileNavigationDisclosure = Readonly<Static<typeof ProfileNavigationDisclosureSchema>>

export const ProfileNavigationEntrySchema = Type.Object({
  ...NavigationContributionSchema.properties,
  disclosure: Type.Optional(ProfileNavigationDisclosureSchema),
}, { additionalProperties: false })
export type ProfileNavigationEntry = Readonly<Static<typeof ProfileNavigationEntrySchema>>

export const ProfileNavigationOutputSchema = Type.Array(ProfileNavigationEntrySchema)
export type ProfileNavigationOutput = readonly ProfileNavigationEntry[]

export const ProfileNavigationErrorCodeSchema = Type.Union([
  Type.Literal('duplicate-id'),
  Type.Literal('invalid-contribution'),
  Type.Literal('invalid-input'),
  Type.Literal('path-collision'),
])
export type ProfileNavigationErrorCode = Static<typeof ProfileNavigationErrorCodeSchema>

export class ProfileNavigationError extends Error {
  readonly code: ProfileNavigationErrorCode

  constructor(code: ProfileNavigationErrorCode, message: string) {
    super(message)
    this.name = 'ProfileNavigationError'
    this.code = code
  }
}

type ComposedNavigation = Pick<ComposedProductProfile, 'profile' | 'navigation'>

export type ProfileNavigationRegistry = Readonly<{
  compose: (profileId: string, overrides: CapabilityOverrides) => ComposedNavigation
}>

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizedNavigationPath(path: string): string {
  const pathname = new URL(path, 'https://navigation.fuma.invalid').pathname
  return pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/'
}

function assertValidInput(input: ProfileNavigationInput): void {
  if (!Value.Check(ProfileNavigationInputSchema, input)) {
    throw new ProfileNavigationError(
      'invalid-input',
      'profile navigation input does not match its public TypeBox contract',
    )
  }
}

function assertValidContributions(
  navigation: readonly ProfileNavigationEntry[],
): void {
  if (!Value.Check(ProfileNavigationOutputSchema, navigation)) {
    throw new ProfileNavigationError(
      'invalid-contribution',
      'composed profile navigation does not match its public TypeBox contract',
    )
  }

  const ids = new Set<string>()
  const paths = new Map<string, string>()
  for (const entry of navigation) {
    if (ids.has(entry.id)) {
      throw new ProfileNavigationError(
        'duplicate-id',
        `composed profile navigation contains duplicate ID "${entry.id}"`,
      )
    }
    ids.add(entry.id)

    const normalizedPath = normalizedNavigationPath(entry.path)
    const existing = paths.get(normalizedPath)
    if (existing) {
      throw new ProfileNavigationError(
        'path-collision',
        `navigation path "${normalizedPath}" is contributed by both "${existing}" and "${entry.id}"`,
      )
    }
    paths.set(normalizedPath, entry.id)
  }
}

function orderedNavigation(
  navigation: readonly ProfileNavigationEntry[],
  preset: readonly string[],
): ProfileNavigationEntry[] {
  const repeatedPresetIds = new Set<string>()
  const seenPresetIds = new Set<string>()
  for (const id of preset) {
    if (seenPresetIds.has(id)) repeatedPresetIds.add(id)
    seenPresetIds.add(id)
  }
  const repeatedPresetId = repeatedPresetIds.values().next().value
  if (repeatedPresetId) {
    throw new ProfileNavigationError(
      'duplicate-id',
      `profile navigation preset contains duplicate ID "${repeatedPresetId}"`,
    )
  }

  const byId = new Map(navigation.map((entry) => [entry.id, entry]))
  const selected = preset.flatMap((id) => {
    const entry = byId.get(id)
    return entry ? [entry] : []
  })
  const presetIds = new Set(preset)
  const fallback = navigation
    .filter(({ id }) => !presetIds.has(id))
    .toSorted((left, right) => left.order - right.order || compareIds(left.id, right.id))
  return [...selected, ...fallback]
}

/**
 * Resolves one profile assignment through an injected registry, then returns
 * only navigation actions available to the supplied permission state.
 */
export function composeProfileNavigation(
  input: ProfileNavigationInput,
  registry: ProfileNavigationRegistry,
): ProfileNavigationOutput {
  assertValidInput(input)
  const composed = registry.compose(input.profileId, input.capabilityOverrides)
  assertValidContributions(composed.navigation)

  const disclosureByNavigationId = new Map<string, ProfileNavigationDisclosure>()
  for (const section of composed.profile.navigationSections ?? []) {
    const disclosure = Object.freeze({
      id: section.id,
      label: section.label,
      defaultCollapsed: section.defaultCollapsed,
    })
    for (const navigationId of section.navigationIds) {
      if (disclosureByNavigationId.has(navigationId)) {
        throw new ProfileNavigationError(
          'duplicate-id',
          `profile navigation "${navigationId}" belongs to more than one disclosure`,
        )
      }
      disclosureByNavigationId.set(navigationId, disclosure)
    }
  }

  const visible = orderedNavigation(
    composed.navigation,
    composed.profile.navigationPreset,
  ).filter(({ permission }) => permission === undefined || input.permissionState[permission] === true)

  return Object.freeze(visible.map((entry) => Object.freeze({
    ...structuredClone(entry),
    ...(disclosureByNavigationId.has(entry.id)
      ? { disclosure: disclosureByNavigationId.get(entry.id) }
      : {}),
  })))
}
