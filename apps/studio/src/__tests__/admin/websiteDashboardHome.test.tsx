/**
 * The website dashboard home: card discipline, one progress surface, and vertical rhythm.
 *
 * Covers three defects that turned out to be one: the same `steps` data was drawn FOUR times (a
 * bar-chart card, a dial card, a segmented bar with a percentage, and the task list), three of them
 * in cards. A reader had to work out that four panels were four drawings of one number, and the
 * question "how far along am I" was answered by all of them and settled by none.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from '@admin/lib/routing'
import { WebsiteDashboardHome } from '@admin/fuma/dashboards/website/WebsiteDashboardHome'
import { RHYTHM } from '@admin/fuma/ui/rhythm'

const STEPS = [
  { id: 's1', title: 'Name the site', description: 'Give it a name people will recognise.', completed: true },
  { id: 's2', title: 'Design a page', description: 'Open the builder and lay out a home page.', completed: true },
  { id: 's3', title: 'Connect a domain', description: 'Point a domain you own at this site.', completed: false },
  { id: 's4', title: 'Publish', description: 'Make it visible to visitors.', completed: false },
]

const AREAS = [
  { id: 'design', label: 'Design', detail: 'Canvas, components and tokens', path: '/admin/site' },
  { id: 'media', label: 'Media', detail: 'Images and files', path: '/admin/media' },
]

function renderHome(steps = STEPS) {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <WebsiteDashboardHome
        siteName="Current Digital"
        builderPath="/admin/builder"
        publicUrl="https://example.com"
        steps={steps as never}
        areas={AREAS as never}
      />
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('one progress surface, not four', () => {
  it('states progress once, as completed of total', () => {
    renderHome()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('of 4 done')).toBeTruthy()
  })

  it('does NOT also render a percentage, which is the same fact in another unit', () => {
    // A percentage and a count are two readings of one number, and offering both makes the reader
    // convert between them to check they agree.
    renderHome()
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('names the next step, so "what do I do now" is answered directly', () => {
    renderHome()
    expect(screen.getByText('Next: Connect a domain')).toBeTruthy()
    expect(screen.getByText('Point a domain you own at this site.')).toBeTruthy()
  })

  it('says everything is set up when nothing remains, rather than showing an empty prompt', () => {
    renderHome(STEPS.map((step) => ({ ...step, completed: true })))
    expect(screen.getByText('Everything is set up.')).toBeTruthy()
    expect(screen.queryByText(/^Next: /)).toBeNull()
  })

  it('lists every step exactly once', () => {
    renderHome()
    for (const step of STEPS) {
      expect(screen.getAllByText(step.title)).toHaveLength(1)
    }
  })

  it('keeps the primary action reachable', () => {
    renderHome()
    expect(screen.getByRole('link', { name: 'Open visual builder' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View site' })).toBeTruthy()
  })

  it('omits the view-site action when nothing is published', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <WebsiteDashboardHome
          siteName="Current Digital"
          builderPath="/admin/builder"
          publicUrl={null}
          steps={STEPS as never}
          areas={AREAS as never}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('link', { name: 'View site' })).toBeNull()
  })
})

describe('progress is not boxed', () => {
  it('renders progress as a labelled section, not inside a card', () => {
    // Progress is the page's own state rather than an item on it, so boxing it made it look like one
    // panel among peers — the opposite of its importance.
    renderHome()
    const heading = screen.getByRole('heading', { level: 2, name: /Getting Current Digital ready/ })
    const section = heading.closest('section')
    expect(section).toBeTruthy()
    // No card chrome on the surface or any ancestor up to the page root.
    let node: HTMLElement | null = section
    while (node) {
      expect(node.className).not.toContain('bg-card')
      node = node.parentElement
    }
  })
})

describe('vertical rhythm', () => {
  it('offers four relationships, not a per-element choice', () => {
    // The defect this replaced was eight different gaps on one surface with nothing deciding which
    // applied where — slightly wrong everywhere without any one value being the mistake.
    expect(Object.keys(RHYTHM).sort()).toEqual([
      'GROUP', 'GROUP_GAP', 'RELATED', 'RELATED_GAP', 'SECTION', 'TIGHT',
    ])
  })

  it('uses steps that are distinguishable from one another', () => {
    // Adjacent steps carry no information: if GROUP were mt-4 and RELATED mt-3, grouping would not
    // read as grouping.
    const scale = [RHYTHM.TIGHT, RHYTHM.RELATED, RHYTHM.GROUP]
      .map((value) => Number(value.replace('mt-', '')))
    for (let index = 1; index < scale.length; index += 1) {
      const previous = scale[index - 1] ?? 0
      const current = scale[index] ?? 0
      expect(current / previous).toBeGreaterThanOrEqual(2)
    }
  })

  it('the dashboard home spends its spacing from the scale', () => {
    const source = Bun.file(
      new URL('../../admin/fuma/dashboards/website/WebsiteDashboardHome.tsx', import.meta.url),
    )
    return source.text().then((text) => {
      // Every rhythm constant the file uses must come from the module, so the scale cannot erode back
      // into per-element choices one edit at a time.
      expect(text).toContain("from '../../ui/rhythm'")
      const arbitrary = text.match(/\bmt-(?!1\.5\b|3\b|6\b|10\b|2\b)[0-9.]+/g) ?? []
      expect(arbitrary).toEqual([])
    })
  })
})

describe('card discipline', () => {
  it('uses at most one card on the home surface', () => {
    // Nine cards made every region look equally important, which is the same as none being important.
    const source = Bun.file(
      new URL('../../admin/fuma/dashboards/website/WebsiteDashboardHome.tsx', import.meta.url),
    )
    return source.text().then((text) => {
      const cards = text.match(/<Card[\s>]/g) ?? []
      expect(cards.length).toBeLessThanOrEqual(1)
    })
  })

  it('keeps the builder tiles as tiles rather than cards inside a card', () => {
    renderHome()
    const heading = screen.getByRole('heading', { level: 2, name: 'Visual builder' })
    expect(heading.closest('section')).toBeTruthy()
  })
})

describe('rhythm holds across every hosted dashboard surface', () => {
  // Every one of these carried four or five ADJACENT margin values (mt-1, mt-2, mt-3, mt-4, mt-5).
  // Adjacent steps are indistinguishable, so the spacing communicated nothing while still being
  // inconsistent between surfaces. The scale collapses them onto steps a reader can actually tell
  // apart.
  const SURFACES = [
    'dashboards/website/WebsiteDashboardHome.tsx',
    'dashboards/website/SiteOverviewCards.tsx',
    'dashboards/PlatformOverview.tsx',
    // Added when task 7 found this file carrying ELEVEN distinct margin values - the task-3
    // sweep covered five surfaces and missed the one the app root actually lands on.
    'dashboards/PlatformDashboard.tsx',
    'dashboards/publication/PublicationDashboardHome.tsx',
    'dashboards/bookings/BookingsDashboard.tsx',
  ]

  // mt-12 belongs here because SECTION IS `mt-10 sm:mt-12` - omitting it meant no surface
  // spending the largest step could ever pass this gate, which I found when task 7 added the
  // first file that uses it.
  const ALLOWED = new Set(['mt-1.5', 'mt-3', 'mt-6', 'mt-10', 'mt-12', 'mt-2'])

  for (const surface of SURFACES) {
    it(`${surface} spends only rhythm steps`, async () => {
      const text = await Bun.file(
        new URL(`../../admin/fuma/${surface}`, import.meta.url),
      ).text()
      // A LOOKBEHIND, not \b: `\b` matches between the hyphen and `mt` in `scroll-mt-24`, so
      // the gate reported scroll-margin as a rogue margin value. A responsive prefix
      // (`sm:mt-12`) must still match, which is why `:` is deliberately absent from the class.
      const used = new Set(text.match(/(?<![-\w.])mt-[0-9.]+/g) ?? [])
      const offenders = [...used].filter((value) => !ALLOWED.has(value))
      expect(offenders).toEqual([])
    })
  }

  it('the scale is small enough to be memorable', () => {
    // A scale nobody can hold in mind is one everybody bypasses.
    expect(Object.keys(RHYTHM).length).toBeLessThanOrEqual(6)
  })
})
