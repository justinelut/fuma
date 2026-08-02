import type { Route } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'

import { Breadcrumbs } from '@/components/breadcrumbs'
import { EditorialContent } from '@/components/editorial-content'
import { PageMain } from '@/components/site-shell'
import { getEditorial, readEditorial, resolveEditorialRedirect, type EditorialEntry } from '@/lib/editorial'
import { editorialMetadata, jsonLd } from '@/lib/seo'
import { articleStructuredData } from '@/lib/structured-data'

const COLLECTION = 'blog' as const
const BLOG_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/

const dateFormatter = new Intl.DateTimeFormat('en-KE', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
  year: 'numeric',
})

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value))
}

function readingMinutes(body: string): number {
  return Math.max(1, Math.round(body.trim().split(/\s+/).length / 220))
}

function blogPath(slug: string): string {
  return `/blog/${slug}`
}

async function blogEntry(slug: string): Promise<EditorialEntry | null> {
  return BLOG_SLUG.test(slug) ? getEditorial(COLLECTION, slug) : null
}

export async function generateStaticParams() {
  return (await readEditorial())
    .filter((entry) => entry.meta.collection === COLLECTION)
    .map((entry) => ({ slug: entry.meta.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entry = await blogEntry(slug)

  // Unavailable states share one generic noindex representation. The requested segment is never
  // reflected into canonical metadata or used to distinguish draft, future, and missing entries.
  return editorialMetadata(entry, entry?.canonicalPath ?? '/blog', 'Essay unavailable')
}

function PublicationRecord({ entry }: Readonly<{ entry: EditorialEntry }>) {
  return <aside aria-labelledby="BlogRecordHeading" className="border-t border-line-strong pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
    <h2 className="font-mono text-eyebrow uppercase text-muted-foreground" id="BlogRecordHeading">
      Publication record
    </h2>
    <dl className="mt-5 border-t border-line-soft text-sm">
      <div className="grid grid-cols-[minmax(6.5rem,0.55fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
        <dt className="text-muted-foreground">Written by</dt>
        <dd>{entry.meta.author}</dd>
      </div>
      <div className="grid grid-cols-[minmax(6.5rem,0.55fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
        <dt className="text-muted-foreground">Category</dt>
        <dd>{entry.meta.category}</dd>
      </div>
      <div className="grid grid-cols-[minmax(6.5rem,0.55fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
        <dt className="text-muted-foreground">Published</dt>
        <dd><time dateTime={entry.meta.publishedAt}>{formatDate(entry.meta.publishedAt)}</time></dd>
      </div>
      <div className="grid grid-cols-[minmax(6.5rem,0.55fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
        <dt className="text-muted-foreground">Updated</dt>
        <dd><time dateTime={entry.meta.updatedAt}>{formatDate(entry.meta.updatedAt)}</time></dd>
      </div>
      <div className="grid grid-cols-[minmax(6.5rem,0.55fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
        <dt className="text-muted-foreground">Reading time</dt>
        <dd>{readingMinutes(entry.body)} min</dd>
      </div>
    </dl>
  </aside>
}

function EssayLink({
  direction,
  entry,
}: Readonly<{
  direction: 'Earlier' | 'Newer'
  entry: EditorialEntry
}>) {
  return <Link
    className="group flex h-full flex-col border-t border-line-soft py-7 first:border-t-0 sm:border-l sm:border-t-0 sm:px-7 sm:py-0 sm:first:border-l-0 sm:first:pl-0"
    href={entry.canonicalPath as Route}
  >
    <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">{direction} essay</span>
    <span className="mt-3 max-w-[24ch] font-display text-display-md text-balance">{entry.meta.title}</span>
    <span className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">{entry.meta.description}</span>
    <span className="mt-auto inline-flex items-center gap-2 pt-6 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4">
      Read essay
      <span aria-hidden="true" className="text-signal-bright transition-transform group-hover:translate-x-0.5">→</span>
    </span>
  </Link>
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entry = await blogEntry(slug)

  if (!entry) {
    // Redirect ownership stays with the compiler, whose map contains only currently public targets.
    // Invalid segments never enter redirect resolution; all other unavailable states fail closed.
    const target = BLOG_SLUG.test(slug) ? await resolveEditorialRedirect(blogPath(slug)) : null
    if (target) permanentRedirect(target as Route)
    notFound()
  }

  const entries = (await readEditorial()).filter((item) => item.meta.collection === COLLECTION)
  const entryIndex = entries.findIndex((item) => item.meta.slug === entry.meta.slug)
  const newer = entryIndex > 0 ? entries[entryIndex - 1] : undefined
  const earlier = entryIndex >= 0 && entryIndex < entries.length - 1 ? entries[entryIndex + 1] : undefined
  const adjacent = [newer, earlier].filter((item): item is EditorialEntry => item !== undefined)

  return <PageMain className="!max-w-none !px-0 !py-0">
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(articleStructuredData(entry))} />

    <article aria-labelledby="BlogEssayTitle">
      <header className="section pt-12 sm:pt-16">
        <Breadcrumbs items={[
          { label: 'Blog', href: '/blog' },
          { label: entry.meta.title, href: entry.canonicalPath },
        ]} />

        <div className="grid gap-12 border-b border-line-soft pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.4fr)] lg:items-end lg:gap-20 lg:pb-16">
          <div>
            <p className="font-mono text-eyebrow uppercase text-signal-bright">
              Fuma essay · {entry.meta.category}
            </p>
            <h1 className="mt-5 max-w-[18ch] font-display text-display-xl text-balance" id="BlogEssayTitle">
              {entry.meta.title}
            </h1>
            <p className="mt-7 max-w-2xl text-lede text-muted-foreground text-pretty">
              {entry.meta.description}
            </p>
          </div>

          <PublicationRecord entry={entry} />
        </div>
      </header>

      <section aria-label="Essay content" className="section !pt-2">
        <div className="mx-auto max-w-5xl">
          <EditorialContent entry={entry} />
        </div>
      </section>
    </article>

    <section aria-labelledby="BlogColophonHeading" className="section border-t border-line-soft">
      <div className="grid gap-12 lg:grid-cols-[minmax(15rem,0.42fr)_minmax(0,1fr)] lg:items-start lg:gap-20">
        <div>
          <p className="eyebrow">Editorial colophon</p>
          <dl className="border-t border-line-soft text-sm">
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Version</dt>
              <dd className="font-mono">{entry.meta.version}</dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Review owner</dt>
              <dd>{entry.meta.owner}</dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Next review</dt>
              <dd><time dateTime={entry.meta.reviewAt}>{formatDate(entry.meta.reviewAt)}</time></dd>
            </div>
          </dl>
        </div>

        <div>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="BlogColophonHeading">
            Continue with Fuma writing.
          </h2>
          <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">
            Return to the journal for published essays, or open the practical guides for outcome-led reading.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <Link className="control-secondary inline-flex min-h-11 items-center rounded-control px-4 text-sm font-medium transition-colors" href="/blog">
              Browse the journal
            </Link>
            <Link className="inline-flex min-h-11 items-center px-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href="/guides">
              Read practical guides
            </Link>
          </div>
        </div>
      </div>

      {adjacent.length > 0 && <nav aria-label="Chronological essays" className={`mt-12 grid border-y border-line-soft py-7 sm:py-8 ${adjacent.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {newer && <EssayLink direction="Newer" entry={newer} />}
        {earlier && <EssayLink direction="Earlier" entry={earlier} />}
      </nav>}
    </section>
  </PageMain>
}
