import { Value } from '@sinclair/typebox/value'
import type { TSchema } from '@sinclair/typebox'
import {
  CapabilityOverridesSchema,
  FumaRegistryDefinitionSchema,
  type CapabilityDefinition,
  type CapabilityId,
  type CapabilityOverrides,
  type ComposedProductProfile,
  type FumaRegistryDefinition,
  type FumaRegistryErrorCode,
  type JobContribution,
  type NavigationContribution,
  type OnboardingStepContribution,
  type PermissionDefinition,
  type ProductProfile,
  type RouteContribution,
  type StarterTemplateContribution,
  type TransferContribution,
} from './contracts'

const EMPTY_OVERRIDES: CapabilityOverrides = Object.freeze({ grant: [], revoke: [] })

type Identified = Readonly<{ id: string }>

type ReadonlyArrayProperties<T> = {
  readonly [Key in keyof T]: T[Key] extends readonly (infer Item)[]
    ? readonly Item[]
    : T[Key]
}

type FumaRegistryInput = ReadonlyArrayProperties<FumaRegistryDefinition>
type FumaRegistryOverrides = ReadonlyArrayProperties<CapabilityOverrides>

export class FumaRegistryError extends Error {
  readonly code: FumaRegistryErrorCode

  constructor(code: FumaRegistryErrorCode, message: string) {
    super(message)
    this.name = 'FumaRegistryError'
    this.code = code
  }
}

function firstValidationError(schema: TSchema, value: unknown): string {
  const error = Value.Errors(schema, value).First()
  return error ? `${error.path || '/'} ${error.message}` : 'unknown schema error'
}

function assertSchema(schema: TSchema, value: unknown, subject: string): void {
  if (!Value.Check(schema, value)) {
    throw new FumaRegistryError(
      'invalid-definition',
      `${subject} does not match its public TypeBox contract: ${firstValidationError(schema, value)}`,
    )
  }
}

function duplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return undefined
}

function assertUniqueIds(values: readonly Identified[], subject: string): void {
  const repeated = duplicate(values.map(({ id }) => id))
  if (repeated) {
    throw new FumaRegistryError('duplicate-id', `${subject} contains duplicate ID "${repeated}"`)
  }
}

function contributions<T extends Identified>(
  capabilities: readonly CapabilityDefinition[],
  select: (capability: CapabilityDefinition) => readonly T[],
): T[] {
  return capabilities.flatMap(select)
}

function routeCollisionKey(route: RouteContribution): string {
  const normalizedPath = route.path
    .replace(/\/+$/, '')
    .replace(/:[^/]+/g, ':parameter') || '/'
  return `${route.method} ${normalizedPath}`
}

function assertNoRouteCollisions(routes: readonly RouteContribution[]): void {
  const owners = new Map<string, string>()
  for (const route of routes) {
    const key = routeCollisionKey(route)
    const existing = owners.get(key)
    if (existing) {
      throw new FumaRegistryError(
        'route-collision',
        `route "${key}" is contributed by both "${existing}" and "${route.id}"`,
      )
    }
    owners.set(key, route.id)
  }
}

