/**
 * The entry point that makes the React canvas mode reachable.
 *
 * Everything below it already existed — the document kind, the surface, the endpoint — and nothing
 * called `setActiveDocument({ kind: 'reactModule' })`, so no author could get there. A feature nothing
 * can reach is indistinguishable from one that was never built.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ModuleListPanel } from '@site/panels/ModuleListPanel/ModuleListPanel'
import type { ModuleStore } from '@core/react-ir/workspace'

afterEach(cleanup)

function storeListing(paths: readonly string[]): ModuleStore {
  return {
    async list() { return paths },
    async get() { return null },
    async put() { /* not exercised */ },
    async delete() { /* not exercised */ },
  }
}

function failingStore(message: string): ModuleStore {
  return {
    async list() { throw new Error(message) },
    async get() { return null },
    async put() {}, async delete() {},
  }
}

describe('it lists the tenant\'s modules', () => {
  it('renders each path and opens the one clicked', async () => {
    const opened: string[] = []
    render(
      <ModuleListPanel
        store={storeListing(['app/page.tsx', 'components/Hero.tsx'])}
        onOpen={(path) => opened.push(path)}
      />,
    )
    await waitFor(() => expect(screen.getByLabelText('React modules')).not.toBeNull())
    await userEvent.click(screen.getByRole('button', { name: /components\/Hero\.tsx/ }))
    expect(opened).toEqual(['components/Hero.tsx'])
  })

  it('sorts the list, so the same site always reads the same way', async () => {
    render(<ModuleListPanel store={storeListing(['z.tsx', 'a.tsx', 'm.tsx'])} onOpen={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('React modules')).not.toBeNull())
    const labels = screen.getAllByRole('button').map((node) => node.textContent ?? '')
    expect(labels[0]).toContain('a.tsx')
    expect(labels[2]).toContain('z.tsx')
  })

  it('marks the open module and does NOT offer it again', async () => {
    const opened: string[] = []
    render(
      <ModuleListPanel
        store={storeListing(['app/page.tsx'])}
        openPath="app/page.tsx"
        onOpen={(path) => opened.push(path)}
      />,
    )
    await waitFor(() => expect(screen.getByLabelText('React modules')).not.toBeNull())
    const button = screen.getByRole('button', { name: /app\/page\.tsx/ })
    // Announced rather than only shaded, because colour alone is not a label.
    expect(button.getAttribute('aria-current')).toBe('true')
    await userEvent.click(button)
    // Re-opening the module already open would discard unsaved edits for no gain.
    expect(opened).toEqual([])
  })
})

describe('a failure is not an empty list', () => {
  it('reports the reason and offers a retry', async () => {
    render(<ModuleListPanel store={failingStore('Could not list modules.')} onOpen={() => {}} />)
    // An empty list reads as "this site has no modules", which is the state a NEW tenant is in — so a
    // failure must be distinguishable from an empty workspace.
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not list modules.'))
    expect(screen.getByRole('button', { name: /Try again/ })).not.toBeNull()
    expect(screen.queryByLabelText('React modules')).toBeNull()
  })

  it('recovers when the retry succeeds', async () => {
    let attempt = 0
    const store: ModuleStore = {
      async list() {
        attempt += 1
        if (attempt === 1) throw new Error('transient')
        return ['app/page.tsx']
      },
      async get() { return null }, async put() {}, async delete() {},
    }
    render(<ModuleListPanel store={store} onOpen={() => {}} />)
    await waitFor(() => expect(screen.getByRole('alert')).not.toBeNull())
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }))
    await waitFor(() => expect(screen.getByLabelText('React modules')).not.toBeNull())
  })
})

describe('the empty and no-match states are different sentences', () => {
  it('says the site has no modules when the list is genuinely empty', async () => {
    render(<ModuleListPanel store={storeListing([])} onOpen={() => {}} />)
    await waitFor(() => expect(screen.getByText(/No modules yet/)).not.toBeNull())
    // A search box for an empty list is a control that cannot do anything.
    expect(screen.queryByLabelText('Search modules')).toBeNull()
  })

  it('offers search only once scanning costs more than typing', async () => {
    render(<ModuleListPanel store={storeListing(['a.tsx', 'b.tsx'])} onOpen={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('React modules')).not.toBeNull())
    // Making somebody type to choose between two files is a regression dressed as a feature.
    expect(screen.queryByLabelText('Search modules')).toBeNull()
  })

  it('reports a search that matches nothing rather than falling back to the full list', async () => {
    const many = Array.from({ length: 10 }, (_, index) => `app/p${index}/page.tsx`)
    render(<ModuleListPanel store={storeListing(many)} onOpen={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('Search modules')).not.toBeNull())
    await userEvent.type(screen.getByLabelText('Search modules'), 'nothing-matches-this')
    // Falling back to everything would look as though the search was ignored.
    await waitFor(() => expect(screen.getByText(/No modules match that search/)).not.toBeNull())
  })

  it('filters on a real substring', async () => {
    const many = ['app/page.tsx', 'components/Hero.tsx', ...Array.from({ length: 8 }, (_, i) => `x${i}.tsx`)]
    render(<ModuleListPanel store={storeListing(many)} onOpen={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('Search modules')).not.toBeNull())
    await userEvent.type(screen.getByLabelText('Search modules'), 'Hero')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /components\/Hero\.tsx/ })).not.toBeNull()
      expect(screen.queryByRole('button', { name: /app\/page\.tsx/ })).toBeNull()
    })
  })
})
