import { CursorPagination } from '@/components/cursor-pagination'
import { AuthorityUnavailable, CTA, Tag } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { readPublicData } from '@/lib/public-data'
import { publicMetadata } from '@/lib/seo'
import Link from 'next/link'

export const metadata = publicMetadata(
  'Reviewed component packs',
  'Browse current Fuma component-pack releases with exact versions, declared permissions, and review evidence.',
  '/components',
)
export const dynamic = 'force-dynamic'

/**
 * The component directory is a parts bench, not a popularity marketplace.
 *
 * Release-specific values come only from the current public authority projection. The composition
 * diagrams describe the shipped component-pack contract; they are not fabricated product UI.
 * Private site components, source drafts, usage, and tenant identifiers never enter this route.
 */

function tag(value?: string): string | undefined {
  return value && /^[a-z0-9-]{1,48}$/.test(value) ? value : undefined
}

function search(value?: string): string | undefined {
  return value && /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(value) ? value : undefined
}

function cursor(value?: string): string | undefined {
  return value && /^[A-Za-z0-9_-]{1,512}$/.test(value) ? value : undefined
}

function reviewDate(value: string): string {
  return new Intl.DateTimeFormat('en-KE', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(value))
}

const releaseReceipt = [
  ['Exact release', 'Version and integrity evidence stay attached to the reviewed bytes.'],
  ['Verified publisher', 'The current listing names the verified publisher.'],
  ['Declared permissions', 'Every requested permission remains visible before a pack is selected.'],
  ['Current decision', 'Withdrawn or revoked releases do not remain discoverable here.'],
] as const

const parameterTypes = [
  'string',
  'number',
  'boolean',
  'colour',
  'image',
  'URL',
  'rich text',
  'enum',
  'slot',
] as const

const compositionLayers = [
  ['Inputs', 'Typed props and named slots define what a builder can change.'],
  ['Variation', 'Variants, conditions, loops, and bindings shape how content composes.'],
  ['Structure', 'A canonical node tree keeps the building piece inspectable and version-bound.'],
  ['Presentation', 'Styles, tokens, responsive rules, and reduced-motion-aware animation travel with the release.'],
] as const

const separation = [
  ['Component pack', 'Reviewed client-side presentation assembled from version-bound building pieces.'],
  ['Private component', 'A site-owned definition remains private to its exact owner and is not made public by this directory.'],
  ['Plugin', 'A backend extension runs through a separate sandbox and permission review path.'],
] as const