function assertDependencies(capabilities: readonly CapabilityDefinition[]): void {
  const byId = new Map(capabilities.map((capability) => [capability.id, capability]))

  for (const capability of capabilities) {
    const dependencies = capability.dependsOn ?? []
    const conflicts = capability.conflictsWith ?? []
    const repeatedDependency = duplicate(dependencies)
    const repeatedConflict = duplicate(conflicts)
    if (repeatedDependency || repeatedConflict) {
      throw new FumaRegistryError(
        'dependency-collision',
        `capability "${capability.id}" repeats dependency/conflict "${repeatedDependency ?? repeatedConflict}"`,
      )
    }
    for (const dependencyId of dependencies) {
      if (dependencyId === capability.id || !byId.has(dependencyId)) {
        throw new FumaRegistryError(
          'dependency-collision',
          `capability "${capability.id}" has invalid dependency "${dependencyId}"`,
        )
      }
      if (conflicts.includes(dependencyId)) {
        throw new FumaRegistryError(
          'dependency-collision',
          `capability "${capability.id}" both depends on and conflicts with "${dependencyId}"`,
        )
      }
    }
    for (const conflictId of conflicts) {
      if (conflictId === capability.id || !byId.has(conflictId)) {
        throw new FumaRegistryError(
          'dependency-collision',
          `capability "${capability.id}" has invalid conflict "${conflictId}"`,
        )
      }
    }
  }

  const visiting = new Set<CapabilityId>()
  const visited = new Set<CapabilityId>()
  const visit = (capabilityId: CapabilityId): void => {
    if (visiting.has(capabilityId)) {
      throw new FumaRegistryError(
        'dependency-collision',
        `capability dependency cycle reaches "${capabilityId}"`,
      )
    }
    if (visited.has(capabilityId)) return
    visiting.add(capabilityId)
    for (const dependencyId of byId.get(capabilityId)?.dependsOn ?? []) visit(dependencyId)
    visiting.delete(capabilityId)
    visited.add(capabilityId)
  }
  for (const capability of capabilities) visit(capability.id)
}

function capabilityOrder(
  requestedIds: readonly CapabilityId[],
  capabilities: ReadonlyMap<CapabilityId, CapabilityDefinition>,
  explicitlyRevoked: ReadonlySet<CapabilityId> = new Set(),
): CapabilityDefinition[] {
  const resolved: CapabilityDefinition[] = []
  const visited = new Set<CapabilityId>()
  const visit = (capabilityId: CapabilityId, requiredBy?: CapabilityId): void => {
    if (explicitlyRevoked.has(capabilityId)) {
      throw new FumaRegistryError(
        'invalid-capability-override',
        requiredBy
          ? `cannot revoke "${capabilityId}" because "${requiredBy}" depends on it`
          : `cannot resolve explicitly revoked capability "${capabilityId}"`,
      )
    }
    if (visited.has(capabilityId)) return
    const capability = capabilities.get(capabilityId)
    if (!capability) {
      throw new FumaRegistryError(
        requiredBy ? 'dependency-collision' : 'invalid-capability-override',
        requiredBy
          ? `capability "${requiredBy}" depends on unknown capability "${capabilityId}"`
          : `unknown capability "${capabilityId}"`,
      )
    }
    for (const dependencyId of capability.dependsOn ?? []) visit(dependencyId, capability.id)
    visited.add(capabilityId)
    resolved.push(capability)
  }
  for (const capabilityId of requestedIds) visit(capabilityId)
  return resolved
}

function assertNoCapabilityConflicts(capabilities: readonly CapabilityDefinition[]): void {
  const active = new Set(capabilities.map(({ id }) => id))
  for (const capability of capabilities) {
    const conflict = (capability.conflictsWith ?? []).find((id) => active.has(id))
    if (conflict) {
      throw new FumaRegistryError(
        'dependency-collision',
        `capabilities "${capability.id}" and "${conflict}" cannot be composed together`,
      )
    }
  }
}

