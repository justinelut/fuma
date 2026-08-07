/**
 * The hosted shell's mobile navigation.
 *
 * Covers two defects that were the same defect: the header used `flex-wrap` with the navigation
 * forced to a full-width third row, so below `lg` a STICKY header grew to three rows and covered the
 * greeting immediately beneath it. Moving the navigation into a left sheet bounds the header to one
 * row at every width, which is what makes `sticky` safe.
 */
import type React from 'react'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from '@admin/lib/routing'
import { WebsiteDashboardShell } from '@admin/fuma/dashboards/website/WebsiteDashboardShell'
import { PublicationDashboardShell } from '@admin/fuma/dashboards/publication/PublicationDashboardShell'

const HOME = '/admin/o/organization-a/w/workspace-a/s/site-a'

function navigation() {
  return [
    { id: 'home', label: 'Overview', path: HOME },
    { id: 'analytics', label: 'Analytics', path: `${HOME}/analytics` },
    { id: 'domains', label: 'Domains', path: `${HOME}/settings/domains` },
    { id: 'settings', label: 'Settings', path: `${HOME}/settings` },
  ]
}

function renderShell(
  currentPath = HOME,
  extra: Readonly<{ organizationOwnerLabel?: string, contextSwitchers?: React.ReactNode }> = {},
) {
  return render(
    <MemoryRouter initialEntries={[currentPath]}>
      <WebsiteDashboardShell
        siteName="Current Digital"
        organizationName="Acacia"
        workspaceName="Studio"
        actorLabel="Justine Quartz"
        navigation={navigation() as never}
        currentPath={currentPath}
        homePath={HOME}
        accountPath="/admin/account"
        settingsPath={`${HOME}/settings`}
        counts={{ sites: 2, workspaces: 1, organizations: 1 }}
        setup={{ completed: 1, total: 3 }}
        {...extra}
      >
        <p>Page body</p>
      </WebsiteDashboardShell>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('mobile navigation trigger', () => {
  it('offers a navigation trigger that is hidden from large viewports', () => {
    renderShell()
    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    // Hidden at `lg` because the pill navigation is visible there; two ways into the same list on
    // one screen is a second thing to keep in sync for no benefit.
    expect(trigger.className).toContain('lg:hidden')
  })

  it('does not render the sheet navigation until it is opened', () => {
    renderShell()
    expect(screen.queryByRole('navigation', { name: 'Website sections menu' })).toBeNull()
  })

  it('opens a panel from the LEFT', async () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Website sections menu' })).toBeTruthy()
    })
    // A panel flying in from the side opposite its trigger reads as unrelated to it.
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('data-side') ?? dialog.className).toContain('left')
  })

  it('lists every section in the sheet', async () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    const nav = await waitFor(() =>
      screen.getByRole('navigation', { name: 'Website sections menu' }))
    for (const label of ['Overview', 'Analytics', 'Domains', 'Settings']) {
      expect(nav.textContent).toContain(label)
    }
  })

  it('names the site and its context, so the panel says which site it navigates', async () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('Current Digital'))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Acacia')
    expect(dialog.textContent).toContain('Studio')
  })

  it('marks exactly one entry current in the sheet, matching the pill navigation', async () => {
    // `/settings/domains` nests under `/settings`, so prefix matching alone lit both.
    renderShell(`${HOME}/settings/domains`)
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    const nav = await waitFor(() =>
      screen.getByRole('navigation', { name: 'Website sections menu' }))
    const current = Array.from(nav.querySelectorAll('[aria-current="page"]'))
    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toBe('Domains')
  })
})

describe('the sticky header cannot cover the greeting', () => {
  it('does not wrap, so its height is bounded at every width', () => {
    renderShell()
    const header = document.querySelector('header')
    expect(header).toBeTruthy()
    // The defect: `flex-wrap` plus a full-width navigation row made a sticky header three rows tall
    // on a narrow viewport, covering the greeting beneath it.
    expect(header?.className).not.toContain('flex-wrap')
    expect(header?.className).toContain('sticky')
  })

  it('keeps the pill navigation out of the flow below lg rather than wrapping it', () => {
    renderShell()
    const pill = screen.getByRole('navigation', { name: 'Website sections' })
    expect(pill.className).toContain('hidden')
    expect(pill.className).toContain('lg:block')
    // The old markup forced it onto its own row instead.
    expect(pill.className).not.toContain('w-full')
  })

  it('is translucent, because the page behind it carries a gradient wash', () => {
    renderShell()
    const header = document.querySelector('header')
    // An opaque strip over a gradient shows as a seam at the header's edge.
    expect(header?.className).toContain('backdrop-blur-sm')
    expect(header?.className).not.toMatch(/bg-background(?!\/)/)
  })

  it('still renders the greeting and the page body', () => {
    renderShell()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Justine')
    expect(screen.getByText('Page body')).toBeTruthy()
  })
})

