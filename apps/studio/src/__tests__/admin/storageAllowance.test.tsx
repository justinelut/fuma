/**
 * Storage and bandwidth allowance surface.
 *
 * The central rule under test: AN UNKNOWN LIMIT IS NOT UNLIMITED. Rendering a missing allowance as
 * unlimited, or as a bar at 0%, is a promise the product has not made — and the one somebody discovers
 * is false at the moment their upload is refused.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import {
  InstaticStorageCard,
  formatBytes,
} from '@admin/fuma/dashboards/website/InstaticStorageCard'

afterEach(cleanup)

const GB = 1024 * 1024 * 1024

describe('formatBytes', () => {
  it('scales to a readable unit', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(5 * GB)).toBe('5.0 GB')
    // A decimal stops carrying information once the number is large enough to read on its own.
    expect(formatBytes(10 * GB)).toBe('10 GB')
  })

  it('renders an unknown value as an em dash rather than zero', () => {
    // Zero is a measurement. Unknown is not, and showing 0 B would be a false one.
    expect(formatBytes(null)).toBe('—')
  })
})

describe('bandwidth', () => {
  it('shows bandwidth against its allowance and names the period', () => {
    // A byte count with no period attached is not a measurement anybody can act on.
    render(
      <InstaticStorageCard
        builderPath="/admin/builder"
        bandwidth={{ usedBytes: 2 * GB, allowanceBytes: 10 * GB, periodLabel: 'This month' }}
      />,
    )
    const bandwidth = screen.getByText('Bandwidth').parentElement
    expect(bandwidth).toBeTruthy()
    // The value and its allowance are separate elements, so the assertion reads the combined text.
    expect(bandwidth?.textContent).toContain('2.0 GB')
    // formatBytes drops the decimal at 10 and above, so this reads '10 GB' by design.
    expect(bandwidth?.textContent).toContain('of 10 GB')
    expect(bandwidth?.textContent).toContain('This month')
    expect(bandwidth?.textContent).toContain('20% used')
  })

  it('says bandwidth is not measured rather than showing a zero', () => {
    render(<InstaticStorageCard builderPath="/admin/builder" />)
    expect(screen.getByText('Not measured for this site yet')).toBeTruthy()
  })

  it('warns BEFORE the limit, not at it', () => {
    // At 100% the upload has already failed, so a warning there is a postmortem.
    render(
      <InstaticStorageCard
        builderPath="/admin/builder"
        bandwidth={{ usedBytes: 9 * GB, allowanceBytes: 10 * GB, periodLabel: 'This month' }}
      />,
    )
    expect(screen.getByText(/close to the limit/)).toBeTruthy()
  })

  it('does not warn well inside the allowance', () => {
    render(
      <InstaticStorageCard
        builderPath="/admin/builder"
        bandwidth={{ usedBytes: 1 * GB, allowanceBytes: 10 * GB, periodLabel: 'This month' }}
      />,
    )
    expect(screen.queryByText(/close to the limit/)).toBeNull()
  })
})

describe('an unknown allowance is never presented as unlimited', () => {
  it('states that the allowance is not published rather than leaving it blank', () => {
    render(
      <InstaticStorageCard
        builderPath="/admin/builder"
        bandwidth={{ usedBytes: 2 * GB, allowanceBytes: null, periodLabel: 'This month' }}
      />,
    )
    // A blank space where an allowance belongs reads as unlimited, and that assumption is the one that
    // turns into a surprise.
    expect(screen.getAllByText('Included allowance not published yet').length).toBeGreaterThan(0)
  })

  it('never renders the word unlimited', () => {
    render(
      <InstaticStorageCard
        builderPath="/admin/builder"
        bandwidth={{ usedBytes: 2 * GB, allowanceBytes: null, periodLabel: 'This month' }}
      />,
    )
    expect(screen.queryByText(/unlimited/i)).toBeNull()
  })

  it('draws no progress bar when the total is unknown', async () => {
    // A proportion of an unknown total is not a quantity, and a bar would read as "plenty left".
    const { container } = render(
      <InstaticStorageCard
        builderPath="/admin/builder"
        bandwidth={{ usedBytes: 2 * GB, allowanceBytes: null, periodLabel: 'This month' }}
      />,
    )
    expect(container.querySelectorAll('[style*="width"]')).toHaveLength(0)
  })

  it('still shows what is being used, which is useful without a limit', () => {
    render(
      <InstaticStorageCard
        builderPath="/admin/builder"
        bandwidth={{ usedBytes: 2 * GB, allowanceBytes: null, periodLabel: 'This month' }}
      />,
    )
    // Scoped to the bandwidth meter: storage also reads "used" when its own limit is unknown.
    const bandwidth = screen.getByText('Bandwidth').parentElement
    expect(bandwidth?.textContent).toContain('2.0 GB')
    expect(bandwidth?.textContent).toContain('used')
  })
})

describe('upgrade path', () => {
  it('offers plans only when there is somewhere to go', () => {
    render(<InstaticStorageCard builderPath="/admin/builder" plansPath="/admin/billing" />)
    expect(screen.getByRole('link', { name: 'See plans' })).toBeTruthy()
  })

  it('omits the plans link when none is supplied', () => {
    render(<InstaticStorageCard builderPath="/admin/builder" />)
    expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull()
  })
})

describe('the removed palette cannot come back', () => {
  it('no hosted admin surface references a token that no longer exists', async () => {
    // Every colour in this card used to be `dash-ink` / `dash-ink-muted` / `dash-rail`, and those
    // tokens were removed when the hosted surfaces moved to the shadcn semantic set. AN UNKNOWN
    // TAILWIND CLASS COMPILES TO NOTHING, SILENTLY — so the text had no colour and the usage bar had no
    // fill, which reads as a rendering bug rather than a missing token.
    const { Glob } = await import('bun')
    const glob = new Glob('**/*.tsx')
    const root = new URL('../../admin/fuma/', import.meta.url).pathname
    const offenders: string[] = []
    for await (const file of glob.scan({ cwd: root })) {
      const text = await Bun.file(`${root}${file}`).text()
      // Class positions only — the explanatory comment in this card names the tokens deliberately.
      const uses = text.match(/(?:^|["'\s])(?:bg|text|border|ring|fill)-dash-[a-z-]+/g) ?? []
      if (uses.length > 0) offenders.push(`${file}: ${uses.join(' ')}`)
    }
    expect(offenders).toEqual([])
  })
})
