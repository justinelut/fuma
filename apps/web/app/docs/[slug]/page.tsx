import type { Route } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { EditorialContent } from '@/components/editorial-content'
import { PageMain } from '@/components/site-shell'
import { getEditorial, readEditorial, resolveEditorialRedirect, type EditorialEntry } from '@/lib/editorial'
import { editorialMetadata, jsonLd } from '@/lib/seo'
import { articleStructuredData } from '@/lib/structured-data'

const COLLECTION = 'docs' as const

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function readingMinutes(body: string): number {
  return Math.max(1, Math.round(body.trim().split(/\s+/).length / 220))
}

function documentPath(slug: string): string {
  return `/docs/${slug}`
}

export async function generateStaticParams() {
  return (await readEditorial())
    .filter((entry) => entry.meta.collection === COLLECTION)
    .map((entry) => ({ slug: entry.meta.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entry = await getEditorial(COLLECTION, slug)

  if (entry) return editorialMetadata(entry, entry.canonicalPath, 'Documentation unavailable')

  try {
    return editorialMetadata(null, documentPath(slug), 'Documentation unavailable')
  } catch {
    // A malformed dynamic segment must remain a closed, noindex absence rather than
    // escaping the canonical-path contract while Next resolves the route to not-found.
    return editorialMetadata(null, '/docs', 'Documentation unavailable')
  }
}

function DocumentRecord({ entry }: Readonly<{ entry: EditorialEntry }>) {
  return <aside aria-labelledby="document-record-title" className="border-t border-line-soft pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-1">
    <h2 className="font-mono text-eyebrow uppercase text-muted-foreground" id="document-record-title">
      Document record
    </h2>
    <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 text-sm leading-6">
      <div className="col-span-2 border-b border-line-soft pb-5">
        <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Maintained by</dt>
        <dd className="mt-1.5">{entry.meta.owner}</dd>
      </div>
      <div>
        <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Version</dt>
        <dd className="mt-1.5 font-mono">{entry.meta.version}</dd>
      </div>
      <div>
        <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Reading time</dt>
        <dd className="mt-1.5">{readingMinutes(entry.body)} min</dd>
      </div>
      <div>
        <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Updated</dt>
        <dd className="mt-1.5"><time dateTime={entry.meta.updatedAt}>{formatDate(entry.meta.updatedAt)}</time></dd>
      </div>
      <div>
        <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Next review</dt>
        <dd className="mt-1.5"><time dateTime={entry.meta.reviewAt}>{formatDate(entry.meta.reviewAt)}</time></dd>
      </div>
    </dl>
  </aside>
}

function AdjacentReference({
  direction,
  entry,
}: Readonly<{
  direction: 'Previous' | 'Next'
  entry: EditorialEntry
}>) {
  return <Link
    className="group flex h-full flex-col gap-3 border-t border-line-soft py-7 first:border-t-0 sm:border-l sm:border-t-0 sm:px-7 sm:py-0 sm:first:border-l-0 sm:first:pl-0"
    href={entry.canonicalPath as Route}
  >
    <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">{direction} reference</span>
    <span className="max-w-[24ch] font-display text-display-md text-balance">{entry.meta.title}</span>
    <span className="mt-auto max-w-md text-sm leading-6 text-muted-foreground">{entry.meta.description}</span>
    <span className="inline-flex items-center gap-2 pt-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4">
      Open reference
      <span aria-hidden="true" className="text-signal-bright transition-transform group-hover:translate-x-0.5">→</span>
    </span>
  </Link>
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entries = (await readEditorial()).filter((entry) => entry.meta.collection === COLLECTION)
  const entryIndex = entries.findIndex((entry) => entry.meta.slug === slug)
  const entry = entries[entryIndex]

  if (!entry) {
    const target = await resolveEditorialRedirect(documentPath(slug))
    if (target) permanentRedirect(target as Route)
    notFound()
  }

  const previous = entryIndex > 0 ? entries[entryIndex - 1] : undefined
  const next = entryIndex < entries.length - 1 ? entries[entryIndex + 1] : undefined
  const adjacent = [previous, next].filter((item): item is EditorialEntry => item !== undefined)

  return <PageMain className="!max-w-none !px-0 !py-0">
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(articleStructuredData(entry))} />

    <article aria-labelledby="document-title">
      <header className="section pt-10 sm:pt-14">
        <Breadcrumbs items={[
          { label: 'Documentation', href: '/docs' },
          { label: entry.meta.title, href: entry.canonicalPath },
        ]} />

        <div className="grid gap-12 border-b border-line-soft pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)] lg:gap-20 lg:pb-16">
          <div>
            <p className="font-mono text-eyebrow uppercase text-signal-bright">
              Documentation · {entry.meta.category}
            </p>
            <h1 className="mt-5 max-w-[22ch] font-display text-display-lg text-balance" id="document-title">
              {entry.meta.title}
            </h1>
            <p className="mt-6 max-w-2xl text-lede text-muted-foreground text-pretty">
              {entry.meta.description}
            </p>
            <p className="mt-8 max-w-2xl border-l border-signal-line pl-5 text-sm leading-7 text-muted-foreground">
              This reference is published from reviewed source. Its table of contents and section links come directly from the current document.
            </p>
          </div>

          <DocumentRecord entry={entry} />
        </div>
      </header>

      <section aria-label="Documentation content" className="section !pt-2">
        <div className="max-w-5xl">
          <EditorialContent entry={entry} />
        </div>
      </section>
    </article>

    <section aria-labelledby="documentation-next" className="section border-t border-line-soft">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(18rem,1fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Next actions</p>
          <h2 className="max-w-[16ch] font-display text-display-lg text-balance" id="documentation-next">
            Keep the reference close.
          </h2>
        </div>
        <div className="lg:pb-1">
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">
            Continue through the published documentation, or return to the index to choose the exact subject you need.
          </p>
          <Link className="control-secondary mt-7 inline-flex h-[2.125rem] items-center rounded-control px-4 text-sm font-medium transition-colors" href="/docs">
            Browse all documentation
          </Link>
        </div>
      </div>

      {adjacent.length > 0 && <nav aria-label="Adjacent documentation" className={`mt-12 grid border-y border-line-soft py-7 sm:py-8 ${adjacent.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {previous && <AdjacentReference direction="Previous" entry={previous} />}
        {next && <AdjacentReference direction="Next" entry={next} />}
      </nav>}
    </section>
  </PageMain>
}
