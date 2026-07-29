import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireInternalConsoleAuthority } from '@/lib/host'
import { consoleViewLabels, consoleViews, queryConsoleDemo } from './console-model'

type Search = Readonly<Record<string, string | string[] | undefined>>
function one(value: string | string[] | undefined): string | undefined { return typeof value === 'string' ? value : undefined }
function href(view: string, filter?: string, cursor?: string): string {
  const query = new URLSearchParams({ view, limit: '5' })
  if (filter) query.set('filter', filter)
  if (cursor) query.set('cursor', cursor)
  return `/internal?${query.toString()}`
}
function shown(value: string | number | boolean | null): string {
  if (value === null) return '—'
  if (typeof value === 'number' && /Minor$/.test(String(value))) return String(value)
  return String(value)
}

const lifecycle = [
  ['Destination', 'Provisional organization, workspace and site revalidated'],
  ['Offer', 'Immutable annual KES offer · setup KES 650.00 separate from recurring KES 2,400.00'],
  ['Gates', 'Finite quota accepted · cost model complete · 71.66% recurring gross margin'],
  ['Acceptance', 'Exact offer version 1 accepted'],
  ['Payment', 'Separate setup and recurring obligations provider-verified and paid'],
  ['Contract', 'Contract activated from immutable offer evidence'],
  ['Handoff', 'paid-transfer-pending · ownership unchanged · retry remains with FUMA-074'],
] as const

const seams = [
  { owner: 'FUMA-068', title: 'Artifact review', state: 'Mounted from the existing bounded review contribution', href: '/internal/plugin-review' },
  { owner: 'FUMA-072', title: 'Support and moderation', state: 'Empty by default', href: '/internal/support' },
  { owner: 'FUMA-073', title: 'Expert moderation', state: 'Empty by default', href: '/internal/experts' },
  { owner: 'FUMA-074', title: 'Transfer recovery', state: 'Empty by default', href: '/internal/transfers' },
] as const

export default async function PlatformConsolePage({ searchParams }: Readonly<{ searchParams: Promise<Search> }>) {
  const authority = await requireInternalConsoleAuthority()
  const search = await searchParams
  const requestedView = one(search.view)
  const view = consoleViews.find((value) => value === requestedView) ?? 'clients'
  const filter = one(search.filter)?.trim() || undefined
  const cursor = one(search.cursor)
  const page = await queryConsoleDemo({ view, ...(filter ? { filter } : {}), ...(cursor ? { cursor } : {}), limit: 5 }, authority)
  const columns = [...new Set(page.rows.flatMap((row) => Object.keys(row)))]

  return <main className="mx-auto max-w-7xl p-6">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm text-muted-foreground">Admin host · hosted staff authority · redacted server projection</p><h1 className="text-3xl font-semibold">Platform console</h1></div>
      <p className="rounded border bg-card px-3 py-2 text-xs">Read actor: {authority.actorId}</p>
    </div>

    <section aria-labelledby="managed-demo" className="mb-8 rounded-lg border bg-card p-5">
      <div className="mb-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">FUMA-071 acceptance demo · read-only evidence</p><h2 id="managed-demo" className="text-xl font-semibold">Kijani Law managed-client lifecycle</h2></div>
      <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{lifecycle.map(([title, detail], index) => <li className="rounded border p-3" key={title}><p className="text-xs text-muted-foreground">{index + 1}. {title}</p><p className="mt-1 text-sm font-medium">{detail}</p></li>)}</ol>
      <p className="mt-4 text-sm text-muted-foreground">The protected <strong>platform-internal</strong> grant remains non-transferable, has KES 0 revenue and visible shadow cost, and never enters checkout, contract or handoff.</p>
    </section>

    <section aria-labelledby="domain-views">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 id="domain-views" className="text-xl font-semibold">Searchable domain views</h2><p className="text-sm text-muted-foreground">{page.total} redacted result{page.total === 1 ? '' : 's'}</p></div>
      <nav aria-label="Console domain views" className="mb-4 flex flex-wrap gap-2">{consoleViews.map((item) => <Link className={`rounded border px-3 py-1.5 text-sm ${item === view ? 'bg-primary text-primary-foreground' : 'bg-card'}`} href={href(item) as never} key={item}>{consoleViewLabels[item]}</Link>)}</nav>
      <form action="/internal" className="mb-4 flex flex-wrap gap-2" method="get"><input name="view" type="hidden" value={view}/><input name="limit" type="hidden" value="5"/><label className="sr-only" htmlFor="console-filter">Search current view</label><input className="h-10 min-w-72 rounded border bg-background px-3 text-sm" defaultValue={filter} id="console-filter" maxLength={100} name="filter" placeholder={`Search ${consoleViewLabels[view].toLowerCase()}`}/><button className="h-10 rounded bg-primary px-4 text-sm font-medium text-primary-foreground" type="submit">Search</button><Link className="h-10 rounded border px-4 py-2 text-sm" href={href(view) as never}>Clear</Link></form>
      <div className="overflow-x-auto rounded-lg border bg-card"><table className="w-full min-w-max text-left text-sm"><thead className="border-b bg-muted/50"><tr>{columns.map((column) => <th className="px-3 py-2 font-medium" key={column}>{column}</th>)}</tr></thead><tbody>{page.rows.map((row, index) => <tr className="border-b last:border-0" key={`${view}-${index}`}>{columns.map((column) => <td className="max-w-80 truncate px-3 py-2" key={column} title={shown(row[column] ?? null)}>{shown(row[column] ?? null)}</td>)}</tr>)}{page.rows.length === 0 ? <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={Math.max(1, columns.length)}>No matching redacted rows.</td></tr> : null}</tbody></table></div>
      {page.nextCursor ? <div className="mt-3"><Link className="rounded border bg-card px-3 py-2 text-sm" href={href(view, filter, page.nextCursor) as never}>Next page</Link></div> : null}
    </section>

    <section className="mt-8" aria-labelledby="contributions"><h2 id="contributions" className="mb-3 text-xl font-semibold">Bounded delegated actions</h2><div className="grid gap-3 md:grid-cols-2">{seams.map((item) => <Card key={item.owner}><CardHeader><CardTitle>{item.title}</CardTitle><CardDescription>{item.owner} · {item.state}</CardDescription></CardHeader><CardContent><Link className="text-sm underline" href={item.href}>Inspect contribution boundary</Link></CardContent></Card>)}</div><p className="mt-3 text-sm text-muted-foreground">The console never writes domain tables. Offer issuance delegates to the canonical entitlement service; review decisions delegate to FUMA-068. Every action requires its own capability and fresh step-up. Future seams register nothing until their owning tickets compose them.</p></section>
  </main>
}
