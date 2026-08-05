import { useCallback, useEffect, useMemo, useState } from 'react'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import { Button } from '@ui/components/Button'
import { DataTable } from '@ui/components/DataTable'
import styles from './PlatformAdminWorkspace.module.css'

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

export default function PlatformAdminWorkspace() {
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

  return <main className={styles.root}>
    <a className={styles.skipLink} href="#platform-content">Skip to platform content</a>
    <header className={styles.header}><div><p className={styles.eyebrow}>Protected owner · Fuma platform</p><h1>Platform administration</h1><p>Operate customers, economics, releases, domains, jobs, AI, and immutable pricing from one authority.</p></div><Button variant="secondary" disabled={busy} onClick={() => void load(view)}>Refresh</Button></header>
    <nav className={styles.tabs} aria-label="Platform administration sections"><a href="#inventory">Inventory</a><a href="#pricing">Pricing</a><a href="#audit">Audit</a><a href="/admin/dashboard">Customer dashboard</a></nav>
    <p className={styles.status} role="status" aria-live="polite">{status}</p>
    <section id="platform-content" className={styles.layout}>
      <article className={styles.panel} id="inventory"><div className={styles.panelHeader}><div><p className={styles.kicker}>Operations</p><h2>Platform inventory</h2></div><label>View<select value={view} onChange={(event) => setView(event.target.value as typeof view)}>{VIEWS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div>
        {page?.rows.length ? <div className={styles.table}><DataTable><caption>{page.total} redacted records</caption><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{page.rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{String(row[column] ?? '—')}</td>)}</tr>)}</tbody></DataTable></div> : <p className={styles.empty}>No records in this view.</p>}
      </article>
      <aside className={styles.panel} id="pricing"><p className={styles.kicker}>Commercial authority</p><h2>Price books</h2><p className={styles.muted}>{entitlements ? `${entitlements.priceBooks.length} books · ${entitlements.offers.length} offers · ${entitlements.recentEvents.length} recent events` : 'Reviewed KES economics must be configured before pricing controls activate.'}</p><label className={styles.draft}>Strict price-book draft JSON<textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={12} spellCheck={false} placeholder='{"version":"…","currency":"KES","effectiveAt":"…","plans":[…]}' /></label><Button variant="primary" disabled={busy || !draft.trim() || !entitlements} onClick={() => void publish()}>Publish price book</Button></aside>
    </section>
    <section className={styles.panel} id="audit"><p className={styles.kicker}>Evidence</p><h2>Recent entitlement events</h2>{entitlements?.recentEvents.length ? <pre>{JSON.stringify(entitlements.recentEvents, null, 2)}</pre> : <p className={styles.empty}>No entitlement administration events yet.</p>}</section>
  </main>
}
