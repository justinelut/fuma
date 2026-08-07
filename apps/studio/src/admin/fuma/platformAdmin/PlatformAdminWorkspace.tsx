import { useCallback, useEffect, useMemo, useState } from 'react'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import { Button } from '@admin/fuma/ui/button'
import { DataTable } from '@ui/components/DataTable'
import { PublicMarketingAnalyticsRouteContent, PUBLIC_MARKETING_ANALYTICS_ADMIN_PATH } from '../publicAnalytics'

const Scalar = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])
const ConsoleEnvelope = Type.Object({ result: Type.Object({
  view: Type.String(), rows: Type.Array(Type.Record(Type.String(), Scalar)),
  nextCursor: Type.Union([Type.String(), Type.Null()]), total: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false }) }, { additionalProperties: false })
const EntitlementEnvelope = Type.Object({ result: Type.Object({
  generatedAt: Type.String(), priceBooks: Type.Array(Type.Unknown()), offers: Type.Array(Type.Unknown()),
  internalGrant: Type.Unknown(), adjustments: Type.Array(Type.Unknown()), recentEvents: Type.Array(Type.Unknown()),
}, { additionalProperties: false }) }, { additionalProperties: false })

type ConsolePage = typeof ConsoleEnvelope.static['result']
type EntitlementWorkspace = typeof EntitlementEnvelope.static['result']
const VIEWS = ['clients','users','organizations','workspaces','sites','plans','offers','contracts','invoices','economics','usage','domains','email','jobs','releases','ai','audit'] as const

async function json<T>(response: Response, schema: Parameters<typeof safeParseValue>[0]): Promise<T> {
  const candidate: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof candidate === 'object' && candidate && 'error' in candidate ? String(candidate.error) : 'Platform request failed')
  const parsed = safeParseValue(schema, candidate)
  if (!parsed.ok) throw new Error('Platform response failed validation')
  return parsed.value as T
}

