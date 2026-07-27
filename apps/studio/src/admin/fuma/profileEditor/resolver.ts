import { Value } from '@sinclair/typebox/value'
import {
  type CapabilityDefinition,
  type ComposedProductProfile,
  type FumaRegistry,
  type NavigationContribution,
  type PermissionDecision,
} from '@core/fuma'
import {
  EditorSurfaceContributionSchema,
  ProfileEditorResolutionInputSchema,
  ProfileEditorSurfaceResolutionSchema,
  type EditorSurfaceContribution,
  type ProfileEditorErrorCode,
  type ProfileEditorResolutionInput,
  type ProfileEditorSurfaceResolution,
  type ResolvedEditorSurface,
  type ResolvedEditorSurfaceRoute,
} from './contracts'

export class ProfileEditorError extends Error {
  readonly code: ProfileEditorErrorCode
  readonly path: string

  constructor(code: ProfileEditorErrorCode, message: string, path: string) {
    super(message)
    this.name = 'ProfileEditorError'
    this.code = code
    this.path = path
  }
}

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) immutable(nested)
    Object.freeze(value)
  }
  return value
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function routePath(route: ResolvedEditorSurfaceRoute): string {
  return route.kind === 'navigation' ? route.navigation.path : route.path
}

function assertInput(input: ProfileEditorResolutionInput): void {
  if (!Value.Check(ProfileEditorResolutionInputSchema, input)) {
    const error = Value.Errors(ProfileEditorResolutionInputSchema, input).First()
    throw new ProfileEditorError(
      'invalid-input',
      `Profile editor input is malformed${error ? `: ${error.path || '/'} ${error.message}` : ''}.`,
      error?.path || 'input',
    )
  }
}

function capabilityPermissions(capability: CapabilityDefinition): ReadonlySet<string> {
  return new Set((capability.permissions ?? []).map(({ id }) => id))
}

function assertContribution(
  contribution: EditorSurfaceContribution,
  index: number,
  registry: FumaRegistry,
): void {
  const path = `contributions.${index}`
  if (!Value.Check(EditorSurfaceContributionSchema, contribution)) {
    throw new ProfileEditorError(
      'invalid-contribution',
      `Editor contribution at ${path} does not match its TypeBox contract.`,
      path,
    )
  }

  const capability = registry.getCapability(contribution.capabilityId)
  if (!capability) {
    throw new ProfileEditorError(
      'invalid-contribution',
      `Editor contribution "${contribution.id}" references unknown capability "${contribution.capabilityId}".`,
      `${path}.capabilityId`,
    )
  }

  const permissions = capabilityPermissions(capability)
  for (const [field, permissionId] of [
    ['viewPermission', contribution.viewPermission],
    ['writePermission', contribution.writePermission],
  ] as const) {
    if (permissionId && !permissions.has(permissionId)) {
      throw new ProfileEditorError(
        'invalid-contribution',
        `Editor contribution "${contribution.id}" uses permission "${permissionId}" not declared by capability "${capability.id}".`,
        `${path}.${field}`,
      )
    }
  }

  if (contribution.route.kind !== 'navigation') return
  const { navigationId } = contribution.route
  const navigation = (capability.navigation ?? []).find(
    ({ id }) => id === navigationId,
  )
  if (!navigation) {
    throw new ProfileEditorError(
      'invalid-contribution',
      `Editor contribution "${contribution.id}" references navigation "${navigationId}" not contributed by capability "${capability.id}".`,
      `${path}.route.navigationId`,
    )
  }
  if (navigation.permission !== contribution.viewPermission) {
    throw new ProfileEditorError(
      'invalid-contribution',
      `Editor contribution "${contribution.id}" view permission must match navigation "${navigation.id}".`,
      `${path}.viewPermission`,
    )
  }
}

function assertUniqueContributions(contributions: readonly EditorSurfaceContribution[]): void {
  const ids = new Set<string>()
  for (const [index, contribution] of contributions.entries()) {
    if (ids.has(contribution.id)) {
      throw new ProfileEditorError(
        'duplicate-contribution',
        `Editor contribution ID "${contribution.id}" is duplicated.`,
        `contributions.${index}.id`,
      )
    }
    ids.add(contribution.id)
  }
}

