/**
 * Instatic figures inside the platform dashboard.
 *
 * Instatic already measures storage, media, pages and posts for the site it
 * builds. Rather than recount any of it, this card reads Instatic's own
 * dashboard readers and presents the result next to the platform's own state,
 * with a direct way into Instatic itself.
 *
 * Every value is either read from Instatic or shown as unavailable. Nothing is
 * estimated.
 */
import { useEffect, useState } from 'react'
import { apiRequest } from '@core/http'
import { Type } from '@core/utils/typeboxHelpers'
import { ButtonLink, Card, CardCaption, CardTitle } from '../../ui/primitives'
import { cn } from '../../ui/cn'

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

function formatBytes(value: number | null): string {
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

export interface InstaticStorageCardProps {
  builderPath: string
}

export function InstaticStorageCard({ builderPath }: InstaticStorageCardProps) {
  const [figures, setFigures] = useState<Figures | null>(null)

  useEffect(() => {
    let active = true
    void readFigures().then((result) => {
      if (active) setFigures(result)
    })
    return () => { active = false }
  }, [])

  const resolved = figures ?? UNAVAILABLE
  const percent = resolved.usedBytes !== null && resolved.limitBytes
    ? Math.min(100, Math.round((resolved.usedBytes / resolved.limitBytes) * 100))
    : null

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>Storage and library</CardTitle>
        <CardCaption>
          {figures === null ? 'Reading from the builder' : 'Measured by the builder'}
        </CardCaption>
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-dash-ink-muted">Storage used</dt>
          <dd className="mt-1 text-xl font-semibold tracking-tight text-dash-ink">
            {formatBytes(resolved.usedBytes)}
            {resolved.limitBytes ? (
              <span className="ml-1 text-xs font-normal text-dash-ink-muted">
                of {formatBytes(resolved.limitBytes)}
              </span>
            ) : null}
          </dd>
          {percent !== null ? (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-dash-rail">
              <div className="h-full rounded-full bg-dash-ink" style={{ width: `${percent}%` }} />
            </div>
          ) : null}
        </div>
        <div>
          <dt className="text-xs text-dash-ink-muted">Media files</dt>
          <dd className="mt-1 text-xl font-semibold tracking-tight text-dash-ink">
            {resolved.media ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-dash-ink-muted">Pages</dt>
          <dd className="mt-1 text-xl font-semibold tracking-tight text-dash-ink">
            {resolved.pages ?? '—'}
          </dd>
        </div>
      </dl>

      <div className={cn('mt-5 flex items-center gap-2')}>
        <ButtonLink href={builderPath} variant="outline" size="sm">
          Open visual builder
        </ButtonLink>
        <CardCaption>Media, pages and data are managed there</CardCaption>
      </div>
    </Card>
  )
}
