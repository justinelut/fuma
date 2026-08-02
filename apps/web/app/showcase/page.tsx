import { CursorPagination } from '@/components/cursor-pagination'
import { AuthorityUnavailable, CTA, Tag } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { readPublicData } from '@/lib/public-data'
import { jsonLd, publicMetadata } from '@/lib/seo'
import { breadcrumbStructuredData } from '@/lib/structured-data'
import { NativeImage } from '@/components/native-image'
import Link from 'next/link'

export const metadata = publicMetadata(
  'Showcase',
  'Explore current consent-backed public work made with Fuma.',
  '/showcase',
)
export const dynamic = 'force-dynamic'

const PROFILES = ['website', 'publication'] as const

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

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
  return new Intl.DateTimeFormat('en-KE', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(value))
}

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await searchParams
  const rawProfile = scalar(raw.profile)
  const profile = PROFILES.includes(rawProfile as typeof PROFILES[number])
    ? rawProfile as typeof PROFILES[number]
    : undefined
  const industry = tag(scalar(raw.industry))
  const query = search(scalar(raw.query))
  const pageCursor = cursor(scalar(raw.cursor))
  const filters = { profile, industry, query }
  const data = await readPublicData('showcases', { ...filters, cursor: pageCursor, limit: 24 })
  const items = data?.data.items ?? []
  const activeFilters = Object.values(filters).filter(Boolean).length

  return <PageMain className="!max-w-none !px-0 !py-0">
    <script
      dangerouslySetInnerHTML={jsonLd(breadcrumbStructuredData([
        { label: 'Home', href: '/' },
        { label: 'Showcase', href: '/showcase' },
      ]))}
      type="application/ld+json"
    />

    <section aria-labelledby="page-title" className="section !pb-0 pt-16 sm:pt-24">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.5fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Current public work</p>
          <h1 className="max-w-[15ch] font-display text-display-xl text-balance" id="page-title">
            The work gets the room. The credit keeps its proof.
          </h1>
        </div>
        <p className="max-w-lg text-lede text-muted-foreground text-pretty lg:pb-1">
          A living folio of websites and publications approved for public display. Every title,
          image, credit, and destination comes from the current approved listing.
        </p>
      </div>
    </section>

    <section aria-label="What public approval means" className="section !pb-0">
      <dl className="grid border-y border-line-soft sm:grid-cols-3">
        <div className="py-6 sm:pr-7">
          <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Permission, twice</dt>
          <dd className="mt-3 max-w-sm text-sm leading-6">Both the attributed expert and the site owner keep current consent.</dd>
        </div>
        <div className="border-t border-line-soft py-6 sm:border-l sm:border-t-0 sm:px-7">
          <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Public release only</dt>
          <dd className="mt-3 max-w-sm text-sm leading-6">Fuma presents approved public material, never a reconstructed concept or borrowed logo.</dd>
        </div>
        <div className="border-t border-line-soft py-6 sm:border-l sm:border-t-0 sm:pl-7">
          <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Rechecked on every read</dt>
          <dd className="mt-3 max-w-sm text-sm leading-6">Withdrawal, opt-out, transfer or suspension removes the work instead of leaving a stale listing.</dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="showcase-folio" className="section" id="folio">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.58fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Public folio</p>
          <h2 className="max-w-[16ch] font-display text-display-lg text-balance" id="showcase-folio">
            Browse the work at the scale it deserves.
          </h2>
        </div>
        <p className="max-w-lg text-lede text-muted-foreground text-pretty lg:pb-1">
          Search by title or industry, or narrow the folio by publishing profile. The order reflects
          current availability, never paid placement or implied endorsement.
        </p>
      </div>

      <div className="mt-12 border-y border-line-soft py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
            {data
              ? `${items.length} current ${items.length === 1 ? 'work record' : 'work records'} on this page`
              : 'Showcase unavailable'}
          </p>
          {activeFilters > 0 && <Link className="text-sm font-medium underline decoration-signal underline-offset-4" href="/showcase">
            Clear {activeFilters === 1 ? 'filter' : `${activeFilters} filters`}
          </Link>}
        </div>

        <form className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1fr)_minmax(10rem,0.38fr)_minmax(10rem,0.38fr)_auto]" method="get">
          <label className="grid gap-2 text-xs font-medium text-muted-foreground">
            Search public work
            <input
              aria-label="Search showcases"
              className="min-h-11 rounded-control border border-control-border bg-background px-3 text-sm text-foreground"
              defaultValue={query}
              name="query"
              placeholder="Title or industry"
            />
          </label>
          <label className="grid gap-2 text-xs font-medium text-muted-foreground">
            Profile
            <select
              aria-label="Profile"
              className="min-h-11 rounded-control border border-control-border bg-background px-3 text-sm text-foreground"
              defaultValue={profile}
              name="profile"
            >
              <option value="">All profiles</option>
              <option value="website">Website</option>
              <option value="publication">Publication</option>
            </select>
          </label>
          <label className="grid gap-2 text-xs font-medium text-muted-foreground">
            Industry
            <input
              aria-label="Industry"
              className="min-h-11 rounded-control border border-control-border bg-background px-3 text-sm text-foreground"
              defaultValue={industry}
              name="industry"
              pattern="[a-z0-9-]+"
              placeholder="e.g. publishing"
            />
          </label>
          <button className="control-primary min-h-11 self-end rounded-control bg-primary px-4 text-sm font-medium text-primary-foreground" type="submit">
            Apply filters
          </button>
        </form>
      </div>

      {!data
        ? <AuthorityUnavailable subject="Showcase" />
        : items.length === 0
          ? <section aria-live="polite" className="mt-12 border-b border-line-soft pb-12" role="status">
              <p className="font-mono text-eyebrow uppercase text-muted-foreground">No current matches</p>
              <h3 className="mt-4 max-w-xl font-display text-display-md">Open the folio a little wider.</h3>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                Remove one or more filters to see other currently approved work. Fuma will not fill this space with withdrawn records or invented examples.
              </p>
              {activeFilters > 0 && <Link className="mt-6 inline-block text-sm font-medium underline decoration-signal underline-offset-4" href="/showcase">
                View all current work
              </Link>}
            </section>
          : <ul aria-label="Current consent-backed public work" className="mt-12 border-t border-line-soft" data-showcase-public-folio>
              {items.map((item) => <li className="border-b border-line-soft py-12 sm:py-16 lg:py-20" key={item.id}>
                <article aria-labelledby={`work-${item.id}`}>
                  <header className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.32fr)] lg:items-end lg:gap-16">
                    <div>
                      <p className="font-mono text-eyebrow uppercase text-muted-foreground">{item.profiles.join(' + ')}</p>
                      <h3 className="mt-4 max-w-[20ch] font-display text-display-lg text-balance" id={`work-${item.id}`}>
                        <Link className="decoration-signal underline-offset-4 hover:underline" href={`/showcase/${item.slug}`}>{item.title}</Link>
                      </h3>
                    </div>
                    <dl className="grid grid-cols-2 gap-5 border-t border-line-soft pt-5 lg:grid-cols-1">
                      <div>
                        <dt className="flex items-center gap-2 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">
                          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-live" />
                          Public state
                        </dt>
                        <dd className="mt-1.5 text-sm">Current approved release</dd>
                      </div>
                      <div>
                        <dt className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">Approved</dt>
                        <dd className="mt-1.5 text-sm"><time dateTime={item.approvedAt}>{approvalDate(item.approvedAt)}</time></dd>
                      </div>
                    </dl>
                  </header>

                  <figure className="mt-9 sm:mt-12">
                    <Link
                      aria-label={`Read the public record for ${item.title}`}
                      className="relative block aspect-video overflow-hidden rounded-surface border border-line-soft bg-surface-inset"
                      href={`/showcase/${item.slug}`}
                    >
                      <NativeImage
                        alt=""
                        className="object-contain transition-opacity hover:opacity-90"
                        fill
                        referrerPolicy="no-referrer"
                        sizes="(min-width: 1280px) 1280px, 100vw"
                        src={item.imageUrl}
                        unoptimized
                      />
                    </Link>
                    <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-xs leading-5 text-muted-foreground">
                      <span>Published project image</span>
                      <span>Approval recorded <time dateTime={item.approvedAt}>{approvalDate(item.approvedAt)}</time></span>
                    </figcaption>
                  </figure>

                  <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.42fr)] lg:gap-16">
                    <div>
                      <p className="max-w-3xl text-lede text-muted-foreground text-pretty">{item.summary}</p>
                      <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-medium">
                        <Link className="underline decoration-signal underline-offset-4" href={`/showcase/${item.slug}`}>Read public record</Link>
                        <a className="underline decoration-signal underline-offset-4" href={item.previewUrl} rel="noopener noreferrer" target="_blank">
                          Visit public work<span className="sr-only"> for {item.title} in a new tab</span>
                        </a>
                      </div>
                    </div>
                    <div>
                      <div aria-label={`${item.title} metadata`} className="flex flex-wrap gap-2">
                        {item.profiles.map((value) => <Tag key={`profile-${value}`}>{value}</Tag>)}
                        {item.industries.map((value) => <Tag key={`industry-${value}`}>{value}</Tag>)}
                      </div>
                      <p className="mt-5 border-t border-line-soft pt-4 font-mono text-xs leading-5 text-muted-foreground">
                        {item.expertIds.length} attributed public {item.expertIds.length === 1 ? 'expert connection' : 'expert connections'}
                      </p>
                    </div>
                  </div>
                </article>
              </li>)}
            </ul>}

      <CursorPagination basePath="/showcase" nextCursor={data?.data.page.nextCursor ?? null} filters={filters} />
    </section>

    <section aria-labelledby="showcase-threshold" className="section">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,0.62fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">The public threshold</p>
          <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="showcase-threshold">
            Presence here is a current state, not a permanent claim.
          </h2>
        </div>
        <p className="max-w-lg text-lede text-muted-foreground text-pretty lg:pb-1">
          Fuma checks the approved release, both attribution consents, owner state, availability and
          moderation before returning this folio. If that chain breaks, the record leaves.
        </p>
      </div>

      <dl className="mt-12 border-t border-line-soft">
        <div className="grid gap-2 border-b border-line-soft py-6 sm:grid-cols-[minmax(12rem,0.38fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10">
          <dt className="font-display text-display-md">Consent</dt>
          <dd className="max-w-2xl text-sm leading-6 text-muted-foreground">The attributed expert and site owner must both keep their release consent current.</dd>
        </div>
        <div className="grid gap-2 border-b border-line-soft py-6 sm:grid-cols-[minmax(12rem,0.38fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10">
          <dt className="font-display text-display-md">Attribution</dt>
          <dd className="max-w-2xl text-sm leading-6 text-muted-foreground">A work record must remain reciprocally connected to its approved public expert record.</dd>
        </div>
        <div className="grid gap-2 border-b border-line-soft py-6 sm:grid-cols-[minmax(12rem,0.38fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10">
          <dt className="font-display text-display-md">Withdrawal</dt>
          <dd className="max-w-2xl text-sm leading-6 text-muted-foreground">Revocation, opt-out, transfer, unavailability or suspension removes the record on the next public read.</dd>
        </div>
      </dl>
    </section>

    <section className="section border-t border-line-soft">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
        <h2 className="max-w-[18ch] font-display text-display-xl text-balance">Built something ready for a public record?</h2>
        <div className="lg:pb-1">
          <p className="max-w-lg text-lede text-muted-foreground text-pretty">
            Ask Fuma about public consideration, or meet an approved expert through the work already here.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <CTA href="/contact">Submit public work</CTA>
            <CTA href="/experts" secondary>Explore experts</CTA>
          </div>
        </div>
      </div>
    </section>
  </PageMain>
}
