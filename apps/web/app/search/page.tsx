import type { Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { PageMain } from '@/components/site-shell'
import { searchEditorial, type EditorialEntry } from '@/lib/editorial'
import { publicMetadata } from '@/lib/seo'

const QUERY_LIMIT = 100
const RESULT_LIMIT = 20

export const metadata = publicMetadata(
  'Search',
  'Search Fuma public documentation and articles.',
  '/search',
  true,
)

function boundedQuery(value: string | readonly string[] | undefined): string {
  const query = typeof value === 'string' ? value : value?.[0] ?? ''
  return query.slice(0, QUERY_LIMIT)
}

function queryTerms(query: string): readonly string[] {
  return [...new Set(query.toLowerCase().trim().split(/\s+/).filter(Boolean))].slice(0, 8)
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function HighlightedText({ children, query }: Readonly<{ children: string; query: string }>) {
  const terms = [...queryTerms(query)].sort((left, right) => right.length - left.length)
  if (terms.length === 0) return children

  const expression = new RegExp(`(${terms.map(escapeRegularExpression).join('|')})`, 'gi')
  const termSet = new Set(terms)
  return children.split(expression).map((part, index): ReactNode => termSet.has(part.toLowerCase())
    ? <mark className="bg-signal-soft text-foreground" key={`${part}-${index}`}>{part}</mark>
    : part)
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  })
}

function SearchResult({ entry, index, query }: Readonly<{
  entry: EditorialEntry
  index: number
  query: string
}>) {
  const titleId = `SearchResult-${index + 1}`

  return <article aria-labelledby={titleId} className="grid gap-6 py-8 sm:py-10 lg:grid-cols-[minmax(8rem,0.24fr)_minmax(0,1fr)] lg:gap-12">
    <header className="flex items-baseline justify-between gap-6 lg:block">
      <p className="font-mono text-eyebrow uppercase text-signal-bright">
        Match {String(index + 1).padStart(2, '0')}
      </p>
      <p className="font-mono text-xs text-muted-foreground lg:mt-3">
        {entry.meta.collection}
      </p>
    </header>

    <div>
      <h3 className="max-w-[26ch] font-display text-display-md text-balance" id={titleId}>
        <Link
          className="decoration-signal underline-offset-4 hover:underline"
          href={entry.canonicalPath as Route}
        >
          <HighlightedText query={query}>{entry.meta.title}</HighlightedText>
        </Link>
      </h3>
      <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
        <HighlightedText query={query}>{entry.meta.description}</HighlightedText>
      </p>

      <footer className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line-soft pt-5 font-mono text-xs text-muted-foreground">
        <span>{entry.meta.category}</span>
        <time dateTime={entry.meta.publishedAt}>Published {formatDate(entry.meta.publishedAt)}</time>
        <span className="break-all">{entry.canonicalPath}</span>
      </footer>
    </div>
  </article>
}

type SearchPageProps = Readonly<{
  searchParams: Promise<{ q?: string | readonly string[] }>
}>

