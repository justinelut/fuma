/**
 * The daily analytics series feeding the publication trend chart.
 *
 * The defect: the chart was handed a hard-coded empty array (`memberSeries={[]}`) while the analytics
 * reader already produced a per-day series. So a publication with real traffic saw an empty-state
 * panel, which reads as "nothing happened" rather than "nothing was wired".
 */
import { describe, expect, it } from 'bun:test'
import {
  dailyReadSeriesFrom,
  daysInRange,
} from '@admin/fuma/publication/publicationFigures'

const RANGE = { from: '2026-03-01', to: '2026-03-05' } as const

describe('daysInRange', () => {
  it('includes both ends', () => {
    expect(daysInRange(RANGE)).toEqual([
      '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05',
    ])
  })

  it('crosses a month boundary', () => {
    expect(daysInRange({ from: '2026-01-30', to: '2026-02-02' })).toEqual([
      '2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02',
    ])
  })

  it('handles a leap day rather than skipping it', () => {
    expect(daysInRange({ from: '2028-02-28', to: '2028-03-01' })).toEqual([
      '2028-02-28', '2028-02-29', '2028-03-01',
    ])
  })

  it('returns a single day when the range is one day', () => {
    expect(daysInRange({ from: '2026-03-01', to: '2026-03-01' })).toEqual(['2026-03-01'])
  })

  it('returns nothing for an inverted or unreadable range', () => {
    // Better an empty chart than a loop that never ends or an axis running backwards.
    expect(daysInRange({ from: '2026-03-05', to: '2026-03-01' })).toEqual([])
    expect(daysInRange({ from: 'nonsense', to: '2026-03-01' })).toEqual([])
  })
})

describe('dailyReadSeriesFrom', () => {
  it('sums site and post reads for each day', () => {
    const series = dailyReadSeriesFrom(RANGE, [
      { day: '2026-03-01', siteReads: 10, postReads: 5 },
      { day: '2026-03-02', siteReads: 3, postReads: 1 },
    ])
    expect(series[0]).toEqual({ label: '1', value: 15 })
    expect(series[1]).toEqual({ label: '2', value: 4 })
  })

  it('FILLS DAYS WITH NO ACTIVITY, because the reader omits them entirely', () => {
    // The query groups by metric_day over the aggregate table, so a quiet day has no row at all.
    // Plotting only the returned days would place 1 March next to 5 March as if they were
    // consecutive - misreporting both the shape of the trend and how long it covers.
    const series = dailyReadSeriesFrom(RANGE, [
      { day: '2026-03-01', siteReads: 10, postReads: 0 },
      { day: '2026-03-05', siteReads: 2, postReads: 0 },
    ])
    expect(series).toHaveLength(5)
    expect(series.map((point) => point.value)).toEqual([10, 0, 0, 0, 2])
  })

  it('covers the whole range even with no data at all', () => {
    const series = dailyReadSeriesFrom(RANGE, [])
    expect(series).toHaveLength(5)
    expect(series.every((point) => point.value === 0)).toBe(true)
  })

  it('ignores a day outside the range rather than extending the axis', () => {
    // A row outside the window would silently widen the period the chart claims to show.
    const series = dailyReadSeriesFrom(RANGE, [
      { day: '2026-02-27', siteReads: 99, postReads: 0 },
      { day: '2026-03-02', siteReads: 4, postReads: 0 },
    ])
    expect(series).toHaveLength(5)
    expect(series.reduce((total, point) => total + point.value, 0)).toBe(4)
  })

  it('labels by day of month, because thirty full dates do not fit one axis', () => {
    const series = dailyReadSeriesFrom({ from: '2026-03-09', to: '2026-03-11' }, [])
    expect(series.map((point) => point.label)).toEqual(['9', '10', '11'])
  })

  it('is in chronological order', () => {
    const series = dailyReadSeriesFrom(RANGE, [
      { day: '2026-03-04', siteReads: 4, postReads: 0 },
      { day: '2026-03-01', siteReads: 1, postReads: 0 },
    ])
    // Supplied out of order; the range decides the order, so the line cannot run backwards.
    expect(series.map((point) => point.value)).toEqual([1, 0, 0, 4, 0])
  })
})

describe('the chart is honest about what it plots', () => {
  it('the panel names reads, not members', async () => {
    // The analytics measure read EVENTS; there is no per-day member count anywhere in the reader, so a
    // "Total members" heading over this series would be authoritative and wrong.
    const source = await Bun.file(
      new URL('../../admin/fuma/dashboards/publication/PublicationDashboardHome.tsx', import.meta.url),
    ).text()
    // Scoped to the RENDERED label. The doc comment above the prop names the old heading on purpose,
    // so scanning the whole file would trip on the explanation of the fix.
    expect(source).toContain('>Reads per day</p>')
    expect(source).not.toContain('>Total members</p>')
    // And the chart's accessible name must agree with the visible one.
    expect(source).toContain('aria-label="Reads per day over the selected range"')
  })

  it('the route no longer hands the chart an empty array', async () => {
    const source = await Bun.file(
      new URL('../../admin/fuma/dashboards/publication/PublicationDashboardRoute.tsx', import.meta.url),
    ).text()
    expect(source).toContain('readSeries={figures.dailyReadSeries}')
    expect(source).not.toContain('memberSeries={[]}')
  })
})
