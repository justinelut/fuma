import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PermissionDecision } from '@core/fuma'
import { getErrorMessage } from '@core/utils/errorMessage'
import type { FumaScopedShellReadyContext } from '../FumaScopedShell'
import { McpScopedHttpClient } from './client'
import {
  McpScopedConnectorPanel,
  type ScopedMcpConnectorView,
  type ScopedMcpCreateIntent,
} from './McpScopedConnectorPanel'

function allowsWrite(
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

export function McpScopedRouteContent({
  shell,
  permissionDecisions,
}: Readonly<{
  shell: FumaScopedShellReadyContext
  permissionDecisions: readonly PermissionDecision[]
}>): ReactNode {
  const { organizationId, workspaceId, siteId } = shell.resolution.selection
  const client = useMemo(() => new McpScopedHttpClient({
    organizationId,
    workspaceId,
    siteId,
  }), [organizationId, siteId, workspaceId])
  const [state, setState] = useState<Readonly<{
    scopeKey: string
    connectors: readonly ScopedMcpConnectorView[] | null
    error: string | null
  }> | null>(null)
  const scopeKey = `${organizationId}\u0000${workspaceId}\u0000${siteId}`
  const selected = shell.profileRelativeSubpath === '/admin/settings'
  const allowed = shell.routeAccess.kind === 'allowed'
    && shell.routeAccess.route.id === 'route.settings'
    && shell.resolution.profile.capabilities.some(({ id }) => id === 'site.settings')

  async function refresh(): Promise<void> {
    try {
      const connectors = await client.list()
      setState(Object.freeze({ scopeKey, connectors, error: null }))
    } catch (error) {
      setState(Object.freeze({
        scopeKey,
        connectors: null,
        error: getErrorMessage(error, 'Site MCP connectors could not be loaded.'),
      }))
    }
  }

  useEffect(() => {
    if (!selected || !allowed) return
    let active = true
    void client.list().then(
      (connectors) => {
        if (active) setState(Object.freeze({ scopeKey, connectors, error: null }))
      },
      (error) => {
        if (active) setState(Object.freeze({
          scopeKey,
          connectors: null,
          error: getErrorMessage(error, 'Site MCP connectors could not be loaded.'),
        }))
      },
    )
    return () => { active = false }
  }, [allowed, client, scopeKey, selected])

  if (!selected || !allowed) return null
  if (!state || state.scopeKey !== scopeKey) {
    return <p className="text-sm text-muted-foreground" role="status">Loading site MCP connectors…</p>
  }
  if (state.error || !state.connectors) {
    return <p className="text-sm text-destructive" role="alert">{state.error ?? 'Site MCP connectors could not be loaded.'}</p>
  }
  const canWrite = allowsWrite(permissionDecisions, shell)
  const create = async (intent: ScopedMcpCreateIntent): Promise<Readonly<{ token: string }>> => {
    if (!canWrite) throw new Error('Site settings write authority is required.')
    const result = await client.create(intent)
    await refresh()
    return result
  }
  const revoke = async (connectorId: string): Promise<void> => {
    if (!canWrite) throw new Error('Site settings write authority is required.')
    await client.revoke(connectorId)
    await refresh()
  }
  return (
    <div className="rounded-md border border-border bg-card p-6" data-testid="mcp-scoped-route-content">
      <McpScopedConnectorPanel
        siteId={siteId}
        connectors={state.connectors}
        onCreate={create}
        onRevoke={revoke}
      />
    </div>
  )
}
