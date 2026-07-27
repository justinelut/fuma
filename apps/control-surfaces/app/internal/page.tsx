import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireControlRealm } from '@/lib/host'

const views = ['Users & organizations', 'Managed and provisional clients', 'Workspaces & sites', 'Plans, custom offers & contracts', 'Invoices, MRR, ARR & collections', 'Usage, quota, COGS & margin', 'Domains, email, jobs & releases', 'AI catalog & audit'] as const
const contributions = ['Plugin review — FUMA-068', 'Support/moderation — FUMA-072', 'Expert moderation — FUMA-073', 'Transfer recovery — FUMA-074'] as const

export default async function PlatformConsolePage() {
  await requireControlRealm('admin')
  return <main className="mx-auto max-w-7xl p-6"><div className="mb-6"><p className="text-sm text-muted-foreground">Internal authority only · mutations remain domain-service owned</p><h1 className="text-3xl font-semibold">Platform console</h1></div><section aria-labelledby="views" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><h2 id="views" className="sr-only">Searchable views</h2>{views.map((view) => <Card key={view}><CardHeader><CardTitle>{view}</CardTitle><CardDescription>Redacted, paginated read model</CardDescription></CardHeader><CardContent><span className="rounded bg-muted px-2 py-1 text-xs">Authority resolved server-side</span></CardContent></Card>)}</section><section className="mt-8"><h2 className="mb-3 text-xl font-semibold">Registered contributions</h2><ul className="grid gap-2 md:grid-cols-2">{contributions.map((item) => <li className="rounded border bg-card p-3" key={item}>{item}</li>)}</ul></section></main>
}
