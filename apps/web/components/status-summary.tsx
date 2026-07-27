import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { PublicStatusView } from '@/lib/status-boundary'

const labels = {
  operational: 'Operational',
  degraded: 'Degraded',
  outage: 'Outage',
} as const

export function StatusSummary({ value }: Readonly<{ value: PublicStatusView }>) {
  const unavailable = value.availability === 'unavailable'
  return <>
    <Card aria-labelledby="service-status-heading" className="mt-8 border">
      <CardHeader>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {unavailable ? 'Live summary unavailable' : 'Authority-reported summary'}
        </p>
        <CardTitle id="service-status-heading" className="text-2xl">
          {unavailable ? 'Status not available' : labels[value.status]}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div role="status" aria-live="polite" aria-atomic="true">
          <p className="leading-7">{value.message}</p>
          <p className="mt-3 text-sm text-muted-foreground">
            {unavailable ? 'Last attempted ' : 'Authority checked '}
            <time dateTime={unavailable ? value.attemptedAt : value.checkedAt}>
              {unavailable ? value.attemptedAt : value.checkedAt}
            </time>
          </p>
        </div>
      </CardContent>
    </Card>
    {value.statusPageUrl
      ? <a className="mt-8 inline-flex min-h-11 items-center rounded-sm underline underline-offset-4" href={value.statusPageUrl} rel="noopener noreferrer">Open configured status history</a>
      : <p className="mt-8 text-sm text-muted-foreground">No separate status-history link is configured.</p>}
  </>
}
