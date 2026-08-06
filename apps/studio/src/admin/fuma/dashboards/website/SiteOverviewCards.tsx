/**
 * Site-specific measurements.
 *
 * Page states, post totals with their 28-day publish histogram, and the media
 * library — the things that belong to this site. Storage, database size and plan
 * limits are plan-level and live on the platform overview instead, so neither
 * profile dashboard repeats them.
 *
 * Every figure comes from the builder's own readers, and an unavailable reader
 * says so rather than showing a zero that would read as real data.
 */
import { useEffect } from 'react'
import { useDashboardStore } from '../dashboardStore'
import { formatBytes } from '../siteOverview'
import { ButtonLink, Card, CardCaption, CardTitle } from '../../ui/primitives'

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
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl leading-none font-semibold tracking-tight text-foreground">
        {value}
      </p>
      {detail ? <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">{detail}</p> : null}
    </div>
  )
}

function PostHistogram({ daily }: { daily: readonly number[] }) {
  if (daily.length === 0 || daily.every((value) => value === 0)) {
    return <p className="mt-3 text-xs text-muted-foreground">No publishes in the last 28 days</p>
  }
  const max = Math.max(...daily, 1)
  return (
    <div className="mt-3 flex h-10 items-end gap-[2px]" aria-hidden="true">
      {daily.map((value, index) => (
        <span
          key={index}
          className="flex-1 rounded-sm bg-primary"
          style={{ height: `${Math.max(6, (value / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

export function SiteOverviewCards({ builderPath }: SiteOverviewCardsProps) {
  const overview = useDashboardStore((state) => state.overview)
  const loadOverview = useDashboardStore((state) => state.loadOverview)

  useEffect(() => { void loadOverview() }, [loadOverview])

  const { pages, posts, media } = overview

  return (
    <div className="grid gap-4 lg:grid-cols-4">
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
            <p className="text-[0.6875rem] text-muted-foreground">
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
