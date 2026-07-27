import { useMemo, type ReactNode } from 'react'
import type { PermissionDecision } from '@core/fuma'
import type { FumaScopedShellReadyContext } from '../FumaScopedShell'
import { PlatformCheckoutHttpClient } from './client'
import { PlatformCheckoutSurface } from './PlatformCheckoutSurface'

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

export function PlatformCheckoutRouteContent({
  shell,
  permissionDecisions,
  search,
}: Readonly<{
  shell: FumaScopedShellReadyContext
  permissionDecisions: readonly PermissionDecision[]
  search?: string
}>): ReactNode {
  const { organizationId, workspaceId, siteId } = shell.resolution.selection
  const client = useMemo(() => new PlatformCheckoutHttpClient({
    organizationId,
    workspaceId,
    siteId,
  }), [organizationId, siteId, workspaceId])
  if (
    shell.profileRelativeSubpath !== '/admin/settings/billing'
    || shell.routeAccess.kind !== 'allowed'
    || shell.routeAccess.route.id !== 'route.settings'
    || !shell.resolution.profile.capabilities.some(({ id }) => id === 'site.settings')
  ) return null

  const query = new URLSearchParams(
    search ?? (typeof window === 'undefined' ? '' : window.location.search),
  )
  return (
    <div data-testid="platform-checkout-route-content">
      <PlatformCheckoutSurface
        client={client}
        canCheckout={allowsSiteWrite(permissionDecisions, shell)}
        initialCheckoutId={query.get('checkout')}
        callbackReference={query.get('reference')}
      />
    </div>
  )
}
