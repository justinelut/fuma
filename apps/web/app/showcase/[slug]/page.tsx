import type { PublicExpert } from '@fuma/public-contracts'
import { NativeImage } from '@/components/native-image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { CTA, Tag } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { readPublicData, readPublicItem } from '@/lib/public-data'
import { publicMetadata } from '@/lib/seo'

export const dynamic = 'force-dynamic'

const dateFormatter = new Intl.DateTimeFormat('en-KE', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
  year: 'numeric',
})

/**
 * Resolve only reciprocal, currently public expert records. The showcase remains useful when
 * enrichment is unavailable, but Web never guesses a name or manufactures an ID-to-slug link.
 */
async function readLinkedExperts(showcaseId: string, expertIds: readonly string[]): Promise<readonly PublicExpert[] | null> {
  if (expertIds.length === 0) return []
  const envelope = await readPublicData('experts', { limit: 100 })
  if (!envelope) return null

  const byId = new Map(envelope.data.items.map((expert) => [expert.id, expert]))
  const experts = expertIds.map((id) => byId.get(id)).filter((expert): expert is PublicExpert => (
    expert !== undefined && expert.showcaseIds.includes(showcaseId)
  ))
  return experts.length === expertIds.length ? experts : null
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const item = await readPublicItem('showcases', slug)
  return publicMetadata(
    item?.title ?? 'Showcase unavailable',
    item?.summary ?? 'This approved showcase is no longer available.',
    `/showcase/${slug}`,
    !item,
  )
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const item = await readPublicItem('showcases', slug)
  if (!item) notFound()

  const linkedExperts = await readLinkedExperts(item.id, item.expertIds)
  const approvedDate = dateFormatter.format(new Date(item.approvedAt))
  const profileLabel = item.profiles.join(' + ')
  const expertCount = item.expertIds.length

  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="showcase-title" className="section !pb-0 pt-12 sm:pt-16">
      <Breadcrumbs items={[{ label: 'Showcase', href: '/showcase' }, { label: item.title, href: `/showcase/${item.slug}` }]} />

      <div className="grid gap-10 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.46fr)] lg:items-end lg:gap-20">
        <div>
          <p className="fuma-rise flex items-center gap-2.5 font-mono text-eyebrow uppercase text-live">
            <span aria-hidden="true" className="live-indicator size-1.5 shrink-0 rounded-full" />
            Current approved work
          </p>
          <h1 className="fuma-rise mt-5 max-w-[15ch] font-display text-display-xl text-balance" id="showcase-title">
            {item.title}
          </h1>
          <p className="fuma-rise mt-7 max-w-2xl text-lede text-muted-foreground text-pretty">{item.summary}</p>
          <div className="fuma-rise mt-9 flex flex-wrap items-center gap-2.5">
            <CTA href={item.previewUrl}>
              Visit the public work<span className="sr-only"> for {item.title} in a new tab</span>
            </CTA>
            <CTA href="/showcase" secondary>Back to showcase</CTA>
          </div>
        </div>

        <aside aria-label="Current project record" className="border-t border-line-strong pt-5 lg:border-t-0 lg:border-l lg:pl-8 lg:pt-0">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground">Project record</p>
          <dl className="mt-5 border-t border-line-soft text-sm">
            <div className="grid grid-cols-[minmax(7rem,0.65fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Profile</dt>
              <dd className="capitalize">{profileLabel}</dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.65fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Industries</dt>
              <dd>{item.industries.length}</dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.65fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Linked experts</dt>
              <dd>{expertCount}</dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.65fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Approved</dt>
              <dd><time dateTime={item.approvedAt}>{approvedDate}</time></dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>

    <section aria-labelledby="project-media-heading" className="section fuma-pool">
      <div className="mb-6 flex flex-col gap-3 border-b border-line-soft pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow !mb-3">Project view</p>
          <h2 className="font-display text-display-md" id="project-media-heading">The approved work, not a stand-in.</h2>
        </div>
        <p className="max-w-md font-mono text-xs leading-5 text-muted-foreground sm:text-right">
          Media supplied with the current consent-backed public record.
        </p>
      </div>

      <figure>
        <div className="fuma-rimlit relative aspect-[16/10] overflow-hidden rounded-surface bg-surface-inset sm:aspect-[16/9]">
          <NativeImage
            alt=""
            className="object-cover"
            fill
            priority
            sizes="(min-width: 1280px) 1280px, 100vw"
            src={item.imageUrl}
            unoptimized
          />
        </div>
        <figcaption className="mt-4 flex flex-col gap-1 font-mono text-xs leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <span>Published project image</span>
          <span className="shrink-0">Current approved release</span>
        </figcaption>
      </figure>
    </section>

    <section aria-labelledby="project-facts-heading" className="section border-t border-line-soft">
      <div className="grid gap-12 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Project facts</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="project-facts-heading">
            What the public record actually says.
          </h2>
          <p className="mt-5 max-w-md text-lede text-muted-foreground text-pretty">
            These labels come from the approved release. They describe its published context without adding outcomes, clients, awards or endorsement claims.
          </p>
        </div>

        <div className="grid gap-10 sm:grid-cols-2 sm:gap-12">
          <section aria-labelledby="showcase-profiles-heading">
            <div className="flex items-baseline justify-between gap-4 border-b border-line-strong pb-4">
              <h3 className="font-display text-display-md" id="showcase-profiles-heading">Publishing profile</h3>
              <p className="font-mono text-xs text-muted-foreground">{item.profiles.length} published</p>
            </div>
            <ul aria-label="Publishing profiles" className="flex flex-wrap gap-2 border-b border-line-soft py-5">
              {item.profiles.map((value) => <li key={value}><Tag>{value}</Tag></li>)}
            </ul>
          </section>

          <section aria-labelledby="showcase-industries-heading">
            <div className="flex items-baseline justify-between gap-4 border-b border-line-strong pb-4">
              <h3 className="font-display text-display-md" id="showcase-industries-heading">Industries</h3>
              <p className="font-mono text-xs text-muted-foreground">{item.industries.length} published</p>
            </div>
            {item.industries.length > 0
              ? <ul aria-label="Industries" className="flex flex-wrap gap-2 border-b border-line-soft py-5">
                  {item.industries.map((value) => <li key={value}><Tag>{value}</Tag></li>)}
                </ul>
              : <p className="border-b border-line-soft py-5 text-sm text-muted-foreground">No industry labels are published.</p>}
          </section>
        </div>
      </div>
    </section>

    <section aria-labelledby="project-credits-heading" className="section border-t border-line-soft">
      <div className="grid gap-10 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Project credits</p>
          <p className="font-display text-display-xl"><span className="sr-only">Linked experts: </span>{expertCount}</p>
          <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">
            {expertCount === 1 ? 'Current reciprocal expert attribution.' : 'Current reciprocal expert attributions.'}
          </p>
        </div>

        <div>
          <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="project-credits-heading">
            Experts credited by the project.
          </h2>
          <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">
            A profile appears only when both the project and expert listing publish the same credit.
          </p>

          {linkedExperts === null
            ? <div aria-live="polite" className="mt-9 border-y border-line-soft py-6" role="status">
                <p className="font-medium">Linked profile details are unavailable.</p>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  The project record remains current, but the reciprocal public profiles could not be resolved without guessing. No stale name or manufactured link is shown.
                </p>
                <div className="mt-5"><CTA href="/experts" secondary>Browse current experts</CTA></div>
              </div>
            : linkedExperts.length === 0
              ? <div className="mt-9 border-y border-line-soft py-6">
                  <p className="font-medium">No public expert credit is attached.</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">This approved project record does not publish an expert attribution.</p>
                </div>
              : <ul aria-label="Linked public experts" className="mt-9 border-t border-line-strong">
                  {linkedExperts.map((expert) => <li className="border-b border-line-soft py-6 sm:py-7" key={expert.id}>
                    <article className="grid gap-5 sm:grid-cols-[minmax(10rem,0.38fr)_minmax(0,1fr)_auto] sm:items-start sm:gap-8">
                      <div>
                        <p className="font-mono text-xs capitalize text-muted-foreground">{expert.expertType}</p>
                        <p className="mt-1 text-sm">{expert.location}</p>
                      </div>
                      <div>
                        <h3 className="font-display text-display-md">
                          <Link className="decoration-signal underline-offset-4 hover:underline" href={`/experts/${expert.slug}`}>{expert.publicName}</Link>
                        </h3>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{expert.summary}</p>
                      </div>
                      <Link className="text-sm font-medium underline decoration-signal underline-offset-4" href={`/experts/${expert.slug}`}>
                        Public record<span className="sr-only"> for {expert.publicName}</span>
                      </Link>
                    </article>
                  </li>)}
                </ul>}
        </div>
      </div>
    </section>

    <section aria-labelledby="showcase-consent-heading" className="section border-t border-line-soft">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Consent chain</p>
          <h2 className="max-w-[17ch] font-display text-display-lg text-balance" id="showcase-consent-heading">
            Public only while every approval stands.
          </h2>
        </div>
        <div className="lg:pb-1">
          <p className="max-w-lg text-lede text-muted-foreground text-pretty">
            This record remains visible only while expert and site-owner attribution consent, approval, moderation, ownership and availability checks continue to pass. Withdrawal removes the page rather than leaving stale evidence behind.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <CTA href={item.previewUrl}>Visit the public work<span className="sr-only"> in a new tab</span></CTA>
            <CTA href="/showcase" secondary>Browse approved work</CTA>
          </div>
        </div>
      </div>
    </section>
  </PageMain>
}
