import type { Route } from 'next'
import Link from 'next/link'
import { PageMain } from '@/components/site-shell'
import { readEditorial, type EditorialEntry } from '@/lib/editorial'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Fuma Journal',
  'Essays from Fuma on the choices, principles and craft behind the product.',
  '/blog',
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

function EssayRecord({ entry, latest = false }: Readonly<{ entry: EditorialEntry; latest?: boolean }>) {
  const sections = entry.headings.filter((heading) => heading.depth === 2)
  const href = entry.canonicalPath as Route

  return <article aria-labelledby={`Essay-${entry.meta.slug}`} className="border-y border-line-soft py-10 sm:py-14">
    <div className="grid gap-9 lg:grid-cols-[minmax(9rem,0.3fr)_minmax(0,0.9fr)_minmax(16rem,0.48fr)] lg:gap-12">
      <header className="lg:pt-1">
        <p className="font-mono text-eyebrow uppercase text-signal-bright">
          {latest ? 'Current essay' : 'From the journal'}
        </p>
        <p className="mt-3 font-mono text-xs leading-5 text-muted-foreground">{entry.meta.category}</p>
        <p className="mt-1 font-mono text-xs leading-5 text-muted-foreground">
          <time dateTime={entry.meta.publishedAt}>{formatDate(entry.meta.publishedAt)}</time>
        </p>
      </header>

      <div>
        <h3 className="max-w-[23ch] font-display text-display-lg text-balance" id={`Essay-${entry.meta.slug}`}>
          <Link className="decoration-signal underline-offset-4 hover:underline" href={href}>
            {entry.meta.title}
          </Link>
        </h3>
        <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">
          {entry.meta.description}
        </p>
        <p className="mt-8 text-sm leading-6">
          By <span className="font-medium">{entry.meta.author}</span>
        </p>
        <Link className="mt-7 inline-flex min-h-11 items-center gap-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href={href}>
          Read the essay
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      <aside aria-label={`Argument and publication record for ${entry.meta.title}`} className="border-t border-line-soft pt-7 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-1">
        {sections.length > 0 && <div>
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
            The argument
          </p>
          <ul className="mt-5">
            {sections.map((section) => <li className="border-t border-line-soft py-3 text-sm leading-6 first:border-t-0 first:pt-0" key={section.id}>
              {section.text}
            </li>)}
          </ul>
        </div>}

        <dl className={`${sections.length > 0 ? 'mt-7 border-t border-line-soft pt-5' : ''} grid grid-cols-2 gap-x-5 gap-y-4 text-xs leading-5`}>
          <div>
            <dt className="font-mono uppercase tracking-[0.08em] text-muted-foreground">Reading time</dt>
            <dd className="mt-1">{readingMinutes(entry.body)} min</dd>
          </div>
          <div>
            <dt className="font-mono uppercase tracking-[0.08em] text-muted-foreground">Version</dt>
            <dd className="mt-1 font-mono">{entry.meta.version}</dd>
          </div>
          <div>
            <dt className="font-mono uppercase tracking-[0.08em] text-muted-foreground">Updated</dt>
            <dd className="mt-1"><time dateTime={entry.meta.updatedAt}>{formatDate(entry.meta.updatedAt)}</time></dd>
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
    </div>
  </article>
}

