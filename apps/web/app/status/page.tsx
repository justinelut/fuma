import Link from 'next/link'
import { PageMain } from '@/components/site-shell'
import { readPublicStatus, type PublicStatusView } from '@/lib/status-boundary'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Service status',
  'See the current Fuma service status and when it was last checked.',
  '/status',
)
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const statusLabels = {
  operational: 'Operational',
  degraded: 'Degraded',
  outage: 'Outage',
} as const

const localDateTime = new Intl.DateTimeFormat('en-KE', {
  dateStyle: 'medium',
  timeStyle: 'long',
  timeZone: 'Africa/Nairobi',
})

function exactTime(value: string) {
  return <time dateTime={value}>{localDateTime.format(new Date(value))}</time>
}

function conclusion(value: PublicStatusView): string {
  return value.availability === 'current' ? statusLabels[value.status] : 'Status unavailable'
}

export default async function Page() {
  const status = await readPublicStatus()
  const available = status.availability === 'current'
  const observedAt = available ? status.checkedAt : status.attemptedAt

  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="status-title" className="section pt-16 sm:pt-24">
      <p className="eyebrow">Service status</p>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.12fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
        <h1 className="max-w-[16ch] font-display text-display-xl text-balance" id="status-title">
          See how Fuma is running right now.
        </h1>
        <p className="max-w-xl text-lede text-muted-foreground text-pretty lg:pb-1">
          This page shows the latest available service check and any current incident details.
        </p>
      </div>
    </section>

    <section aria-labelledby="current-status-title" className="section">
      <div className="grid gap-8 lg:grid-cols-[minmax(18rem,0.58fr)_minmax(0,1fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Current status</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="current-status-title">
            {conclusion(status)}
          </h2>
        </div>
        <p className="max-w-2xl text-lede text-muted-foreground text-pretty">
          {available
            ? status.message
            : 'A current service check is not available. Try again shortly or use the links below.'}
        </p>
      </div>

      <div aria-atomic="true" aria-live="polite" className="mt-12 grid overflow-hidden rounded-surface border border-line-strong bg-surface-inset lg:grid-cols-3" role="status">
        <div className="border-b border-line-soft p-6 sm:p-8 lg:border-b-0 lg:border-r">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Fuma</p>
          <p className="mt-8 flex items-center gap-3 font-display text-display-md">
            <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${available ? 'bg-live' : 'bg-muted-foreground'}`} />
            {conclusion(status)}
          </p>
        </div>
        <div className="border-b border-line-soft p-6 sm:p-8 lg:border-b-0 lg:border-r">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">{available ? 'Last checked' : 'Last attempt'}</p>
          <p className="mt-8 text-base leading-7">{exactTime(observedAt)}</p>
        </div>
        <div className="p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Details</p>
          <p className="mt-8 max-w-sm text-sm leading-7 text-muted-foreground">
            {available ? 'Current information is available below.' : 'No current incident details are available.'}
          </p>
        </div>
      </div>
    </section>

    <section aria-labelledby="incident-title" className="section">
      <div className="grid gap-10 lg:grid-cols-[minmax(18rem,0.58fr)_minmax(0,1.12fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Incidents</p>
          <h2 className="max-w-[14ch] font-display text-display-lg text-balance" id="incident-title">
            What needs your attention.
          </h2>
        </div>

        {available && status.incident
          ? <article className="border-y border-line-soft py-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-baseline sm:justify-between">
                <h3 className="font-display text-display-md">{status.incident.summary}</h3>
                <p className="font-mono text-xs text-muted-foreground">{status.incident.incidentId}</p>
              </div>
              <dl className="mt-8 grid gap-7 border-t border-line-soft pt-7 sm:grid-cols-3">
                <div>
                  <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">State</dt>
                  <dd className="mt-2 capitalize">{status.incident.state}</dd>
                </div>
                <div>
                  <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Started</dt>
                  <dd className="mt-2 text-sm leading-6">{exactTime(status.incident.startedAt)}</dd>
                </div>
                <div>
                  <dt className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Updated</dt>
                  <dd className="mt-2 text-sm leading-6">{exactTime(status.incident.updatedAt)}</dd>
                </div>
              </dl>
            </article>
          : <div className="border-y border-line-soft py-8">
              <h3 className="font-display text-display-md">{available ? 'No current incident details' : 'Status details unavailable'}</h3>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
                {available
                  ? 'The latest service check did not include an active incident.'
                  : 'Try again shortly or check the configured status page if one is listed below.'}
              </p>
            </div>}
      </div>
    </section>

    <section aria-labelledby="status-about-title" className="section border-t border-border">
      <div className="grid gap-10 lg:grid-cols-[minmax(18rem,0.64fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">About this page</p>
          <h2 className="max-w-[14ch] font-display text-display-lg text-balance" id="status-about-title">
            A current snapshot, not a service history.
          </h2>
          <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">
            This page does not publish uptime percentages, response-time promises, or past incident history.
          </p>
        </div>
        <nav aria-label="Related status and trust pages">
          <ul className="border-t border-line-soft">
            {status.statusPageUrl
              ? <li className="border-b border-line-soft">
                  <a className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(11rem,0.55fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10" href={status.statusPageUrl} rel="noopener noreferrer">
                    <span className="font-display text-xl underline-offset-4 group-hover:underline">Detailed status page</span>
                    <span className="text-sm leading-6 text-muted-foreground">Open the configured service-status page.</span>
                  </a>
                </li>
              : null}
            <li className="border-b border-line-soft">
              <Link className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(11rem,0.55fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10" href="/trust">
                <span className="font-display text-xl underline-offset-4 group-hover:underline">Trust centre</span>
                <span className="text-sm leading-6 text-muted-foreground">Read about privacy, security, and public commitments.</span>
              </Link>
            </li>
            <li className="border-b border-line-soft">
              <Link className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(11rem,0.55fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10" href="/security">
                <span className="font-display text-xl underline-offset-4 group-hover:underline">Security reporting</span>
                <span className="text-sm leading-6 text-muted-foreground">Report a security concern safely.</span>
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </section>
  </PageMain>
}
