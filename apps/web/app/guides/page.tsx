import type { Route } from 'next'
import Link from 'next/link'
import { PageMain } from '@/components/site-shell'
import { readEditorial, type EditorialEntry } from '@/lib/editorial'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Guides',
  'Reviewed Fuma guides that turn practical publishing outcomes into clear sequences.',
  '/guides',
)

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

function GuideRoute({ entry }: Readonly<{ entry: EditorialEntry }>) {
  const checkpoints = entry.headings.filter((heading) => heading.depth === 2)

  if (checkpoints.length === 0) {
    return <p className="border-y border-line-soft py-4 text-sm leading-6 text-muted-foreground" role="status">
      No section checkpoints are published for this guide.
    </p>
  }

  return <ol aria-label={`Route through ${entry.meta.title}`} className="border-l border-diagram-track">
    {checkpoints.map((checkpoint, index) => <li className="relative pb-7 pl-8 last:pb-0" key={checkpoint.id}>
      <span
        aria-hidden="true"
        className="absolute -left-3 top-0 inline-flex size-6 items-center justify-center rounded-full border border-signal-line bg-background font-mono text-[0.65rem] text-signal-bright"
      >{index + 1}</span>
      <p className="text-sm font-medium leading-6">{checkpoint.text}</p>
    </li>)}
  </ol>
}

function GuideRecord({ entry }: Readonly<{ entry: EditorialEntry }>) {
  const href = entry.canonicalPath as Route

  return <li className="border-b border-line-soft py-10 first:border-t sm:py-14">
    <article aria-labelledby={`guide-${entry.meta.slug}`} className="grid gap-9 lg:grid-cols-[minmax(10rem,0.28fr)_minmax(0,0.82fr)_minmax(16rem,0.48fr)] lg:gap-12">
      <div className="lg:pt-1">
        <p className="font-mono text-eyebrow uppercase text-signal-bright">Guide</p>
        <p className="mt-3 font-mono text-xs leading-5 text-muted-foreground">{entry.meta.category}</p>
      </div>

      <div>
        <h3 className="max-w-[22ch] font-display text-display-md text-balance" id={`guide-${entry.meta.slug}`}>
          <Link className="decoration-signal underline-offset-4 hover:underline" href={href}>
            {entry.meta.title}
          </Link>
        </h3>
        <p className="mt-4 max-w-xl text-lede text-muted-foreground text-pretty">
          {entry.meta.description}
        </p>
        <dl className="mt-7 flex flex-wrap gap-x-7 gap-y-3 border-y border-line-soft py-4 text-xs leading-5">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">By</dt>
            <dd>{entry.meta.author}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Updated</dt>
            <dd><time dateTime={entry.meta.updatedAt}>{formatDate(entry.meta.updatedAt)}</time></dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Reading time</dt>
            <dd>{readingMinutes(entry.body)} min</dd>
          </div>
        </dl>
        <Link className="mt-7 inline-flex min-h-11 items-center gap-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href={href}>
          Follow this path
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      <aside aria-label={`Checkpoints and review record for ${entry.meta.title}`} className="border-t border-line-soft pt-7 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
        <p className="mb-6 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
          Checkpoints
        </p>
        <GuideRoute entry={entry} />
        <dl className="mt-8 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-line-soft pt-5 text-xs leading-5">
          <div>
            <dt className="font-mono uppercase tracking-[0.08em] text-muted-foreground">Version</dt>
            <dd className="mt-1 font-mono">{entry.meta.version}</dd>
          </div>
          <div>
            <dt className="font-mono uppercase tracking-[0.08em] text-muted-foreground">Reviewed by</dt>
            <dd className="mt-1">{entry.meta.owner}</dd>
          </div>
          <div className="col-span-2">
            <dt className="font-mono uppercase tracking-[0.08em] text-muted-foreground">Next review</dt>
            <dd className="mt-1"><time dateTime={entry.meta.reviewAt}>{formatDate(entry.meta.reviewAt)}</time></dd>
          </div>
        </dl>
      </aside>
    </article>
  </li>
}

