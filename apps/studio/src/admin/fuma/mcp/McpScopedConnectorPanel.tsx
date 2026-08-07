import { useState, type FormEvent } from 'react'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@admin/fuma/ui/button'
import { Input } from '@admin/fuma/ui/input'

export type ScopedMcpCapability = 'site.read' | 'site.mutate' | 'site.publish' | 'component.read' | 'component.create-source' | 'component.install' | 'component.mutate' | 'component.confirm' | 'component.publish'
export interface ScopedMcpConnectorView { connectorId: string; label: string; siteId: string; ownerGeneration: number; capabilities: readonly ScopedMcpCapability[]; state: 'active' | 'revoked' | 'transferring'; expiresAt: string; requestsPerMinute: Readonly<Record<'read' | 'mutate' | 'publish', number>> }
export interface ScopedMcpCreateIntent { label: string; capabilities: readonly ScopedMcpCapability[]; expiresAt: string }

const OPTIONS: readonly Readonly<{ id: ScopedMcpCapability; label: string; detail: string }>[] = [
  { id: 'site.read', label: 'Read', detail: 'Inspect only this site and its content.' },
  { id: 'site.mutate', label: 'Mutate drafts', detail: 'Edit the exact site draft through the live editor bridge.' },
  { id: 'site.publish', label: 'Publish', detail: 'Requires an explicit confirmation and current step-up for every publish.' },
  { id: 'component.read', label: 'Read components', detail: 'Inspect starter, private, installed, and reviewed component definitions.' },
  { id: 'component.create-source', label: 'Create source drafts', detail: 'Draft and isolated-validate restricted React/Tailwind source.' },
  { id: 'component.install', label: 'Install and upgrade components', detail: 'Install exact reviewed pins and create rollback evidence.' },
  { id: 'component.mutate', label: 'Author components', detail: 'Create declarative versions, variants, and usage records.' },
  { id: 'component.confirm', label: 'Confirm executable artifacts', detail: 'Confirm exact validated bytes and disclosed permissions.' },
  { id: 'component.publish', label: 'Publish component sites', detail: 'Validate every component pin, then require explicit step-up to publish.' },
]

export function McpScopedConnectorPanel({ siteId, connectors, onCreate, onRevoke }: Readonly<{ siteId: string; connectors: readonly ScopedMcpConnectorView[]; onCreate(intent: ScopedMcpCreateIntent): Promise<Readonly<{ token: string }>>; onRevoke(connectorId: string): Promise<void> }>) {
  const [label, setLabel] = useState('')
  const [selected, setSelected] = useState<Set<ScopedMcpCapability>>(() => new Set(['site.read']))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); setCreatedToken(null); try { const created = await onCreate({ label, capabilities: [...selected], expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString() }); setCreatedToken(created.token); setLabel(''); setSelected(new Set(['site.read'])) } catch (cause) { setError(getErrorMessage(cause, 'Connector creation failed.')) } finally { setBusy(false) } }
  return <section className="grid gap-4" aria-labelledby="scoped-mcp-title">
    <header className="flex items-start justify-between gap-3 [&_p]:text-muted-foreground"><div><h2 id="scoped-mcp-title">Site MCP connectors</h2><p>Tokens are site-bound, shown once, hashed at rest, expiring, and immediately revocable.</p></div><span className="rounded-md border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground">{siteId}</span></header>
    <form className="grid gap-3 p-3 rounded-md border border-border bg-card" onSubmit={(event) => void submit(event)}><label className="grid gap-1"><span>Connector label</span><Input value={label} onChange={(event) => setLabel(event.currentTarget.value)} required placeholder="Deployment assistant" /></label><fieldset className="m-0 grid gap-1 border-0 p-0 [&_legend]:mb-1 [&_legend]:font-semibold"><legend>Exact capabilities</legend>{OPTIONS.map((option) => <label key={option.id} className="flex items-start gap-1 rounded-md bg-muted p-1 [&_span]:grid [&_span]:gap-0.5 [&_small]:text-muted-foreground"><input type="checkbox" checked={selected.has(option.id)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(option.id)) next.delete(option.id); else next.add(option.id); return next })} /><span><strong>{option.label}</strong><small>{option.detail}</small></span></label>)}</fieldset>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" variant="default" size="sm" disabled={busy || !label.trim() || selected.size === 0}><span>{busy ? 'Creating…' : 'Create scoped connector'}</span></Button></form>
    {createdToken && <div className="grid gap-1 rounded-md border border-border bg-muted p-3 [&_code]:break-all [&_code]:font-mono" role="status"><strong>Copy this token now. It will not be shown again.</strong><code>{createdToken}</code><Button type="button" variant="secondary" size="sm" onClick={() => void navigator.clipboard.writeText(createdToken)}><span>Copy token</span></Button></div>}
    <div className="grid gap-1">{connectors.length === 0 ? <p className="text-sm text-muted-foreground">No connector is bound to this site.</p> : connectors.map((connector) => <article className="grid gap-1 [&_p]:text-muted-foreground [&_small]:text-muted-foreground" key={connector.connectorId}><div><strong>{connector.label}</strong><p>{connector.capabilities.join(' · ')} · generation {connector.ownerGeneration}</p><small>{connector.state === 'active' ? `Expires ${new Date(connector.expiresAt).toLocaleDateString()}` : connector.state}</small></div><Button type="button" variant="secondary" size="sm" disabled={connector.state !== 'active'} onClick={() => void onRevoke(connector.connectorId)}><span>{connector.state === 'revoked' ? 'Revoked' : 'Revoke'}</span></Button></article>)}</div>
  </section>
}
