import type { Route } from 'next'
import Link from 'next/link'
import { PageMain } from '@/components/site-shell'
import { readEditorial, type EditorialEntry } from '@/lib/editorial'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Documentation',
  'Reviewed Fuma product references for building and publishing.',
  '/docs',
)

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  })
}

function categoryId(category: string, index: number): string {
  const stem = category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `docs-${stem || 'topic'}-${index + 1}`
}

type CategoryGroup = Readonly<{
  category: string
  entries: readonly EditorialEntry[]
  id: string
}>

function groupEntries(entries: readonly EditorialEntry[]): readonly CategoryGroup[] {
  const grouped = new Map<string, EditorialEntry[]>()
  for (const entry of entries) {
    const categoryEntries = grouped.get(entry.meta.category) ?? []
    categoryEntries.push(entry)
    grouped.set(entry.meta.category, categoryEntries)
  }

  return [...grouped].map(([category, categoryEntries], index) => ({
    category,
    entries: categoryEntries,
    id: categoryId(category, index),
  }))
}

function ReferenceEntry({ entry }: Readonly<{ entry: EditorialEntry }>) {
  return <article className="grid gap-8 border-b border-line-soft px-5 py-8 last:border-b-0 sm:px-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(12rem,0.56fr)_minmax(14rem,0.72fr)] lg:gap-10 lg:py-10">
    <div>
      <h4 className="font-display text-display-md text-balance">
        <Link
          className="decoration-signal underline-offset-4 hover:underline"
          href={entry.canonicalPath as Route}
        >
          {entry.meta.title}
        </Link>
      </h4>
      <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
        {entry.meta.description}
      </p>
      <Link
        className="mt-6 inline-flex items-center gap-2 text-sm font-medium"
        href={entry.canonicalPath as Route}
      >
        Open reference
        <span aria-hidden="true" className="text-signal-bright">→</span>
      </Link>
    </div>

    <dl className="grid content-start gap-4 border-t border-line-soft pt-6 text-sm lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
      <div>
        <dt className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">Version</dt>
        <dd className="mt-1.5 font-mono">{entry.meta.version}</dd>
      </div>
      <div>
        <dt className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">Updated</dt>
        <dd className="mt-1.5"><time dateTime={entry.meta.updatedAt}>{formatDate(entry.meta.updatedAt)}</time></dd>
      </div>
      <div>
        <dt className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">Reviewed by</dt>
        <dd className="mt-1.5 leading-5">{entry.meta.owner}</dd>
      </div>
    </dl>

    <nav aria-label={`Sections in ${entry.meta.title}`} className="border-t border-line-soft pt-6 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">In this reference</p>
      <ol className="mt-4 grid gap-3">
        {entry.headings.map((heading) => <li className="flex gap-3 text-sm leading-5" key={heading.id}>
          <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-signal-bright" />
          <Link
            className="text-muted-foreground decoration-signal underline-offset-4 hover:text-foreground hover:underline"
            href={`${entry.canonicalPath}#${heading.id}` as Route}
          >
            {heading.text}
          </Link>
        </li>)}
      </ol>
    </nav>
  </article>
}

