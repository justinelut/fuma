/**
 * Storage and bandwidth for the site, with the allowance the plan includes.
 *
 * TWO DEFECTS THIS FIXES.
 *
 * 1. IT WAS RENDERING WITH A PALETTE THAT NO LONGER EXISTS. Every colour here was `dash-ink`,
 *    `dash-ink-muted` or `dash-rail`, and those tokens were removed when the hosted surfaces moved to
 *    the shadcn semantic set. An unknown Tailwind class compiles to NOTHING — silently — so the text
 *    had no colour and the usage bar had no fill. It looked like a rendering bug rather than a missing
 *    token, which is why it survived.
 *
 * 2. THE ALLOWANCE WAS ONLY SHOWN WHEN A LIMIT HAPPENED TO BE KNOWN, and bandwidth was not shown at
 *    all. A visitor on the free tier could not see what they were allowed, so there was no way to tell
 *    whether they were near it until something refused.
 *
 * THE RULE THAT SHAPES THE REST: AN UNKNOWN LIMIT IS NOT UNLIMITED. Rendering a missing allowance as
 * "unlimited", or as a bar at 0%, is a promise the product has not made — and the one somebody
 * discovers is false at the moment their upload is refused. So an absent limit says exactly that, and
 * no bar is drawn, because a proportion of an unknown total is not a quantity.
 */
import { useEffect, useState } from 'react'
import { apiRequest } from '@core/http'
import { Type } from '@core/utils/typeboxHelpers'
import { ButtonLink, Card, CardCaption, CardTitle } from '../../ui/primitives'
import { cn } from '../../ui/cn'
import { GROUP, GROUP_GAP, RELATED_GAP, TIGHT } from '../../ui/rhythm'

const StorageSchema = Type.Object({
  usedBytes: Type.Number(),
  limitBytes: Type.Union([Type.Number(), Type.Null()]),
}, { additionalProperties: true })

const CountSchema = Type.Object({
  total: Type.Number(),
}, { additionalProperties: true })

type Figures = Readonly<{
  usedBytes: number | null
  limitBytes: number | null
  media: number | null
  pages: number | null
}>

const UNAVAILABLE: Figures = Object.freeze({
  usedBytes: null,
  limitBytes: null,
  media: null,
  pages: null,
})

