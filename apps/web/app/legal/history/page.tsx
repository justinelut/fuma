import type { Route } from 'next'
import Link from 'next/link'

import { PageMain } from '@/components/site-shell'
import { readEditorial } from '@/lib/editorial'
import { readLegalPolicyApprovalManifest } from '@/lib/legal-policy-approval'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Policy history',
  'Current and prior Fuma public website policy versions, source receipts, review records, and preserved text access.',
  '/legal/history',
)

function policyPath(pathname: string): Route {
  return pathname as Route
}

export default async function Page() {
  const [entries, manifest] = await Promise.all([
    readEditorial(),
    readLegalPolicyApprovalManifest(),
  ])
  const policies = entries
    .filter((entry) => entry.meta.collection === 'legal')
    .sort((left, right) => left.meta.slug.localeCompare(right.meta.slug))
  const priorVersionCount = 0

  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="page-title" className="section pt-16 sm:pt-24">
      <p className="eyebrow">Policy history</p>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.12fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
        <h1 className="max-w-[15ch] font-display text-display-xl text-balance" id="page-title">
          Every policy change keeps the text it replaced.
        </h1>
        <div className="lg:pb-1">
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">
            This register follows the public website notices forward from the first recorded set.
            Each version stays attached to its effective date, review clock, owner, canonical text,
            and exact source receipt.
          </p>
          <nav aria-label="Policy history entry points" className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
            <a className="min-h-11 py-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href="#version-register">Inspect every version</a>
            <Link className="min-h-11 py-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href="/legal">Open current policy index</Link>
          </nav>
        </div>
      </div>

      <dl className="mt-14 grid border-y border-line-soft text-sm sm:grid-cols-2 lg:mt-16 lg:grid-cols-4">
        <div className="border-b border-line-soft py-5 sm:border-r sm:pr-6 lg:border-b-0">
          <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Current versions</dt>
          <dd className="mt-2 flex items-center gap-2">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-live" />
            {policies.length} public notices
          </dd>
        </div>
        <div className="border-b border-line-soft py-5 sm:pl-6 lg:border-b-0 lg:border-r lg:pr-6">
          <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Prior versions</dt>
          <dd className="mt-2">{priorVersionCount} recorded</dd>
        </div>
        <div className="border-b border-line-soft py-5 sm:border-b-0 sm:border-r sm:pr-6 lg:pl-6">
          <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Manifest version</dt>
          <dd className="mt-2 font-mono text-xs">{manifest.manifestVersion}</dd>
        </div>
        <div className="py-5 sm:pl-6">
          <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Approval state</dt>
          <dd className="mt-2 capitalize">{manifest.approvalState}</dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="lineage-title" className="section border-t border-border">
      <div className="grid gap-10 lg:grid-cols-[minmax(18rem,0.66fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Forward-only lineage</p>
          <h2 className="max-w-[14ch] font-display text-display-lg text-balance" id="lineage-title">
            The record begins here. It does not rewrite backward.
          </h2>
        </div>
        <div>
          <div className="border-y border-line-strong py-7">
            <div className="grid gap-6 sm:grid-cols-[minmax(8rem,0.34fr)_minmax(0,1fr)] sm:gap-10">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Recorded position</p>
                <p className="mt-3 font-display text-xl">Origin → current</p>
              </div>
              <div>
                <p className="font-display text-display-md">Policy set {manifest.manifestVersion}</p>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
                  Issued <time dateTime={manifest.issuedAt}>{manifest.issuedAt.slice(0, 10)}</time>.
                  {' '}{manifest.supersedesPolicySetSha256 === null
                    ? 'No predecessor policy set is recorded.'
                    : `This set supersedes policy set ${manifest.supersedesPolicySetSha256}.`}
                </p>
              </div>
            </div>
          </div>
          <p className="mt-6 max-w-2xl text-sm leading-7 text-muted-foreground">
            The maintained repository currently contains one public version of each notice. There
            is no superseded public text to expose yet. A later publication must add a newer
            effective version and retain the complete prior text; it cannot reuse an existing
            version or replace history in place.
          </p>
        </div>
      </div>
    </section>

    <section aria-labelledby="register-title" className="section border-t border-border" id="version-register">
      <div className="grid gap-8 lg:grid-cols-[minmax(18rem,0.66fr)_minmax(0,1fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Complete version register</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="register-title">
            One ruled record for every maintained notice.
          </h2>
        </div>
        <p className="max-w-2xl text-lede text-muted-foreground text-pretty">
          Current and prior are evidence states, not visual decoration. Every current row links to
          the preserved canonical text; a prior row will remain in this register when a valid
          forward publication supersedes it.
        </p>
      </div>

      <ul aria-label="Policy version histories" className="mt-12 border-t border-line-strong" data-policy-history-register>
        {policies.map((policy) => {
          const receipt = manifest.policies.find(({ slug }) => slug === policy.meta.slug)
          if (!receipt) throw new Error(`Missing policy history receipt for ${policy.meta.slug}`)
          return <li className="border-b border-line-soft" key={policy.meta.slug}>
            <article aria-labelledby={`history-${policy.meta.slug}`} className="py-9 sm:py-12">
              <div className="grid gap-9 lg:grid-cols-[minmax(15rem,0.66fr)_minmax(0,1.34fr)] lg:gap-16">
                <header>
                  <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-live" />
                    Current · Version {policy.meta.version}
                  </p>
                  <h3 className="mt-4 max-w-[18ch] font-display text-display-md" id={`history-${policy.meta.slug}`}>
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

                  <dl className="mt-8 border-y border-line-soft py-5 text-sm">
                    <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6">
                      <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Source receipt</dt>
                      <dd className="break-all font-mono text-xs leading-6 text-muted-foreground">{receipt?.sourceSha256}</dd>
                    </div>
                  </dl>

                  <div className="mt-5 grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <p className="text-sm leading-6 text-muted-foreground">Superseded public versions: none recorded.</p>
                    <Link className="min-h-11 py-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href={policyPath(policy.canonicalPath)}>Read preserved current text</Link>
                  </div>
                </div>
              </div>
            </article>
          </li>
        })}
      </ul>
    </section>

    <section aria-labelledby="integrity-title" className="section border-t border-border">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.72fr)_minmax(22rem,0.72fr)] lg:gap-24">
        <div>
          <p className="eyebrow">History integrity</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="integrity-title">
            Publication proves identity, not approval.
          </h2>
          <p className="mt-6 max-w-2xl text-lede text-muted-foreground text-pretty">
            The source receipts identify the exact repository bytes behind the current text. They
            do not establish legal, privacy, trust-and-safety, compliance, certification, counsel,
            or launch approval.
          </p>
          <dl className="mt-10 border-t border-line-strong text-sm">
            <div className="grid gap-2 border-b border-line-soft py-5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-8">
              <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Current set</dt>
              <dd className="break-all font-mono text-xs leading-6">{manifest.policySetSha256}</dd>
            </div>
            <div className="grid gap-2 border-b border-line-soft py-5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-8">
              <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Predecessor set</dt>
              <dd className="break-all font-mono text-xs leading-6 text-muted-foreground">{manifest.supersedesPolicySetSha256 ?? 'None recorded'}</dd>
            </div>
            <div className="grid gap-2 border-b border-line-soft py-5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-8">
              <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Recorded approvals</dt>
              <dd>{manifest.approvals.length}</dd>
            </div>
          </dl>
        </div>

        <aside aria-labelledby="preservation-title" className="border border-line-strong bg-surface-inset p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Preservation contract</p>
          <h3 className="mt-4 font-display text-display-md" id="preservation-title">What survives the next version</h3>
          <ol className="mt-8 border-t border-line-soft">
            <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4 border-b border-line-soft py-5">
              <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">01</span>
              <p className="text-sm leading-7">The complete prior policy text remains accessible.</p>
            </li>
            <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4 border-b border-line-soft py-5">
              <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">02</span>
              <p className="text-sm leading-7">Its version, effective date, review date, and owner remain attached.</p>
            </li>
            <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4 border-b border-line-soft py-5">
              <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">03</span>
              <p className="text-sm leading-7">The newer version moves effective time forward and becomes the sole current record.</p>
            </li>
          </ol>
          <p className="mt-6 text-sm leading-7 text-muted-foreground">
            These are enforced history invariants. They do not claim that a superseded version or
            approval exists before one is recorded.
          </p>
        </aside>
      </div>
    </section>

    <section aria-labelledby="history-resources-title" className="section border-t border-border">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)] lg:gap-24">
        <div>
          <p className="eyebrow">Record navigation</p>
          <h2 className="max-w-[14ch] font-display text-display-lg text-balance" id="history-resources-title">
            Move from history to the maintained source.
          </h2>
        </div>
        <nav aria-label="Policy history resources">
          <ul className="border-t border-line-soft">
            <li className="border-b border-line-soft">
              <Link className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(10rem,0.58fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10" href="/legal">
                <span className="font-display text-xl underline-offset-4 group-hover:underline">Current policy index</span>
                <span className="text-sm leading-6 text-muted-foreground">All current notices and the exact policy-set approval manifest.</span>
              </Link>
            </li>
            <li className="border-b border-line-soft">
              <Link className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(10rem,0.58fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10" href="/trust">
                <span className="font-display text-xl underline-offset-4 group-hover:underline">Trust centre</span>
                <span className="text-sm leading-6 text-muted-foreground">Privacy, security, service status, and the limits of current public claims.</span>
              </Link>
            </li>
            <li className="border-b border-line-soft">
              <Link className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(10rem,0.58fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10" href="/contact">
                <span className="font-display text-xl underline-offset-4 group-hover:underline">Contact</span>
                <span className="text-sm leading-6 text-muted-foreground">The bounded public route for a legal or privacy question.</span>
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </section>
  </PageMain>
}
