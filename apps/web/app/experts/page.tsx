import { CursorPagination } from '@/components/cursor-pagination'
import { AuthorityUnavailable, CTA, FilterBar, Hero, Tag } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { readPublicData } from '@/lib/public-data'
import { publicMetadata } from '@/lib/seo'
import { NativeImage } from '@/components/native-image'
import Link from 'next/link'

export const metadata = publicMetadata('Experts', 'Discover approved Fuma experts and studios.', '/experts')
export const dynamic = 'force-dynamic'

const EXPERT_TYPES = ['designer', 'developer', 'studio', 'agency'] as const

function tag(value?: string): string | undefined {
  return value && /^[a-z0-9-]{1,48}$/.test(value) ? value : undefined
}

function search(value?: string): string | undefined {
  return value && /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(value) ? value : undefined
}

function cursor(value?: string): string | undefined {
  return value && /^[A-Za-z0-9_-]{1,512}$/.test(value) ? value : undefined
}

function approvalDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(value))
}

export default async function Page({ searchParams }: {
  searchParams: Promise<{ expertType?: string; skill?: string; location?: string; query?: string; cursor?: string }>
}) {
  const raw = await searchParams
  const expertType = EXPERT_TYPES.includes(raw.expertType as typeof EXPERT_TYPES[number])
    ? raw.expertType as typeof EXPERT_TYPES[number]
    : undefined
  const skill = tag(raw.skill)
  const location = tag(raw.location)
  const query = search(raw.query)
  const pageCursor = cursor(raw.cursor)
  const filters = { expertType, skill, location, query }
  const data = await readPublicData('experts', { ...filters, cursor: pageCursor, limit: 24 })
  const items = data?.data.items ?? []
  const activeFilters = Object.values(filters).filter(Boolean).length

  return <PageMain className="!max-w-none !px-0 !py-0">
    <Hero
      eyebrow="Consent-backed experts"
      title="Find skilled people through approved public work."
      description="Every record is public by choice, grounded in approved work and rechecked when you open the directory. Fuma presents the evidence; it does not sell placement or imply endorsement."
    />

    <section aria-label="How expert records earn a place here" className="section !pb-0">
      <dl className="grid border-y border-line-soft sm:grid-cols-3">
        <div className="py-6 sm:pr-7">
          <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Visible by choice</dt>
          <dd className="mt-3 max-w-sm text-sm leading-6">Experts and studios opt in to a public record and can opt out again.</dd>
        </div>
        <div className="border-t border-line-soft py-6 sm:border-l sm:border-t-0 sm:px-7">
          <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Work before profile</dt>
          <dd className="mt-3 max-w-sm text-sm leading-6">A listing rests on approved public work and current attribution consent.</dd>
        </div>
        <div className="border-t border-line-soft py-6 sm:border-l sm:border-t-0 sm:pl-7">
          <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Private by default</dt>
          <dd className="mt-3 max-w-sm text-sm leading-6">Introductions stay mediated. Private recipient details never appear here.</dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="expert-directory" className="section" id="directory">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.58fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Public record</p>
          <h2 className="max-w-[17ch] font-display text-display-lg text-balance" id="expert-directory">
            Search the work. Then meet the practice behind it.
          </h2>
        </div>
        <p className="max-w-lg text-lede text-muted-foreground text-pretty lg:pb-1">
          Filter by practice or place. The order comes from current availability and revision evidence,
          never payment, partnership or a membership tier.
        </p>
      </div>

      <div className="mt-12 border-y border-line-soft py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
            {data ? `${items.length} public ${items.length === 1 ? 'record' : 'records'} on this page` : 'Expert directory unavailable'}
          </p>
          {activeFilters > 0 && <Link className="text-sm font-medium underline decoration-signal underline-offset-4" href="/experts">
            Clear {activeFilters === 1 ? 'filter' : `${activeFilters} filters`}
          </Link>}
        </div>

        <FilterBar>
          <input aria-label="Search experts" defaultValue={query} name="query" placeholder="Search experts" />
          <select aria-label="Expert type" defaultValue={expertType} name="expertType">
            <option value="">All expert types</option>
            {EXPERT_TYPES.map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
          <input aria-label="Skill" defaultValue={skill} name="skill" pattern="[a-z0-9-]+" placeholder="Skill" />
          <input aria-label="Location" defaultValue={location} name="location" pattern="[a-z0-9-]+" placeholder="Location" />
        </FilterBar>
      </div>

      {!data
        ? <AuthorityUnavailable subject="Expert directory" />
        : items.length === 0
          ? <section aria-live="polite" className="mt-12 border-b border-line-soft pb-12" role="status">
              <p className="font-mono text-eyebrow uppercase text-muted-foreground">No public matches</p>
              <h3 className="mt-4 max-w-xl font-display text-display-md">Try a wider path through the record.</h3>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                Remove one or more filters to see other currently approved experts. No opted-out, withdrawn or stale profile is substituted.
              </p>
              {activeFilters > 0 && <Link className="mt-6 inline-block text-sm font-medium underline decoration-signal underline-offset-4" href="/experts">
                View every public expert
              </Link>}
            </section>
          : <ul aria-label="Consent-backed public expert records" className="mt-12 border-t border-line-soft" data-expert-consent-ledger>
              {items.map((item) => <li className="relative border-b border-line-soft pl-6 sm:pl-8" key={item.id}>
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-signal-line" />
                <span aria-hidden="true" className="absolute left-0 top-12 size-2 -translate-x-1/2 rounded-full bg-live sm:top-16" />

                <article className="grid gap-8 py-10 sm:py-12 lg:grid-cols-[minmax(14rem,0.48fr)_minmax(0,1fr)] lg:gap-16 lg:py-16">
                  <div className="min-w-0">
                    {item.imageUrl && <figure className="mb-7">
                      <div className="fuma-rimlit relative aspect-[4/3] overflow-hidden rounded-surface bg-surface-inset">
                        <NativeImage
                          alt={`Profile image for ${item.publicName}`}
                          className="object-cover"
                          fill
                          sizes="(min-width: 1024px) 26vw, 100vw"
                          src={item.imageUrl}
                          unoptimized
                        />
                      </div>
                      <figcaption className="mt-3 font-mono text-xs leading-5 text-muted-foreground">Published profile image</figcaption>
                    </figure>}

                    <p className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-muted-foreground">
                      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-live" />
                      Current public release
                    </p>
                    <dl className="mt-5 border-t border-line-soft text-sm">
                      <div className="border-b border-line-soft py-4">
                        <dt className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">Practice</dt>
                        <dd className="mt-1.5 capitalize">{item.expertType}</dd>
                      </div>
                      <div className="border-b border-line-soft py-4">
                        <dt className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">Location</dt>
                        <dd className="mt-1.5">{item.location}</dd>
                      </div>
                      <div className="border-b border-line-soft py-4">
                        <dt className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">Public approval</dt>
                        <dd className="mt-1.5"><time dateTime={item.approvedAt}>{approvalDate(item.approvedAt)}</time></dd>
                      </div>
                      <div className="border-b border-line-soft py-4">
                        <dt className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">Introduction</dt>
                        <dd className="mt-1.5">{item.mediatedInquiryAvailable ? 'Mediated inquiry available' : 'Public profile only'}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="min-w-0 lg:pt-1">
                    <p className="font-mono text-eyebrow uppercase text-muted-foreground">{item.expertType} · {item.location}</p>
                    <h3 className="mt-4 max-w-[18ch] font-display text-display-lg text-balance">
                      <Link className="decoration-signal underline-offset-4 hover:underline" href={`/experts/${item.slug}`}>{item.publicName}</Link>
                    </h3>
                    <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">{item.summary}</p>

                    {(item.skills.length > 0 || item.services.length > 0) && <div className="mt-9 grid gap-7 border-y border-line-soft py-6 sm:grid-cols-2 sm:gap-10">
                      {item.skills.length > 0 && <div>
                        <h4 className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">Skills</h4>
                        <ul aria-label={`${item.publicName} skills`} className="mt-3 flex flex-wrap gap-2">
                          {item.skills.map((value) => <li key={value}><Tag>{value}</Tag></li>)}
                        </ul>
                      </div>}
                      {item.services.length > 0 && <div>
                        <h4 className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">Services</h4>
                        <ul aria-label={`${item.publicName} services`} className="mt-3 flex flex-wrap gap-2">
                          {item.services.map((value) => <li key={value}><Tag>{value}</Tag></li>)}
                        </ul>
                      </div>}
                    </div>}

                    <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-medium">
                      <Link className="underline decoration-signal underline-offset-4" href={`/experts/${item.slug}`}>Inspect public record</Link>
                      {item.showcaseIds.length > 0 && <span className="font-mono text-xs text-muted-foreground">
                        {item.showcaseIds.length} connected public {item.showcaseIds.length === 1 ? 'work record' : 'work records'}
                      </span>}
                    </div>
                  </div>
                </article>
              </li>)}
            </ul>}

      <CursorPagination basePath="/experts" nextCursor={data?.data.page.nextCursor ?? null} filters={filters} />
    </section>

    <section aria-labelledby="public-record-method" className="section">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,0.62fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">The public threshold</p>
          <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="public-record-method">
            A profile stays only while its evidence does.
          </h2>
        </div>
        <p className="max-w-lg text-lede text-muted-foreground text-pretty lg:pb-1">
          Visibility is not permanent inventory. Fuma checks the release, attribution, consent,
          ownership, availability and moderation state again on every directory read.
        </p>
      </div>

      <dl className="mt-12 border-t border-line-soft">
        <div className="grid gap-2 border-b border-line-soft py-6 sm:grid-cols-[minmax(12rem,0.38fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10">
          <dt className="font-display text-display-md">Consent</dt>
          <dd className="max-w-2xl text-sm leading-6 text-muted-foreground">Expert and site-owner attribution consent must both remain current.</dd>
        </div>
        <div className="grid gap-2 border-b border-line-soft py-6 sm:grid-cols-[minmax(12rem,0.38fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10">
          <dt className="font-display text-display-md">Availability</dt>
          <dd className="max-w-2xl text-sm leading-6 text-muted-foreground">An opted-out, unavailable, transferred or suspended profile leaves the next public read.</dd>
        </div>
        <div className="grid gap-2 border-b border-line-soft py-6 sm:grid-cols-[minmax(12rem,0.38fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10">
          <dt className="font-display text-display-md">Introduction</dt>
          <dd className="max-w-2xl text-sm leading-6 text-muted-foreground">A mediated inquiry is checked again before Fuma forwards it, without exposing a private recipient.</dd>
        </div>
      </dl>
    </section>

    <section className="section border-t border-line-soft">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
        <h2 className="max-w-[19ch] font-display text-display-xl text-balance">Choose by the work. Start with a considered introduction.</h2>
        <div className="lg:pb-1">
          <p className="max-w-lg text-lede text-muted-foreground text-pretty">
            Inspect the public record first. When an expert accepts mediated inquiries, continue from their profile without revealing private contact details.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <CTA href="/showcase">Browse approved work</CTA>
            <CTA href="/contact" secondary>Ask about a listing</CTA>
          </div>
        </div>
      </div>
    </section>
  </PageMain>
}
