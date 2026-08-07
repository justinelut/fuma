/**
 * Website-profile analytics page.
 *
 * This route is the one task 76 was missing: `nav.website-analytics` pointed at
 * `route.website-analytics` and NO admin file claimed it, so choosing "Analytics" in a website
 * site's navigation rendered the shell with an empty content region. That reads as the product
 * being broken rather than as a page nobody built, which is why the acceptance gate in
 * `src/core/fuma/pageAcceptance.ts` now measures the property instead of trusting a checklist.
 *
 * The surface renders a MEASURED series when one exists and states the absence otherwise. It is not
 * a placeholder: the data arrives as a prop, so the moment a reader exists the page reports it.
 */
import { Info } from 'lucide-react'
import type { PermissionDecision } from '@core/fuma'
import {
  availabilityOf,
  filledSeries,
  isPlottable,
  totalReads,
  type WebsiteAnalyticsData,
} from '@core/fuma/websiteAnalytics'
import { Badge } from '../ui/badge'
import { RHYTHM } from '../ui/rhythm'
import type { FumaScopedShellReadyContext } from '../FumaScopedShell'

export interface WebsiteAnalyticsSurfaceProps {
  readonly data: WebsiteAnalyticsData
}

/** Tallest bar in the series, floored at 1 so a single measured day does not divide by zero. */
function peakOf(series: readonly { reads: number }[]): number {
  return Math.max(1, ...series.map((day) => day.reads))
}

export function WebsiteAnalyticsSurface({ data }: WebsiteAnalyticsSurfaceProps) {
  const availability = availabilityOf(data)
  const series = filledSeries(data)
  const plottable = isPlottable(data)
  const peak = series === null ? 1 : peakOf(series)

  return (
    <section aria-labelledby="website-analytics-heading">
      <h1 id="website-analytics-heading" className="text-lg font-semibold text-foreground">
        Analytics
      </h1>
      <p className={`${RHYTHM.TIGHT} text-sm text-muted-foreground`}>{data.range.label}</p>

      {/*
        The total is shown only when something was measured. A "0 visits" headline on an
        un-instrumented site is a number somebody would act on, and it would be wrong.
      */}
      {availability.code === 'measured' ? (
        <p className={`${RHYTHM.GROUP} text-3xl font-semibold tabular-nums text-foreground`}>
          {totalReads(data).toLocaleString()}
          <span className={`${RHYTHM.TIGHT} block text-sm font-normal text-muted-foreground`}>
            {totalReads(data) === 1 ? 'visit' : 'visits'}
          </span>
        </p>
      ) : (
        <div className={`${RHYTHM.GROUP} flex items-start gap-3 rounded-md border border-border bg-muted/40 p-4`} role="status">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm text-foreground">{availability.message}</p>
            {availability.code === 'not-collected' ? (
              <p className={`${RHYTHM.TIGHT} text-sm text-muted-foreground`}>
                Nothing is wrong with your site. This page will fill in once collection is switched on.
              </p>
            ) : null}
          </div>
        </div>
      )}

      {/*
        NO BAR IS DRAWN unless the range was measured. An empty chart frame reads as "no traffic",
        which is a claim about the site rather than about what the platform counted.
      */}
      {plottable && series !== null ? (
        <div className={RHYTHM.SECTION}>
          <h2 className="text-sm font-medium text-foreground">Visits per day</h2>
          <ul className={`${RHYTHM.RELATED} flex items-end ${RHYTHM.RELATED_GAP} h-32`}>
            {series.map((day) => (
              <li key={day.day} className="flex h-full flex-1 flex-col justify-end">
                <span
                  className="block w-full rounded-sm bg-primary"
                  style={{ height: `${Math.round((day.reads / peak) * 100)}%` }}
                  /* The bar is decorative; the accessible reading is the label below it. */
                  aria-hidden="true"
                />
                <span className="sr-only">{`${day.day}: ${day.reads} visits`}</span>
                <span aria-hidden="true" className={`${RHYTHM.TIGHT} block text-center text-xs text-muted-foreground`}>
                  {day.day.slice(8)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={RHYTHM.SECTION}>
        <h2 className="text-sm font-medium text-foreground">Bandwidth</h2>
        {data.bandwidthBytes === null ? (
          /*
            Stated rather than shown as zero, for the reason task 6 established: bandwidth is a
            platform meter and no per-site reading is exposed, so a 0 would claim a measurement.
          */
          <p className={`${RHYTHM.TIGHT} text-sm text-muted-foreground`}>
            Not measured for this site yet.
          </p>
        ) : (
          <p className={`${RHYTHM.TIGHT} text-sm tabular-nums text-foreground`}>
            {(data.bandwidthBytes / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB
            <Badge variant="secondary" className="ml-2">{data.range.label}</Badge>
          </p>
        )}
      </div>
    </section>
  )
}

/**
 * Claims `route.website-analytics`.
 *
 * Gated the same way DomainsRouteContent is - by resolved route id plus the profile capability -
 * so the page cannot render for a profile whose navigation does not offer it.
 */
export function WebsiteAnalyticsRouteContent({ shell, data }: Readonly<{
  shell: FumaScopedShellReadyContext
  permissionDecisions?: readonly PermissionDecision[]
  /** Null until a reader exists; the surface states the absence rather than drawing zeros. */
  data?: WebsiteAnalyticsData | null
}>) {
  const selected = shell.routeAccess.kind === 'allowed'
    && shell.routeAccess.route.id === 'route.website-analytics'
  if (!selected) return null
  const resolved: WebsiteAnalyticsData = data ?? {
    range: { from: '', to: '', label: 'Past 30 days' },
    dailyReads: null,
    bandwidthBytes: null,
  }
  return (
    <div data-testid="website-analytics-route-content">
      <WebsiteAnalyticsSurface data={resolved} />
    </div>
  )
}
