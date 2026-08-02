import { CursorPagination } from '@/components/cursor-pagination'
import { AuthorityUnavailable, CTA, Tag } from '@/components/public-sections'
import { ProductShot } from '@/components/section-kit'
import { PageMain } from '@/components/site-shell'
import { readPublicData } from '@/lib/public-data'
import { publicMetadata } from '@/lib/seo'
import Link from 'next/link'

export const metadata = publicMetadata(
  'Reviewed plugins',
  'Inspect current Fuma plugin releases, requested permissions, and review evidence before choosing an extension.',
  '/plugins',
)
export const dynamic = 'force-dynamic'

/**
 * The plugin directory is a review ledger, not a popularity marketplace.
 *
 * Every release-specific value comes from the current public authority projection. If that
 * authority is unavailable, the route fails closed; if a valid query has no results, it renders a
 * distinct empty state. The surrounding architecture copy describes shipped plugin boundaries and
 * never substitutes downloads, ratings, rankings, or endorsements for review evidence.
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

const reviewScope = [
  ['Exact release', 'The version and integrity hash belong to the package that was reviewed.'],
  ['Named publisher', 'The listing carries the publisher identity bound to the approved submission.'],
  ['Visible permissions', 'Requested capability labels stay beside the release instead of appearing after selection.'],
  ['Current decision', 'Revoked or suspended approvals do not remain in the public directory.'],
] as const

const deniedByDefault = [
  ['Host filesystem', 'Plugin backends cannot read or write the host disk.'],
  ['Environment variables', 'Runtime secrets are outside the plugin sandbox.'],
  ['Network access', 'No outbound host is available until a workspace owner grants it explicitly.'],
  ['Admin-window code', 'Editor entrypoints and app-kind admin pages require editor.code approval.'],
] as const

const capabilitySurface = [
  ['HTTP routes', 'Serve an endpoint within Fuma.'],
  ['Admin pages', 'Add a managed workspace screen.'],
  ['Storage and jobs', 'Persist plugin state and schedule work.'],
  ['Loop data sources', 'Expose collections to content loops.'],
  ['Canvas modules', 'Add blocks to the visual editor.'],
  ['Media adapters', 'Connect an approved upload destination.'],
  ['Frontend assets', 'Contribute published scripts and styles.'],
  ['Lifecycle hooks', 'Respond to install, activation, and removal.'],
] as const

export default async function Page({ searchParams }: {
  searchParams: Promise<{ category?: string; query?: string; cursor?: string }>
}) {
  const raw = await searchParams
  const category = tag(raw.category)
  const query = search(raw.query)
  const pageCursor = cursor(raw.cursor)
  const data = await readPublicData('plugins', { category, query, cursor: pageCursor, limit: 24 })
  const items = data?.data.items ?? []
  const categories = data?.data.facets.categories ?? []
  const isFiltered = Boolean(category || query)

  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="page-title" className="section fuma-glow pt-16 sm:pt-24">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.54fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow fuma-rise">Reviewed plugins</p>
          <h1 className="fuma-rise max-w-[17ch] font-display text-display-xl text-balance" id="page-title">
            Backend extensions, before they reach your workspace.
          </h1>
          <p className="fuma-rise mt-6 max-w-2xl text-lede text-muted-foreground text-pretty">
            Read the requested permissions and release-specific review evidence first. A listing
            records what Fuma reviewed; it is not a rating, ranking, or endorsement.
          </p>
          <div className="fuma-rise mt-10 flex flex-wrap items-center gap-3">
            <CTA href="#directory">Browse current releases</CTA>
            <CTA href="/components" secondary>Looking for component packs?</CTA>
          </div>
        </div>

        <aside aria-labelledby="review-scope-title" className="border-t border-line-strong pt-6">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground">What a listing carries</p>
          <h2 className="mt-3 font-display text-display-md" id="review-scope-title">A review receipt, not a score.</h2>
          <dl className="mt-6 divide-y divide-border">
            {reviewScope.map(([label, detail]) => <div className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr]" key={label}>
              <dt className="text-sm font-medium">{label}</dt>
              <dd className="text-sm leading-6 text-muted-foreground">{detail}</dd>
            </div>)}
          </dl>
        </aside>
      </div>
    </section>

    <section aria-labelledby="directory-title" className="section border-t border-border" id="directory">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.45fr)] lg:items-end lg:gap-16">
        <div>
          <p className="eyebrow">Current directory</p>
          <h2 className="max-w-2xl font-display text-display-lg text-balance" id="directory-title">
            Compare capabilities, permissions, and review details.
          </h2>
          <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">
            Search current reviewed plugins. Every result keeps its requested permissions and review
            details attached to the exact release.
          </p>
        </div>
        <p className="border-l border-line-strong pl-5 text-sm leading-6 text-muted-foreground">
          Review metadata helps you inspect a release. Fuma revalidates its signature, revocation
          state, and permissions again before installation.
        </p>
      </div>

      <form aria-label="Filter reviewed plugins" className="mt-10 grid gap-4 rounded-panel border border-border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.42fr)_auto] sm:items-end" method="get" role="search">
        <div>
          <label className="mb-2 block font-mono text-xs uppercase tracking-wider text-muted-foreground" htmlFor="plugin-query">Search name, publisher, or permission</label>
          <input
            className="min-h-11 w-full rounded-control border border-input bg-background px-3 text-sm"
            defaultValue={query}
            id="plugin-query"
            maxLength={80}
            name="query"
            placeholder="Search reviewed plugins"
          />
        </div>
        <div>
          <label className="mb-2 block font-mono text-xs uppercase tracking-wider text-muted-foreground" htmlFor="plugin-category">Category</label>
          <select className="min-h-11 w-full rounded-control border border-input bg-background px-3 text-sm" defaultValue={category ?? ''} id="plugin-category" name="category">
            <option value="">All categories</option>
            {categories.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <button className="control-primary min-h-11 rounded-control bg-primary px-4 text-sm font-medium text-primary-foreground" type="submit">Apply filters</button>
      </form>

      {data === null
        ? <AuthorityUnavailable
            detail="The current plugin list could not be loaded. No outdated or unreviewed records are shown."
            subject="Plugin directory"
          />
        : items.length === 0
          ? <section aria-labelledby="empty-directory-title" aria-live="polite" className="mt-10 rounded-panel border border-dashed border-border p-8" role="status">
              <p className="font-mono text-eyebrow uppercase text-muted-foreground">No current records</p>
              <h3 className="mt-3 font-display text-display-md" id="empty-directory-title">
                {isFiltered ? 'No reviewed plugins match these filters.' : 'No reviewed plugins are listed right now.'}
              </h3>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                {isFiltered
                  ? 'Try a broader name, publisher, permission, or category.'
                  : 'No reviewed plugins are available right now.'}
              </p>
              {isFiltered && <Link className="mt-6 inline-flex border-b border-signal pb-0.5 text-sm font-medium" href="/plugins">Clear filters</Link>}
            </section>
          : <div className="mt-12">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-strong pb-4">
                <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Review ledger</p>
                <p className="text-sm text-muted-foreground">{items.length} current {items.length === 1 ? 'release' : 'releases'} on this page</p>
              </div>
              <div className="divide-y divide-border">
                {items.map((item) => <article aria-labelledby={`plugin-${item.id}`} className="py-10" key={item.id}>
                  <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(16rem,0.52fr)_minmax(19rem,0.7fr)] lg:gap-12">
                    <div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        <span>Reviewed release</span>
                        <span aria-hidden="true">·</span>
                        <time dateTime={item.reviewedAt}>{reviewDate(item.reviewedAt)}</time>
                      </div>
                      <h3 className="mt-4 font-display text-display-md" id={`plugin-${item.id}`}>
                        <Link className="transition-colors hover:text-signal-bright" href={`/plugins/${item.slug}`}>{item.name}</Link>
                      </h3>
                      <p className="mt-2 text-sm text-muted-foreground">Version {item.version} · verified publisher {item.publisherName}</p>
                      <p className="mt-5 max-w-xl leading-7 text-muted-foreground">{item.summary}</p>
                      <div className="mt-6 flex flex-wrap gap-2">{item.categories.map((value) => <Tag key={value}>{value}</Tag>)}</div>
                      <Link className="mt-7 inline-flex items-center gap-2 border-b border-signal/50 pb-0.5 text-sm font-medium transition-colors hover:border-signal-bright" href={`/plugins/${item.slug}`}>
                        Inspect complete release <span aria-hidden="true">→</span>
                      </Link>
                    </div>

                    <section aria-labelledby={`permissions-${item.id}`} className="border-t border-line-strong pt-5 lg:border-t-0 lg:border-l lg:pl-8 lg:pt-0">
                      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Capability request</p>
                      <h4 className="mt-3 text-sm font-medium" id={`permissions-${item.id}`}>Permission labels</h4>
                      {item.permissionLabels.length > 0
                        ? <ul className="mt-4 divide-y divide-border border-y border-border">
                            {item.permissionLabels.map((label) => <li className="py-3 text-sm leading-6" key={label}>{label}</li>)}
                          </ul>
                        : <p className="mt-4 text-sm leading-6 text-muted-foreground">No runtime permissions were declared in this reviewed release.</p>}
                    </section>

                    <section aria-labelledby={`evidence-${item.id}`} className="border-t border-line-strong pt-5 lg:border-t-0 lg:border-l lg:pl-8 lg:pt-0">
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
                          <dt className="text-xs text-muted-foreground">Package integrity</dt>
                          <dd className="mt-2 break-all font-mono text-xs leading-5">sha256:{item.reviewEvidence.contentHashSha256}</dd>
                        </div>
                      </dl>
                    </section>
                  </div>
                </article>)}
              </div>
            </div>}

      <CursorPagination basePath="/plugins" filters={{ category, query }} nextCursor={data?.data.page.nextCursor ?? null} />
    </section>

    <section aria-labelledby="workspace-title" className="section">
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
        <div className="max-w-2xl">
          <p className="eyebrow">Inside Fuma</p>
          <h2 className="font-display text-display-lg text-balance" id="workspace-title">Approval remains visible after discovery.</h2>
          <p className="mt-5 max-w-xl text-lede text-muted-foreground text-pretty">
            The Plugins workspace keeps installed packages and their requested permissions together.
            Choosing a listing never bypasses the installation review.
          </p>
        </div>
        <CTA href="/docs" secondary>Read the plugin documentation</CTA>
      </div>
      <div className="fuma-pool mt-14 sm:mt-16">
        <ProductShot
          alt="The Fuma Plugins workspace listing installed packages and their permissions"
          caption="The real Fuma Plugins workspace, where packages and permission requests are managed."
          src="/product/plugins.webp"
        />
      </div>
    </section>

    <section aria-labelledby="boundary-title" className="section border-t border-border">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Plugin permissions</p>
          <h2 className="max-w-xl font-display text-display-lg text-balance" id="boundary-title">Powerful extensions with explicit access.</h2>
          <p className="mt-5 max-w-lg text-lede text-muted-foreground text-pretty">
            Each plugin backend runs in its own QuickJS-WASM sandbox. It starts without access to
            sensitive features and receives only the permissions a workspace owner approves.
          </p>

          <h3 className="mt-10 font-display text-display-md">Denied by default</h3>
          <dl className="mt-6 divide-y divide-border border-y border-border">
            {deniedByDefault.map(([label, detail]) => <div className="py-5" key={label}>
              <dt className="text-sm font-medium">{label}</dt>
              <dd className="mt-1.5 text-sm leading-6 text-muted-foreground">{detail}</dd>
            </div>)}
          </dl>
        </div>

        <div className="lg:border-l lg:border-line-strong lg:pl-12">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground">Capability surface</p>
          <h3 className="mt-3 max-w-lg font-display text-display-md">What an approved plugin can add</h3>
          <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
            The SDK supports a wide range of extensions. Each release lists the permissions it
            requests so you can review them before installation.
          </p>
          <ul className="mt-8 grid border-t border-border sm:grid-cols-2">
            {capabilitySurface.map(([label, detail]) => <li className="border-b border-border py-5 sm:odd:pr-6 sm:even:border-l sm:even:pl-6" key={label}>
              <p className="text-sm font-medium">{label}</p>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{detail}</p>
            </li>)}
          </ul>
        </div>
      </div>
    </section>

    <section aria-labelledby="plugin-close-title" className="section border-t border-border">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,0.52fr)] lg:items-end lg:gap-20">
        <h2 className="max-w-[20ch] font-display text-display-xl text-balance" id="plugin-close-title">Review access before you extend Fuma.</h2>
        <div>
          <p className="max-w-lg text-lede text-muted-foreground text-pretty">
            Read the manifest, sandbox, permission model, and SDK surface before evaluating a package
            or designing an extension for Fuma.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <CTA href="/docs">Read the plugin documentation</CTA>
            <CTA href="/components" secondary>Browse component packs</CTA>
          </div>
        </div>
      </div>
    </section>
  </PageMain>
}