function orderedContributions<T extends Identified & Readonly<{ order: number }>>(
  available: readonly T[],
  preferredIds: readonly string[],
): T[] {
  const byId = new Map(available.map((contribution) => [contribution.id, contribution]))
  const selected: T[] = []
  const seen = new Set<string>()
  for (const id of preferredIds) {
    const contribution = byId.get(id)
    if (contribution) {
      selected.push(contribution)
      seen.add(id)
    }
  }
  const remaining = available
    .filter(({ id }) => !seen.has(id))
    .toSorted((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  return [...selected, ...remaining]
}

function assertProfilePresets(
  profile: ProductProfile,
  activeCapabilities: readonly CapabilityDefinition[],
): void {
  const presets = [
    ['navigationPreset', profile.navigationPreset, contributions<NavigationContribution>(activeCapabilities, ({ navigation }) => navigation ?? [])],
    ['onboardingPreset', profile.onboardingPreset, contributions<OnboardingStepContribution>(activeCapabilities, ({ onboarding }) => onboarding ?? [])],
    ['starterTemplatePreset', profile.starterTemplatePreset, contributions<StarterTemplateContribution>(activeCapabilities, ({ starterTemplates }) => starterTemplates ?? [])],
  ] as const

  for (const [name, ids, available] of presets) {
    const repeated = duplicate(ids)
    if (repeated) {
      throw new FumaRegistryError('duplicate-id', `profile "${profile.id}" ${name} repeats "${repeated}"`)
    }
    const availableIds = new Set(available.map(({ id }) => id))
    const unavailable = ids.find((id) => !availableIds.has(id))
    if (unavailable) {
      throw new FumaRegistryError(
        'dependency-collision',
        `profile "${profile.id}" ${name} references unavailable contribution "${unavailable}"`,
      )
    }
  }

  const sections = profile.navigationSections ?? []
  assertUniqueIds(sections, `profile "${profile.id}" navigation sections`)
  const availableNavigationIds = new Set(contributions<NavigationContribution>(
    activeCapabilities,
    ({ navigation }) => navigation ?? [],
  ).map(({ id }) => id))
  const assignedNavigationIds = new Set<string>()
  for (const section of sections) {
    for (const navigationId of section.navigationIds) {
      if (!availableNavigationIds.has(navigationId)) {
        throw new FumaRegistryError(
          'dependency-collision',
          `profile "${profile.id}" navigation section "${section.id}" references unavailable contribution "${navigationId}"`,
        )
      }
      if (assignedNavigationIds.has(navigationId)) {
        throw new FumaRegistryError(
          'duplicate-id',
          `profile "${profile.id}" assigns navigation "${navigationId}" to more than one section`,
        )
      }
      assignedNavigationIds.add(navigationId)
    }
  }
}

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) immutable(nested)
    Object.freeze(value)
  }
  return value
}

export class FumaRegistry {
  readonly capabilities: readonly CapabilityDefinition[]
  readonly profiles: readonly ProductProfile[]
  readonly #capabilitiesById: ReadonlyMap<CapabilityId, CapabilityDefinition>
  readonly #profilesById: ReadonlyMap<string, ProductProfile>

