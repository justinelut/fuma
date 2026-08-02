import type { Route } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { Breadcrumbs } from './breadcrumbs'
import { EditorialContent } from './editorial-content'
import { PageMain } from './site-shell'
import { Eyebrow, SectionHead } from '@/components/section-kit'
import { getEditorial, readEditorial, resolveEditorialRedirect } from '@/lib/editorial'
import { jsonLd } from '@/lib/seo'
import { articleStructuredData } from '@/lib/structured-data'

/**
 * Editorial surfaces: the index for each collection, and the article reading view.
 *
 * Both follow the measured design system. The reading view caps its measure at ~68 characters,
 * which is the range the reference editorial sites use; wider lines are what made this feel
 * unfinished before. Every entry carries its real reviewer and review date — that metadata is
 * the product's own honesty guarantee, so it stays visible rather than being hidden as clutter.
 */

const labels: Record<string, string> = {
  blog: 'Blog',
  changelog: 'Changelog',
  docs: 'Documentation',
  guides: 'Guides',
  legal: 'Policies',
}

const ledes: Record<string, string> = {
  blog: 'Notes on the craft, the architecture and what we are changing next.',
  changelog: 'What shipped, when, and what changed with it.',
  docs: 'Reference for every product surface, reviewed and versioned.',
  guides: 'Practical walkthroughs, from first block to published page.',
  legal: 'Policies with versioned approval receipts.',
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Estimated reading time from the real body text, at a conventional 220 words per minute. */
function readingMinutes(body: string): number {
  return Math.max(1, Math.round(body.trim().split(/\s+/).length / 220))
}

type Entry = Awaited<ReturnType<typeof readEditorial>>[number]

function ArticleMeta({ entry }: Readonly<{ entry: Entry }>) {
  return <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
    <span className="text-signal-bright">{entry.meta.category}</span>
    <span aria-hidden="true">·</span>
    <time dateTime={entry.meta.updatedAt}>{formatDate(entry.meta.updatedAt)}</time>
    <span aria-hidden="true">·</span>
    <span>{readingMinutes(entry.body)} min read</span>
  </p>
}

export async function EditorialIndex({ collection }: Readonly<{ collection: string }>) {
  const entries = (await readEditorial()).filter((entry) => entry.meta.collection === collection)
  const [featured, ...rest] = entries
  const label = labels[collection] ?? 'Resources'
  const categories = [...new Set(entries.map((entry) => entry.meta.category))]

  return <PageMain className="!max-w-none !px-0 !py-0">
    <section className="section fuma-glow !pb-0 pt-14 sm:pt-20">
      <Eyebrow>Resources</Eyebrow>
      <h1 className="fuma-rise max-w-[19ch] font-display text-display-xl text-balance">{label}</h1>
      <p className="fuma-rise mt-6 max-w-xl text-lede text-muted-foreground text-pretty" style={{ animationDelay: '70ms' }}>
        {ledes[collection] ?? 'Reviewed public resources from the Fuma team.'}
      </p>

      <form action="/search" className="fuma-rise mt-9 flex max-w-md gap-2" style={{ animationDelay: '140ms' }}>
        <label className="sr-only" htmlFor="content-search">Search public resources</label>
        <input
          className="min-w-0 flex-1 rounded-control border border-border bg-card px-4 py-2 text-sm placeholder:text-muted-foreground"
          id="content-search"
          maxLength={100}
          name="q"
          placeholder={`Search ${label.toLowerCase()}`}
          required
        />
        <button className="min-h-11 sm:min-h-0 sm:h-[2.125rem] shrink-0 control-primary rounded-control bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors" type="submit">
          Search
        </button>
      </form>

      {categories.length > 1 && <ul className="mt-8 flex flex-wrap gap-2">
        {categories.map((category) => <li
          className="rounded-full border border-border px-3 py-1 font-mono text-xs text-muted-foreground"
          key={category}
        >{category}</li>)}
      </ul>}
    </section>

    {/* Featured entry gets a wider treatment; the reference editorial sites all lead with one. */}
    {featured && <section className="section !pb-0">
      <Link
        className="group grid gap-8 rounded-surface border border-border bg-card p-6 transition-colors hover:border-foreground/25 sm:p-9 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-14"
        href={`/${collection}/${featured.meta.slug}` as Route}
      >
        <div>
          <ArticleMeta entry={featured} />
          <h2 className="mt-4 max-w-2xl font-display text-display-lg text-balance">{featured.meta.title}</h2>
          <p className="mt-5 max-w-xl text-lede text-muted-foreground text-pretty">{featured.meta.description}</p>
          <span className="mt-7 inline-flex items-center gap-2 text-sm font-medium">
            Read it
            <span aria-hidden="true" className="text-signal-bright transition-transform group-hover:translate-x-0.5">→</span>
          </span>
        </div>
        <dl className="grid content-start gap-4 self-start border-t border-border pt-6 text-sm lg:border-l lg:border-t-0 lg:pl-14 lg:pt-0">
          <div>
            <dt className="font-mono text-xs uppercase text-muted-foreground">Reviewed by</dt>
            <dd className="mt-1">{featured.meta.owner}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs uppercase text-muted-foreground">Version</dt>
            <dd className="mt-1 font-mono">{featured.meta.version}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs uppercase text-muted-foreground">Next review</dt>
            <dd className="mt-1"><time dateTime={featured.meta.reviewAt}>{formatDate(featured.meta.reviewAt)}</time></dd>
          </div>
        </dl>
      </Link>
    </section>}

    {rest.length > 0 && <section className="section">
      <SectionHead eyebrow="Archive" title={`More from the ${label.toLowerCase()}`} />
      <ul className="mt-10 grid border-t border-border md:grid-cols-2 lg:grid-cols-3">
        {rest.map((entry) => <li
          className="border-b border-border md:[&:nth-child(odd)]:border-r lg:[&:nth-child(3n+1)]:border-r lg:[&:nth-child(3n+2)]:border-r"
          key={entry.meta.slug}
        >
          <Link className="group flex h-full flex-col justify-between gap-6 p-6 transition-colors hover:bg-secondary/40 sm:p-7" href={`/${collection}/${entry.meta.slug}` as Route}>
            <div>
              <ArticleMeta entry={entry} />
              <h3 className="mt-3 font-display text-display-md text-balance">{entry.meta.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{entry.meta.description}</p>
            </div>
            <span className="font-mono text-xs text-muted-foreground transition-colors group-hover:text-foreground">
              Reviewed by {entry.meta.owner}
            </span>
          </Link>
        </li>)}
      </ul>
    </section>}

    {entries.length === 0 && <section className="section">
      <p className="rounded-panel border border-dashed border-border p-8 text-muted-foreground" role="status">
        Nothing is published in this collection yet. We would rather show an empty shelf than filler.
      </p>
    </section>}
  </PageMain>
}

export async function EditorialDetail({ collection, slug }: Readonly<{ collection: string; slug: string }>) {
  const entry = await getEditorial(collection, slug)
  if (!entry) {
    const target = await resolveEditorialRedirect(`/${collection}/${slug}`)
    if (target) permanentRedirect(target as Route)
    notFound()
  }

  const all = (await readEditorial()).filter((item) => item.meta.collection === collection)
  const related = all.filter((item) => item.meta.slug !== entry.meta.slug).slice(0, 2)
  const label = labels[collection] ?? 'Resources'

  return <PageMain className="!max-w-none !px-0 !py-0">
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(articleStructuredData(entry))} />

    <article>
      <header className="section !pb-0 pt-10 sm:pt-14">
        <Breadcrumbs items={[
          { label, href: `/${collection}` },
          { label: entry.meta.title, href: `/${collection}/${entry.meta.slug}` },
        ]} />
        <p className="mt-8 font-mono text-xs uppercase tracking-[0.14em] text-signal-bright">
          {label} · {entry.meta.category}
        </p>
        {/* Article headline sits a step below the marketing display scale so reading, not
            announcement, is the priority. */}
        <h1 className="mt-5 max-w-[24ch] font-display text-display-lg text-balance">{entry.meta.title}</h1>
        <p className="mt-6 max-w-2xl text-lede text-muted-foreground text-pretty">{entry.meta.description}</p>
        <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-4 border-y border-border py-5 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Reviewed by</dt>
            <dd>{entry.meta.owner}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Updated</dt>
            <dd><time dateTime={entry.meta.updatedAt}>{formatDate(entry.meta.updatedAt)}</time></dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Version</dt>
            <dd className="font-mono">{entry.meta.version}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Next review</dt>
            <dd><time dateTime={entry.meta.reviewAt}>{formatDate(entry.meta.reviewAt)}</time></dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Reading time</dt>
            <dd>{readingMinutes(entry.body)} min</dd>
          </div>
        </dl>
      </header>

      {/* Reading measure capped near 68 characters, matching the reference editorial sites. */}
      <div className="section">
        <div className="max-w-[68ch]">
          <EditorialContent entry={entry} />
        </div>
      </div>
    </article>

    {related.length > 0 && <section className="section border-t border-border">
      <SectionHead eyebrow="Keep reading" title={`More from the ${label.toLowerCase()}`} />
      <ul className="mt-10 grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-2">
        {related.map((item) => <li className="bg-background" key={item.meta.slug}>
          <Link className="group flex h-full flex-col gap-4 p-6 transition-colors hover:bg-secondary/40 sm:p-7" href={`/${collection}/${item.meta.slug}` as Route}>
            <ArticleMeta entry={item} />
            <h3 className="font-display text-display-md text-balance">{item.meta.title}</h3>
            <p className="text-sm leading-6 text-muted-foreground">{item.meta.description}</p>
            <span className="mt-auto inline-flex items-center gap-2 text-sm font-medium">
              Read it
              <span aria-hidden="true" className="text-signal-bright transition-transform group-hover:translate-x-0.5">→</span>
            </span>
          </Link>
        </li>)}
      </ul>
    </section>}
  </PageMain>
}
