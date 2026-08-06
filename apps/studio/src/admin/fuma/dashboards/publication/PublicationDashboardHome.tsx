/**
 * Publication dashboard content.
 *
 * The stacked card sequence from
 * docs/reference/design/ghost-publication-dashboard.webp: a three-up member KPI
 * row with deltas, a gradient area chart, a three-up revenue row pairing a
 * sparkline with a bar series and a stacked mix bar, an engagement row, and a
 * tabbed table with inline rate bars.
 *
 * Every figure comes from the injected model. A series with no data renders its
 * own empty state instead of a fabricated shape.
 */
import { useId, useState } from 'react'
import { cn } from '../../ui/cn'

export type Kpi = Readonly<{
  id: string
  label: string
  value: number | null
  deltaPercent: number | null
}>

export type SeriesPoint = Readonly<{ label: string, value: number }>

export type PostRow = Readonly<{
  id: string
  title: string
  sends: number | null
  openRate: number | null
}>

export interface PublicationDashboardHomeProps {
  kpis: readonly Kpi[]
  memberSeries: readonly SeriesPoint[]
  reads: Readonly<{
    /** Total site reads in range, the headline for the first cell. */
    total: number | null
    postShareSeries: readonly SeriesPoint[]
    newsletterSeries: readonly SeriesPoint[]
    /** Share of reads from paying members, for the stacked mix bar. */
    paidShare: number | null
    sources: readonly Readonly<{ source: string, reads: number }>[]
  }>
  engagement: Readonly<{
    openRate: number | null
    clickRate: number | null
    members: number | null
  }>
  recentPosts: readonly PostRow[]
}

function Panel({ className, children }: { className?: string, children: React.ReactNode }) {
  return (
    <section
      className={cn(
        'rounded-lg border border-ghost-hairline bg-ghost-card p-5',
        className,
      )}
    >
      {children}
    </section>
  )
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return null
  const up = value >= 0
  return (
    <span className={cn('ml-2 text-xs font-medium', up ? 'text-ghost-positive' : 'text-ghost-series')}>
      {up ? '↑' : '↓'}{Math.abs(value)}%
    </span>
  )
}

function formatCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US')
}

function AreaChart({ points }: { points: readonly SeriesPoint[] }) {
  const gradientId = useId()
  if (points.length < 2) {
    return (
      <div className="mt-4 grid h-[190px] place-items-center rounded-md border border-dashed border-ghost-hairline">
        <p className="text-xs text-ghost-ink-muted">No member history yet</p>
      </div>
    )
  }
  const max = Math.max(...points.map((point) => point.value), 1)
  const step = 100 / (points.length - 1)
  const line = points
    .map((point, index) => `${index * step},${40 - (point.value / max) * 34}`)
    .join(' ')
  return (
    <div className="mt-4">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-[190px] w-full" role="img" aria-label="Total members over time">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-ghost-series)" stopOpacity="0.42" />
            <stop offset="100%" stopColor="var(--color-ghost-series)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,40 ${line} 100,40`} fill={`url(#${gradientId})`} />
        <polyline
          points={line}
          fill="none"
          stroke="var(--color-ghost-series)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-2 flex justify-between text-[0.6875rem] text-ghost-ink-muted">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  )
}

function Sparkline({ points }: { points: readonly SeriesPoint[] }) {
  if (points.length < 2) {
    return <p className="mt-3 text-xs text-ghost-ink-muted">No revenue history yet</p>
  }
  const max = Math.max(...points.map((point) => point.value), 1)
  const step = 100 / (points.length - 1)
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-3 h-12 w-full" aria-hidden="true">
      <polyline
        points={points.map((point, index) => `${index * step},${30 - (point.value / max) * 26}`).join(' ')}
        fill="none"
        stroke="var(--color-ghost-series-alt)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function Bars({ points }: { points: readonly SeriesPoint[] }) {
  if (points.length === 0) {
    return <p className="mt-3 text-xs text-ghost-ink-muted">No subscription activity yet</p>
  }
  const max = Math.max(...points.map((point) => point.value), 1)
  return (
    <div className="mt-3 flex h-12 items-end gap-[3px]">
      {points.map((point) => (
        <span
          key={point.label}
          className="flex-1 rounded-sm bg-ghost-series-alt"
          style={{ height: `${Math.max(6, (point.value / max) * 100)}%` }}
          title={`${point.label}: ${point.value}`}
        />
      ))}
    </div>
  )
}

