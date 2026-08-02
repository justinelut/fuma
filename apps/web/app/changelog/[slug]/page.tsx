import type { Route } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'

import { Breadcrumbs } from '@/components/breadcrumbs'
import { EditorialContent } from '@/components/editorial-content'
import { PageMain } from '@/components/site-shell'
import { getEditorial, readEditorial, resolveEditorialRedirect, type EditorialEntry } from '@/lib/editorial'
import { editorialMetadata, jsonLd } from '@/lib/seo'
import { articleStructuredData } from '@/lib/structured-data'

const COLLECTION = 'changelog' as const
const CHANGELOG_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/

const dateFormatter = new Intl.DateTimeFormat('en-KE', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
  year: 'numeric',
})

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value))
}

function changelogPath(slug: string): string {
  return `/changelog/${slug}`
}

async function release(slug: string): Promise<EditorialEntry | null> {
  return CHANGELOG_SLUG.test(slug) ? getEditorial(COLLECTION, slug) : null
}

export async function generateStaticParams() {
  return (await readEditorial())
    .filter((entry) => entry.meta.collection === COLLECTION)
    .map((entry) => ({ slug: entry.meta.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entry = await release(slug)

  // Invalid, missing, draft, and future slugs all receive the same closed representation. The
  // canonical never reflects an unavailable request segment or reveals why no release resolved.
  return editorialMetadata(entry, entry?.canonicalPath ?? '/changelog', 'Changelog entry unavailable')
}

function AdjacentRelease({
  direction,
  entry,
}: Readonly<{
  direction: 'Earlier' | 'Newer'
  entry: EditorialEntry
}>) {
  return <Link
    className="group flex h-full flex-col gap-3 border-t border-line-soft py-7 first:border-t-0 sm:border-l sm:border-t-0 sm:px-7 sm:py-0 sm:first:border-l-0 sm:first:pl-0"
    href={entry.canonicalPath as Route}
  >
    <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">{direction} release</span>
    <span className="font-mono text-sm text-signal-bright">{entry.meta.version}</span>
    <span className="max-w-[24ch] font-display text-display-md text-balance">{entry.meta.title}</span>
    <span className="mt-auto pt-2 text-sm text-muted-foreground">
      <time dateTime={entry.meta.publishedAt}>{formatDate(entry.meta.publishedAt)}</time>
    </span>
    <span className="inline-flex items-center gap-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4">
      Read release
      <span aria-hidden="true" className="text-signal-bright transition-transform group-hover:translate-x-0.5">→</span>
    </span>
  </Link>
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entry = await release(slug)

  if (!entry) {
    // Redirects are compiler-owned and include only aliases whose canonical target is currently
    // public. Malformed segments never reach redirect lookup; all other absences fail closed.
    const target = CHANGELOG_SLUG.test(slug) ? await resolveEditorialRedirect(changelogPath(slug)) : null
    if (target) permanentRedirect(target as Route)
    notFound()
  }

  const releases = (await readEditorial()).filter((item) => item.meta.collection === COLLECTION)
  const releaseIndex = releases.findIndex((item) => item.meta.slug === entry.meta.slug)
  const newer = releaseIndex > 0 ? releases[releaseIndex - 1] : undefined
  const earlier = releaseIndex >= 0 && releaseIndex < releases.length - 1 ? releases[releaseIndex + 1] : undefined
  const adjacent = [newer, earlier].filter((item): item is EditorialEntry => item !== undefined)
  const changes = entry.headings.filter((heading) => heading.depth === 2)

  return <PageMain className="!max-w-none !px-0 !py-0">
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(articleStructuredData(entry))} />

    <article aria-labelledby="ReleaseTitle">
      <header className="section pt-10 sm:pt-14">
        <Breadcrumbs items={[
          { label: 'Changelog', href: '/changelog' },
          { label: entry.meta.title, href: entry.canonicalPath },
        ]} />

        <div className="grid gap-12 border-b border-line-strong pb-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.55fr)] lg:items-end lg:gap-20 lg:pb-16">
          <div>
            <p className="font-mono text-eyebrow uppercase text-signal-bright">
              Changelog · {entry.meta.category}
            </p>
            <p className="mt-8 font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Release</p>
            <p aria-label={`Version ${entry.meta.version}`} className="mt-2 font-display text-display-xl text-balance">
              {entry.meta.version}
            </p>
            <h1 className="mt-7 max-w-[22ch] font-display text-display-lg text-balance" id="ReleaseTitle">
              {entry.meta.title}
            </h1>
            <p className="mt-6 max-w-2xl text-lede text-muted-foreground text-pretty">
              {entry.meta.description}
            </p>
          </div>

          <aside aria-labelledby="ReleaseRecordTitle" className="border-t border-line-soft pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-1">
            <h2 className="font-mono text-eyebrow uppercase text-muted-foreground" id="ReleaseRecordTitle">
              Release record
            </h2>
            <dl className="mt-6 border-t border-line-soft text-sm leading-6">
              <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
                <dt className="text-muted-foreground">Published</dt>
                <dd><time dateTime={entry.meta.publishedAt}>{formatDate(entry.meta.publishedAt)}</time></dd>
              </div>
              <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
                <dt className="text-muted-foreground">Version</dt>
                <dd className="font-mono">{entry.meta.version}</dd>
              </div>
              <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
                <dt className="text-muted-foreground">Released by</dt>
                <dd>{entry.meta.author}</dd>
              </div>
              <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
                <dt className="text-muted-foreground">Maintained by</dt>
                <dd>{entry.meta.owner}</dd>
              </div>
              <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
                <dt className="text-muted-foreground">Review due</dt>
                <dd><time dateTime={entry.meta.reviewAt}>{formatDate(entry.meta.reviewAt)}</time></dd>
              </div>
            </dl>
          </aside>
        </div>
      </header>

      {changes.length > 0 && <section aria-labelledby="ChangeLedgerTitle" className="section !pt-2">
        <div className="grid gap-10 border-b border-line-soft py-10 lg:grid-cols-[minmax(15rem,0.42fr)_minmax(0,1fr)] lg:gap-20 lg:py-14">
          <div>
            <p className="eyebrow">Release contents</p>
            <h2 className="max-w-[13ch] font-display text-display-lg text-balance" id="ChangeLedgerTitle">
              Change ledger
            </h2>
            <p className="mt-5 max-w-sm text-sm leading-6 text-muted-foreground">
              Entries follow the published release note in source order. Each link moves to its exact section.
            </p>
          </div>

          <ol aria-label={`Changes in release ${entry.meta.version}`} className="border-t border-line-strong">
            {changes.map((change, index) => <li className="border-b border-line-soft" key={change.id}>
              <a
                className="group grid min-h-20 grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-4 py-4 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:gap-6"
                href={`#${change.id}`}
              >
                <span aria-hidden="true" className="font-mono text-xs text-signal-bright">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="font-display text-display-md text-balance">{change.text}</span>
                <span aria-hidden="true" className="text-muted-foreground transition-transform group-hover:translate-y-0.5">↓</span>
              </a>
            </li>)}
          </ol>
        </div>
      </section>}

      <section aria-label="Release notes" className={`section ${changes.length > 0 ? '!pt-0' : '!pt-2'}`}>
        <div className="mx-auto max-w-5xl">
          <EditorialContent entry={entry} />
        </div>
      </section>
    </article>

    <section aria-labelledby="ReleaseContinuityTitle" className="section border-t border-line-soft">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(18rem,1fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Release continuity</p>
          <h2 className="max-w-[16ch] font-display text-display-lg text-balance" id="ReleaseContinuityTitle">
            Follow what changed.
          </h2>
        </div>
        <div className="lg:pb-1">
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">
            Return to the complete changelog, or open Fuma Docs for the current reviewed product reference.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-2.5">
            <Link className="control-secondary inline-flex min-h-11 items-center rounded-control px-4 text-sm font-medium transition-colors" href="/changelog">
              Browse changelog
            </Link>
            <Link className="inline-flex min-h-11 items-center px-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href="/docs">
              Open Fuma Docs
            </Link>
          </div>
        </div>
      </div>

      {adjacent.length > 0 && <nav aria-label="Adjacent releases" className={`mt-12 grid border-y border-line-soft py-7 sm:py-8 ${adjacent.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {newer && <AdjacentRelease direction="Newer" entry={newer} />}
        {earlier && <AdjacentRelease direction="Earlier" entry={earlier} />}
      </nav>}
    </section>
  </PageMain>
}
