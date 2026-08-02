import type { Route } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'

import { Breadcrumbs } from '@/components/breadcrumbs'
import { EditorialContent } from '@/components/editorial-content'
import { PageMain } from '@/components/site-shell'
import { getEditorial, resolveEditorialRedirect, type EditorialEntry } from '@/lib/editorial'
import { editorialMetadata, jsonLd } from '@/lib/seo'
import { articleStructuredData } from '@/lib/structured-data'

const GUIDE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/

const dateFormatter = new Intl.DateTimeFormat('en-KE', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
  year: 'numeric',
})

function readingMinutes(body: string): number {
  return Math.max(1, Math.round(body.trim().split(/\s+/).length / 220))
}

async function guide(slug: string): Promise<EditorialEntry | null> {
  return GUIDE_SLUG.test(slug) ? getEditorial('guides', slug) : null
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entry = await guide(slug)

  // Missing, invalid, draft, and future slugs share one generic noindex representation. The
  // untrusted request slug never becomes their canonical URL or leaks editorial state.
  return editorialMetadata(entry, entry?.canonicalPath ?? '/guides', 'Guide unavailable')
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entry = await guide(slug)

  if (!entry) {
    // Redirects are compiler-owned and include only currently public targets. Invalid slug shapes
    // never enter redirect resolution, and every other unavailable state fails closed as a 404.
    const target = GUIDE_SLUG.test(slug) ? await resolveEditorialRedirect(`/guides/${slug}`) : null
    if (target) permanentRedirect(target as Route)
    notFound()
  }

  const checkpoints = entry.headings.filter((heading) => heading.depth === 2)
  const minutes = readingMinutes(entry.body)

  return <PageMain className="!max-w-none !px-0 !py-0">
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(articleStructuredData(entry))} />

    <header aria-labelledby="GuideTitle" className="section !pb-0 pt-12 sm:pt-16">
      <Breadcrumbs items={[
        { label: 'Guides', href: '/guides' },
        { label: entry.meta.title, href: entry.canonicalPath },
      ]} />

      <div className="grid gap-12 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)] lg:items-end lg:gap-20">
        <div>
          <p className="fuma-rise font-mono text-eyebrow uppercase text-signal-bright">
            Practical guide · {entry.meta.category}
          </p>
          <h1 className="fuma-rise mt-5 max-w-[15ch] font-display text-display-xl text-balance" id="GuideTitle">
            {entry.meta.title}
          </h1>
          <p className="fuma-rise mt-7 max-w-2xl text-lede text-muted-foreground text-pretty">
            {entry.meta.description}
          </p>
          {checkpoints.length > 0 && <a
            className="control-primary mt-9 inline-flex min-h-11 items-center rounded-control bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors"
            href="#GuideRoute"
          >
            See the route
          </a>}
        </div>

        <aside aria-label="Guide record" className="border-t border-line-strong pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground">Guide record</p>
          <dl className="mt-5 border-t border-line-soft text-sm">
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">By</dt>
              <dd>{entry.meta.author}</dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Updated</dt>
              <dd><time dateTime={entry.meta.updatedAt}>{dateFormatter.format(new Date(entry.meta.updatedAt))}</time></dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Reading time</dt>
              <dd>{minutes} min</dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Checkpoints</dt>
              <dd>{checkpoints.length}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </header>

    {checkpoints.length > 0 && <section aria-labelledby="GuideRouteHeading" className="section" id="GuideRoute">
      <div className="grid gap-10 border-y border-line-soft py-10 lg:grid-cols-[minmax(15rem,0.42fr)_minmax(0,1fr)] lg:gap-20 lg:py-14">
        <div>
          <p className="eyebrow">Route map</p>
          <h2 className="max-w-[14ch] font-display text-display-lg text-balance" id="GuideRouteHeading">
            See the whole path before you begin.
          </h2>
          <p className="mt-5 max-w-sm text-sm leading-6 text-muted-foreground">
            These checkpoints come directly from the guide, in the order you will work through them.
          </p>
        </div>

        <ol aria-label={`Route through ${entry.meta.title}`} className="border-t border-line-strong">
          {checkpoints.map((checkpoint, index) => <li className="border-b border-line-soft" key={checkpoint.id}>
            <a
              className="group grid min-h-20 grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-4 py-4 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:gap-6"
              href={`#${checkpoint.id}`}
            >
              <span aria-hidden="true" className="font-mono text-xs text-signal-bright">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="font-display text-display-md text-balance">{checkpoint.text}</span>
              <span aria-hidden="true" className="text-muted-foreground transition-transform group-hover:translate-y-0.5">↓</span>
            </a>
          </li>)}
        </ol>
      </div>
    </section>}

    <section aria-label="Guide instructions" className={`section ${checkpoints.length > 0 ? '!pt-0' : ''}`}>
      <div className="mx-auto max-w-5xl">
        <EditorialContent entry={entry} />
      </div>
    </section>

    <section aria-labelledby="GuideReviewHeading" className="section border-t border-line-soft">
      <div className="grid gap-12 lg:grid-cols-[minmax(15rem,0.42fr)_minmax(0,1fr)] lg:items-start lg:gap-20">
        <div>
          <p className="eyebrow">Review receipt</p>
          <dl className="border-t border-line-soft text-sm">
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Version</dt>
              <dd className="font-mono">{entry.meta.version}</dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Reviewed by</dt>
              <dd>{entry.meta.owner}</dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Next review</dt>
              <dd><time dateTime={entry.meta.reviewAt}>{dateFormatter.format(new Date(entry.meta.reviewAt))}</time></dd>
            </div>
          </dl>
        </div>

        <div>
          <h2 className="max-w-[17ch] font-display text-display-lg text-balance" id="GuideReviewHeading">
            Need a route, or an exact answer?
          </h2>
          <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">
            Guides order practical work around an outcome. Fuma Docs hold reviewed product reference when you need to look up one surface directly.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <Link className="control-secondary inline-flex min-h-11 items-center rounded-control px-4 text-sm font-medium transition-colors" href="/guides">
              Browse guides
            </Link>
            <Link className="inline-flex min-h-11 items-center px-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href="/docs">
              Open Fuma Docs
            </Link>
          </div>
        </div>
      </div>
    </section>
  </PageMain>
}