export default function PlatformAdminWorkspace({ pathname = '/admin/internal' }: Readonly<{ pathname?: string }>) {
  const [view, setView] = useState<(typeof VIEWS)[number]>('clients')
  const [page, setPage] = useState<ConsolePage | null>(null)
  const [entitlements, setEntitlements] = useState<EntitlementWorkspace | null>(null)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('Loading protected platform authority…')
  const [busy, setBusy] = useState(false)
  const columns = useMemo(() => [...new Set((page?.rows ?? []).flatMap((row) => Object.keys(row)))], [page])

  const load = useCallback(async (nextView: (typeof VIEWS)[number]) => {
    setBusy(true)
    try {
      const consoleResponse = await fetch(`/api/fuma/internal/platform-console?view=${encodeURIComponent(nextView)}&limit=50`, { credentials: 'include' })
      setPage(await json<{ result: ConsolePage }>(consoleResponse, ConsoleEnvelope).then((value) => value.result))
      const entitlementResponse = await fetch('/api/fuma/internal/entitlements', { credentials: 'include' })
      if (entitlementResponse.ok) setEntitlements(await json<{ result: EntitlementWorkspace }>(entitlementResponse, EntitlementEnvelope).then((value) => value.result))
      else setEntitlements(null)
      setStatus('Protected platform data is current.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Platform administration is unavailable.')
    } finally { setBusy(false) }
  }, [])

  useEffect(() => {
    queueMicrotask(() => { void load(view) })
  }, [load, view])

  async function publish() {
    setBusy(true)
    try {
      const command = { kind: 'publish-price-book', requestId: crypto.randomUUID(), draft: JSON.parse(draft) }
      const response = await fetch('/api/fuma/internal/entitlements', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command),
      })
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? 'Price book publication failed')
      setDraft('')
      setStatus('Price book published and audited.')
      await load(view)
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Price book publication failed.') }
    finally { setBusy(false) }
  }

  if (pathname === PUBLIC_MARKETING_ANALYTICS_ADMIN_PATH) {
    return <main className="grid min-h-screen gap-10 bg-background p-6 text-foreground sm:p-10"><nav className="flex gap-1 overflow-auto pb-1 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:rounded-md [&_a]:border [&_a]:border-border [&_a]:px-4 [&_a]:py-2 [&_a:hover]:border-primary [&_a:focus-visible]:ring-2 [&_a:focus-visible]:ring-ring [&_a:focus-visible]:outline-none" aria-label="Platform administration sections"><a href="/admin/internal">Platform console</a><a href="/admin/dashboard">Customer dashboard</a></nav><PublicMarketingAnalyticsRouteContent pathname={pathname} /></main>
  }

  return <main className="grid min-h-screen gap-10 bg-background p-6 text-foreground sm:p-10">
    <a className="fixed left-3 top-3 z-20 -translate-y-[200%] rounded-md bg-card p-3 focus:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" href="#platform-content">Skip to platform content</a>
    <header className="flex flex-col items-start justify-between gap-6 border-b border-border pb-10 sm:flex-row sm:items-end [&_h1]:m-0 [&_h1]:text-4xl [&_h1]:font-medium [&_h1]:leading-tight [&_h1]:tracking-tight [&>div]:grid [&>div]:max-w-[58rem] [&>div]:gap-2 [&>div>p:last-child]:leading-relaxed [&>div>p:last-child]:text-muted-foreground"><div><p className="text-xs font-bold uppercase tracking-widest text-primary">Protected owner · Fuma platform</p><h1>Platform administration</h1><p>Operate customers, economics, releases, domains, jobs, AI, and immutable pricing from one authority.</p></div><Button variant="secondary" disabled={busy} onClick={() => void load(view)}>Refresh</Button></header>
    <nav className="flex gap-1 overflow-auto pb-1 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:rounded-md [&_a]:border [&_a]:border-border [&_a]:px-4 [&_a]:py-2 [&_a:hover]:border-primary [&_a:focus-visible]:ring-2 [&_a:focus-visible]:ring-ring [&_a:focus-visible]:outline-none" aria-label="Platform administration sections"><a href="#inventory">Inventory</a><a href="#pricing">Pricing</a><a href="/admin/internal/marketing-analytics">Acquisition analytics</a><a href="#audit">Audit</a><a href="/admin/dashboard">Customer dashboard</a></nav>
    <p className="m-0 border-l-[3px] border-primary bg-muted px-4 py-3" role="status" aria-live="polite">{status}</p>
    <section id="platform-content" className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(20rem,0.8fr)]">
      <article className="grid min-w-0 gap-4 rounded-md border border-border bg-card p-6 sm:p-10 [&_h2]:m-0 [&_p]:m-0 [&_label]:grid [&_label]:gap-1 [&_label]:text-sm [&_label]:font-semibold [&_label]:text-muted-foreground [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-transparent [&_select]:p-3 [&_textarea]:resize-y [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-transparent [&_textarea]:p-3 [&_textarea]:font-mono [&_textarea]:text-xs [&_textarea]:leading-relaxed [&_select:focus-visible]:ring-2 [&_select:focus-visible]:ring-ring [&_select:focus-visible]:outline-none [&_textarea:focus-visible]:ring-2 [&_textarea:focus-visible]:ring-ring [&_textarea:focus-visible]:outline-none [&_pre]:m-0 [&_pre]:max-h-[30rem] [&_pre]:overflow-auto [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:text-xs [&_pre]:leading-relaxed" id="inventory"><div className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-widest text-primary">Operations</p><h2>Platform inventory</h2></div><label>View<select value={view} onChange={(event) => setView(event.target.value as typeof view)}>{VIEWS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div>
        {page?.rows.length ? <div className="overflow-auto [&_table]:min-w-[46rem] [&_td]:max-w-[22rem] [&_td]:truncate"><DataTable><caption>{page.total} redacted records</caption><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{page.rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{String(row[column] ?? '—')}</td>)}</tr>)}</tbody></DataTable></div> : <p className="rounded-md border border-dashed border-border p-6 text-center leading-relaxed text-muted-foreground">No records in this view.</p>}
      </article>
      <aside className="grid min-w-0 gap-4 rounded-md border border-border bg-card p-6 sm:p-10 [&_h2]:m-0 [&_p]:m-0 [&_label]:grid [&_label]:gap-1 [&_label]:text-sm [&_label]:font-semibold [&_label]:text-muted-foreground [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-transparent [&_select]:p-3 [&_textarea]:resize-y [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-transparent [&_textarea]:p-3 [&_textarea]:font-mono [&_textarea]:text-xs [&_textarea]:leading-relaxed [&_select:focus-visible]:ring-2 [&_select:focus-visible]:ring-ring [&_select:focus-visible]:outline-none [&_textarea:focus-visible]:ring-2 [&_textarea:focus-visible]:ring-ring [&_textarea:focus-visible]:outline-none [&_pre]:m-0 [&_pre]:max-h-[30rem] [&_pre]:overflow-auto [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:text-xs [&_pre]:leading-relaxed" id="pricing"><p className="text-xs font-bold uppercase tracking-widest text-primary">Commercial authority</p><h2>Price books</h2><p className="leading-relaxed text-muted-foreground">{entitlements ? `${entitlements.priceBooks.length} books · ${entitlements.offers.length} offers · ${entitlements.recentEvents.length} recent events` : 'Reviewed KES economics must be configured before pricing controls activate.'}</p><label className="grid gap-1 text-sm font-semibold text-muted-foreground">Strict price-book draft JSON<textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={12} spellCheck={false} placeholder='{"version":"…","currency":"KES","effectiveAt":"…","plans":[…]}' /></label><Button variant="default" disabled={busy || !draft.trim() || !entitlements} onClick={() => void publish()}>Publish price book</Button></aside>
    </section>
    <section className="grid min-w-0 gap-4 rounded-md border border-border bg-card p-6 sm:p-10 [&_h2]:m-0 [&_p]:m-0 [&_label]:grid [&_label]:gap-1 [&_label]:text-sm [&_label]:font-semibold [&_label]:text-muted-foreground [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-transparent [&_select]:p-3 [&_textarea]:resize-y [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-transparent [&_textarea]:p-3 [&_textarea]:font-mono [&_textarea]:text-xs [&_textarea]:leading-relaxed [&_select:focus-visible]:ring-2 [&_select:focus-visible]:ring-ring [&_select:focus-visible]:outline-none [&_textarea:focus-visible]:ring-2 [&_textarea:focus-visible]:ring-ring [&_textarea:focus-visible]:outline-none [&_pre]:m-0 [&_pre]:max-h-[30rem] [&_pre]:overflow-auto [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:text-xs [&_pre]:leading-relaxed" id="audit"><p className="text-xs font-bold uppercase tracking-widest text-primary">Evidence</p><h2>Recent entitlement events</h2>{entitlements?.recentEvents.length ? <pre>{JSON.stringify(entitlements.recentEvents, null, 2)}</pre> : <p className="rounded-md border border-dashed border-border p-6 text-center leading-relaxed text-muted-foreground">No entitlement administration events yet.</p>}</section>
  </main>
}
