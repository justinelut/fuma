import { useEffect, useState } from 'react'
import {
  AccessibleContextCatalogSchema,
  type AccessibleContextCatalog,
  type NavigationPermissionState,
  type PermissionDecision,
} from '@core/fuma'
import { Type } from '@core/utils/typeboxHelpers'
import { Value } from '@core/utils/typeboxHelpers'

export const ACCESSIBLE_CONTEXT_CATALOG_PATH = '/api/fuma/context-catalog'

const EMPTY_PROJECTION = Object.freeze({
  catalog: null,
  permissionState: Object.freeze({}) as NavigationPermissionState,
  permissionDecisions: Object.freeze([]) as readonly PermissionDecision[],
})

const PermissionProjectionsSchema = Type.Array(Type.Object({
  organizationId: Type.String({ minLength: 1 }),
  workspaceId: Type.String({ minLength: 1 }),
  siteId: Type.String({ minLength: 1 }),
  allow: Type.Array(Type.String({ minLength: 1 })),
}, { additionalProperties: false }))

export type HostedContextProjection = Readonly<{
  catalog: AccessibleContextCatalog | null
  permissionState: NavigationPermissionState
  permissionDecisions: readonly PermissionDecision[]
}>

export type HostedContextCatalogState =
  | Readonly<{ status: 'loading' } & HostedContextProjection>
  | Readonly<{ status: 'ready' } & HostedContextProjection>

/**
 * Reads the authenticated staff member's organization/workspace/site scope.
 *
 * The shell must not decide between onboarding and the scoped workspace until
 * this resolves: treating an unresolved projection as "no sites" sends an owner
 * who already has a site back into first-site onboarding.
 */
export function useHostedContextCatalog(enabled: boolean): HostedContextCatalogState {
  const [state, setState] = useState<HostedContextCatalogState>(
    enabled ? { status: 'loading', ...EMPTY_PROJECTION } : { status: 'ready', ...EMPTY_PROJECTION },
  )

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      void fetch(ACCESSIBLE_CONTEXT_CATALOG_PATH, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('Accessible context catalog is unavailable.')
          const body: unknown = await response.json()
          const candidate = body !== null && typeof body === 'object' && !Array.isArray(body)
            ? (body as { catalog?: unknown }).catalog
            : undefined
          if (!Value.Check(AccessibleContextCatalogSchema, candidate)) {
            throw new Error('Accessible context catalog failed validation.')
          }
          const rawPermissions = (body as { permissions?: unknown }).permissions
          const permissions = Value.Check(PermissionProjectionsSchema, rawPermissions) ? rawPermissions : []
          // Navigation reads a flat allow map; route access reads per-site decisions.
          const permissionState: Record<string, boolean> = {}
          const permissionDecisions: PermissionDecision[] = []
          for (const projection of permissions) {
            for (const permissionId of projection.allow) {
              permissionState[permissionId] = true
              permissionDecisions.push(Object.freeze({
                organizationId: projection.organizationId,
                workspaceId: projection.workspaceId,
                siteId: projection.siteId,
                permissionId,
                decision: 'allow' as const,
              }) as unknown as PermissionDecision)
            }
          }
          if (!controller.signal.aborted) {
            setState({
              status: 'ready',
              catalog: candidate,
              permissionState: Object.freeze(permissionState),
              permissionDecisions: Object.freeze(permissionDecisions),
            })
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setState({ status: 'ready', ...EMPTY_PROJECTION })
        })
    })
    return () => controller.abort()
  }, [enabled])

  return state
}
