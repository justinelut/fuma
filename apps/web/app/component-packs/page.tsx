import { CursorPagination } from '@/components/cursor-pagination'
import { AuthorityUnavailable, CTA, FilterBar } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { readPublicData } from '@/lib/public-data'
import { publicMetadata } from '@/lib/seo'
import Link from 'next/link'

export const metadata = publicMetadata(
  'Component packs',
  'Browse current Fuma component-pack releases with exact review and provenance evidence.',
  '/components',
)
export const dynamic = 'force-dynamic'

function tag(value?: string): string | undefined {
  return value && /^[a-z0-9-]{1,48}$/.test(value) ? value : undefined
}

function search(value?: string): string | undefined {
  return value && /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(value) ? value : undefined
}

function cursor(value?: string): string | undefined {
  return value && /^[A-Za-z0-9_-]{1,512}$/.test(value) ? value : undefined
}

export default async function Page({ searchParams }: {
  searchParams: Promise<{ category?: string; query?: string; cursor?: string }>
}) {
  const raw = await searchParams
  const category = tag(raw.category)
  const query = search(raw.query)
  const pageCursor = cursor(raw.cursor)
  const data = await readPublicData('components', { category, query, cursor: pageCursor, limit: 24 })
  const items = data?.data.items ?? []
  const hasFilters = Boolean(category || query)

  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="page-title" className="section pt-16 sm:pt-24">
      <p className="eyebrow">Reviewed component packs</p>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)] lg:items-end lg:gap-20">
        <div>
          <h1 className="max-w-[16ch] font-display text-display-xl text-balance" id="page-title">
            The pack is the unit.
          </h1>
          <p className="mt-6 max-w-2xl text-lede text-muted-foreground text-pretty">
            A component pack holds reusable interface pieces in one versioned presentation release.
            Fuma publishes the set only with its current review record, so the release and its
            evidence stay together.
          </p>
        </div>
        <div className="border-l border-line-strong pl-5">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground">Reading the folio</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Name and summary describe the set. Version, publisher, review date and hashes identify
            the exact release that was reviewed.
          </p>
        </div>
      </div>
      <div className="mt-10 flex flex-wrap items-center gap-2.5">
        <CTA href="#pack-folio">Browse current releases</CTA>
        <CTA href="/plugins" secondary>Compare backend plugins</CTA>
      </div>
    </section>

    <section aria-labelledby="pack-model-title" className="section">
      <div className="border-y border-line-strong">
        <div className="grid gap-8 py-8 lg:grid-cols-[minmax(0,0.62fr)_minmax(0,1fr)] lg:gap-20">
          <div>
            <p className="eyebrow">One coordinated release</p>
            <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="pack-model-title">
              Coherent sets, not loose downloads.
            </h2>
          </div>
          <dl className="grid gap-px bg-border sm:grid-cols-3">
            <div className="bg-background p-5">
              <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Set</dt>
              <dd className="mt-3 text-sm leading-6">Reusable presentation pieces grouped as one pack.</dd>
            </div>
            <div className="bg-background p-5">
              <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Release</dt>
              <dd className="mt-3 text-sm leading-6">One exact version tied to its published review date.</dd>
            </div>
            <div className="bg-background p-5">
              <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Provenance</dt>
              <dd className="mt-3 text-sm leading-6">Content, signature and provenance hashes bind the evidence.</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>

    <section aria-labelledby="pack-folio-title" className="section" id="pack-folio">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.58fr)_minmax(0,1fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Release folio</p>
          <h2 className="font-display text-display-lg text-balance" id="pack-folio-title">Current reviewed sets.</h2>
        </div>
        <p className="max-w-2xl text-lede text-muted-foreground text-pretty">
          Search reviewed releases by pack name or category. Private drafts, site usage, and owner
          information are not shown in this directory.
        </p>
      </div>

      <FilterBar>
        <input
          aria-label="Search component packs"
          className="min-h-11 min-w-0 flex-1 rounded-control border border-input bg-background px-3 text-sm placeholder:text-muted-foreground"
          defaultValue={query}
          name="query"
          placeholder="Search component packs"
        />
        <input
          aria-label="Category"
          className="min-h-11 min-w-0 flex-1 rounded-control border border-input bg-background px-3 text-sm placeholder:text-muted-foreground"
          defaultValue={category}
          name="category"
          placeholder="Category"
        />
      </FilterBar>

      {data === null
        ? <AuthorityUnavailable subject="Component-pack folio" />
        : items.length === 0
          ? <section aria-labelledby="empty-folio-title" className="mt-10 border-y border-dashed border-border py-10" role="status">
              <h3 className="font-display text-display-md" id="empty-folio-title">
                {hasFilters ? 'No reviewed packs match these filters.' : 'No reviewed packs are currently published.'}
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                {hasFilters
                  ? 'Change or clear the name and category filters to inspect the current public folio.'
                  : 'No reviewed component packs are available right now.'}
              </p>
              {hasFilters && <div className="mt-6"><CTA href="/component-packs" secondary>Clear filters</CTA></div>}
            </section>
          : <div className="mt-12 border-t border-line-strong">
              {items.map((item) => <article aria-labelledby={`pack-${item.id}`} className="border-b border-line-strong py-10" key={item.id}>
                <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.56fr)] lg:gap-20">
                  <div>
                    <p className="font-mono text-eyebrow uppercase text-muted-foreground">
                      Component pack · release {item.version}
                    </p>
                    <h3 className="mt-4 max-w-[22ch] font-display text-display-lg text-balance" id={`pack-${item.id}`}>
                      <Link className="decoration-signal underline-offset-8 hover:underline" href={`/components/${item.slug}`}>
                        {item.name}
                      </Link>
                    </h3>
                    <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">{item.summary}</p>
                    <div className="mt-7 flex flex-wrap items-baseline gap-x-5 gap-y-2 text-sm">
                      <p>By {item.publisherName}</p>
                      {item.publisherVerified && <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Verified publisher</p>}
                    </div>
                    {item.categories.length > 0
                      ? <ul aria-label={`${item.name} categories`} className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
                          {item.categories.map((value) => <li className="before:mr-2 before:content-['—']" key={value}>{value}</li>)}
                        </ul>
                      : <p className="mt-5 text-sm text-muted-foreground">No public category labels.</p>}
                  </div>

                  <aside aria-label={`${item.name} release record`} className="border-l border-line-strong pl-5 sm:pl-7">
                    <dl className="grid gap-5 sm:grid-cols-2">
                      <div>
                        <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Reviewed release</dt>
                        <dd className="mt-2 font-mono text-sm">v{item.version}</dd>
                      </div>
                      <div>
                        <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Reviewed on</dt>
                        <dd className="mt-2 text-sm"><time dateTime={item.reviewedAt}>{item.reviewedAt.slice(0, 10)}</time></dd>
                      </div>
                      <div>
                        <dt className="font-mono text-eyebrow uppercase text-muted-foreground">License</dt>
                        <dd className="mt-2 text-sm">{item.reviewEvidence.licenseSpdx}</dd>
                      </div>
                      <div>
                        <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Accessibility</dt>
                        <dd className="mt-2 text-sm">{item.reviewEvidence.accessibilityStandard}</dd>
                      </div>
                    </dl>
                    <details className="mt-6 border-t border-border pt-5">
                      <summary className="cursor-pointer text-sm font-medium text-signal-bright">Inspect release provenance</summary>
                      <dl className="mt-5 grid gap-5 text-sm">
                        <div>
                          <dt className="text-muted-foreground">Content integrity</dt>
                          <dd className="mt-1 break-all font-mono text-xs leading-5">sha256:{item.reviewEvidence.contentHashSha256}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Signature key</dt>
                          <dd className="mt-1 break-all font-mono text-xs leading-5">{item.reviewEvidence.signatureKeyId}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Signed payload</dt>
                          <dd className="mt-1 break-all font-mono text-xs leading-5">sha256:{item.reviewEvidence.signaturePayloadHashSha256}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Provenance record</dt>
                          <dd className="mt-1 break-all font-mono text-xs leading-5">sha256:{item.reviewEvidence.provenanceHashSha256}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Minimum runtime</dt>
                          <dd className="mt-1 font-mono text-xs leading-5">{item.reviewEvidence.minimumRuntimeVersion}</dd>
                        </div>
                      </dl>
                    </details>
                  </aside>
                </div>
              </article>)}
            </div>}

      <CursorPagination
        basePath="/component-packs"
        filters={{ category, query }}
        nextCursor={data?.data.page.nextCursor ?? null}
      />
    </section>

    <section aria-labelledby="presentation-title" className="section border-t border-border">
      <p className="eyebrow">Components and plugins</p>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.5fr)] lg:items-end lg:gap-20">
        <div>
          <h2 className="max-w-[20ch] font-display text-display-xl text-balance" id="presentation-title">
            Choose the right kind of extension.
          </h2>
          <p className="mt-6 max-w-2xl text-lede text-muted-foreground text-pretty">
            Component packs add interface pieces. Plugins add backend behaviour and require a separate permission review.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5 lg:justify-end">
          <CTA href="/plugins">Browse plugins</CTA>
          <CTA href="/docs" secondary>Read the docs</CTA>
        </div>
      </div>
    </section>
  </PageMain>
}