export default async function Page() {
  const entries = (await readEditorial()).filter((entry) => entry.meta.collection === 'blog')
  const [current, ...earlier] = entries
  const categories = [...new Set(entries.map((entry) => entry.meta.category))]

  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="page-title" className="section pt-16 sm:pt-24">
      <p className="eyebrow">Fuma Journal</p>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(18rem,0.58fr)] lg:items-end lg:gap-20">
        <h1 className="max-w-[13ch] font-display text-display-xl text-balance" id="page-title">
          The thinking behind the work.
        </h1>
        <div className="lg:pb-1">
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">
            Essays from Fuma on product judgment, publishing craft and the decisions that deserve
            more room than a release note.
          </p>
          <nav aria-label="Journal feeds" className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <span className="text-muted-foreground">Follow the journal</span>
            <Link className="min-h-11 content-center underline decoration-signal decoration-2 underline-offset-4" href="/feeds/rss.xml">RSS</Link>
            <Link className="min-h-11 content-center underline decoration-signal decoration-2 underline-offset-4" href="/feeds/atom.xml">Atom</Link>
          </nav>
        </div>
      </div>

      <div className="mt-14 grid border-y border-line-soft sm:mt-16 sm:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)]">
        <div className="py-6 sm:pr-8">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground">Editorial form</p>
          <p className="mt-3 max-w-sm text-sm leading-6">Long-form positions and the reasoning that supports them.</p>
        </div>
        <div className="border-t border-line-soft py-6 sm:border-l sm:border-t-0 sm:pl-8">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground">Current threads</p>
          {categories.length > 0
            ? <ul aria-label="Current journal categories" className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm leading-6">
                {categories.map((category) => <li key={category}>{category}</li>)}
              </ul>
            : <p className="mt-3 text-sm leading-6 text-muted-foreground">Threads appear when a reviewed essay is published.</p>}
        </div>
      </div>
    </section>

    <section aria-labelledby="published-thinking" className="section">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(18rem,0.55fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Published thinking</p>
          <h2 className="max-w-[16ch] font-display text-display-lg text-balance" id="published-thinking">
            An argument you can inspect.
          </h2>
        </div>
        <p className="max-w-lg text-lede text-muted-foreground text-pretty lg:pb-1">
          Each essay keeps its author, publication record and real line of argument visible before
          you begin reading.
        </p>
      </div>

      {current
        ? <div className="mt-12"><EssayRecord entry={current} latest /></div>
        : <div aria-live="polite" className="mt-12 border-y border-line-soft py-10" role="status">
            <p className="font-mono text-eyebrow uppercase text-muted-foreground">No published essays</p>
            <h3 className="mt-4 max-w-xl font-display text-display-md">The journal is intentionally quiet.</h3>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              No reviewed essay is publicly eligible right now. Draft and future writing is not substituted as filler.
            </p>
          </div>}
    </section>

    {earlier.length > 0 && <section aria-labelledby="earlier-essays" className="section border-t border-line-soft">
      <div className="grid gap-7 lg:grid-cols-[minmax(0,0.9fr)_minmax(18rem,0.55fr)] lg:items-end lg:gap-20">
        <h2 className="max-w-[17ch] font-display text-display-lg text-balance" id="earlier-essays">
          Earlier essays, still current.
        </h2>
        <p className="max-w-lg text-lede text-muted-foreground text-pretty lg:pb-1">
          The journal stays ordered by publication date. Every essay below remains inside its declared review window.
        </p>
      </div>
      <ol aria-label="Earlier Fuma essays" className="mt-12 space-y-12">
        {earlier.map((entry) => <li key={entry.meta.slug}><EssayRecord entry={entry} /></li>)}
      </ol>
    </section>}

    <section aria-labelledby="other-reading" className="section border-t border-line-soft">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(18rem,0.58fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Other reading modes</p>
          <h2 className="max-w-[17ch] font-display text-display-lg text-balance" id="other-reading">
            Looking for a record, a route or an answer?
          </h2>
        </div>
        <nav aria-label="Other Fuma publications" className="grid border-t border-line-soft text-sm lg:pb-1">
          <Link className="flex min-h-11 items-center justify-between gap-4 border-b border-line-soft py-3 underline-offset-4 hover:underline" href="/changelog">
            <span>Changelog</span><span className="text-muted-foreground">What changed</span>
          </Link>
          <Link className="flex min-h-11 items-center justify-between gap-4 border-b border-line-soft py-3 underline-offset-4 hover:underline" href="/guides">
            <span>Guides</span><span className="text-muted-foreground">Follow a route</span>
          </Link>
          <Link className="flex min-h-11 items-center justify-between gap-4 border-b border-line-soft py-3 underline-offset-4 hover:underline" href="/docs">
            <span>Fuma Docs</span><span className="text-muted-foreground">Look up a detail</span>
          </Link>
        </nav>
      </div>
    </section>
  </PageMain>
}
