import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import {
  CapabilityOverridesSchema,
  PermissionIdSchema,
  RouteContributionSchema,
  type CapabilityOverrides,
  type RouteContribution,
} from './contracts'
import {
  NavigationPermissionStateSchema,
  type NavigationPermissionState,
} from './navigation'
import type { FumaRegistry } from './registry'

const RegistryIdSchema = Type.String({
  minLength: 1,
  pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
})

export const ProfileRouteAccessInputSchema = Type.Object({
  profileId: RegistryIdSchema,
  capabilityOverrides: CapabilityOverridesSchema,
  permissionState: NavigationPermissionStateSchema,
  method: Type.Literal('GET'),
  path: Type.String({ pattern: '^/admin(?:/|$)' }),
}, { additionalProperties: false })
export type ProfileRouteAccessInput = Readonly<Static<typeof ProfileRouteAccessInputSchema>>

export const ProfileRouteAccessSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('allowed'),
    route: RouteContributionSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('denied'),
    reason: Type.Union([
      Type.Literal('capability-disabled'),
      Type.Literal('permission-denied'),
    ]),
    permission: PermissionIdSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('unmanaged'),
  }, { additionalProperties: false }),
])
export type ProfileRouteAccess = Readonly<Static<typeof ProfileRouteAccessSchema>>

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) immutable(nested)
    Object.freeze(value)
  }
  return value
}

function normalizedPath(path: string): string {
  return path.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/admin'
}

function routeMatches(path: string, route: RouteContribution): boolean {
  if (route.method !== 'GET') return false
  const candidate = normalizedPath(route.path)
  if (candidate === '/admin') return path === candidate
  const pattern = candidate
    .split('/')
    .map((segment) => segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('/')
  return new RegExp(`^${pattern}(?:/|$)`).test(path)
}

function selectRoute(
  path: string,
  routes: readonly RouteContribution[],
): RouteContribution | undefined {
  return routes
    .filter((route) => routeMatches(path, route))
    .toSorted((left, right) => normalizedPath(right.path).length - normalizedPath(left.path).length)[0]
}

/** Resolves direct-link access from active capabilities and an immutable permission snapshot. */
export function resolveProfileRouteAccess(
  input: ProfileRouteAccessInput,
  registry: Pick<FumaRegistry, 'capabilities' | 'compose'>,
): ProfileRouteAccess {
  if (!Value.Check(ProfileRouteAccessInputSchema, input)) {
    throw new Error('profile route access input does not match its public TypeBox contract')
  }

  const path = normalizedPath(input.path)
  const composed = registry.compose(input.profileId, input.capabilityOverrides)
  const activeRoute = selectRoute(path, composed.routes)
  if (activeRoute) {
    return immutable(input.permissionState[activeRoute.permission] === true
      ? { kind: 'allowed', route: structuredClone(activeRoute) }
      : {
          kind: 'denied',
          reason: 'permission-denied',
          permission: activeRoute.permission,
        })
  }

  const registeredRoutes = registry.capabilities.flatMap(({ routes }) => routes ?? [])
  const inactiveRoute = selectRoute(path, registeredRoutes)
  if (inactiveRoute) {
    return immutable({
      kind: 'denied',
      reason: 'capability-disabled',
      permission: inactiveRoute.permission,
    })
  }

  return immutable({ kind: 'unmanaged' })
}

export type { NavigationPermissionState, CapabilityOverrides }
