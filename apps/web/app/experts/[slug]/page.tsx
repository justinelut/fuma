import { Breadcrumbs } from '@/components/breadcrumbs'
import { ContactForm } from '@/components/contact-form'
import { CTA } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { readPublicItem } from '@/lib/public-data'
import { jsonLd, publicMetadata } from '@/lib/seo'
import { expertStructuredData } from '@/lib/structured-data'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

function approvedDate(value: string): string {
  return new Intl.DateTimeFormat('en-KE', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(value))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const item = await readPublicItem('experts', slug)
  return publicMetadata(
    item?.publicName ?? 'Expert unavailable',
    item?.summary ?? 'This approved expert profile is no longer available.',
    `/experts/${slug}`,
    !item,
  )
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const item = await readPublicItem('experts', slug)
  if (!item) notFound()

  const workCount = item.showcaseIds.length
  const approvedLabel = approvedDate(item.approvedAt)

  return <PageMain className="!max-w-none !px-0 !py-0">
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(expertStructuredData(item))} />

    <section aria-labelledby="expert-name" className="section">
      <Breadcrumbs items={[{ label: 'Experts', href: '/experts' }, { label: item.publicName, href: `/experts/${item.slug}` }]} />

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Approved expert record</p>
          <h1 className="max-w-[18ch] font-display text-display-xl text-balance" id="expert-name">
            {item.publicName}
          </h1>
          <p className="mt-7 max-w-2xl text-lede text-muted-foreground text-pretty">{item.summary}</p>
          <div className="mt-9 flex flex-wrap items-center gap-2.5">
            {item.mediatedInquiryAvailable && <CTA href="#expert-inquiry">Send an inquiry</CTA>}
            <CTA href="/experts" secondary>Back to experts</CTA>
          </div>
        </div>

        <aside aria-label="Public profile record" className="border-t border-line-strong pt-5 lg:border-t-0 lg:border-l lg:pl-8 lg:pt-0">
          <p className="flex items-center gap-2.5 text-sm font-medium">
            <span aria-hidden="true" className="live-indicator size-1.5 shrink-0 rounded-full" />
            Current public record
          </p>
          <dl className="mt-6 border-t border-line-soft text-sm">
            <div className="grid grid-cols-[minmax(7rem,0.65fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Profile</dt>
              <dd className="capitalize">{item.expertType}</dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.65fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Location</dt>
              <dd>{item.location}</dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.65fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Public work</dt>
              <dd>{workCount} linked {workCount === 1 ? 'record' : 'records'}</dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.65fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Approved</dt>
              <dd><time dateTime={item.approvedAt}>{approvedLabel}</time></dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>

    <section aria-labelledby="public-scope-heading" className="section border-t border-line-soft">
      <div className="grid gap-10 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Public scope</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="public-scope-heading">
            The work vocabulary, exactly as published.
          </h2>
          <p className="mt-5 max-w-md text-lede text-muted-foreground text-pretty">
            This record presents only approved public fields. It does not add further profile claims or expose direct or private contact detail.
          </p>
        </div>

        <div className="grid gap-10 sm:grid-cols-2 sm:gap-12">
          <section aria-labelledby="expert-skills-heading">
            <div className="flex items-baseline justify-between gap-4 border-b border-line-strong pb-4">
              <h3 className="font-display text-display-md" id="expert-skills-heading">Skills</h3>
              <p className="font-mono text-xs text-muted-foreground">{item.skills.length} published</p>
            </div>
            {item.skills.length > 0
              ? <ul>
                  {item.skills.map((skill) => <li className="border-b border-line-soft py-4 text-sm" key={skill}>{skill}</li>)}
                </ul>
              : <p className="border-b border-line-soft py-4 text-sm text-muted-foreground">No public skills are listed.</p>}
          </section>

          <section aria-labelledby="expert-services-heading">
            <div className="flex items-baseline justify-between gap-4 border-b border-line-strong pb-4">
              <h3 className="font-display text-display-md" id="expert-services-heading">Services</h3>
              <p className="font-mono text-xs text-muted-foreground">{item.services.length} published</p>
            </div>
            {item.services.length > 0
              ? <ul>
                  {item.services.map((service) => <li className="border-b border-line-soft py-4 text-sm" key={service}>{service}</li>)}
                </ul>
              : <p className="border-b border-line-soft py-4 text-sm text-muted-foreground">No public services are listed.</p>}
          </section>
        </div>
      </div>
    </section>

    <section aria-labelledby="public-work-heading" className="section border-t border-line-soft">
      <div className="grid gap-10 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:items-start lg:gap-20">
        <div>
          <p className="eyebrow">Public work ledger</p>
          <p className="font-display text-display-xl"><span className="sr-only">Linked public work: </span>{workCount}</p>
          <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">
            {workCount === 1 ? 'Approved showcase record linked to this profile.' : 'Approved showcase records linked to this profile.'}
          </p>
        </div>
        <div className="border-t border-line-strong pt-6">
          <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="public-work-heading">
            Public while every approval still stands.
          </h2>
          <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">
            Showcase attribution remains visible only while expert and site-owner attribution consents, current approval, moderation, availability and ownership checks all continue to pass. Withdrawal removes the public record rather than leaving a stale profile behind.
          </p>
          <div className="mt-8"><CTA href="/showcase" secondary>Browse the approved showcase</CTA></div>
        </div>
      </div>
    </section>

    {item.mediatedInquiryAvailable
      ? <section aria-labelledby="expert-inquiry-heading" className="section border-t border-line-soft" id="expert-inquiry">
          <div className="grid gap-10 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
            <div>
              <p className="eyebrow">Mediated inquiry</p>
              <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="expert-inquiry-heading">
                Send a request without exposing a private address.
              </h2>
              <p className="mt-5 max-w-md text-lede text-muted-foreground text-pretty">
                Fuma receives the bounded request and checks the route again before forwarding it. A public listing never reveals the recipient’s private contact details.
              </p>
              <dl className="mt-8 border-t border-line-soft text-sm">
                <div className="border-b border-line-soft py-4">
                  <dt className="font-medium">You send</dt>
                  <dd className="mt-1.5 leading-6 text-muted-foreground">Your name, reply address and message.</dd>
                </div>
                <div className="border-b border-line-soft py-4">
                  <dt className="font-medium">Fuma rechecks</dt>
                  <dd className="mt-1.5 leading-6 text-muted-foreground">Approval, opt-in, moderation, ownership and availability.</dd>
                </div>
                <div className="border-b border-line-soft py-4">
                  <dt className="font-medium">The public page withholds</dt>
                  <dd className="mt-1.5 leading-6 text-muted-foreground">Private recipient and direct contact details.</dd>
                </div>
              </dl>
            </div>

            <div className="min-w-0 lg:border-l lg:border-line-soft lg:pl-10">
              <ContactForm kind="expert_inquiry" expertId={item.id} />
              <div className="mt-6">
                <CTA secondary href={`/start?kind=contact_expert&source=expert&expertId=${item.id}`}>Continue inquiry in the application</CTA>
              </div>
            </div>
          </div>
        </section>
      : <section aria-labelledby="expert-inquiry-heading" className="section border-t border-line-soft" id="expert-inquiry">
          <div className="grid gap-8 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:items-start lg:gap-20">
            <p className="eyebrow">Inquiry status</p>
            <div className="border-t border-line-strong pt-6">
              <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="expert-inquiry-heading">Inquiries are closed on this record.</h2>
              <p className="mt-5 max-w-2xl text-lede text-muted-foreground" role="status">
                This expert is not accepting mediated inquiries. Fuma does not publish an alternative address or route around that choice.
              </p>
              <div className="mt-8"><CTA href="/experts" secondary>Browse other experts</CTA></div>
            </div>
          </div>
        </section>}
  </PageMain>
}