function decisionMap(decisions: readonly PermissionDecision[]): ReadonlyMap<string, boolean> {
  const access = new Map<string, boolean>()
  for (const [index, decision] of decisions.entries()) {
    if (access.has(decision.permissionId)) {
      throw new ProfileEditorError(
        'duplicate-permission-decision',
        `Permission "${decision.permissionId}" has more than one decision.`,
        `permissionDecisions.${index}.permissionId`,
      )
    }
    access.set(decision.permissionId, decision.decision === 'allow')
  }
  return access
}

function resolveRoute(
  contribution: EditorSurfaceContribution,
  navigationById: ReadonlyMap<string, NavigationContribution>,
): ResolvedEditorSurfaceRoute {
  if (contribution.route.kind === 'route') {
    return { kind: 'route', path: contribution.route.path }
  }

  const navigation = navigationById.get(contribution.route.navigationId)
  if (!navigation) {
    throw new ProfileEditorError(
      'invalid-contribution',
      `Active editor contribution "${contribution.id}" has no composed navigation "${contribution.route.navigationId}".`,
      `contributions.${contribution.id}.route.navigationId`,
    )
  }
  return { kind: 'navigation', navigation: structuredClone(navigation) }
}

function resolvedSurface(
  contribution: EditorSurfaceContribution,
  route: ResolvedEditorSurfaceRoute,
  permissions: ReadonlyMap<string, boolean>,
): ResolvedEditorSurface {
  const visible = permissions.get(contribution.viewPermission) === true
  const mutable = visible
    && contribution.writePermission !== undefined
    && permissions.get(contribution.writePermission) === true

  return {
    id: contribution.id,
    surface: contribution.surface,
    capabilityId: contribution.capabilityId,
    order: contribution.order,
    label: contribution.label,
    route,
    access: { visible, mutable },
  }
}

function assertNoRouteCollisions(surfaces: readonly ResolvedEditorSurface[]): void {
  const routes = new Map<string, string>()
  for (const surface of surfaces) {
    const path = routePath(surface.route).replace(/\/+$/, '') || '/'
    const existing = routes.get(path)
    if (existing) {
      throw new ProfileEditorError(
        'route-collision',
        `Editor route "${path}" is contributed by both "${existing}" and "${surface.id}".`,
        `contributions.${surface.id}.route`,
      )
    }
    routes.set(path, surface.id)
  }
}

function composedProfile(input: ProfileEditorResolutionInput, registry: FumaRegistry): ComposedProductProfile {
  return registry.compose(input.profileId, input.capabilityOverrides)
}

/**
 * Resolves editor access from composed capabilities and permission decisions.
 * Profile identity is deliberately opaque to this function.
 */
export function resolveProfileEditorSurfaces(
  input: ProfileEditorResolutionInput,
  registry: FumaRegistry,
): ProfileEditorSurfaceResolution {
  assertInput(input)
  assertUniqueContributions(input.contributions)
  input.contributions.forEach((contribution, index) => {
    assertContribution(contribution, index, registry)
  })

  const composed = composedProfile(input, registry)
  const activeCapabilities = new Set(composed.capabilities.map(({ id }) => id))
  const navigationById = new Map(composed.navigation.map((entry) => [entry.id, entry]))
  const permissions = decisionMap(input.permissionDecisions)
  const surfaces = input.contributions
    .filter(({ capabilityId }) => activeCapabilities.has(capabilityId))
    .map((contribution) => resolvedSurface(
      contribution,
      resolveRoute(contribution, navigationById),
      permissions,
    ))
    .toSorted((left, right) => left.order - right.order || compareIds(left.id, right.id))

  assertNoRouteCollisions(surfaces)
  const resolution = {
    surfaces,
    visible: surfaces.filter(({ access }) => access.visible),
    mutable: surfaces.filter(({ access }) => access.mutable),
  }
  if (!Value.Check(ProfileEditorSurfaceResolutionSchema, resolution)) {
    throw new ProfileEditorError(
      'invalid-contribution',
      'Resolved editor surfaces do not match the public TypeBox contract.',
      'resolution',
    )
  }
  return immutable(resolution)
}
