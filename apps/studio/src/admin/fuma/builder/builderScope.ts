/**
 * Active builder scope.
 *
 * Instatic links between its own sections with fixed paths — `/admin/site`,
 * `/admin/media`, `/admin/content` and so on. Those links carry no tenant
 * scope, so once the hosted product hands the viewport over, the site being
 * designed has to be remembered somewhere the next navigation can read.
 *
 * Session storage is the right lifetime: it survives in-app navigation and a
 * reload of the same tab, and disappears when the tab does. It is a
 * convenience record only — every request re-derives authority from the staff
 * session, so a forged value grants nothing.
 */
import type { BuilderSessionScope } from '@core/fuma/builder/builderSessionClient'
import type { AccessibleContextCatalog } from '@core/fuma'

const STORAGE_KEY = 'fuma.builder.scope'

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    // Storage access throws in partitioned or blocked contexts.
    return null
  }
}

export function rememberBuilderScope(scope: BuilderSessionScope): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(scope))
  } catch {
    // A full or blocked store must never break the handoff.
  }
}

export function readRememberedBuilderScope(): BuilderSessionScope | null {
  const raw = storage()?.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { organizationId, workspaceId, siteId } = parsed as Record<string, unknown>
    if (typeof organizationId !== 'string' || !organizationId) return null
    if (typeof workspaceId !== 'string' || !workspaceId) return null
    if (typeof siteId !== 'string' || !siteId) return null
    return Object.freeze({ organizationId, workspaceId, siteId })
  } catch {
    return null
  }
}

/**
 * Scope for an Instatic section entered without a remembered choice.
 *
 * A remembered scope wins. Otherwise a single accessible active site is
 * unambiguous and is used; with several sites the caller has to send the
 * visitor back to the platform to pick one.
 */
export function resolveBuilderScope(
  catalog: AccessibleContextCatalog,
): BuilderSessionScope | null {
  const remembered = readRememberedBuilderScope()
  const active = catalog.sites.filter((site) => site.status === 'active')
  if (remembered && active.some((site) => (
    site.id === remembered.siteId
    && site.organizationId === remembered.organizationId
    && site.workspaceId === remembered.workspaceId
  ))) {
    return remembered
  }
  const only = active.length === 1 ? active[0] : undefined
  if (!only) return null
  return Object.freeze({
    organizationId: only.organizationId,
    workspaceId: only.workspaceId,
    siteId: only.id,
  })
}