export default async function Page() {
  const entries = (await readEditorial()).filter((entry) => entry.meta.collection === 'guides')
  const categories = [...new Set(entries.map((entry) => entry.meta.category))]

  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="page-title" className="section fuma-bloom pt-16 sm:pt-24">
      <p className="eyebrow fuma-rise">Guided learning</p>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.12fr)_minmax(18rem,0.62fr)] lg:items-end lg:gap-20">
        <h1 className="fuma-rise max-w-[16ch] font-display text-display-xl text-balance" id="page-title">
          Follow the work, not a wall of reference.
        </h1>
        <div className="fuma-rise lg:pb-1">
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">
            Fuma Guides turn one practical outcome into an ordered route. See the checkpoints first,
            then work through the reviewed guide at your own pace.
          </p>
          <form action="/search" className="mt-8 flex max-w-md gap-2">
            <label className="sr-only" htmlFor="guide-search">Search public resources</label>
            <input
              className="min-h-11 min-w-0 flex-1 rounded-control border border-control-border bg-surface-inset px-4 py-2 text-sm placeholder:text-muted-foreground"
              id="guide-search"
              maxLength={100}
              name="q"
              placeholder="Search public resources"
              required
            />
            <button className="control-primary min-h-11 shrink-0 rounded-control bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors" type="submit">
              Search
            </button>
          </form>
        </div>
      </div>

      <dl aria-label="How to read the guide index" className="mt-14 grid border-y border-line-soft sm:mt-16 sm:grid-cols-3">
        <div className="py-6 sm:pr-7">
          <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Outcome</dt>
          <dd className="mt-3 max-w-sm text-sm leading-6">Each title names the practical result the guide works towards.</dd>
        </div>
        <div className="border-t border-line-soft py-6 sm:border-l sm:border-t-0 sm:px-7">
          <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Route</dt>
          <dd className="mt-3 max-w-sm text-sm leading-6">The visible checkpoints come directly from the guide’s reviewed sections.</dd>
        </div>
        <div className="border-t border-line-soft py-6 sm:border-l sm:border-t-0 sm:pl-7">
          <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Review</dt>
          <dd className="mt-3 max-w-sm text-sm leading-6">Version, owner and next review date stay attached to every published path.</dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="published-paths" className="section">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Published paths</p>
          <h2 className="max-w-[17ch] font-display text-display-lg text-balance" id="published-paths">
            Begin with a route that matches the work.
          </h2>
        </div>
        <div className="lg:pb-1">
          <p className="max-w-lg text-lede text-muted-foreground text-pretty">
            Only public guides with a current review record appear here. Drafts and future
            publications stay out of the path until they are eligible.
          </p>
          {categories.length > 0 && <p className="mt-5 font-mono text-xs leading-5 text-muted-foreground">
            Current {categories.length === 1 ? 'subject' : 'subjects'}: {categories.join(' · ')}
          </p>}
        </div>
      </div>

      {entries.length > 0
        ? <ol aria-label="Published Fuma guide paths" className="mt-12">
            {entries.map((entry) => <GuideRecord entry={entry} key={entry.meta.slug} />)}
          </ol>
        : <div aria-live="polite" className="mt-12 border-y border-line-soft py-10" role="status">
            <p className="font-mono text-eyebrow uppercase text-muted-foreground">No published paths</p>
            <h3 className="mt-4 max-w-xl font-display text-display-md">The guide shelf is intentionally empty.</h3>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              No reviewed guide is publicly eligible right now. Draft or future material is not substituted as filler.
            </p>
          </div>}
    </section>

    <section aria-labelledby="reference-next" className="section border-t border-line-soft">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(18rem,0.55fr)] lg:items-end lg:gap-20">
        <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="reference-next">
          Need an exact answer instead of a route?
        </h2>
        <div className="lg:pb-1">
          <p className="max-w-lg text-lede text-muted-foreground text-pretty">
            Guides sequence practical work. Fuma Docs hold reviewed, versioned product reference when
            you need to look up one surface directly.
          </p>
          <Link className="control-secondary mt-7 inline-flex min-h-11 items-center rounded-control px-4 text-sm font-medium transition-colors" href="/docs">
            Browse Fuma Docs
          </Link>
        </div>
      </div>
    </section>
  </PageMain>
}
