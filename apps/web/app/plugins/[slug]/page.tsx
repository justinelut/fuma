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
  const item = await readPublicItem('plugins', slug)
  return publicMetadata(
    item?.name ?? 'Plugin unavailable',
    item?.summary ?? 'No current reviewed plugin exists at this address.',
    `/plugins/${slug}`,
    !item,
  )
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const item = await readPublicItem('plugins', slug)
  if (!item) notFound()

  const breadcrumbs = [
    { label: 'Plugins', href: '/plugins' },
    { label: item.name, href: `/plugins/${item.slug}` },
  ] as const
  const permissionCount = item.permissionLabels.length
  const reviewRows = [
    ['Package integrity', `sha256:${item.reviewEvidence.contentHashSha256}`],
    ['Signature key', item.reviewEvidence.signatureKeyId],
    ['Signed payload', `sha256:${item.reviewEvidence.signaturePayloadHashSha256}`],
    ['Provenance record', `sha256:${item.reviewEvidence.provenanceHashSha256}`],
  ] as const

  return <PageMain className="!max-w-none !px-0 !py-0">
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(breadcrumbStructuredData(breadcrumbs))} />

    <section aria-labelledby="plugin-name" className="section !pb-0 pt-12 sm:pt-16">
      <Breadcrumbs items={breadcrumbs} />

      <div className="grid gap-12 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)] lg:items-end lg:gap-20">
        <div>
          <p className="fuma-rise flex items-center gap-2.5 font-mono text-eyebrow uppercase text-live">
            <span aria-hidden="true" className="live-indicator size-1.5 shrink-0 rounded-full" />
            Current signed review
          </p>
          <h1 className="fuma-rise mt-5 max-w-[14ch] font-display text-display-xl text-balance" id="plugin-name">
            {item.name}
          </h1>
          <p className="mt-7 max-w-2xl text-lede text-muted-foreground text-pretty">{item.summary}</p>
          <div className="mt-9 flex flex-wrap items-center gap-2.5">
            <CTA href="#plugin-install-boundary">Review before installing</CTA>
            <CTA href="/plugins" secondary>Back to plugins</CTA>
          </div>
        </div>

        <aside aria-label="Artifact identity" className="border-t border-line-strong pt-5 lg:border-t-0 lg:border-l lg:pl-8 lg:pt-0">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground">Artifact identity</p>
          <dl className="mt-5 border-t border-line-soft text-sm">
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Kind</dt>
              <dd>Plugin</dd>
            </div>
            <div className="grid grid-cols-[minmax(7rem,0.62fr)_minmax(0,1fr)] gap-4 border-b border-line-soft py-3.5">
              <dt className="text-muted-foreground">Version</dt>
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

    <section aria-labelledby="plugin-scope" className="section">
      <div className="grid gap-12 border-y border-line-soft py-10 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Published scope</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="plugin-scope">
            What this record is allowed to say.
          </h2>
        </div>
        <div className="grid gap-10 sm:grid-cols-2 sm:gap-12">
          <div>
            <h3 className="font-mono text-eyebrow uppercase text-muted-foreground">Categories</h3>
            {item.categories.length > 0
              ? <ul className="mt-4 border-t border-line-soft">
                  {item.categories.map((category) => <li className="border-b border-line-soft py-3.5 text-sm" key={category}>{category}</li>)}
                </ul>
              : <p className="mt-4 border-y border-line-soft py-3.5 text-sm text-muted-foreground">No public category is listed.</p>}
          </div>
          <div>
            <h3 className="font-mono text-eyebrow uppercase text-muted-foreground">About this review</h3>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              This page shows review details for one exact release. It is not a rating, recommendation, install count, or guarantee about future versions.
            </p>
          </div>
        </div>
      </div>
    </section>

    <section aria-labelledby="plugin-permissions" className="section border-t border-line-soft">
      <div className="grid gap-12 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Requested permissions</p>
          <p className="font-display text-display-xl"><span className="sr-only">Declared permission labels: </span>{permissionCount}</p>
          <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">
            {permissionCount === 1 ? 'Permission label in this reviewed release.' : 'Permission labels in this reviewed release.'}
          </p>
        </div>
        <div className="border-t border-line-strong pt-6">
          <h2 className="max-w-[17ch] font-display text-display-lg text-balance" id="plugin-permissions">
            Permissions remain a decision, not a side effect.
          </h2>
          <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">
            These labels show what this release wants to access. Installation requires a site owner to review and approve the complete set.
          </p>
          {permissionCount > 0
            ? <ul aria-label="Declared plugin permission labels" className="mt-9 border-t border-line-soft">
                {item.permissionLabels.map((label) => <li className="grid gap-2 border-b border-line-soft py-5 sm:grid-cols-[2rem_minmax(0,1fr)]" key={label}>
                  <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">—</span>
                  <span className="text-sm leading-6">{label}</span>
                </li>)}
              </ul>
            : <p className="mt-9 border-y border-line-soft py-5 text-sm leading-6 text-muted-foreground" role="status">
                No runtime permission labels were declared in this reviewed release. Fuma still revalidates the exact release and current review before installation.
              </p>}
        </div>
      </div>
    </section>

    <section aria-labelledby="plugin-review-evidence" className="section border-t border-line-soft">
      <div className="grid gap-12 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Review dossier</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="plugin-review-evidence">
            Evidence bound to the bytes.
          </h2>
          <p className="mt-5 max-w-md text-lede text-muted-foreground text-pretty">
            The signature, provenance record and package digest identify the reviewed release together. A different payload is a different review.
          </p>
        </div>

        <div>
          <dl className="border-t border-line-strong">
            {reviewRows.map(([label, value]) => <div className="grid gap-2 border-b border-line-soft py-5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6" key={label}>
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
            Review evidence is metadata, not an endorsement. Fuma revalidates the exact signature, clean review, revocation state and permission set before an install can proceed.
          </p>
        </div>
      </div>
    </section>

    <section aria-labelledby="plugin-install-intent" className="section border-t border-line-soft" id="plugin-install-boundary">
      <div className="grid gap-10 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:items-start lg:gap-20">
        <div>
          <p className="eyebrow">Install this plugin</p>
          <p className="break-all font-mono text-xs leading-6 text-muted-foreground">Plugin {item.id}</p>
        </div>
        <div className="border-t border-line-strong pt-6">
          <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="plugin-install-intent">
            Review it in Fuma before installing.
          </h2>
          <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">
            Sign in, choose an active site, and review the current release and every requested permission before installing the plugin.
          </p>
          <dl className="mt-9 grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-3">
            <div className="bg-background p-5">
              <dt className="text-sm font-medium">Review</dt>
              <dd className="mt-2 text-sm leading-6 text-muted-foreground">Check the release details and requested access.</dd>
            </div>
            <div className="bg-background p-5">
              <dt className="text-sm font-medium">Choose a site</dt>
              <dd className="mt-2 text-sm leading-6 text-muted-foreground">Pick where you want the plugin installed.</dd>
            </div>
            <div className="bg-background p-5">
              <dt className="text-sm font-medium">Confirm</dt>
              <dd className="mt-2 text-sm leading-6 text-muted-foreground">Approve the full permission list yourself.</dd>
            </div>
          </dl>
          <div className="mt-9 flex flex-wrap items-center gap-2.5">
            <CTA href="/start?kind=sign_in&source=plugin">Open in Fuma</CTA>
            <CTA href="/docs" secondary>Read the plugin docs</CTA>
          </div>
        </div>
      </div>
    </section>
  </PageMain>
}
