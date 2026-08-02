import type { Route } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { EditorialContent } from '@/components/editorial-content'
import { PageMain } from '@/components/site-shell'
import { getEditorial, readEditorial } from '@/lib/editorial'
import { readLegalPolicyApprovalManifest } from '@/lib/legal-policy-approval'
import { CANONICAL_ORIGIN, jsonLd, publicMetadata } from '@/lib/seo'

const LEGAL_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/

export const dynamicParams = false

export async function generateStaticParams() {
  return (await readEditorial())
    .filter((entry) => entry.meta.collection === 'legal')
    .map((entry) => ({ slug: entry.meta.slug }))
}

async function policy(slug: string) {
  return LEGAL_SLUG.test(slug) ? getEditorial('legal', slug) : null
}

function readableRole(value: string): string {
  return value.replaceAll('-', ' ')
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entry = await policy(slug)
  return publicMetadata(
    entry?.meta.title ?? 'Policy unavailable',
    entry?.meta.description ?? 'The requested public policy is unavailable.',
    entry?.canonicalPath ?? '/legal/unavailable',
    !entry,
  )
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entry = await policy(slug)
  if (!entry) notFound()

  const approval = await readLegalPolicyApprovalManifest()
  const receipt = approval.policies.find((item) => item.slug === entry.meta.slug)
  if (!receipt) throw new Error(`Legal policy receipt is unavailable for ${entry.meta.slug}`)

  const policyPath = entry.canonicalPath as Route

  return <PageMain className="!max-w-none !px-0 !py-0">
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: entry.meta.title,
      description: entry.meta.description,
      datePublished: entry.meta.publishedAt,
      dateModified: entry.meta.updatedAt,
      inLanguage: 'en-KE',
      isPartOf: { '@type': 'WebSite', name: 'Fuma', url: CANONICAL_ORIGIN },
    })} />

    <header className="section pt-16 sm:pt-24">
      <nav aria-label="Policy breadcrumb" className="mb-10 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
        <Link className="min-h-11 py-3 underline-offset-4 hover:text-foreground hover:underline" href="/legal">Legal and policies</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{entry.meta.category}</span>
      </nav>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1.12fr)_minmax(19rem,0.55fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Current policy · Version {entry.meta.version}</p>
          <h1 className="max-w-[15ch] font-display text-display-xl text-balance" id="policy-title">
            {entry.meta.title}
          </h1>
          <p className="mt-7 max-w-3xl text-lede text-muted-foreground text-pretty">{entry.meta.description}</p>
        </div>

        <aside aria-labelledby="policy-record-title" className="border-t border-line-strong pt-6">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Policy record</p>
          <h2 className="mt-3 font-display text-display-md" id="policy-record-title">Current repository notice</h2>
          <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-line-soft pt-6 text-sm">
            <div>
              <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Version</dt>
              <dd className="mt-2 font-mono text-xs">{entry.meta.version}</dd>
            </div>
            <div>
              <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">State</dt>
              <dd className="mt-2">Current</dd>
            </div>
            <div>
              <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Effective</dt>
              <dd className="mt-2"><time dateTime={entry.meta.publishedAt}>{entry.meta.publishedAt.slice(0, 10)}</time></dd>
            </div>
            <div>
              <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Updated</dt>
              <dd className="mt-2"><time dateTime={entry.meta.updatedAt}>{entry.meta.updatedAt.slice(0, 10)}</time></dd>
            </div>
          </dl>
        </aside>
      </div>

      <dl className="mt-14 grid border-y border-line-soft text-sm sm:grid-cols-3 sm:divide-x sm:divide-line-soft lg:mt-16">
        <div className="border-b border-line-soft py-5 sm:border-b-0 sm:pr-7">
          <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Effective version</dt>
          <dd className="mt-2">Version {entry.meta.version} · <time dateTime={entry.meta.publishedAt}>{entry.meta.publishedAt.slice(0, 10)}</time></dd>
        </div>
        <div className="border-b border-line-soft py-5 sm:border-b-0 sm:px-7">
          <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Review owner</dt>
          <dd className="mt-2">{entry.meta.owner}</dd>
        </div>
        <div className="py-5 sm:pl-7">
          <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Review due</dt>
          <dd className="mt-2"><time dateTime={entry.meta.reviewAt}>{entry.meta.reviewAt.slice(0, 10)}</time></dd>
        </div>
      </dl>
    </header>

    <section aria-labelledby="maintained-notice-title" className="section">
      <div className="mb-12 grid gap-6 border-b border-line-strong pb-8 lg:grid-cols-[minmax(16rem,0.56fr)_minmax(0,1fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Maintained notice</p>
          <h2 className="max-w-[13ch] font-display text-display-lg text-balance" id="maintained-notice-title">
            The current policy text.
          </h2>
        </div>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
          This document is rendered from the compiler-validated public policy source attached to
          the version, effective date, owner, review date, and receipt shown on this page.
        </p>
      </div>
      <EditorialContent entry={entry} />
    </section>

    <section aria-labelledby="review-signature-title" className="section border-y border-border">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.82fr)_minmax(20rem,0.62fr)] lg:gap-24">
        <div>
          <p className="eyebrow">Review signature</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="review-signature-title">
            Publication and approval remain separate records.
          </h2>
          {approval.approvalState === 'pending' && <p className="mt-6 max-w-2xl text-lede text-muted-foreground text-pretty">
            This exact policy set is published with a pending approval state. No approval record is
            present in the maintained manifest.
          </p>}
          {approval.approvalState === 'approved' && <p className="mt-6 max-w-2xl text-lede text-muted-foreground text-pretty">
            The maintained manifest records every required approval role against this exact policy-set digest.
          </p>}
          {approval.approvalState === 'withdrawn' && <p className="mt-6 max-w-2xl text-lede text-muted-foreground text-pretty">
            The maintained manifest marks the approval state for this exact policy set as withdrawn.
          </p>}

          <figure className="mt-10 border-y border-line-soft" data-policy-review-signature>
            <ol aria-label="Policy review evidence relationship">
              <li className="grid gap-3 border-b border-line-soft py-6 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-8">
                <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Policy receipt</p>
                <div>
                  <p className="text-sm">{entry.meta.slug} · Version {receipt.version}</p>
                  <p className="mt-2 break-all font-mono text-xs leading-6 text-muted-foreground">{receipt.sourceSha256}</p>
                </div>
              </li>
              <li className="grid gap-3 border-b border-line-soft py-6 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-8">
                <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Policy set</p>
                <div>
                  <p className="text-sm">Manifest {approval.manifestVersion} · issued <time dateTime={approval.issuedAt}>{approval.issuedAt.slice(0, 10)}</time></p>
                  <p className="mt-2 break-all font-mono text-xs leading-6 text-muted-foreground">{approval.policySetSha256}</p>
                </div>
              </li>
              <li className="grid gap-3 py-6 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-8">
                <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Review records</p>
                <div>
                  <p className="text-sm capitalize">Approval state: {approval.approvalState}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{approval.approvals.length} recorded approval{approval.approvals.length === 1 ? '' : 's'} for {approval.requiredApprovals.length} required roles</p>
                </div>
              </li>
            </ol>
            <figcaption className="border-t border-line-soft py-4 font-mono text-xs leading-6 text-muted-foreground">
              Exact policy source <span aria-hidden="true">→</span> exact policy set <span aria-hidden="true">→</span> recorded review state
            </figcaption>
          </figure>
        </div>

        <aside aria-labelledby="required-review-title" className="border-t border-line-strong pt-6 lg:mt-2">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Required roles</p>
          <h3 className="mt-3 font-display text-display-md" id="required-review-title">Manifest review record</h3>
          <ul className="mt-7 border-t border-line-soft">
            {approval.requiredApprovals.map((role) => {
              const record = approval.approvals.find((item) => item.role === role)
              return <li className="border-b border-line-soft py-5" key={role}>
                <p className="capitalize">{readableRole(role)}</p>
                {record
                  ? <p className="mt-2 text-sm leading-6 text-muted-foreground">Recorded actor: {record.actor} · <time dateTime={record.approvedAt}>{record.approvedAt}</time></p>
                  : <p className="mt-2 text-sm leading-6 text-muted-foreground">Required · no approval recorded</p>}
              </li>
            })}
          </ul>

          {approval.withdrawal && <div className="mt-7 border-t border-line-soft pt-6">
            <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Withdrawal record</p>
            <p className="mt-3 text-sm leading-7">{approval.withdrawal.reason}</p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Recorded actor: {approval.withdrawal.actor} · <time dateTime={approval.withdrawal.withdrawnAt}>{approval.withdrawal.withdrawnAt}</time></p>
          </div>}

          <dl className="mt-7 border-t border-line-soft pt-6 text-sm">
            <div>
              <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Supersedes policy set</dt>
              <dd className="mt-2 break-all font-mono text-xs leading-6 text-muted-foreground">{approval.supersedesPolicySetSha256 ?? 'No earlier policy set recorded'}</dd>
            </div>
          </dl>
          <p className="mt-7 border-t border-line-soft pt-6 text-sm leading-7 text-muted-foreground">
            A source receipt identifies maintained bytes. It does not by itself establish legal,
            privacy, trust-and-safety, compliance, certification, or production approval.
          </p>
        </aside>
      </div>
    </section>

    <section aria-labelledby="policy-records-title" className="section">
      <div className="grid gap-10 lg:grid-cols-[minmax(18rem,0.66fr)_minmax(0,1fr)] lg:gap-24">
        <div>
          <p className="eyebrow">Related records</p>
          <h2 className="max-w-[13ch] font-display text-display-lg text-balance" id="policy-records-title">
            Follow the maintained record.
          </h2>
          <p className="mt-6 max-w-md text-sm leading-7 text-muted-foreground">
            Use the history route for version records, the legal index for the complete current set,
            and the trust centre for related privacy, security, and service information.
          </p>
        </div>
        <nav aria-label="Policy resources">
          <ul className="border-t border-line-soft">
            <li className="border-b border-line-soft">
              <Link className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(10rem,0.58fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10" href="/legal/history">
                <span className="font-display text-xl underline-offset-4 group-hover:underline">Policy history</span>
                <span className="text-sm leading-6 text-muted-foreground">Current versions and any superseded public text maintained by the history record.</span>
              </Link>
            </li>
            <li className="border-b border-line-soft">
              <Link className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(10rem,0.58fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10" href="/legal">
                <span className="font-display text-xl underline-offset-4 group-hover:underline">Legal and policies</span>
                <span className="text-sm leading-6 text-muted-foreground">The complete current policy register and policy-set manifest.</span>
              </Link>
            </li>
            <li className="border-b border-line-soft">
              <Link className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(10rem,0.58fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10" href="/trust">
                <span className="font-display text-xl underline-offset-4 group-hover:underline">Trust centre</span>
                <span className="text-sm leading-6 text-muted-foreground">The maintained evidence map and the limits around each public claim.</span>
              </Link>
            </li>
            <li className="border-b border-line-soft">
              <Link className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(10rem,0.58fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10" href="/contact">
                <span className="font-display text-xl underline-offset-4 group-hover:underline">Contact</span>
                <span className="text-sm leading-6 text-muted-foreground">The bounded public route for a legal, privacy, abuse, or general question.</span>
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      <nav aria-label="Current policy" className="mt-14 border-t border-line-soft pt-6">
        <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Canonical record</p>
        <Link className="mt-3 inline-flex min-h-11 items-center text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href={policyPath}>{entry.canonicalPath}</Link>
      </nav>
    </section>
  </PageMain>
}