export default async function Page({ searchParams }: {
  searchParams: Promise<{ category?: string; query?: string; cursor?: string }>
}) {
  const raw = await searchParams
  const category = tag(raw.category)
  const query = search(raw.query)
  const pageCursor = cursor(raw.cursor)
  const data = await readPublicData('components', { category, query, cursor: pageCursor, limit: 24 })
  const items = data?.data.items ?? []
  const categories = data?.data.facets.categories ?? []
  const isFiltered = Boolean(category || query)

  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="page-title" className="section fuma-glow pt-16 sm:pt-24">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow fuma-rise">Reviewed component packs</p>
          <h1 className="fuma-rise max-w-[16ch] font-display text-display-xl text-balance" id="page-title">
            Building pieces that hold together.
          </h1>
          <p className="fuma-rise mt-6 max-w-2xl text-lede text-muted-foreground text-pretty">
            Find reusable, composable presentation for Fuma. Every public listing names the exact
            reviewed release; popularity, private source, and site usage stay out of the decision.
          </p>
          <div className="fuma-rise mt-10 flex flex-wrap items-center gap-3">
            <CTA href="#directory">Browse current packs</CTA>
            <CTA href="/plugins" secondary>Looking for backend plugins?</CTA>
          </div>
        </div>

        <aside aria-labelledby="receipt-title" className="border-t border-line-strong pt-6">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground">Release receipt</p>
          <h2 className="mt-3 font-display text-display-md" id="receipt-title">Reviewed as a whole, reused in parts.</h2>
          <dl className="mt-6 divide-y divide-border">
            {releaseReceipt.map(([label, detail]) => <div className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr]" key={label}>
              <dt className="text-sm font-medium">{label}</dt>
              <dd className="text-sm leading-6 text-muted-foreground">{detail}</dd>
            </div>)}
          </dl>
        </aside>
      </div>
    </section>

    <section aria-labelledby="composition-title" className="section border-t border-border">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(18rem,0.48fr)] lg:items-end lg:gap-16">
        <div>
          <p className="eyebrow">Composition anatomy</p>
          <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="composition-title">
            A stable release. Many useful arrangements.
          </h2>
        </div>
        <p className="max-w-lg text-lede text-muted-foreground text-pretty">
          Packs expose bounded choices instead of a sealed picture. Builders combine typed values,
          content slots, and variants while the reviewed release remains exact.
        </p>
      </div>

      <div className="fuma-rimlit mt-12 overflow-hidden rounded-surface bg-surface-inset">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-4 sm:px-7">
          <span className="font-mono text-xs text-muted-foreground">Reviewed component-pack contract</span>
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Inputs → composition → output</span>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
          <section aria-labelledby="parameter-title" className="border-b border-line-soft p-5 sm:p-7 lg:border-b-0 lg:border-r">
            <p className="font-mono text-eyebrow uppercase text-muted-foreground">Typed inputs</p>
            <h3 className="mt-3 font-display text-display-md" id="parameter-title">Parameters a builder can recognise.</h3>
            <ul className="mt-6 flex flex-wrap gap-2" aria-label="Supported component parameter types">
              {parameterTypes.map((value) => <li className="rounded-control border border-border bg-card px-2.5 py-1.5 font-mono text-xs text-muted-foreground" key={value}>{value}</li>)}
            </ul>
            <p className="mt-6 border-t border-line-soft pt-5 text-sm leading-6 text-muted-foreground">
              Named slots can carry whole regions of content. Typed values keep the component’s
              editable surface explicit rather than hiding it inside source.
            </p>
          </section>

          <section aria-labelledby="layers-title" className="p-5 sm:p-7">
            <p className="font-mono text-eyebrow uppercase text-muted-foreground">Composition layers</p>
            <h3 className="sr-only" id="layers-title">How a component pack composes</h3>
            <ol className="mt-6 grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-2">
              {compositionLayers.map(([label, detail], index) => <li className="bg-background p-5 sm:p-6" key={label}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{label}</p>
                  <span className="font-mono text-xs text-muted-foreground" aria-label={`Layer ${index + 1} of ${compositionLayers.length}`}>{index + 1}/{compositionLayers.length}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{detail}</p>
              </li>)}
            </ol>
          </section>
        </div>

        <div className="grid gap-px border-t border-line-soft bg-line-soft sm:grid-cols-3">
          {[
            ['Version-bound', 'Installs pin an exact release'],
            ['Inspectable', 'Release details, review evidence, and requested permissions'],
            ['Reusable', 'The same building piece can carry different content'],
          ].map(([label, detail]) => <div className="bg-background px-5 py-4 sm:px-7" key={label}>
            <p className="text-sm font-medium">{label}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
          </div>)}
        </div>
      </div>
    </section>

    <section aria-labelledby="directory-title" className="section border-t border-border" id="directory">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.45fr)] lg:items-end lg:gap-16">
        <div>
          <p className="eyebrow">Current library</p>
          <h2 className="max-w-2xl font-display text-display-lg text-balance" id="directory-title">
            Choose by fit, then review the release.
          </h2>
          <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">
            Search reviewed component packs by name, publisher, or category. Each result keeps its
            version, permissions, and review details together.
          </p>
        </div>
        <p className="border-l border-line-strong pl-5 text-sm leading-6 text-muted-foreground">
          A listing shows a current reviewed release, not a rating or endorsement. Fuma checks the
          release again before installation.
        </p>
      </div>

      <form aria-label="Filter reviewed component packs" className="mt-10 grid gap-4 rounded-panel border border-border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.42fr)_auto] sm:items-end" method="get" role="search">
        <div>
          <label className="mb-2 block font-mono text-xs uppercase tracking-wider text-muted-foreground" htmlFor="component-query">Search name or publisher</label>
          <input
            className="min-h-11 w-full rounded-control border border-input bg-background px-3 text-sm"
            defaultValue={query}
            id="component-query"
            maxLength={80}
            name="query"
            placeholder="Search reviewed packs"
          />
        </div>
        <div>
          <label className="mb-2 block font-mono text-xs uppercase tracking-wider text-muted-foreground" htmlFor="component-category">Category</label>
          <select className="min-h-11 w-full rounded-control border border-input bg-background px-3 text-sm" defaultValue={category ?? ''} id="component-category" name="category">
            <option value="">All categories</option>
            {categories.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <button className="control-primary min-h-11 rounded-control bg-primary px-4 text-sm font-medium text-primary-foreground" type="submit">Apply filters</button>
      </form>

      {data === null
        ? <AuthorityUnavailable
            detail="The current component list could not be loaded. No outdated or unreviewed records are shown."
            subject="Component directory"
          />
        : items.length === 0
          ? <section aria-labelledby="empty-directory-title" aria-live="polite" className="mt-10 rounded-panel border border-dashed border-border p-8" role="status">
              <p className="font-mono text-eyebrow uppercase text-muted-foreground">No current records</p>
              <h3 className="mt-3 font-display text-display-md" id="empty-directory-title">
                {isFiltered ? 'No reviewed packs match these filters.' : 'No reviewed component packs are listed right now.'}
              </h3>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                {isFiltered
                  ? 'Try a broader name, publisher, or category.'
                  : 'No reviewed component packs are available right now.'}
              </p>
              {isFiltered && <Link className="mt-6 inline-flex border-b border-signal pb-0.5 text-sm font-medium" href="/components">Clear filters</Link>}
            </section>
          : <div className="mt-12">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-strong pb-4">
                <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Parts bench</p>
                <p className="text-sm text-muted-foreground">{items.length} current {items.length === 1 ? 'release' : 'releases'} on this page</p>
              </div>
              <div className="divide-y divide-border">
                {items.map((item) => <article aria-labelledby={`component-${item.id}`} className="py-10" key={item.id}>
                  <div className="grid gap-8 lg:grid-cols-[minmax(0,0.86fr)_minmax(15rem,0.46fr)_minmax(19rem,0.68fr)] lg:gap-12">
                    <div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        <span>Reviewed component pack</span>
                        <span aria-hidden="true">·</span>
                        <time dateTime={item.reviewedAt}>{reviewDate(item.reviewedAt)}</time>
                      </div>
                      <h3 className="mt-4 font-display text-display-md" id={`component-${item.id}`}>
                        <Link className="transition-colors hover:text-signal-bright" href={`/components/${item.slug}`}>{item.name}</Link>
                      </h3>
                      <p className="mt-2 text-sm text-muted-foreground">Version {item.version} · verified publisher {item.publisherName}</p>
                      <p className="mt-5 max-w-xl leading-7 text-muted-foreground">{item.summary}</p>
                      {item.categories.length > 0
                        ? <ul className="mt-6 flex flex-wrap gap-2" aria-label={`Categories for ${item.name}`}>
                            {item.categories.map((value) => <li key={value}><Tag>{value}</Tag></li>)}
                          </ul>
                        : <p className="mt-6 text-sm text-muted-foreground">No categories are published for this release.</p>}
                      <Link className="mt-7 inline-flex items-center gap-2 border-b border-signal pb-0.5 text-sm font-medium transition-colors hover:border-signal-bright" href={`/components/${item.slug}`}>
                        Inspect complete release <span aria-hidden="true">→</span>
                      </Link>
                    </div>

                    <section aria-labelledby={`authority-${item.id}`} className="border-t border-line-strong pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Requested permissions</p>
                      <h4 className="sr-only" id={`authority-${item.id}`}>Declared permissions for {item.name}</h4>
                      {item.permissionLabels.length > 0
                        ? <ul className="mt-4 divide-y divide-border border-y border-border">
                            {item.permissionLabels.map((label) => <li className="py-3 text-sm leading-6" key={label}>{label}</li>)}
                          </ul>
                        : <p className="mt-4 text-sm leading-6 text-muted-foreground" role="status">No permissions are declared for this reviewed release.</p>}
                    </section>

                    <section aria-labelledby={`evidence-${item.id}`} className="border-t border-line-strong pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Review evidence</p>
                      <h4 className="sr-only" id={`evidence-${item.id}`}>Evidence for {item.name} version {item.version}</h4>
                      <dl className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                        <div>
                          <dt className="text-xs text-muted-foreground">Licence</dt>
                          <dd className="mt-1 text-sm">{item.reviewEvidence.licenseSpdx}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Accessibility</dt>
                          <dd className="mt-1 text-sm">{item.reviewEvidence.accessibilityStandard}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Minimum runtime</dt>
                          <dd className="mt-1 text-sm">{item.reviewEvidence.minimumRuntimeVersion}</dd>
                        </div>
                      </dl>
                      <dl className="mt-5 border-t border-border pt-4">
                        <div>
                          <dt className="text-xs text-muted-foreground">Pack integrity</dt>
                          <dd className="mt-2 break-all font-mono text-xs leading-5">sha256:{item.reviewEvidence.contentHashSha256}</dd>
                        </div>
                      </dl>
                    </section>
                  </div>
                </article>)}
              </div>
            </div>}

      <CursorPagination basePath="/components" filters={{ category, query }} nextCursor={data?.data.page.nextCursor ?? null} />
    </section>

    <section aria-labelledby="separation-title" className="section border-t border-border">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Clear boundaries</p>
          <h2 className="max-w-xl font-display text-display-lg text-balance" id="separation-title">Reuse does not erase ownership.</h2>
          <p className="mt-5 max-w-lg text-lede text-muted-foreground text-pretty">
            The public library shows reviewed distributable releases. It does not expose the private
            components, drafts, source, site relationships, or usage data that belong inside Fuma.
          </p>
        </div>
        <dl className="divide-y divide-border border-y border-border">
          {separation.map(([label, detail]) => <div className="grid gap-2 py-6 sm:grid-cols-[10rem_1fr]" key={label}>
            <dt className="text-sm font-medium">{label}</dt>
            <dd className="text-sm leading-6 text-muted-foreground">{detail}</dd>
          </div>)}
        </dl>
      </div>
    </section>

    <section aria-labelledby="component-close-title" className="section border-t border-border">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,0.52fr)] lg:items-end lg:gap-20">
        <h2 className="max-w-[20ch] font-display text-display-xl text-balance" id="component-close-title">Build once. Compose with intent.</h2>
        <div>
          <p className="max-w-lg text-lede text-muted-foreground text-pretty">
            Read how typed parameters, slots, exact versions, review evidence, and lifecycle rules
            keep reusable building pieces dependable inside Fuma.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <CTA href="/docs">Read the documentation</CTA>
            <CTA href="/plugins" secondary>Browse backend plugins</CTA>
          </div>
        </div>
      </div>
    </section>
  </PageMain>
}
