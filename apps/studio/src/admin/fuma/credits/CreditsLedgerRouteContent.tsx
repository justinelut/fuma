import { useEffect, useMemo, useState } from 'react'
import type { FumaScopedShellReadyContext } from '../FumaScopedShell'
import { AiCreditsHttpClient, type AiCreditsLedgerWire } from './client'
import { CreditsLedger } from './CreditsLedger'
import { AI_CREDITS_CAPABILITY_ID, AI_CREDITS_ROUTE_ID } from './registry'

export function CreditsLedgerRouteContent({ shell, client: providedClient }: Readonly<{
  shell: FumaScopedShellReadyContext
  client?: Pick<AiCreditsHttpClient, 'ledger'>
}>) {
  const { organizationId, workspaceId, siteId } = shell.resolution.selection
  const client = useMemo(
    () => providedClient ?? new AiCreditsHttpClient({ organizationId, workspaceId, siteId }),
    [organizationId, providedClient, siteId, workspaceId],
  )
  const scopeKey = `${organizationId}\u0000${workspaceId}\u0000${siteId}`
  const selected = shell.routeAccess.kind === 'allowed'
    && shell.routeAccess.route.id === AI_CREDITS_ROUTE_ID
    && shell.resolution.profile.capabilities.some(({ id }) => id === AI_CREDITS_CAPABILITY_ID)
  const [state, setState] = useState<Readonly<{ scopeKey: string; model: AiCreditsLedgerWire | null; error: string | null }> | null>(null)

  useEffect(() => {
    if (!selected) return
    let active = true
    void client.ledger().then(
      (model) => { if (active) setState(Object.freeze({ scopeKey, model, error: null })) },
      (_error) => { if (active) setState(Object.freeze({ scopeKey, model: null, error: 'AI credit ledger could not be loaded.' })) },
    )
    return () => { active = false }
  }, [client, scopeKey, selected])

  if (!selected) return null
  if (!state || state.scopeKey !== scopeKey) return <p className="m-10 text-sm text-muted-foreground" role="status">Loading AI credit ledger…</p>
  if (state.error || !state.model) return <p className="m-10 text-sm text-destructive" role="alert">{state.error ?? 'AI credit ledger could not be loaded.'}</p>
  return <div data-testid="credits-ledger-route-content"><CreditsLedger model={state.model} /></div>
}
