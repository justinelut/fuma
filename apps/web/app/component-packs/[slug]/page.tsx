import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { CTA, Tag } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { readPublicItem } from '@/lib/public-data'
import { jsonLd, publicMetadata } from '@/lib/seo'
import { breadcrumbStructuredData } from '@/lib/structured-data'

export const dynamic = 'force-dynamic'

const reviewedDate = new Intl.DateTimeFormat('en-KE', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
  year: 'numeric',
})

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const item = await readPublicItem('components', slug)

  // This legacy route is another entrance to the same reviewed record, never a second catalog.
  // Missing and malformed slugs share one generic noindex canonical so metadata cannot disclose
  // whether an artifact existed, was withdrawn, was revoked, or failed projection validation.
  return item
    ? publicMetadata(item.name, item.summary, `/components/${item.slug}`)
    : publicMetadata(
        'Component pack unavailable',
        'No current reviewed component pack exists at this address.',
        '/components',
        true,
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
    ['Pack integrity', `sha256:${item.reviewEvidence.contentHashSha256}`],
    ['Signature key', item.reviewEvidence.signatureKeyId],
    ['Signed payload', `sha256:${item.reviewEvidence.signaturePayloadHashSha256}`],
    ['Provenance record', `sha256:${item.reviewEvidence.provenanceHashSha256}`],
  ] as const

  return <PageMain className="!max-w-none !px-0 !py-0">
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(breadcrumbStructuredData(breadcrumbs))} />

    <section aria-labelledby="pack-name" className="section !pb-0 pt-12 sm:pt-16">
      <Breadcrumbs items={breadcrumbs} />

      <div className="grid gap-12 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)] lg:items-end lg:gap-20">
        <div>
          <p className="fuma-rise flex items-center gap-2.5 font-mono text-eyebrow uppercase text-live">
            <span aria-hidden="true" className="live-indicator size-1.5 shrink-0 rounded-full" />
            Current signed pack review
          </p>
          <h1 className="fuma-rise mt-5 max-w-[14ch] font-display text-display-xl text-balance" id="pack-name">
            {item.name}
          </h1>
          <p className="mt-7 max-w-2xl text-lede text-muted-foreground text-pretty">{item.summary}</p>
          <div className="mt-9 flex flex-wrap items-center gap-2.5">
            <CTA href="#pack-release-dossier">Inspect the release</CTA>
            <CTA href="/components" secondary>Back to components</CTA>
          </div>
        </div>

        <aside aria-label="Pack release identity" className="border-t border-line-strong pt-5 lg:border-t-0 lg:border-l lg:pl-8 lg:pt-0">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground">Release coordinate</p>
          <dl className="mt-5 border-t border-line-soft text-sm">
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Artifact</dt>
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

    <section aria-labelledby="pack-coherence-heading" className="section fuma-pool">
      <div className="grid gap-8 border-y border-line-soft py-10 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Coherent release</p>
          <h2 className="max-w-[14ch] font-display text-display-lg text-balance" id="pack-coherence-heading">
            One pack. One bound review.
          </h2>
        </div>
        <p className="max-w-2xl text-lede text-muted-foreground text-pretty">
          This record covers the exact component-pack release identified below. It does not publish a component inventory, private source, usage, installation state, or claims about another version.
        </p>
      </div>

      <div className="fuma-rimlit mt-10 overflow-hidden rounded-surface bg-card">
        <div className="grid gap-8 border-b border-line-soft p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <p className="font-mono text-eyebrow uppercase text-muted-foreground">Reviewed pack coordinate</p>
            <p className="mt-5 max-w-[18ch] font-display text-display-lg text-balance">{item.name}</p>
          </div>
          <p className="break-all font-mono text-sm leading-6 text-muted-foreground">component-pack / v{item.version}</p>
        </div>
        <dl className="grid gap-px bg-border sm:grid-cols-3">
          <div className="bg-background p-5 sm:p-6">
            <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Publisher</dt>
            <dd className="mt-3 text-sm leading-6">{item.publisherName}</dd>
          </div>
          <div className="bg-background p-5 sm:p-6">
            <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Release</dt>
            <dd className="mt-3 font-mono text-sm leading-6">{item.version}</dd>
          </div>
          <div className="min-w-0 bg-background p-5 sm:p-6">
            <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Content binding</dt>
            <dd className="mt-3 break-all font-mono text-xs leading-5">sha256:{item.reviewEvidence.contentHashSha256}</dd>
          </div>
        </dl>
      </div>
    </section>

    <section aria-labelledby="pack-published-scope" className="section border-t border-line-soft">
      <div className="grid gap-12 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Published scope</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="pack-published-scope">
            The classification, without a guessed inventory.
          </h2>
          <p className="mt-5 max-w-md text-lede text-muted-foreground text-pretty">
            Categories describe this current public listing. They do not replace component names, variants, screenshots, or compatibility details that have not been published.
          </p>
        </div>

        <div className="border-t border-line-strong pt-6">
          <h3 className="font-mono text-eyebrow uppercase text-muted-foreground">Published categories</h3>
          {item.categories.length > 0
            ? <ul aria-label="Component pack categories" className="mt-5 flex flex-wrap gap-2 border-y border-line-soft py-5">
                {item.categories.map((category) => <li key={category}><Tag>{category}</Tag></li>)}
              </ul>
            : <p className="mt-5 border-y border-line-soft py-5 text-sm text-muted-foreground" role="status">
                No public category is listed for this reviewed release.
              </p>}
          <p className="mt-6 max-w-2xl text-sm leading-6 text-muted-foreground">
            This public listing excludes private drafts, source files, installations, usage data, owner details, and unpublished review notes.
          </p>
        </div>
      </div>
    </section>

    <section aria-labelledby="pack-permissions" className="section border-t border-line-soft">
      <div className="grid gap-12 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Requested permissions</p>
          <p className="font-display text-display-xl"><span className="sr-only">Published permission labels: </span>{permissionCount}</p>
          <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">
            {permissionCount === 1 ? 'Permission label published with this release.' : 'Permission labels published with this release.'}
          </p>
        </div>

        <div className="border-t border-line-strong pt-6">
          <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="pack-permissions">
            Pack permissions stay visible before installation.
          </h2>
          <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">
            These are the permission labels published for this reviewed release. This page cannot grant them, install the pack, or choose a site for you.
          </p>
          {permissionCount > 0
            ? <ul aria-label="Published component pack permission labels" className="mt-9 border-t border-line-soft">
                {item.permissionLabels.map((label) => <li className="grid gap-2 border-b border-line-soft py-5 sm:grid-cols-[2rem_minmax(0,1fr)]" key={label}>
                  <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">—</span>
                  <span className="text-sm leading-6">{label}</span>
                </li>)}
              </ul>
            : <p className="mt-9 border-y border-line-soft py-5 text-sm leading-6 text-muted-foreground" role="status">
                No permission labels are published for this exact release. Fuma still revalidates the current review, revocation state, and release before installation.
              </p>}

          <dl className="mt-10 grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-3">
            <div className="bg-background p-5">
              <dt className="text-sm font-medium">Backend worker</dt>
              <dd className="mt-2 text-sm leading-6 text-muted-foreground">Not available to component packs.</dd>
            </div>
            <div className="bg-background p-5">
              <dt className="text-sm font-medium">Schedules and secrets</dt>
              <dd className="mt-2 text-sm leading-6 text-muted-foreground">Not available to component packs.</dd>
            </div>
            <div className="bg-background p-5">
              <dt className="text-sm font-medium">Installation</dt>
              <dd className="mt-2 text-sm leading-6 text-muted-foreground">Authenticated and revalidated by Fuma.</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>

    <section aria-labelledby="pack-release-dossier-heading" className="section border-t border-line-soft" id="pack-release-dossier">
      <div className="grid gap-12 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Release dossier</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="pack-release-dossier-heading">
            Four bindings, one reviewed payload.
          </h2>
          <p className="mt-5 max-w-md text-lede text-muted-foreground text-pretty">
            Integrity, signature, signed payload, and provenance remain together so the evidence cannot be mistaken for a review of an unbound name or future version.
          </p>
        </div>

        <div aria-labelledby="pack-release-dossier-heading">
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
            Review evidence is metadata, not a rating, endorsement, security guarantee, or promise about another release. Fuma checks the current signed review, revocation state, exact release, and complete permission set again inside the authenticated product.
          </p>
        </div>
      </div>
    </section>

    <section aria-labelledby="pack-next" className="section border-t border-line-soft">
      <div className="grid gap-10 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Use this pack</p>
          <p className="break-all font-mono text-xs leading-6 text-muted-foreground">Pack {item.id}</p>
        </div>
        <div className="border-t border-line-strong pt-6">
          <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="pack-next">
            Add this pack from Fuma.
          </h2>
          <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">
            Sign in, choose an active site, and review the current release and permissions before adding the pack.
          </p>
          <dl className="mt-9 grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-3">
            <div className="bg-background p-5">
              <dt className="text-sm font-medium">Review</dt>
              <dd className="mt-2 text-sm leading-6 text-muted-foreground">Check the release details shown here.</dd>
            </div>
            <div className="bg-background p-5">
              <dt className="text-sm font-medium">Choose a site</dt>
              <dd className="mt-2 text-sm leading-6 text-muted-foreground">Pick where you want to use the pack.</dd>
            </div>
            <div className="bg-background p-5">
              <dt className="text-sm font-medium">Confirm</dt>
              <dd className="mt-2 text-sm leading-6 text-muted-foreground">Review every permission before adding it.</dd>
            </div>
          </dl>
          <div className="mt-9 flex flex-wrap items-center gap-2.5">
            <CTA href="/start?kind=sign_in&source=product">Open in Fuma</CTA>
            <CTA href="/components" secondary>Browse reviewed packs</CTA>
          </div>
        </div>
      </div>
    </section>
  </PageMain>
}
