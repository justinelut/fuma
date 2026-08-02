import type { Route } from 'next'
import Link from 'next/link'

import { PageMain } from '@/components/site-shell'
import { readEditorial } from '@/lib/editorial'
import { readLegalPolicyApprovalManifest } from '@/lib/legal-policy-approval'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Legal and policies',
  'Read the current Fuma website notices, review dates, and approval state.',
  '/legal',
)

function policyPath(pathname: string): Route {
  return pathname as Route
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
      <p className="eyebrow">Legal and policies</p>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.12fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
        <h1 className="max-w-[15ch] font-display text-display-xl text-balance" id="page-title">
          Current notices, dates, and review state.
        </h1>
        <div className="lg:pb-1">
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">
            These notices cover the public Fuma website. Product-specific terms may apply before you create an account, subscribe, or buy a service.
          </p>
          <nav aria-label="Policy index entry points" className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
            <a className="min-h-11 py-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href="#current-policies">Read current notices</a>
            <Link className="min-h-11 py-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href="/legal/history">View policy history</Link>
          </nav>
        </div>
      </div>

      <dl className="mt-14 grid border-y border-line-soft text-sm sm:grid-cols-3 lg:mt-16">
        <div className="border-b border-line-soft py-5 sm:border-b-0 sm:border-r sm:pr-6">
          <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Current notices</dt>
          <dd className="mt-2">{policies.length}</dd>
        </div>
        <div className="border-b border-line-soft py-5 sm:border-b-0 sm:border-r sm:px-6">
          <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Policy set issued</dt>
          <dd className="mt-2"><time dateTime={approval.issuedAt}>{approval.issuedAt.slice(0, 10)}</time></dd>
        </div>
        <div className="py-5 sm:pl-6">
          <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Approval state</dt>
          <dd className="mt-2 capitalize">{approval.approvalState}</dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="policy-register-title" className="section" id="current-policies">
      <div className="grid gap-8 lg:grid-cols-[minmax(18rem,0.66fr)_minmax(0,1fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Current policies</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="policy-register-title">
            Read the notice that matches your question.
          </h2>
        </div>
        <p className="max-w-2xl text-lede text-muted-foreground text-pretty">
          Each notice includes its version, effective date, latest update, review owner, and next review date.
        </p>
      </div>

      <div className="mt-12 border-t border-line-strong" data-policy-register>
        {policies.map((policy) => <article aria-labelledby={`policy-${policy.meta.slug}`} className="border-b border-line-soft py-8 sm:py-10" id={policy.meta.slug} key={policy.meta.slug}>
          <div className="grid gap-8 lg:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.28fr)] lg:gap-16">
            <header>
              <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Version {policy.meta.version}</p>
              <h3 className="mt-4 max-w-[18ch] font-display text-display-md" id={`policy-${policy.meta.slug}`}>
                <Link className="underline-offset-4 hover:underline" href={policyPath(policy.canonicalPath)}>{policy.meta.title}</Link>
              </h3>
              <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">{policy.meta.description}</p>
            </header>

            <div>
              <dl className="grid gap-x-8 gap-y-6 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Effective</dt>
                  <dd className="mt-2"><time dateTime={policy.meta.publishedAt}>{policy.meta.publishedAt.slice(0, 10)}</time></dd>
                </div>
                <div>
                  <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Updated</dt>
                  <dd className="mt-2"><time dateTime={policy.meta.updatedAt}>{policy.meta.updatedAt.slice(0, 10)}</time></dd>
                </div>
                <div>
                  <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Review due</dt>
                  <dd className="mt-2"><time dateTime={policy.meta.reviewAt}>{policy.meta.reviewAt.slice(0, 10)}</time></dd>
                </div>
                <div>
                  <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Review owner</dt>
                  <dd className="mt-2 leading-6">{policy.meta.owner}</dd>
                </div>
              </dl>
              <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-line-soft pt-5">
                <Link className="min-h-11 py-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href={policyPath(policy.canonicalPath)}>Read notice</Link>
                <Link className="min-h-11 py-2 text-sm underline underline-offset-4" href="/legal/history">View history</Link>
              </div>
            </div>
          </div>
        </article>)}
      </div>
    </section>

    <section aria-labelledby="approval-title" className="section border-y border-border bg-card">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.72fr)_minmax(22rem,0.72fr)] lg:gap-24">
        <div>
          <p className="eyebrow">Approval state</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="approval-title">
            {approval.approvalState === 'pending' ? 'Final review is still pending.' : `This policy set is ${approval.approvalState}.`}
          </h2>
          <p className="mt-6 max-w-2xl text-lede text-muted-foreground text-pretty">
            {approval.approvalState === 'pending'
              ? 'These notices are available for testing, but the required independent reviewers have not recorded final approval.'
              : 'The review state shown here applies to the current policy set.'}
          </p>
        </div>

        <div className="border-y border-line-soft">
          <h3 className="py-5 font-display text-xl">Required reviewers</h3>
          <ul aria-label="Required policy approvals">
            {approval.requiredApprovals.map((role) => {
              const recorded = approval.approvals.find((item) => item.role === role)
              return <li className="grid gap-2 border-t border-line-soft py-5 sm:grid-cols-[minmax(10rem,0.7fr)_minmax(0,1fr)] sm:items-baseline sm:gap-8" key={role}>
                <span className="capitalize">{readableRole(role)}</span>
                {recorded
                  ? <span className="text-sm text-muted-foreground">Approved by {recorded.actor} on <time dateTime={recorded.approvedAt}>{recorded.approvedAt.slice(0, 10)}</time></span>
                  : <span className="text-sm text-muted-foreground">No approval recorded</span>}
              </li>
            })}
          </ul>
        </div>
      </div>
    </section>

    <section aria-labelledby="legal-resources-title" className="section">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)] lg:gap-24">
        <div>
          <p className="eyebrow">More information</p>
          <h2 className="max-w-[14ch] font-display text-display-lg text-balance" id="legal-resources-title">
            Find the page that matches your question.
          </h2>
        </div>
        <nav aria-label="Legal resources">
          <ul className="border-t border-line-soft">
            <li className="border-b border-line-soft"><Link className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(10rem,0.58fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10" href="/legal/history"><span className="font-display text-xl underline-offset-4 group-hover:underline">Policy history</span><span className="text-sm leading-6 text-muted-foreground">See current and earlier public versions when available.</span></Link></li>
            <li className="border-b border-line-soft"><Link className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(10rem,0.58fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10" href="/trust"><span className="font-display text-xl underline-offset-4 group-hover:underline">Trust centre</span><span className="text-sm leading-6 text-muted-foreground">Privacy, security, service status, and public commitments.</span></Link></li>
            <li className="border-b border-line-soft"><Link className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(10rem,0.58fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10" href="/contact"><span className="font-display text-xl underline-offset-4 group-hover:underline">Contact</span><span className="text-sm leading-6 text-muted-foreground">Ask a legal, privacy, abuse, or general question.</span></Link></li>
          </ul>
        </nav>
      </div>
    </section>
  </PageMain>
}