describe('context switching from the header', () => {
  it('renders a plain label when no switchers are supplied', () => {
    renderShell()
    expect(screen.queryByRole('button', { name: /Switch organization/ })).toBeNull()
  })

  it('turns the context label into the switcher control', async () => {
    // The pill that NAMES the current context is what opens the control that changes it. Switching
    // previously existed only in a different shell, so a site opened from the website dashboard could
    // not be changed without navigating back out to find one.
    renderShell(HOME, { contextSwitchers: <p>Switcher body</p> })
    const trigger = screen.getByRole('button', { name: /Current context: Current Digital/ })
    expect(trigger.textContent).toContain('Current Digital')
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.getByText('Switcher body')).toBeTruthy())
  })
})

describe('organization owner in the greeting', () => {
  it('names the owner when it is somebody other than the viewer', () => {
    // Staff and agency users work inside organizations they do not own, and a dashboard that only
    // greets you by your own name gives no indication of whose site you are about to change.
    renderShell(HOME, { organizationOwnerLabel: 'Ada Owner' })
    // Scoped to the greeting line: the organization name also appears in the metric strip below, so
    // an unscoped query matches twice.
    const line = screen.getByText(/owned by/)
    expect(line.textContent).toContain('Ada Owner')
    expect(line.textContent).toContain('Acacia')
    expect(line.textContent).toContain('Working in')
  })

  it('says nothing when the viewer IS the owner, rather than telling them their own name', () => {
    renderShell(HOME, { organizationOwnerLabel: 'Justine Quartz' })
    expect(screen.queryByText(/owned by/)).toBeNull()
  })

  it('says nothing when the owner is unknown, rather than asserting one', () => {
    // An organization can legitimately have no owner membership row — mid-transfer, or an owner whose
    // account was removed.
    renderShell()
    expect(screen.queryByText(/owned by/)).toBeNull()
  })
})

function renderPublication(currentPath = HOME) {
  const nav = [
    { id: 'nav.home', label: 'Dashboard', path: HOME },
    { id: 'nav.posts', label: 'Posts', path: `${HOME}/posts` },
    { id: 'nav.members', label: 'Members', path: `${HOME}/members` },
    { id: 'nav.settings', label: 'Settings', path: `${HOME}/settings` },
    { id: 'nav.domains', label: 'Domains', path: `${HOME}/settings/domains` },
  ]
  return render(
    <MemoryRouter initialEntries={[currentPath]}>
      <PublicationDashboardShell
        publicationName="The Weekly"
        actorLabel="Justine Quartz"
        navigation={nav as never}
        currentPath={currentPath}
        homePath={HOME}
        accountPath="/admin/account"
        builderPath={`${HOME}/builder`}
        publicUrl={null}
        postChildren={[]}
        title="Dashboard"
        range="Last 30 days"
      >
        <p>Publication body</p>
      </PublicationDashboardShell>
    </MemoryRouter>,
  )
}

describe('publication profile: navigation below lg', () => {
  it('offers a sheet trigger instead of a horizontally scrolling strip', () => {
    renderPublication()
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy()
    // The strip put sections past the third off-screen with no indication they existed, and competed
    // with the page's own horizontal scrolling.
    expect(screen.queryByRole('navigation', { name: 'Publication sections' })).toBeNull()
  })

  it('opens from the LEFT, the same edge the sidebar occupies at wider widths', async () => {
    renderPublication()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Publication sections menu' })).toBeTruthy()
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('data-side') ?? dialog.className).toContain('left')
  })

  it('lists every section', async () => {
    renderPublication()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    const nav = await waitFor(() =>
      screen.getByRole('navigation', { name: 'Publication sections menu' }))
    for (const label of ['Dashboard', 'Posts', 'Members', 'Settings', 'Domains']) {
      expect(nav.textContent).toContain(label)
    }
  })

  it('highlights the SAME entry it announces as current', async () => {
    // The strip styled by `currentPath === entry.path` while announcing aria-current from the resolved
    // most-specific match, so on a nested route the highlighted item and the announced item differed.
    renderPublication(`${HOME}/settings/domains`)
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    const nav = await waitFor(() =>
      screen.getByRole('navigation', { name: 'Publication sections menu' }))
    const current = Array.from(nav.querySelectorAll('[aria-current="page"]'))
    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toContain('Domains')
    // And the announced entry is the one carrying the highlight class.
    expect(current[0]?.className).toContain('bg-accent')
  })

  it('names the publication in the narrow bar, not just its first letter', () => {
    renderPublication()
    expect(screen.getAllByText('The Weekly').length).toBeGreaterThan(1)
  })
})
