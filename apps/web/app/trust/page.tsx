import type { Route } from 'next'
import Link from 'next/link'

import { PageMain } from '@/components/site-shell'
import { readEditorial } from '@/lib/editorial'
import { readLegalPolicyApprovalManifest } from '@/lib/legal-policy-approval'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Trust centre',
  'Find Fuma privacy, security, service status, contact, and policy information.',
  '/trust',
)

const trustTopics: readonly Readonly<{
  description: string
  href: Route
  label: string
}>[] = [
  { description: 'See what the public website collects and how optional measurement works.', href: '/legal/privacy' as Route, label: 'Privacy' },
  { description: 'Read safe-reporting guidance or send a security concern.', href: '/security', label: 'Security' },
  { description: 'Check the latest available service status and current incident details.', href: '/status', label: 'Service status' },
  { description: 'Read the current website terms, notices, and policy history.', href: '/legal', label: 'Policies' },
]

const commitments = [
  {
    title: 'Privacy choices stay clear',
    body: 'Optional measurement remains off until you choose it, and public contact forms ask only for information needed to handle the request.',
  },
  {
    title: 'Unavailable means unavailable',
    body: 'Fuma does not replace missing pricing, listings, or status information with an estimate or an older claim.',
  },
  {
    title: 'Permissions stay visible',
    body: 'Templates, components, and plugins show their current review information and requested permissions before you add them to a site.',
  },
] as const

function policyPath(slug: string): Route {
  return `/legal/${slug}` as Route
}

function readableRole(value: string): string {
  return value.replaceAll('-', ' ')
}

export default async function Page() {
  const [entries, approval] = await Promise.all([
    readEditorial(),
    readLegalPolicyApprovalManifest(),
  ])
  const policies = entries
    .filter((entry) => entry.meta.collection === 'legal')
    .sort((left, right) => left.meta.slug.localeCompare(right.meta.slug))

  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="page-title" className="section pt-16 sm:pt-24">
      <p className="eyebrow">Trust centre</p>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.14fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
        <h1 className="max-w-[15ch] font-display text-display-xl text-balance" id="page-title">
          The information you need to trust how Fuma works.
        </h1>
        <div className="lg:pb-1">
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">
            Find privacy choices, security reporting, service status, contact information, and current policies in one place.
          </p>
          <nav aria-label="Trust centre entry points" className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
            <Link className="min-h-11 py-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href="/legal">Read policies</Link>
            <Link className="min-h-11 py-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href="/security">Report a concern</Link>
            <Link className="min-h-11 py-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href="/status">Check status</Link>
          </nav>
        </div>
      </div>
      <p className="mt-14 max-w-4xl border-l border-signal-line pl-5 text-sm leading-7 text-muted-foreground sm:mt-16 sm:pl-7">
        Fuma does not claim a certification, service-level agreement, uptime history, or production approval that has not been independently reviewed.
      </p>
    </section>

    <section aria-labelledby="trust-topics-title" className="section">
      <div className="grid gap-8 lg:grid-cols-[minmax(18rem,0.6fr)_minmax(0,1fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Start here</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="trust-topics-title">
            Go straight to your question.
          </h2>
        </div>
        <p className="max-w-2xl text-lede text-muted-foreground text-pretty">
          Each page focuses on one topic and explains what is known, what you can do, and what is still under review.
        </p>
      </div>

      <ul className="mt-12 grid overflow-hidden rounded-surface border border-border sm:grid-cols-2">
        {trustTopics.map((item) => <li className="border-b border-line-soft p-6 last:border-b-0 sm:border-r sm:p-8 sm:[&:nth-last-child(-n+2)]:border-b-0 sm:[&:nth-child(2n)]:border-r-0" key={item.href}>
          <h3 className="font-display text-display-md"><Link className="underline-offset-4 hover:underline" href={item.href}>{item.label}</Link></h3>
          <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground">{item.description}</p>
          <Link className="mt-6 inline-flex min-h-11 items-center text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href={item.href}>Open {item.label.toLowerCase()}</Link>
        </li>)}
      </ul>
    </section>

    <section aria-labelledby="commitments-title" className="section border-y border-border bg-card">
      <div className="grid gap-8 lg:grid-cols-[minmax(18rem,0.58fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Public commitments</p>
          <h2 className="max-w-[14ch] font-display text-display-lg text-balance" id="commitments-title">
            Clear information without invented certainty.
          </h2>
        </div>
        <dl className="border-t border-line-soft">
          {commitments.map((item) => <div className="border-b border-line-soft py-6" key={item.title}>
            <dt className="font-display text-xl">{item.title}</dt>
            <dd className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{item.body}</dd>
          </div>)}
        </dl>
      </div>
    </section>

    <section aria-labelledby="policies-title" className="section">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.74fr)_minmax(18rem,0.54fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Current policies</p>
          <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="policies-title">
            Version, effective date, and review date together.
          </h2>
        </div>
        <p className="max-w-xl text-lede text-muted-foreground text-pretty">
          These are the current notices for the public Fuma website.
        </p>
      </div>

      <div className="mt-12 border-y border-line-soft">
        {policies.map((policy) => <article aria-labelledby={`policy-${policy.meta.slug}`} className="grid gap-6 border-b border-line-soft py-7 last:border-b-0 lg:grid-cols-[minmax(14rem,0.8fr)_minmax(0,1.2fr)] lg:gap-16" key={policy.meta.slug}>
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Version {policy.meta.version}</p>
            <h3 className="mt-3 font-display text-display-md" id={`policy-${policy.meta.slug}`}>
              <Link className="underline-offset-4 hover:underline" href={policyPath(policy.meta.slug)}>{policy.meta.title}</Link>
            </h3>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">{policy.meta.description}</p>
          </div>
          <dl className="grid gap-5 text-sm sm:grid-cols-3 lg:pt-1">
            <div>
              <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Effective</dt>
              <dd className="mt-2"><time dateTime={policy.meta.publishedAt}>{policy.meta.publishedAt.slice(0, 10)}</time></dd>
            </div>
            <div>
              <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Review owner</dt>
              <dd className="mt-2 leading-6">{policy.meta.owner}</dd>
            </div>
            <div>
              <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Review due</dt>
              <dd className="mt-2"><time dateTime={policy.meta.reviewAt}>{policy.meta.reviewAt.slice(0, 10)}</time></dd>
            </div>
          </dl>
        </article>)}
      </div>
    </section>

    <section aria-labelledby="review-title" className="section border-t border-border">
      <div className="grid gap-10 lg:grid-cols-[minmax(18rem,0.64fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Policy review</p>
          <h2 className="max-w-[14ch] font-display text-display-lg text-balance" id="review-title">
            Current state: {approval.approvalState}
          </h2>
          <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">
            {approval.approvalState === 'pending'
              ? 'The current policy set is published for testing, but final independent approval is not yet recorded.'
              : 'The required reviewers have approved the current policy set.'}
          </p>
        </div>
        <div className="border-y border-line-soft py-7">
          <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Required reviewers</p>
          <p className="mt-3 capitalize">{approval.requiredApprovals.map(readableRole).join(' · ')}</p>
          <Link className="mt-6 inline-flex min-h-11 items-center text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href="/legal">
            View the current policy set
          </Link>
        </div>
      </div>
    </section>
  </PageMain>
}
