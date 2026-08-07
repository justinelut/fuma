/**
 * Website analytics: the model's honesty rules and the surface that renders them.
 *
 * The distinction under test throughout is `dailyReads: null` (nothing measured) versus `[]`
 * (measured and genuinely empty). Collapsing them tells somebody their site has no visitors when
 * the truth is that nothing is counting.
 */
import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import {
  MEASUREMENT_GAP,
  PUBLICATION_ONLY_METRICS,
  availabilityOf,
  daysInRange,
  filledSeries,
  isPlottable,
  totalReads,
  type WebsiteAnalyticsData,
} from '@core/fuma/websiteAnalytics'
import { WebsiteAnalyticsSurface } from '@admin/fuma/analytics/WebsiteAnalyticsRouteContent'

const range = { from: '2026-03-01', to: '2026-03-05', label: 'Past 5 days' }

function data(over: Partial<WebsiteAnalyticsData> = {}): WebsiteAnalyticsData {
  return { range, dailyReads: null, bandwidthBytes: null, ...over }
}

describe('not measured and measured-as-zero are different facts', () => {
  it('an unmeasured range says the platform is not collecting, not that nobody visited', () => {
    const availability = availabilityOf(data())
    expect(availability.code).toBe('not-collected')
    expect(availability.message).toContain('not being collected')
    // The wording must not make a claim about the site's traffic.
    expect(availability.message).not.toContain('No visits')
  })

  it('a measured empty range says nobody visited, which is a real measurement', () => {
    const availability = availabilityOf(data({ dailyReads: [] }))
    expect(availability.code).toBe('measured-empty')
    expect(availability.message).toContain('No visits were recorded')
  })

  it('a measured range with reads reports nothing to explain', () => {
    const availability = availabilityOf(data({ dailyReads: [{ day: '2026-03-01', reads: 4 }] }))
    expect(availability.code).toBe('measured')
    expect(availability.message).toBe('')
  })
})

describe('nothing is plotted from an unmeasured range', () => {
  it('an unmeasured range is not plottable and yields no series', () => {
    expect(isPlottable(data())).toBe(false)
    expect(filledSeries(data())).toBeNull()
  })

  it('so an un-instrumented site cannot acquire a flat line of zeros', () => {
    // The dangerous shape: filling the axis first would turn "not measured" into five zero bars.
    expect(filledSeries(data({ dailyReads: null }))).toBeNull()
  })

  it('a measured empty range is also not plotted, because an empty chart reads as no traffic', () => {
    expect(isPlottable(data({ dailyReads: [] }))).toBe(false)
  })

  it('a measured range fills absent days so the axis is not misleading', () => {
    // A day with no events has no row, so plotting rows directly puts 1 March beside 4 March.
    const series = filledSeries(data({
      dailyReads: [{ day: '2026-03-01', reads: 2 }, { day: '2026-03-04', reads: 3 }],
    }))
    expect(series?.map((day) => day.day)).toEqual([
      '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05',
    ])
    expect(series?.map((day) => day.reads)).toEqual([2, 0, 0, 3, 0])
  })

  it('and the total counts only what was measured', () => {
    expect(totalReads(data())).toBe(0)
    expect(totalReads(data({ dailyReads: [{ day: '2026-03-01', reads: 7 }] }))).toBe(7)
  })
})

describe('the range axis', () => {
  it('includes both ends', () => {
    expect(daysInRange('2026-03-01', '2026-03-03')).toEqual(['2026-03-01', '2026-03-02', '2026-03-03'])
  })

  it('crosses a leap day', () => {
    expect(daysInRange('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01'])
  })

  it('returns empty for an inverted or unparseable range rather than looping', () => {
    expect(daysInRange('2026-03-05', '2026-03-01')).toEqual([])
    expect(daysInRange('not-a-date', '2026-03-01')).toEqual([])
  })
})

describe('publication metrics never appear on a website site', () => {
  it('names them, because each would render a permanent zero', () => {
    // A zero beside "Newsletter opens" reports that the newsletter has no readers, for a site with
    // no newsletter. Absent is correct.
    expect(PUBLICATION_ONLY_METRICS).toContain('newsletter-open')
    expect(PUBLICATION_ONLY_METRICS).toContain('post-read')
  })

  it('and the surface renders none of them', () => {
    render(<WebsiteAnalyticsSurface data={data({ dailyReads: [{ day: '2026-03-01', reads: 5 }] })} />)
    for (const word of ['Newsletter', 'Subscribers', 'Posts']) {
      expect(screen.queryByText(new RegExp(word, 'i'))).toBeNull()
    }
  })
})

describe('the surface states absence rather than drawing it', () => {
  it('shows no visit total at all when nothing was measured', () => {
    render(<WebsiteAnalyticsSurface data={data()} />)
    expect(screen.getByRole('status').textContent).toContain('not being collected')
    // A "0 visits" headline is a number somebody would act on, and it would be wrong.
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.getByText(/Nothing is wrong with your site/i)).toBeTruthy()
  })

  it('draws no bar when nothing was measured', () => {
    const { container } = render(<WebsiteAnalyticsSurface data={data()} />)
    expect(container.querySelectorAll('[style*="height"]')).toHaveLength(0)
  })

  it('reports the measured total and draws a bar per day when it was', () => {
    const { container } = render(<WebsiteAnalyticsSurface data={data({
      dailyReads: [{ day: '2026-03-01', reads: 2 }, { day: '2026-03-02', reads: 6 }],
    })} />)
    expect(screen.getByText('8')).toBeTruthy()
    expect(screen.getByText('visits')).toBeTruthy()
    expect(container.querySelectorAll('[style*="height"]')).toHaveLength(5)
  })

  it('uses the singular for one visit, because "1 visits" reads as a bug', () => {
    render(<WebsiteAnalyticsSurface data={data({ dailyReads: [{ day: '2026-03-01', reads: 1 }] })} />)
    expect(screen.getByText('visit')).toBeTruthy()
  })

  it('gives every bar an accessible reading, since a bar alone is not a label', () => {
    render(<WebsiteAnalyticsSurface data={data({ dailyReads: [{ day: '2026-03-01', reads: 2 }] })} />)
    expect(screen.getByText('2026-03-01: 2 visits')).toBeTruthy()
  })

  it('states unmeasured bandwidth rather than showing zero', () => {
    render(<WebsiteAnalyticsSurface data={data({ dailyReads: [] })} />)
    expect(screen.getByText(/Not measured for this site yet/i)).toBeTruthy()
  })

  it('and reports bandwidth when it is measured', () => {
    render(<WebsiteAnalyticsSurface data={data({ dailyReads: [], bandwidthBytes: 2_500_000 })} />)
    expect(screen.getByText(/2\.5 MB/)).toBeTruthy()
  })
})

describe('the measurement gap is recorded rather than hidden', () => {
  it('names the route and why no reader exists', () => {
    expect(MEASUREMENT_GAP.route).toBe('route.website-analytics')
    expect(MEASUREMENT_GAP.reason).toContain('profile_id')
    expect(MEASUREMENT_GAP.whatWouldCloseIt.length).toBeGreaterThan(40)
  })

  it('and is not blocking, because the page is honest without it', () => {
    expect(MEASUREMENT_GAP.blocking).toBe(false)
  })
})
