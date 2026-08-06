/**
 * Merged site overview.
 *
 * Brings the builder's own dashboard measurements into the platform dashboard:
 * the storage breakdown by kind, page states, post totals with their 28-day
 * publish histogram, and the media library. Nothing here is recounted by the
 * platform, and an unavailable reader says so rather than showing a zero.
 */
import { useEffect } from 'react'
import { useDashboardStore } from '../dashboardStore'
import { formatBytes } from '../siteOverview'
import { ButtonLink, Card, CardCaption, CardTitle } from '../../ui/primitives'
import { cn } from '../../ui/cn'

export interface SiteOverviewCardsProps {
  builderPath: string
}

function Figure({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div>
      <p className="text-xs text-dash-ink-muted">{label}</p>
      <p className="mt-1 text-xl leading-none font-semibold tracking-tight text-dash-ink">
        {value}
      </p>
      {detail ? <p className="mt-1.5 text-[0.6875rem] text-dash-ink-muted">{detail}</p> : null}
    </div>
  )
}

function StorageBar({
  parts,
  total,
}: {
  parts: readonly Readonly<{ label: string, bytes: number, className: string }>[]
  total: number
}) {
  if (total <= 0) {
    return <p className="mt-3 text-xs text-dash-ink-muted">Nothing stored yet</p>
  }
  return (
    <>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-dash-rail">
        {parts.filter((part) => part.bytes > 0).map((part) => (
          <span
            key={part.label}
            className={part.className}
            style={{ width: `${(part.bytes / total) * 100}%` }}
            title={`${part.label}: ${formatBytes(part.bytes)}`}
          />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-[0.6875rem]">
        {parts.map((part) => (
          <div key={part.label} className="flex items-center gap-1.5">
            <span className={cn('size-1.5 shrink-0 rounded-full', part.className)} />
            <dt className="text-dash-ink-muted">{part.label}</dt>
            <dd className="ml-auto text-dash-ink-soft">{formatBytes(part.bytes)}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

function PostHistogram({ daily }: { daily: readonly number[] }) {
  if (daily.length === 0 || daily.every((value) => value === 0)) {
    return <p className="mt-3 text-xs text-dash-ink-muted">No publishes in the last 28 days</p>
  }
  const max = Math.max(...daily, 1)
  return (
    <div className="mt-3 flex h-10 items-end gap-[2px]" aria-hidden="true">
      {daily.map((value, index) => (
        <span
          key={index}
          className="flex-1 rounded-sm bg-dash-accent"
          style={{ height: `${Math.max(6, (value / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

export function SiteOverviewCards({ builderPath }: SiteOverviewCardsProps) {
  const status = useDashboardStore((state) => state.status)
  const overview = useDashboardStore((state) => state.overview)
  const loadOverview = useDashboardStore((state) => state.loadOverview)

  useEffect(() => { void loadOverview() }, [loadOverview])

  const { storage, pages, posts, media } = overview
  const loading = status !== 'ready'

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <Card className="lg:col-span-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Storage</CardTitle>
          <CardCaption>
            {loading
              ? 'Reading measurements'
              : storage
                ? `${formatBytes(storage.totalBytes)} used · ${storage.dialect}`
                : 'Measurements unavailable'}
          </CardCaption>
        </div>
        {storage ? (
          <StorageBar
            total={storage.totalBytes}
            parts={[
              { label: 'Images', bytes: storage.imageBytes, className: 'bg-dash-ink' },
              { label: 'Videos', bytes: storage.videoBytes, className: 'bg-dash-accent' },
              { label: 'Documents', bytes: storage.documentBytes, className: 'bg-dash-ink-soft' },
              { label: 'Plugins', bytes: storage.pluginBytes, className: 'bg-dash-accent-soft' },
              { label: 'Database', bytes: storage.databaseBytes, className: 'bg-dash-ink-muted' },
            ]}
          />
        ) : (
          <p className="mt-3 text-xs text-dash-ink-muted">
            {loading ? 'Reading storage…' : 'Open the visual builder to see storage.'}
          </p>
        )}
      </Card>

      <Card>
        <CardTitle>Pages</CardTitle>
        <div className="mt-4 space-y-3">
          <Figure
            label="Published"
            value={pages ? String(pages.published) : '—'}
            detail={pages
              ? `${pages.drafts} drafts · ${pages.scheduled} scheduled`
              : undefined}
          />
          {pages && pages.deltaPublishedThisWeek > 0 ? (
            <p className="text-[0.6875rem] text-dash-ink-soft">
              +{pages.deltaPublishedThisWeek} this week
            </p>
          ) : null}
        </div>
      </Card>

      <Card tone="warm">
        <CardTitle>Posts</CardTitle>
        <div className="mt-4">
          <Figure
            label="Total"
            value={posts ? String(posts.total) : '—'}
            detail={posts
              ? `${posts.categories} ${posts.categories === 1 ? 'category' : 'categories'} · ${posts.scheduled} scheduled`
              : undefined}
          />
          {posts ? <PostHistogram daily={posts.daily28} /> : null}
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Media</CardTitle>
          <CardCaption>Managed in the visual builder</CardCaption>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4">
          <Figure label="Files" value={media ? String(media.count) : '—'} />
          <Figure label="Size" value={formatBytes(media?.totalBytes ?? null)} />
        </dl>
        <div className="mt-5">
          <ButtonLink href={builderPath} variant="outline" size="sm">
            Open visual builder
          </ButtonLink>
        </div>
      </Card>
    </div>
  )
}
