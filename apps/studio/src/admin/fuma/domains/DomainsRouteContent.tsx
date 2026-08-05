import { useMemo } from 'react'
import type { PermissionDecision } from '@core/fuma'
import type { FumaScopedShellReadyContext } from '../FumaScopedShell'
import { CloudflareDomainsHttpClient } from './client'
import { DomainsWorkspace } from './DomainsWorkspace'
import { createRegistrarHttpClient } from '../registrar'
import { createDomainOperationsClient } from '../domainOperations/client'

function canWrite(
  decisions: readonly PermissionDecision[],
  selection: FumaScopedShellReadyContext['resolution']['selection'],
): boolean {
  return decisions.some((decision) => decision.permissionId === 'site.settings.write'
    && decision.decision === 'allow'
    && decision.scope.kind === 'site'
    && decision.scope.organizationId === selection.organizationId
    && decision.scope.workspaceId === selection.workspaceId
    && decision.scope.siteId === selection.siteId)
}

export function DomainsRouteContent({ shell, permissionDecisions, client: providedClient }: Readonly<{
  shell: FumaScopedShellReadyContext
  permissionDecisions: readonly PermissionDecision[]
  client?: Pick<CloudflareDomainsHttpClient, 'list' | 'create' | 'reconcile' | 'cutover' | 'rollback' | 'remove'>
}>) {
  const selection = shell.resolution.selection
  const client = useMemo(() => providedClient ?? new CloudflareDomainsHttpClient({
    organizationId: selection.organizationId,
    workspaceId: selection.workspaceId,
    siteId: selection.siteId,
  }), [providedClient, selection.organizationId, selection.siteId, selection.workspaceId])
  const registrarClient = useMemo(() => createRegistrarHttpClient(
    `/api/fuma/organizations/${encodeURIComponent(selection.organizationId)}`
      + `/workspaces/${encodeURIComponent(selection.workspaceId)}`
      + `/sites/${encodeURIComponent(selection.siteId)}`,
  ), [selection.organizationId, selection.siteId, selection.workspaceId])
  const operationsClient = useMemo(() => createDomainOperationsClient(
    `/api/fuma/organizations/${encodeURIComponent(selection.organizationId)}`
      + `/workspaces/${encodeURIComponent(selection.workspaceId)}`
      + `/sites/${encodeURIComponent(selection.siteId)}`,
  ), [selection.organizationId, selection.siteId, selection.workspaceId])
  const selected = shell.routeAccess.kind === 'allowed'
    && shell.routeAccess.route.id === 'route.domains'
    && shell.resolution.profile.capabilities.some(({ id }) => id === 'site.settings')
  if (!selected) return null
  return <div data-testid="domains-route-content"><DomainsWorkspace client={client} registrarClient={registrarClient} operationsClient={operationsClient} canWrite={canWrite(permissionDecisions, selection)} /></div>
}