export default async function Page() {
  const entries = (await readEditorial()).filter((entry) => entry.meta.collection === 'docs')
  const groups = groupEntries(entries)
  const nextReview = entries
    .map((entry) => entry.meta.reviewAt)
    .sort((left, right) => left.localeCompare(right))[0]

  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="docs-title" className="section !pb-0 pt-14 sm:pt-20">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.48fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Fuma reference library</p>
          <h1 className="fuma-rise max-w-[17ch] font-display text-display-xl text-balance" id="docs-title">
            Find the exact product reference.
          </h1>
          <p className="mt-6 max-w-2xl text-lede text-muted-foreground text-pretty">
            Build and publish with guidance tied to the current Fuma product. Every reference is
            versioned, assigned to a review owner and kept off this shelf until it is published.
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line-soft bg-line-soft">
          <div className="bg-background p-5">
            <dt className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">References</dt>
            <dd className="mt-3 font-display text-display-md">{entries.length}</dd>
          </div>
          <div className="bg-background p-5">
            <dt className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">Topics</dt>
            <dd className="mt-3 font-display text-display-md">{groups.length}</dd>
          </div>
          <div className="col-span-2 bg-background p-5">
            <dt className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">Next scheduled review</dt>
            <dd className="mt-3 text-sm">
              {nextReview
                ? <time dateTime={nextReview}>{formatDate(nextReview)}</time>
                : <span className="text-muted-foreground">No published reference is scheduled.</span>}
            </dd>
          </div>
        </dl>
      </div>

      <form action="/search" className="mt-10 flex max-w-lg gap-2">
        <label className="sr-only" htmlFor="docs-search">Search Fuma resources</label>
        <input
          className="min-w-0 flex-1 rounded-control border border-input bg-card px-4 py-2 text-sm placeholder:text-muted-foreground"
          id="docs-search"
          maxLength={100}
          name="q"
          placeholder="Search Fuma resources"
          required
        />
        <button className="control-primary h-[2.125rem] shrink-0 rounded-control bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors" type="submit">
          Search
        </button>
      </form>
    </section>

    {entries.length > 0
      ? <section aria-labelledby="reference-index-title" className="section">
          <div className="grid gap-10 lg:grid-cols-[minmax(12rem,0.27fr)_minmax(0,1fr)] lg:gap-14">
            <div>
              <div className="lg:sticky lg:top-24">
                <p className="eyebrow">Library index</p>
                <h2 className="max-w-[12ch] font-display text-display-lg text-balance" id="reference-index-title">
                  Read by topic.
                </h2>
                <p className="mt-5 max-w-xs text-sm leading-6 text-muted-foreground">
                  Open a complete reference, or move directly to a heading from its contents rail.
                </p>
                <nav aria-label="Documentation topics" className="mt-8 border-t border-line-soft">
                  <ul>
                    {groups.map((group) => <li className="border-b border-line-soft" key={group.id}>
                      <a className="flex items-center justify-between gap-4 py-3 text-sm text-muted-foreground hover:text-foreground" href={`#${group.id}`}>
                        <span>{group.category}</span>
                        <span className="font-mono text-xs">{group.entries.length}</span>
                      </a>
                    </li>)}
                  </ul>
                </nav>
              </div>
            </div>

            <div className="overflow-hidden rounded-surface border border-border bg-surface-inset">
              <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.15fr)_minmax(12rem,0.56fr)_minmax(14rem,0.72fr)] gap-10 border-b border-line-soft px-7 py-4 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground lg:grid">
                <span>Reference</span>
                <span>Review record</span>
                <span>Contents</span>
              </div>

              {groups.map((group) => <section aria-labelledby={`${group.id}-title`} id={group.id} key={group.id}>
                <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line-soft bg-card px-5 py-5 sm:px-7">
                  <h3 className="font-display text-display-md" id={`${group.id}-title`}>{group.category}</h3>
                  <p className="font-mono text-xs text-muted-foreground">
                    {group.entries.length} {group.entries.length === 1 ? 'reference' : 'references'}
                  </p>
                </header>
                {group.entries.map((entry) => <ReferenceEntry entry={entry} key={entry.canonicalPath} />)}
              </section>)}
            </div>
          </div>
        </section>
      : <section aria-labelledby="empty-library-title" className="section">
          <div className="border-y border-line-soft py-12" role="status">
            <h2 className="font-display text-display-md" id="empty-library-title">The reference shelf is empty.</h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
              No documentation is currently published and eligible for this library. Draft or
              scheduled material is never substituted as filler.
            </p>
          </div>
        </section>}

    <section aria-labelledby="library-standard-title" className="section border-t border-line-soft">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(18rem,0.55fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Reading standard</p>
          <h2 className="max-w-[17ch] font-display text-display-lg text-balance" id="library-standard-title">
            A reference should tell you when to trust it.
          </h2>
        </div>
        <p className="max-w-lg text-lede text-muted-foreground text-pretty">
          Each published entry keeps its version, last update and accountable review owner beside
          the work. When no entry is eligible, the library says so instead of inventing an answer.
        </p>
      </div>
    </section>
  </PageMain>
}
