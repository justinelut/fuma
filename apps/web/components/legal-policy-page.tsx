import { Breadcrumbs } from '@/components/breadcrumbs'
import { EditorialContent } from '@/components/editorial-content'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { EditorialEntry } from '@/lib/editorial'
import { jsonLd } from '@/lib/seo'

export function LegalPolicyPage({ entry }: Readonly<{ entry: EditorialEntry }>) {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: entry.meta.title,
      description: entry.meta.description,
      datePublished: entry.meta.publishedAt,
      dateModified: entry.meta.updatedAt,
      inLanguage: 'en-KE',
      isPartOf: { '@type': 'WebSite', name: 'Fuma', url: 'https://fuma.co.ke' },
    })} />
    <Breadcrumbs items={[
      { label: 'Trust centre', href: '/trust' },
      { label: entry.meta.title, href: entry.canonicalPath },
    ]} />
    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Public website notice · {entry.meta.category}</p>
    <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl">{entry.meta.title}</h1>
    <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">{entry.meta.description}</p>
    <dl className="my-8 grid gap-4 rounded-xl border bg-card p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div><dt className="font-semibold">Version</dt><dd className="mt-1 text-muted-foreground">{entry.meta.version}</dd></div>
      <div><dt className="font-semibold">Effective</dt><dd className="mt-1 text-muted-foreground"><time dateTime={entry.meta.publishedAt}>{entry.meta.publishedAt.slice(0, 10)}</time></dd></div>
      <div><dt className="font-semibold">Review owner</dt><dd className="mt-1 text-muted-foreground">{entry.meta.owner}</dd></div>
      <div><dt className="font-semibold">Review due</dt><dd className="mt-1 text-muted-foreground"><time dateTime={entry.meta.reviewAt}>{entry.meta.reviewAt.slice(0, 10)}</time></dd></div>
    </dl>
    <Card className="mb-10 border" aria-labelledby="approval-state">
      <CardHeader><CardTitle id="approval-state">Approval state</CardTitle></CardHeader>
      <CardContent><p className="leading-7 text-muted-foreground">This is the current repository-published public website notice. Independent legal and privacy approval for production launch is pending; publication is not a compliance, certification, or regulatory claim.</p></CardContent>
    </Card>
    <EditorialContent entry={entry} />
    <nav aria-label="Policy resources" className="mt-12 flex flex-wrap gap-x-6 gap-y-3 border-t pt-6">
      <a className="min-h-11 py-2 underline underline-offset-4" href="/legal/history">Policy history</a>
      <a className="min-h-11 py-2 underline underline-offset-4" href="/trust">Trust centre</a>
      <a className="min-h-11 py-2 underline underline-offset-4" href="/contact">Contact</a>
    </nav>
  </>
}
