import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PermissionDecision } from '@core/fuma'
import { getErrorMessage } from '@core/utils/errorMessage'
import type { FumaScopedShellReadyContext } from '../FumaScopedShell'
import { QuotaSelfServiceHttpClient } from './client'
import type { QuotaSelfServiceWire } from './contracts'
import { UsageSurface } from './UsageSurface'
import styles from './UsageSurface.module.css'

function allowsSiteWrite(
  decisions: readonly PermissionDecision[],
  shell: FumaScopedShellReadyContext,
): boolean {
  const selection = shell.resolution.selection
  return decisions.some((decision) => (
    decision.permissionId === 'site.settings.write'
    && decision.decision === 'allow'
    && decision.scope.kind === 'site'
    && decision.scope.organizationId === selection.organizationId
    && decision.scope.workspaceId === selection.workspaceId
    && decision.scope.siteId === selection.siteId
  ))
}

export function QuotaSelfServiceRouteContent({
  shell,
  permissionDecisions,
  customerBilling,
}: Readonly<{
  shell: FumaScopedShellReadyContext
  permissionDecisions: readonly PermissionDecision[]
  customerBilling: ReactNode
}>): ReactNode {
  const { organizationId, workspaceId, siteId } = shell.resolution.selection
  const client = useMemo(() => new QuotaSelfServiceHttpClient({
    organizationId,
    workspaceId,
    siteId,
  }), [organizationId, workspaceId, siteId])
  const [loaded, setLoaded] = useState<Readonly<{
    scopeKey: string
    model: QuotaSelfServiceWire | null
    error: string | null
  }> | null>(null)
  const scopeKey = `${organizationId}\u0000${workspaceId}\u0000${siteId}`
  const path = shell.profileRelativeSubpath
  const selected = path === '/admin/settings/usage' || path === '/admin/settings/billing'
  const allowed = shell.routeAccess.kind === 'allowed'
    && shell.routeAccess.route.id === 'route.settings'
    && shell.resolution.profile.capabilities.some(({ id }) => id === 'site.settings')

  useEffect(() => {
    if (!selected || !allowed) return
    let active = true
    void client.view().then(
      (value) => {
        if (active) setLoaded(Object.freeze({ scopeKey, model: value, error: null }))
      },
      (caught) => {
        if (active) setLoaded(Object.freeze({
          scopeKey,
          model: null,
          error: getErrorMessage(caught, 'Usage could not be loaded.'),
        }))
      },
    )
    return () => { active = false }
  }, [allowed, client, scopeKey, selected])

  if (!selected || !allowed) return null
  if (!loaded || loaded.scopeKey !== scopeKey) {
    return <p className={styles.status} role="status">Loading account usage…</p>
  }
  if (loaded.error) return <p className={styles.error} role="alert">{loaded.error}</p>
  if (!loaded.model) return <p className={styles.status} role="status">Loading account usage…</p>
  const model = loaded.model
  const canWrite = allowsSiteWrite(permissionDecisions, shell)
  if (path === '/admin/settings/usage' || model.billing === null) {
    return (
      <div data-testid="quota-self-service-route-content">
        <UsageSurface model={model} client={client} canWrite={canWrite} mode="usage" />
      </div>
    )
  }
  return (
    <div data-testid="quota-self-service-route-content">
      <UsageSurface model={model} client={client} canWrite={canWrite} mode="account" />
      {customerBilling}
    </div>
  )
}
