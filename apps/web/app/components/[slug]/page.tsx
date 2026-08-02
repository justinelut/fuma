import { Breadcrumbs } from '@/components/breadcrumbs'
import { CTA } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { readPublicItem } from '@/lib/public-data'
import { jsonLd, publicMetadata } from '@/lib/seo'
import { breadcrumbStructuredData } from '@/lib/structured-data'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

const reviewedDate = new Intl.DateTimeFormat('en-KE', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
  year: 'numeric',
})

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const item = await readPublicItem('components', slug)
  return publicMetadata(
    item?.name ?? 'Component pack unavailable',
    item?.summary ?? 'This reviewed component pack is no longer available.',
    `/components/${slug}`,
    !item,
  )
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const item = await readPublicItem('components', slug)
  if (!item) notFound()

  const breadcrumbs = [
    { label: 'Components', href: '/components' },
    { label: item.name, href: `/components/${item.slug}` },
  ] as const
  const permissionCount = item.permissionLabels.length
  const evidenceRows = [
    ['Content integrity', `sha256:${item.reviewEvidence.contentHashSha256}`],
    ['Signature key', item.reviewEvidence.signatureKeyId],
    ['Signed payload', `sha256:${item.reviewEvidence.signaturePayloadHashSha256}`],
    ['Provenance record', `sha256:${item.reviewEvidence.provenanceHashSha256}`],
  ] as const

  return <PageMain className="!max-w-none !px-0 !py-0">
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(breadcrumbStructuredData(breadcrumbs))} />

    <section aria-labelledby="component-name" className="section !pb-0 pt-12 sm:pt-16">
      <Breadcrumbs items={breadcrumbs} />

      <div className="grid gap-12 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)] lg:items-end lg:gap-20">
        <div>
          <p className="fuma-rise flex items-center gap-2.5 font-mono text-eyebrow uppercase text-live">
            <span aria-hidden="true" className="live-indicator size-1.5 shrink-0 rounded-full" />
            Current reviewed component release
          </p>
          <h1 className="fuma-rise mt-5 max-w-[14ch] font-display text-display-xl text-balance" id="component-name">
            {item.name}
          </h1>
          <p className="mt-7 max-w-2xl text-lede text-muted-foreground text-pretty">{item.summary}</p>
          <div className="mt-9 flex flex-wrap items-center gap-2.5">
            <CTA href="#component-review-evidence">Inspect review evidence</CTA>
            <CTA href="/components" secondary>Back to component packs</CTA>
          </div>
        </div>

        <aside aria-label="Artifact identity" className="border-t border-line-strong pt-5 lg:border-t-0 lg:border-l lg:pl-8 lg:pt-0">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground">Artifact identity</p>
          <dl className="mt-5 border-t border-line-soft text-sm">
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Kind</dt>
              <dd>Component pack</dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Exact version</dt>
              <dd className="font-mono">{item.version}</dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Verified publisher</dt>
              <dd>{item.publisherName}</dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Reviewed</dt>
              <dd><time dateTime={item.reviewedAt}>{reviewedDate.format(new Date(item.reviewedAt))}</time></dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Stable public ID</dt>
              <dd className="break-all font-mono">{item.id}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>

    <section aria-labelledby="component-release-record" className="section">
      <div className="border-y border-line-soft py-10">
        <div className="grid gap-10 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
          <div>
            <p className="eyebrow">Release coordinate</p>
            <h2 className="max-w-[13ch] font-display text-display-lg text-balance" id="component-release-record">
              One record. One reviewed payload.
            </h2>
          </div>
          <div>
            <p className="break-all font-mono text-display-md leading-tight">{item.id}@{item.version}</p>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
              This coordinate joins the stable public artifact ID to the exact reviewed version. The name and publisher remain readable context; the coordinate keeps the release unambiguous.
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-10 border-t border-line-soft pt-8 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
          <div aria-hidden="true" className="hidden lg:block" />
          <div className="grid gap-10 sm:grid-cols-2">
            <section aria-labelledby="component-categories">
              <h3 className="font-mono text-eyebrow uppercase text-muted-foreground" id="component-categories">Published categories</h3>
              {item.categories.length > 0
                ? <ul className="mt-4 border-t border-line-soft">
                    {item.categories.map((category) => <li className="border-b border-line-soft py-3.5 text-sm" key={category}>{category}</li>)}
                  </ul>
                : <p className="mt-4 border-y border-line-soft py-3.5 text-sm text-muted-foreground">No public category is listed.</p>}
            </section>
            <section aria-labelledby="component-record-boundary">
              <h3 className="font-mono text-eyebrow uppercase text-muted-foreground" id="component-record-boundary">What this listing includes</h3>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                This page shows the current release details. It does not publish private source, site usage, owner information, ratings, popularity, or an endorsement.
              </p>
            </section>
          </div>
        </div>
      </div>
    </section>

    <section aria-labelledby="component-permissions" className="section border-t border-line-soft">
      <div className="grid gap-12 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Requested permissions</p>
          <p className="font-display text-display-xl"><span className="sr-only">Published permission labels: </span>{permissionCount}</p>
          <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">
            {permissionCount === 1 ? 'Permission label in this reviewed release.' : 'Permission labels in this reviewed release.'}
          </p>
        </div>
        <div className="border-t border-line-strong pt-6">
          <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="component-permissions">
            Permission scope stays attached to the release.
          </h2>
          <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">
            These permission labels belong to this exact component-pack version. This public listing cannot grant them.
          </p>
          {permissionCount > 0
            ? <ul aria-label="Published component-pack permission labels" className="mt-9 border-t border-line-soft">
                {item.permissionLabels.map((label) => <li className="grid gap-2 border-b border-line-soft py-5 sm:grid-cols-[2rem_minmax(0,1fr)]" key={label}>
                  <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">—</span>
                  <span className="text-sm leading-6">{label}</span>
                </li>)}
              </ul>
            : <div className="mt-9 border-y border-line-soft py-5" role="status">
                <p className="text-sm font-medium">No permission labels are declared.</p>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  This is the complete published permission state for this reviewed release, not a missing field or a permission grant.
                </p>
              </div>}
        </div>
      </div>
    </section>

    <section aria-labelledby="component-review-evidence" className="section border-t border-line-soft">
      <div className="grid gap-12 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Review evidence</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="component-review-evidence">
            Evidence bound to the exact contents.
          </h2>
          <p className="mt-5 max-w-md text-lede text-muted-foreground text-pretty">
            Integrity, signature and provenance identify the reviewed payload together. Changing the contents produces a different release record.
          </p>
        </div>

        <div>
          <dl className="border-t border-line-strong">
            {evidenceRows.map(([label, value]) => <div className="grid gap-2 border-b border-line-soft py-5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6" key={label}>
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-all font-mono text-xs leading-6">{value}</dd>
            </div>)}
          </dl>

          <dl className="mt-10 grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-3">
            <div className="bg-background p-5">
              <dt className="font-mono text-eyebrow uppercase text-muted-foreground">License</dt>
              <dd className="mt-3 text-sm leading-6">{item.reviewEvidence.licenseSpdx}</dd>
            </div>
            <div className="bg-background p-5">
              <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Accessibility</dt>
              <dd className="mt-3 text-sm leading-6">{item.reviewEvidence.accessibilityStandard}</dd>
            </div>
            <div className="bg-background p-5">
              <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Minimum runtime</dt>
              <dd className="mt-3 font-mono text-sm leading-6">{item.reviewEvidence.minimumRuntimeVersion}</dd>
            </div>
          </dl>

          <p className="mt-6 max-w-2xl text-sm leading-6 text-muted-foreground">
            Review evidence is metadata, not an endorsement. Fuma revalidates the current review, signature, release and revocation state before installation. This public page cannot install, execute or expose private component source.
          </p>
        </div>
      </div>
    </section>

    <section aria-labelledby="component-next" className="section border-t border-line-soft">
      <div className="grid gap-12 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Use this component</p>
          <p className="break-all font-mono text-xs leading-6 text-muted-foreground">{item.id}@{item.version}</p>
        </div>
        <div className="border-t border-line-strong pt-6">
          <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="component-next">
            Add it to a site in Fuma.
          </h2>
          <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">
            Sign in, choose the site you want to update, and review the component’s current version and permissions before adding it.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-2.5">
            <CTA href="/start?kind=sign_in&source=product">Open in Fuma</CTA>
            <CTA href="/components" secondary>Browse component packs</CTA>
          </div>
        </div>
      </div>
    </section>
  </PageMain>
}