export function formatBytes(value: number | null): string {
  if (value === null) return '—'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let scaled = value / 1024
  let unit = 0
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024
    unit += 1
  }
  return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1)} ${units[unit]}`
}

async function readFigures(): Promise<Figures> {
  const [storage, media, pages] = await Promise.all([
    apiRequest('/admin/api/cms/dashboard/storage', { schema: StorageSchema }).catch(() => null),
    apiRequest('/admin/api/cms/dashboard/media', { schema: CountSchema }).catch(() => null),
    apiRequest('/admin/api/cms/dashboard/pages', { schema: CountSchema }).catch(() => null),
  ])
  if (!storage && !media && !pages) return UNAVAILABLE
  return Object.freeze({
    usedBytes: storage?.usedBytes ?? null,
    limitBytes: storage?.limitBytes ?? null,
    media: media?.total ?? null,
    pages: pages?.total ?? null,
  })
}

/**
 * Bandwidth for the current billing period.
 *
 * Supplied by the caller rather than fetched here, because bandwidth is a PLATFORM meter
 * (origin_bandwidth_bytes) and not something the builder measures — this component must not imply the
 * builder is its source. The period is named because a byte count with no period attached is not a
 * measurement anybody can act on.
 */
export interface BandwidthReading {
  usedBytes: number | null
  allowanceBytes: number | null
  periodLabel: string
}

export interface InstaticStorageCardProps {
  builderPath: string
  bandwidth?: BandwidthReading
  /** Where a visitor goes to raise an allowance. Omitted when there is nothing to upgrade to. */
  plansPath?: string
}

/** A usage meter that refuses to imply a limit it does not know. */
function Meter({
  label,
  used,
  allowance,
  caption,
}: {
  label: string
  used: number | null
  allowance: number | null
  caption?: string
}) {
  // Only a KNOWN allowance produces a proportion. A bar against an unknown total would read as
  // "plenty left", which is the reading that gets somebody into trouble.
  const percent = used !== null && allowance !== null && allowance > 0
    ? Math.min(100, Math.round((used / allowance) * 100))
    : null
  // Warn before refusal rather than at it: at 100% the upload has already failed.
  const nearLimit = percent !== null && percent >= 80

  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('text-xl font-semibold tracking-tight text-foreground', TIGHT)}>
        {formatBytes(used)}
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          {allowance === null ? 'used' : `of ${formatBytes(allowance)}`}
        </span>
      </dd>
      {percent === null ? (
        <p className="mt-2 text-[0.6875rem] leading-snug text-muted-foreground">
          {/* Said plainly rather than left blank: a blank space where an allowance belongs reads as
              unlimited, and that is the assumption that turns into a surprise. */}
          {allowance === null ? 'Included allowance not published yet' : caption ?? ''}
        </p>
      ) : (
        <>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', nearLimit ? 'bg-destructive' : 'bg-primary')}
              style={{ width: `${percent}%` }}
            />
          </div>
          <p
            className={cn(
              'mt-1.5 text-[0.6875rem] leading-snug',
              nearLimit ? 'font-medium text-destructive' : 'text-muted-foreground',
            )}
          >
            {nearLimit ? `${percent}% used — close to the limit` : `${percent}% used`}
            {caption ? ` · ${caption}` : ''}
          </p>
        </>
      )}
    </div>
  )
}

export function InstaticStorageCard({
  builderPath,
  bandwidth,
  plansPath,
}: InstaticStorageCardProps) {
  const [figures, setFigures] = useState<Figures | null>(null)

  useEffect(() => {
    let active = true
    void readFigures().then((result) => {
      if (active) setFigures(result)
    })
    return () => { active = false }
  }, [])

  const resolved = figures ?? UNAVAILABLE

  return (
    <Card>
      <div className={cn('flex flex-wrap items-baseline justify-between', RELATED_GAP)}>
        <CardTitle>Storage and bandwidth</CardTitle>
        <CardCaption>
          {figures === null ? 'Reading current usage' : 'Measured, not estimated'}
        </CardCaption>
      </div>

      <dl className={cn('grid sm:grid-cols-2 lg:grid-cols-4', GROUP_GAP, GROUP)}>
        <Meter label="Storage used" used={resolved.usedBytes} allowance={resolved.limitBytes} />
        {bandwidth ? (
          <Meter
            label="Bandwidth"
            used={bandwidth.usedBytes}
            allowance={bandwidth.allowanceBytes}
            caption={bandwidth.periodLabel}
          />
        ) : (
          <div>
            <dt className="text-xs text-muted-foreground">Bandwidth</dt>
            <dd className={cn('text-xl font-semibold tracking-tight text-foreground', TIGHT)}>—</dd>
            <p className="mt-2 text-[0.6875rem] leading-snug text-muted-foreground">
              Not measured for this site yet
            </p>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted-foreground">Media files</dt>
          <dd className={cn('text-xl font-semibold tracking-tight text-foreground', TIGHT)}>
            {resolved.media ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Pages</dt>
          <dd className={cn('text-xl font-semibold tracking-tight text-foreground', TIGHT)}>
            {resolved.pages ?? '—'}
          </dd>
        </div>
      </dl>

      <div className={cn('flex flex-wrap items-center', RELATED_GAP, GROUP)}>
        <ButtonLink href={builderPath} variant="outline" size="sm">
          Open visual builder
        </ButtonLink>
        {plansPath ? (
          <ButtonLink href={plansPath} variant="quiet" size="sm">
            See plans
          </ButtonLink>
        ) : null}
        <CardCaption>Media, pages and data are managed in the builder</CardCaption>
      </div>
    </Card>
  )
}
