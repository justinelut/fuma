import { CursorPagination } from '@/components/cursor-pagination'
import { AuthorityUnavailable, CTA, FilterBar, Hero, Tag } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { readPublicData } from '@/lib/public-data'
import { canonicalTemplateFilters, exactTemplatePreview } from '@/lib/templates'
import { publicMetadata } from '@/lib/seo'
import Link from 'next/link'

export const metadata = publicMetadata('Templates', 'Discover approved Fuma templates and immutable previews.', '/templates')
export const dynamic = 'force-dynamic'

const INSTALL_CONTENTS = [
  ['Pages', 'Editable nodes on the same canvas you use for the rest of the site.'],
  ['Components', 'Reusable pieces keep their typed parameters and named slots.'],
  ['Design tokens', 'Colour, type and spacing scales arrive ready to change.'],
  ['Your direction', 'After installation, no template-owned layer sits between you and the work.'],
] as const

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const filters = canonicalTemplateFilters(await searchParams)
  const data = await readPublicData('templates', { ...filters, limit: 24 })
  const items = (data?.data.items ?? []).filter(exactTemplatePreview)
  const activeFilters = Object.entries(filters).filter(([key, value]) => key !== 'cursor' && value).length

  return <PageMain className="!max-w-none !px-0 !py-0">
    <Hero
      eyebrow="Approved templates"
      title="Choose the structure. Keep the direction."
      description="Every template here is a reviewed Fuma release. Inspect the real capture, open the exact immutable preview, then reshape every page, component and token after installation."
    />

    <section aria-label="How template releases are presented" className="section !pb-0">
      <dl className="grid border-y border-line-soft sm:grid-cols-3">
        <div className="py-6 sm:pr-7">
          <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Approved</dt>
          <dd className="mt-3 max-w-sm text-sm leading-6">Only releases with current public approval enter the directory.</dd>
        </div>
        <div className="border-t border-line-soft py-6 sm:border-l sm:border-t-0 sm:px-7">
          <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Exact</dt>
          <dd className="mt-3 max-w-sm text-sm leading-6">The capture and preview share one retained release root.</dd>
        </div>
        <div className="border-t border-line-soft py-6 sm:border-l sm:border-t-0 sm:pl-7">
          <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Rechecked</dt>
          <dd className="mt-3 max-w-sm text-sm leading-6">Fuma verifies current approval again before installation.</dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="template-directory" className="section" id="directory">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.58fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Release directory</p>
          <h2 className="max-w-[17ch] font-display text-display-lg text-balance" id="template-directory">
            Find a shape worth starting from.
          </h2>
        </div>
        <p className="max-w-lg text-lede text-muted-foreground text-pretty lg:pb-1">
          Filter by the work you are making, then inspect the release itself. The imagery below comes
          from the same immutable root as each isolated preview.
        </p>
      </div>

      <div className="mt-12 border-y border-line-soft py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
            {data ? `${items.length} approved ${items.length === 1 ? 'match' : 'matches'} on this page` : 'Templates unavailable'}
          </p>
          {activeFilters > 0 && <Link className="text-sm font-medium underline decoration-signal underline-offset-4" href="/templates">
            Clear {activeFilters === 1 ? 'filter' : `${activeFilters} filters`}
          </Link>}
        </div>
        <FilterBar>
          <select aria-label="Profile" name="profile" defaultValue={filters.profile}>
            <option value="">All profiles</option>
            <option value="website">Website</option>
            <option value="publication">Publication</option>
          </select>
          <input aria-label="Capability" name="capability" defaultValue={filters.capability} placeholder="Capability" pattern="[a-z0-9-]+" />
          <input aria-label="Industry" name="industry" defaultValue={filters.industry} placeholder="Industry" pattern="[a-z0-9-]+" />
          <input aria-label="Style" name="style" defaultValue={filters.style} placeholder="Style" pattern="[a-z0-9-]+" />
        </FilterBar>
      </div>

      {!data
        ? <AuthorityUnavailable subject="Templates" />
        : items.length === 0
          ? <section aria-live="polite" className="mt-12 border-b border-line-soft pb-12" role="status">
              <p className="font-mono text-eyebrow uppercase text-muted-foreground">No approved matches</p>
              <h3 className="mt-4 max-w-xl font-display text-display-md">Try a broader path through the directory.</h3>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                Remove one or more filters to see other currently approved releases. No withdrawn or stale template is substituted.
              </p>
              {activeFilters > 0 && <Link className="mt-6 inline-block text-sm font-medium underline decoration-signal underline-offset-4" href="/templates">
                View every approved template
              </Link>}
            </section>
          : <ul aria-label="Approved template releases" className="mt-12 border-t border-line-soft" data-template-release-folio>
              {items.map((item, index) => {
                const reverse = index % 2 === 1
                return <li className="border-b border-line-soft py-10 sm:py-12 lg:py-16" key={item.id}>
                  <article className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)] lg:gap-14">
                    <figure className={reverse ? 'min-w-0 lg:order-2' : 'min-w-0'}>
                      <div className="fuma-rimlit overflow-hidden rounded-surface bg-surface-inset">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-3 sm:px-5">
                          <span className="font-mono text-xs text-muted-foreground">Template preview</span>
                          <span className="font-mono text-[0.7rem] text-muted-foreground">{item.releaseId}</span>
                        </div>
                        {/* Exact release media is intentionally rendered from authority and never copied or transformed by Web. */}
                        <Link aria-label={`View the release record for ${item.name}`} href={`/templates/${item.slug}`}>
                          <img
                            alt={item.image.alt}
                            className="aspect-[16/9] h-auto w-full object-cover transition-opacity hover:opacity-90"
                            decoding="async"
                            height={item.image.height}
                            loading="lazy"
                            src={item.image.url}
                            width={item.image.width}
                          />
                        </Link>
                      </div>
                      <figcaption className="mt-3 font-mono text-xs leading-5 text-muted-foreground">
                        Capture and preview are pinned to the exact retained release.
                      </figcaption>
                    </figure>

                    <div className={reverse ? 'min-w-0 lg:order-1' : 'min-w-0'}>
                      <p className="font-mono text-eyebrow uppercase text-muted-foreground">
                        {item.profiles.join(' + ')}
                      </p>
                      <h3 className="mt-4 font-display text-display-md text-balance">
                        <Link className="decoration-signal underline-offset-4 hover:underline" href={`/templates/${item.slug}`}>{item.name}</Link>
                      </h3>
                      <p className="mt-4 text-sm leading-6 text-muted-foreground text-pretty">{item.summary}</p>

                      <dl className="mt-7 grid gap-x-5 gap-y-4 border-y border-line-soft py-5 sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          <dt className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">Release</dt>
                          <dd className="mt-1 break-all text-xs leading-5">{item.releaseId}</dd>
                        </div>
                        <div>
                          <dt className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">Review</dt>
                          <dd className="mt-1 text-xs leading-5">{item.accessibility.standard}</dd>
                        </div>
                        <div>
                          <dt className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">Preview</dt>
                          <dd className="mt-1 text-xs leading-5">Isolated root</dd>
                        </div>
                      </dl>

                      <div aria-label="Template metadata" className="mt-5 flex flex-wrap gap-2">
                        {item.profiles.map((tag) => <Tag key={`profile-${tag}`}>{tag}</Tag>)}
                        {item.capabilities.map((tag) => <Tag key={`capability-${tag}`}>{tag}</Tag>)}
                        {item.industries.map((tag) => <Tag key={`industry-${tag}`}>{tag}</Tag>)}
                        {item.styles.map((tag) => <Tag key={`style-${tag}`}>{tag}</Tag>)}
                      </div>

                      <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-medium">
                        <Link className="underline decoration-signal underline-offset-4" href={`/templates/${item.slug}`}>Inspect release</Link>
                        <a className="underline decoration-signal underline-offset-4" href={item.previewUrl} rel="noopener noreferrer" target="_blank">
                          Open isolated preview<span className="sr-only"> of {item.name} in a new tab</span>
                        </a>
                      </div>
                    </div>
                  </article>
                </li>
              })}
            </ul>}

      <CursorPagination basePath="/templates" nextCursor={data?.data.page.nextCursor ?? null} filters={filters} />
    </section>

    <section aria-labelledby="installed-template" className="section">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,0.62fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">After installation</p>
          <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="installed-template">
            A starting structure, not a permanent layer.
          </h2>
        </div>
        <p className="max-w-lg text-lede text-muted-foreground text-pretty lg:pb-1">
          Fuma installs the release into the product’s ordinary building materials. Change the system,
          replace the composition or remove what you do not need.
        </p>
      </div>

      <dl className="mt-12 border-t border-line-soft">
        {INSTALL_CONTENTS.map(([label, detail]) => <div className="grid gap-2 border-b border-line-soft py-6 sm:grid-cols-[minmax(10rem,0.36fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10" key={label}>
          <dt className="font-display text-display-md">{label}</dt>
          <dd className="max-w-2xl text-sm leading-6 text-muted-foreground">{detail}</dd>
        </div>)}
      </dl>
    </section>

    <section className="section border-t border-line-soft">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
        <h2 className="max-w-[19ch] font-display text-display-xl text-balance">Begin with a release, or begin with nothing.</h2>
        <div className="lg:pb-1">
          <p className="max-w-lg text-lede text-muted-foreground text-pretty">
            Install a reviewed template when its structure helps. Start from an empty canvas when it does not.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <CTA href="/website">Create a website</CTA>
            <CTA href="/experts" secondary>Commission a studio</CTA>
          </div>
        </div>
      </div>
    </section>
  </PageMain>
}