  constructor(definition: FumaRegistryInput) {
    assertSchema(FumaRegistryDefinitionSchema, definition, 'Fuma registry definition')
    assertUniqueIds(definition.capabilities, 'capability registry')
    assertUniqueIds(definition.profiles, 'profile registry')
    assertDependencies(definition.capabilities)

    const contributionGroups = [
      ['jobs', contributions<JobContribution>(definition.capabilities, ({ jobs }) => jobs ?? [])],
      ['navigation', contributions<NavigationContribution>(definition.capabilities, ({ navigation }) => navigation ?? [])],
      ['onboarding', contributions<OnboardingStepContribution>(definition.capabilities, ({ onboarding }) => onboarding ?? [])],
      ['permissions', contributions<PermissionDefinition>(definition.capabilities, ({ permissions }) => permissions ?? [])],
      ['routes', contributions<RouteContribution>(definition.capabilities, ({ routes }) => routes ?? [])],
      ['starterTemplates', contributions<StarterTemplateContribution>(definition.capabilities, ({ starterTemplates }) => starterTemplates ?? [])],
      ['transfer', contributions<TransferContribution>(definition.capabilities, ({ transfer }) => transfer ?? [])],
    ] as const
    for (const [name, values] of contributionGroups) {
      assertUniqueIds(values, `${name} contributions`)
    }
    assertNoRouteCollisions(contributions<RouteContribution>(definition.capabilities, ({ routes }) => routes ?? []))

    this.capabilities = immutable(structuredClone(definition.capabilities))
    this.profiles = immutable(structuredClone(definition.profiles))
    this.#capabilitiesById = new Map(this.capabilities.map((capability) => [capability.id, capability]))
    this.#profilesById = new Map(this.profiles.map((profile) => [profile.id, profile]))

    for (const profile of this.profiles) {
      const repeatedCapability = duplicate(profile.capabilityPreset)
      if (repeatedCapability) {
        throw new FumaRegistryError(
          'duplicate-id',
          `profile "${profile.id}" repeats capability "${repeatedCapability}"`,
        )
      }
      const active = capabilityOrder(profile.capabilityPreset, this.#capabilitiesById)
      assertNoCapabilityConflicts(active)
      assertProfilePresets(profile, active)
    }
  }

  getCapability(id: CapabilityId): CapabilityDefinition | undefined {
    return this.#capabilitiesById.get(id)
  }

  getProfile(id: string): ProductProfile | undefined {
    return this.#profilesById.get(id)
  }

  compose(profileId: string, overrides: FumaRegistryOverrides = EMPTY_OVERRIDES): ComposedProductProfile {
    const profile = this.#profilesById.get(profileId)
    if (!profile) throw new FumaRegistryError('unknown-profile', `unknown product profile "${profileId}"`)

    if (!Value.Check(CapabilityOverridesSchema, overrides)) {
      throw new FumaRegistryError(
        'invalid-capability-override',
        `capability overrides do not match their public TypeBox contract: ${firstValidationError(CapabilityOverridesSchema, overrides)}`,
      )
    }
    const repeatedGrant = duplicate(overrides.grant)
    const repeatedRevoke = duplicate(overrides.revoke)
    if (repeatedGrant || repeatedRevoke) {
      throw new FumaRegistryError(
        'invalid-capability-override',
        `capability overrides repeat "${repeatedGrant ?? repeatedRevoke}"`,
      )
    }
    const revoked = new Set(overrides.revoke)
    const overlap = overrides.grant.find((id) => revoked.has(id))
    if (overlap) {
      throw new FumaRegistryError(
        'invalid-capability-override',
        `capability "${overlap}" cannot be granted and revoked together`,
      )
    }
    for (const capabilityId of [...overrides.grant, ...overrides.revoke]) {
      if (!this.#capabilitiesById.has(capabilityId)) {
        throw new FumaRegistryError('invalid-capability-override', `unknown capability override "${capabilityId}"`)
      }
    }

    const requested = [
      ...profile.capabilityPreset.filter((id) => !revoked.has(id)),
      ...overrides.grant,
    ]
    const active = capabilityOrder(requested, this.#capabilitiesById, revoked)
    assertNoCapabilityConflicts(active)

    const navigation = orderedContributions(
      contributions<NavigationContribution>(active, ({ navigation }) => navigation ?? []),
      profile.navigationPreset,
    )
    const onboarding = orderedContributions(
      contributions<OnboardingStepContribution>(active, ({ onboarding }) => onboarding ?? []),
      profile.onboardingPreset,
    )
    const starterTemplates = orderedContributions(
      contributions<StarterTemplateContribution>(active, ({ starterTemplates }) => starterTemplates ?? []),
      profile.starterTemplatePreset,
    )

    return immutable({
      profile,
      capabilities: active,
      navigation,
      onboarding,
      starterTemplates,
      permissions: contributions<PermissionDefinition>(active, ({ permissions }) => permissions ?? []),
      routes: contributions<RouteContribution>(active, ({ routes }) => routes ?? []),
      jobs: contributions<JobContribution>(active, ({ jobs }) => jobs ?? []),
      transfer: contributions<TransferContribution>(active, ({ transfer }) => transfer ?? []),
    })
  }
}

export function createFumaRegistry(definition: FumaRegistryInput): FumaRegistry {
  return new FumaRegistry(definition)
}
