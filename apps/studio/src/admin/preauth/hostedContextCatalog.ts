import { useEffect, useState } from 'react'
import { AccessibleContextCatalogSchema, type AccessibleContextCatalog } from '@core/fuma'
import { Value } from '@core/utils/typeboxHelpers'

export const ACCESSIBLE_CONTEXT_CATALOG_PATH = '/api/fuma/context-catalog'

export type HostedContextCatalogState =
  | Readonly<{ status: 'loading'; catalog: null }>
  | Readonly<{ status: 'ready'; catalog: AccessibleContextCatalog | null }>

/**
 * Reads the authenticated staff member's organization/workspace/site scope.
 *
 * The shell must not decide between onboarding and the scoped workspace until
 * this resolves: treating an unresolved projection as "no sites" sends an owner
 * who already has a site back into first-site onboarding.
 */
export function useHostedContextCatalog(enabled: boolean): HostedContextCatalogState {
  const [state, setState] = useState<HostedContextCatalogState>(
    enabled ? { status: 'loading', catalog: null } : { status: 'ready', catalog: null },
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
          if (!controller.signal.aborted) setState({ status: 'ready', catalog: candidate })
        })
        .catch(() => {
          if (!controller.signal.aborted) setState({ status: 'ready', catalog: null })
        })
    })
    return () => controller.abort()
  }, [enabled])

  return state
}