export default async function Page({ searchParams }: SearchPageProps) {
  const query = boundedQuery((await searchParams).q)
  const hasQuery = query.trim().length > 0
  const entries = hasQuery ? await searchEditorial(query) : []

  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="search-title" className="section pt-14 sm:pt-20">
      <p className="eyebrow">Fuma public library</p>
      <div className="grid gap-9 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.48fr)] lg:items-end lg:gap-20">
        <div>
          <h1 className="max-w-[13ch] font-display text-display-xl text-balance" id="search-title">
            Search what Fuma has published.
          </h1>
          <p className="mt-6 max-w-2xl text-lede text-muted-foreground text-pretty">
            One query across reviewed documentation, guides, essays, release notes and public
            policies. Draft and scheduled work never appears here.
          </p>
        </div>

        <dl className="grid border-y border-line-soft text-sm">
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4 border-b border-line-soft py-4">
            <dt className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Source</dt>
            <dd>Generated public index</dd>
          </div>
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4 border-b border-line-soft py-4">
            <dt className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Eligibility</dt>
            <dd>Published and in review</dd>
          </div>
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4 py-4">
            <dt className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Response</dt>
            <dd>Up to {RESULT_LIMIT} ranked matches</dd>
          </div>
        </dl>
      </div>

      <form action="/search" className="mt-14 border-y border-line-strong py-6 sm:py-8" method="get" role="search">
        <label className="font-mono text-eyebrow uppercase text-muted-foreground" htmlFor="public-search">
          What do you need to find?
        </label>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            aria-describedby="search-guidance"
            autoComplete="off"
            className="min-h-14 min-w-0 flex-1 rounded-control border border-input bg-card px-4 font-display text-xl placeholder:font-sans placeholder:text-base placeholder:text-muted-foreground"
            defaultValue={query}
            id="public-search"
            maxLength={QUERY_LIMIT}
            name="q"
            placeholder="Search a subject, task or policy"
            required
            type="search"
          />
          <button className="control-primary min-h-12 shrink-0 rounded-control bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors" type="submit">
            Search library
          </button>
        </div>
        <p className="mt-3 max-w-3xl text-xs leading-5 text-muted-foreground" id="search-guidance">
          Use up to {QUERY_LIMIT} characters. Every search word must appear in the title,
          description or published body.
        </p>
      </form>
    </section>

    {!hasQuery && <section aria-labelledby="search-initial-title" className="section border-t border-line-soft">
      <div className="grid gap-9 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,0.62fr)] lg:items-start lg:gap-20">
        <div>
          <p className="eyebrow">Ready for a query</p>
          <h2 className="max-w-[16ch] font-display text-display-lg text-balance" id="search-initial-title">
            Begin with the thing you are trying to find.
          </h2>
          <p className="mt-5 max-w-xl text-lede text-muted-foreground text-pretty">
            Search a product task, publishing question, policy or release. A blank query does not
            substitute popular pages or guessed recommendations.
          </p>
        </div>

        <dl className="border-t border-line-soft text-sm leading-6">
          <div className="border-b border-line-soft py-5">
            <dt className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Searches</dt>
            <dd className="mt-2">Titles, descriptions and published body text</dd>
          </div>
          <div className="border-b border-line-soft py-5">
            <dt className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Includes</dt>
            <dd className="mt-2">Docs, guides, journal entries, changelog and public policies</dd>
          </div>
          <div className="border-b border-line-soft py-5">
            <dt className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Excludes</dt>
            <dd className="mt-2">Draft, scheduled or otherwise ineligible material</dd>
          </div>
        </dl>
      </div>
    </section>}

    {hasQuery && <section aria-labelledby="search-results-title" className="section border-t border-line-soft">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(18rem,0.52fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Search response</p>
          <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="search-results-title">
            {entries.length === 0
              ? 'No published match.'
              : `${entries.length} published ${entries.length === 1 ? 'match' : 'matches'}.`}
          </h2>
        </div>
        <div className="border-l border-line-strong pl-5 lg:pb-1">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Query</p>
          <p className="mt-2 break-words text-base leading-7">“{query}”</p>
          <p aria-live="polite" className="mt-2 text-xs leading-5 text-muted-foreground" role="status">
            {entries.length === 0
              ? 'The generated public index returned no result.'
              : 'Ordered by match relevance, then publication date.'}
          </p>
        </div>
      </div>

      {entries.length > 0
        ? <ol aria-label={`Search results for ${query}`} className="mt-12 divide-y divide-line-soft border-y border-line-soft">
            {entries.map((entry, index) => <li key={entry.canonicalPath}>
              <SearchResult entry={entry} index={index} query={query} />
            </li>)}
          </ol>
        : <div className="mt-12 border-y border-line-soft py-10 sm:py-14">
            <div className="max-w-2xl">
              <p className="font-mono text-eyebrow uppercase text-muted-foreground">Nothing substituted</p>
              <h3 className="mt-4 font-display text-display-md">Try a broader request.</h3>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                Remove one or more words, or use a broader term. Search requires every word to
                appear somewhere in an eligible public resource.
              </p>
              <Link className="mt-7 inline-flex min-h-11 items-center text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href="/search">
                Clear the query
              </Link>
            </div>
          </div>}
    </section>}
  </PageMain>
}