export function PublicationDashboardHome({
  kpis,
  memberSeries,
  reads,
  engagement,
  recentPosts,
}: PublicationDashboardHomeProps) {
  const [tab, setTab] = useState<'posts' | 'members'>('posts')

  return (
    <>
      <Panel>
        <dl className="grid gap-6 sm:grid-cols-3">
          {kpis.map((kpi) => (
            <div key={kpi.id}>
              <dt className="text-xs text-ghost-ink-soft">{kpi.label}</dt>
              <dd className="mt-2 flex items-baseline text-[1.75rem] leading-none font-semibold tracking-tight">
                {formatCount(kpi.value)}
                <Delta value={kpi.deltaPercent} />
              </dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel>
        <p className="text-xs text-ghost-ink-soft">Total members</p>
        <AreaChart points={memberSeries} />
      </Panel>

      <Panel>
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-xs text-ghost-ink-soft">Reads</p>
            <p className="mt-2 text-[1.5rem] leading-none font-semibold tracking-tight">
              {formatCount(reads.total)}
            </p>
            <Sparkline points={reads.postShareSeries} />
          </div>
          <div>
            <p className="text-xs text-ghost-ink-soft">Newsletter opens</p>
            <div className="mt-2 flex items-center gap-3 text-[0.6875rem] text-ghost-ink-muted">
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-ghost-series-alt" />Per newsletter
              </span>
            </div>
            <Bars points={reads.newsletterSeries} />
          </div>
          <div>
            <p className="text-xs text-ghost-ink-soft">Read sources</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[0.6875rem] text-ghost-ink-muted">
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-ghost-series-alt" />Members
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-ghost-series" />Public
              </span>
            </div>
            {reads.paidShare === null ? (
              <p className="mt-3 text-xs text-ghost-ink-muted">No reads recorded in range</p>
            ) : (
              <>
                <div className="mt-5 flex h-1.5 overflow-hidden rounded-full bg-ghost-hairline">
                  <span className="bg-ghost-series-alt" style={{ width: `${reads.paidShare}%` }} />
                  <span className="flex-1 bg-ghost-series" />
                </div>
                <dl className="mt-3 space-y-1 text-[0.6875rem]">
                  {reads.sources.map((entry) => (
                    <div key={entry.source} className="flex justify-between gap-3">
                      <dt className="text-ghost-ink-muted capitalize">{entry.source}</dt>
                      <dd className="text-ghost-ink-soft">{formatCount(entry.reads)}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </div>
        </div>
      </Panel>

      <Panel>
        <dl className="grid gap-6 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ghost-ink-soft">Newsletter open rate</dt>
            <dd className="mt-2 text-[1.5rem] leading-none font-semibold tracking-tight">
              {engagement.openRate === null ? '—' : `${engagement.openRate}%`}
            </dd>
            <p className="mt-1 text-[0.6875rem] text-ghost-ink-muted">
              Opens against sends in range
            </p>
          </div>
          <div>
            <dt className="text-xs text-ghost-ink-soft">Click rate</dt>
            <dd className="mt-2 text-[1.5rem] leading-none font-semibold tracking-tight">
              {engagement.clickRate === null ? '—' : `${engagement.clickRate}%`}
            </dd>
            <p className="mt-1 text-[0.6875rem] text-ghost-ink-muted">
              Clicks against opens in range
            </p>
          </div>
          <div>
            <dt className="text-xs text-ghost-ink-soft">Members</dt>
            <dd className="mt-2 text-[1.5rem] leading-none font-semibold tracking-tight">
              {formatCount(engagement.members)}
            </dd>
            <p className="mt-1 text-[0.6875rem] text-ghost-ink-muted">
              Active member accounts
            </p>
          </div>
        </dl>
      </Panel>

      <Panel className="p-0">
        <div className="flex gap-5 border-b border-ghost-hairline px-5 pt-4">
          {(['posts', 'members'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              aria-current={tab === value ? 'true' : undefined}
              className={cn(
                '-mb-px border-b-2 pb-3 text-[0.8125rem] transition-colors',
                tab === value
                  ? 'border-ghost-ink text-ghost-ink'
                  : 'border-transparent text-ghost-ink-soft hover:text-ghost-ink',
              )}
            >
              {value === 'posts' ? 'Recent posts' : 'Member activity'}
            </button>
          ))}
        </div>

        {tab === 'posts' ? (
          recentPosts.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-ghost-ink-muted">
              No posts yet. Write the first one to see how it performs.
            </p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="text-[0.6875rem] tracking-wide text-ghost-ink-muted uppercase">
                  <th scope="col" className="px-5 py-3 font-medium">Title</th>
                  <th scope="col" className="px-5 py-3 font-medium">Sends</th>
                  <th scope="col" className="px-5 py-3 font-medium">Open rate</th>
                </tr>
              </thead>
              <tbody>
                {recentPosts.map((post) => (
                  <tr key={post.id} className="border-t border-ghost-hairline text-[0.8125rem]">
                    <td className="max-w-[340px] truncate px-5 py-3">{post.title}</td>
                    <td className="px-5 py-3 text-ghost-ink-soft">{formatCount(post.sends)}</td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-3">
                        <span className="w-9 shrink-0 text-ghost-ink-soft">
                          {post.openRate === null ? '—' : `${post.openRate}%`}
                        </span>
                        <span className="h-1 min-w-[80px] flex-1 overflow-hidden rounded-full bg-ghost-hairline">
                          <span
                            className="block h-full rounded-full bg-ghost-series"
                            style={{ width: `${post.openRate ?? 0}%` }}
                          />
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          <p className="px-5 py-8 text-center text-xs text-ghost-ink-muted">
            Member activity appears once members sign up.
          </p>
        )}
      </Panel>
    </>
  )
}
