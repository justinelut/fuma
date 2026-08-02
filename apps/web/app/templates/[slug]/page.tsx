import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { CTA, Tag } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { jsonLd, publicMetadata } from '@/lib/seo'
import { templateStructuredData } from '@/lib/structured-data'
import { installTemplateHref, readTemplateDetail } from '@/lib/templates'

export const dynamic = 'force-dynamic'

const dateFormatter = new Intl.DateTimeFormat('en-KE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

const numberFormatter = new Intl.NumberFormat('en-KE')

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const result = await readTemplateDetail(slug)
  if (result.status === 'available') {
    return publicMetadata(result.item.name, result.item.summary, `/templates/${result.item.slug}`)
  }

  // Missing, withdrawn, malformed, and authority-unavailable reads share one generic noindex
  // representation. Metadata must not become a side channel for approval history or outages.
  return publicMetadata(
    'Template unavailable',
    'No currently approved template exists at this address.',
    '/templates',
    true,
  )
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const result = await readTemplateDetail(slug)

  // Every non-approved read fails closed through the same 404. Only a withdrawn read has an
  // authority tombstone, but none produce detail markup or Product JSON-LD.
  if (result.status !== 'available') notFound()
  const { item } = result

  const approvedDate = dateFormatter.format(new Date(item.approvedAt))
  const imageDimensions = `${numberFormatter.format(item.image.width)} × ${numberFormatter.format(item.image.height)}`
  const imageKilobytes = `${numberFormatter.format(Math.ceil(item.image.byteSize / 1_000))} kB`
  const metadataGroups = [
    ['Profiles', item.profiles],
    ['Capabilities', item.capabilities],
    ['Industries', item.industries],
    ['Style', item.styles],
  ] as const
  const accessibilityChecks = [
    ['Keyboard', item.accessibility.keyboardChecked],
    ['Reduced motion', item.accessibility.reducedMotionChecked],
    ['High contrast', item.accessibility.highContrastChecked],
  ] as const

  return <PageMain className="!max-w-none !px-0 !py-0">
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(templateStructuredData(item))} />

    <section className="section !pb-0 pt-12 sm:pt-16">
      <Breadcrumbs items={[{ label: 'Templates', href: '/templates' }, { label: item.name, href: `/templates/${item.slug}` }]} />

      <div className="grid gap-10 pt-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(20rem,0.55fr)] lg:items-end lg:gap-20">
        <div>
          <p className="fuma-rise flex items-center gap-2.5 font-mono text-eyebrow uppercase text-live">
            <span aria-hidden="true" className="live-indicator size-1.5 shrink-0 rounded-full" />
            Approved exact release
          </p>
          <h1 className="fuma-rise mt-5 max-w-[13ch] font-display text-4xl font-medium tracking-[-0.022em] text-balance sm:text-5xl lg:text-[4.75rem] lg:leading-none">
            {item.name}
          </h1>
        </div>

        <div className="lg:pb-1">
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">{item.summary}</p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <CTA href={installTemplateHref(item.id)}>Use this template</CTA>
            <CTA href={item.previewUrl} secondary>
              Open exact preview<span className="sr-only"> of {item.name} in a new tab</span>
            </CTA>
          </div>
        </div>
      </div>
    </section>

    <section aria-labelledby="release-artifact" className="section fuma-pool">
      <div className="mb-6 flex flex-col gap-3 border-b border-line-soft pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow !mb-3">Release artifact</p>
          <h2 className="font-display text-display-md" id="release-artifact">The work, without a stand-in.</h2>
        </div>
        <p className="max-w-md font-mono text-xs leading-5 text-muted-foreground sm:text-right">
          Published media from the reviewed template release.
        </p>
      </div>

      <figure>
        <div className="fuma-rimlit overflow-hidden rounded-surface bg-surface-inset p-2 sm:p-3">
          <img
            alt={item.image.alt}
            className="block h-auto w-full rounded-panel"
            decoding="async"
            fetchPriority="high"
            height={item.image.height}
            src={item.image.url}
            width={item.image.width}
          />
        </div>
        <figcaption className="mt-4 flex flex-col gap-1 font-mono text-xs leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <span>{item.image.alt}</span>
          <span className="shrink-0">{imageDimensions} px · {imageKilobytes}</span>
        </figcaption>
      </figure>

      <dl className="mt-10 grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0 bg-background p-5 sm:p-6">
          <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Release</dt>
          <dd className="mt-3 break-all font-mono text-sm leading-6">{item.releaseId}</dd>
        </div>
        <div className="bg-background p-5 sm:p-6">
          <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Approved</dt>
          <dd className="mt-3 text-sm leading-6"><time dateTime={item.approvedAt}>{approvedDate}</time></dd>
        </div>
        <div className="bg-background p-5 sm:p-6">
          <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Preview</dt>
          <dd className="mt-3 text-sm leading-6">Isolated exact release</dd>
        </div>
        <div className="bg-background p-5 sm:p-6">
          <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Install check</dt>
          <dd className="mt-3 text-sm leading-6">Approval revalidated by Fuma</dd>
        </div>
      </dl>
    </section>

    <section className="section border-t border-line-soft">
      <div className="grid gap-14 lg:grid-cols-[minmax(0,0.8fr)_minmax(22rem,0.7fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Fit</p>
          <h2 className="max-w-[16ch] font-display text-display-lg text-balance">A clear starting shape.</h2>
          <p className="mt-5 max-w-xl text-lede text-muted-foreground text-pretty">
            These labels come from the approved template record. They describe where the structure starts; once installed, it becomes part of your Fuma site.
          </p>

          <div aria-label="Template metadata" className="mt-10 border-t border-line-soft">
            {metadataGroups.map(([label, tags]) => <div className="grid gap-3 border-b border-line-soft py-5 sm:grid-cols-[8rem_minmax(0,1fr)]" key={label}>
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => <Tag key={`${label}-${tag}`}>{tag}</Tag>)}
              </div>
            </div>)}
          </div>
        </div>

        <section aria-labelledby="template-accessibility" className="rounded-surface border border-line-strong bg-card p-6 sm:p-8">
          <p className="font-mono text-eyebrow uppercase text-live">Reviewed standard</p>
          <h2 className="mt-4 font-display text-display-md" id="template-accessibility">Accessibility review</h2>
          <p className="mt-3 text-lede">{item.accessibility.standard}</p>

          <dl className="mt-8 grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {accessibilityChecks.map(([label, checked]) => <div className="bg-background p-4" key={label}>
              <dt className="text-xs leading-5 text-muted-foreground">{label}</dt>
              <dd className="mt-1 flex items-center gap-2 text-sm font-medium">
                {checked && <span aria-hidden="true" className="size-1.5 rounded-full bg-live" />}
                {checked ? 'Checked' : 'Not checked'}
              </dd>
            </div>)}
          </dl>

          <ul className="mt-8 grid gap-4 border-t border-line-soft pt-6">
            {item.accessibility.notes.map((note) => <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 text-sm leading-6" key={note}>
              <span aria-hidden="true" className="mt-2 size-1.5 rounded-full bg-signal-bright" />
              <span>{note}</span>
            </li>)}
          </ul>
        </section>
      </div>
    </section>

    <section aria-labelledby="template-next" className="section border-t border-line-soft">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Start with this design</p>
          <h2 className="max-w-[17ch] font-display text-display-lg text-balance" id="template-next">Make this starting point yours.</h2>
        </div>
        <div className="lg:pb-1">
          <p className="max-w-lg text-lede text-muted-foreground text-pretty">
            Open the template in Fuma, choose a site, and review the current version before adding it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <CTA href={installTemplateHref(item.id)}>Use this template</CTA>
            <CTA href="/templates" secondary>Back to templates</CTA>
          </div>
        </div>
      </div>
    </section>
  </PageMain>
}
