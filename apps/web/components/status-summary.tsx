import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { PublicStatusView } from '@/lib/status-boundary'

const labels = {
  operational: 'Operational',
  degraded: 'Degraded',
  outage: 'Outage',
} as const

const kenyaDateTime = new Intl.DateTimeFormat('en-KE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Nairobi',
})

export function StatusSummary({ value }: Readonly<{ value: PublicStatusView }>) {
  const unavailable = value.availability === 'unavailable'
  const observedAt = unavailable ? value.attemptedAt : value.checkedAt
  return <>
    <Card aria-labelledby="service-status-heading" className="mt-8 border">
      <CardHeader>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {unavailable ? 'Current summary unavailable' : 'Latest service check'}
        </p>
        <CardTitle id="service-status-heading" className="text-2xl">
          {unavailable ? 'Status not available' : labels[value.status]}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div role="status" aria-live="polite" aria-atomic="true">
          <p className="leading-7">{value.message}</p>
          <p className="mt-3 text-sm text-muted-foreground">
            {unavailable ? 'Last attempted ' : 'Last checked '}
            <time dateTime={observedAt}>{kenyaDateTime.format(new Date(observedAt))}</time>
          </p>
        </div>
        {!unavailable && value.incident
          ? <section aria-labelledby="current-incident-heading" className="mt-6 border-t pt-5">
              <h2 id="current-incident-heading" className="text-lg font-semibold">Current incident</h2>
              <p className="mt-2 leading-7">{value.incident.summary}</p>
              <dl className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                <div><dt className="font-medium text-foreground">State</dt><dd>{value.incident.state}</dd></div>
                <div><dt className="font-medium text-foreground">Updated</dt><dd><time dateTime={value.incident.updatedAt}>{kenyaDateTime.format(new Date(value.incident.updatedAt))}</time></dd></div>
              </dl>
            </section>
          : null}
        {!unavailable
          ? <p className="mt-5 text-sm text-muted-foreground">
              On-call coverage: <strong className="font-medium text-foreground">{value.onCallCoverage.coverage}</strong>
              {' · checked '}<time dateTime={value.onCallCoverage.checkedAt}>{kenyaDateTime.format(new Date(value.onCallCoverage.checkedAt))}</time>
            </p>
          : null}
      </CardContent>
    </Card>
    {value.statusPageUrl
      ? <a className="mt-8 inline-flex min-h-11 items-center rounded-sm underline underline-offset-4" href={value.statusPageUrl} rel="noopener noreferrer">Open configured status history</a>
      : <p className="mt-8 text-sm text-muted-foreground">No separate status-history link is configured.</p>}
  </>
}
