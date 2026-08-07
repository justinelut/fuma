/**
 * The context picker at scale.
 *
 * The defect: every choice was an option in a plain select. Right for three sites, unusable for three
 * hundred — no search, and a list you scroll past the thing you wanted. An agency or staff account with
 * many tenants could not reach a site at all.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  ContextPicker,
  SEARCHABLE_THRESHOLD,
  VISIBLE_MATCH_LIMIT,
  matchChoices,
  type PickerChoice,
} from '@admin/fuma/ContextPicker'

afterEach(cleanup)

function choices(count: number, prefix = 'Site'): PickerChoice[] {
  return Array.from({ length: count }, (_, index) => ({
    value: `id-${index}`,
    label: `${prefix} ${index}`,
    hint: `Workspace ${index % 5}`,
  }))
}

describe('matchChoices', () => {
  it('returns everything for an empty query', () => {
    expect(matchChoices(choices(4), '')).toHaveLength(4)
    expect(matchChoices(choices(4), '   ')).toHaveLength(4)
  })

  it('matches on the label', () => {
    expect(matchChoices(choices(20), 'Site 1').map((c) => c.label))
      .toContain('Site 1')
  })

  it('also matches the HINT, because people remember the client not the site', () => {
    const found = matchChoices(choices(20), 'Workspace 3')
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((c) => c.hint === 'Workspace 3')).toBe(true)
  })

  it('ignores case and surrounding space', () => {
    expect(matchChoices(choices(10), '  sITe 4  ').map((c) => c.label)).toContain('Site 4')
  })

  it('returns nothing rather than everything when there is no match', () => {
    // Falling back to the full list would look like the search was ignored.
    expect(matchChoices(choices(10), 'nonexistent')).toHaveLength(0)
  })
})

describe('behaviour switches on count', () => {
  it('a SHORT list keeps the plain select', () => {
    // Making somebody type to choose between three sites is a regression dressed as a feature.
    render(
      <ContextPicker
        id="p"
        label="Site"
        value="id-0"
        choices={choices(3)}
        onChange={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /Search/ })).toBeNull()
    expect(screen.getByRole('combobox')).toBeTruthy()
  })

  it('a LONG list becomes searchable', () => {
    render(
      <ContextPicker
        id="p"
        label="Site"
        value="id-0"
        choices={choices(SEARCHABLE_THRESHOLD + 1)}
        onChange={() => {}}
      />,
    )
    const trigger = screen.getByRole('combobox')
    // The accessible name states the count, so a screen-reader user knows the list is long before
    // opening it.
    expect(trigger.getAttribute('aria-label')).toContain(`${SEARCHABLE_THRESHOLD + 1} to choose from`)
  })

  it('names the current selection on the trigger', () => {
    render(
      <ContextPicker id="p" label="Site" value="id-4" choices={choices(40)} onChange={() => {}} />,
    )
    expect(screen.getByRole('combobox').textContent).toContain('Site 4')
  })
})

describe('searching a long list', () => {
  it('filters to what was typed', async () => {
    render(
      <ContextPicker id="p" label="Site" value="id-0" choices={choices(40)} onChange={() => {}} />,
    )
    fireEvent.click(screen.getByRole('combobox'))
    const input = await waitFor(() => screen.getByPlaceholderText(/Search 40 sites/))
    fireEvent.change(input, { target: { value: 'Site 37' } })
    await waitFor(() => expect(screen.getByText('Site 37')).toBeTruthy())
    expect(screen.queryByText('Site 12')).toBeNull()
  })

  it('reports how many matches are hidden rather than truncating in silence', async () => {
    // A site that exists but is not listed reads as deleted, and somebody goes looking in the wrong
    // place.
    render(
      <ContextPicker id="p" label="Site" value="id-0" choices={choices(200)} onChange={() => {}} />,
    )
    fireEvent.click(screen.getByRole('combobox'))
    await waitFor(() => {
      expect(screen.getByText(new RegExp(`${200 - VISIBLE_MATCH_LIMIT} more match`))).toBeTruthy()
    })
    expect(screen.getByText(/keep typing/)).toBeTruthy()
  })

  it('says nothing matches when nothing does', async () => {
    render(
      <ContextPicker id="p" label="Site" value="id-0" choices={choices(40)} onChange={() => {}} />,
    )
    fireEvent.click(screen.getByRole('combobox'))
    const input = await waitFor(() => screen.getByPlaceholderText(/Search 40 sites/))
    fireEvent.change(input, { target: { value: 'zzzz' } })
    await waitFor(() => expect(screen.getByText(/Nothing matches/)).toBeTruthy())
  })

  it('shows the hint so identical names are distinguishable', async () => {
    // Two sites called "Marketing" is ordinary once an agency runs one per client, and a list of
    // identical labels is a list you cannot choose from.
    const duplicated: PickerChoice[] = [
      ...choices(10),
      { value: 'a', label: 'Marketing', hint: 'Acacia' },
      { value: 'b', label: 'Marketing', hint: 'Baobab' },
    ]
    render(
      <ContextPicker id="p" label="Site" value="id-0" choices={duplicated} onChange={() => {}} />,
    )
    fireEvent.click(screen.getByRole('combobox'))
    const input = await waitFor(() => screen.getByPlaceholderText(/Search 12 sites/))
    fireEvent.change(input, { target: { value: 'Marketing' } })
    await waitFor(() => expect(screen.getAllByText('Marketing')).toHaveLength(2))
    expect(screen.getByText('Acacia')).toBeTruthy()
    expect(screen.getByText('Baobab')).toBeTruthy()
  })
})

describe('selection', () => {
  it('reports the chosen value', async () => {
    let chosen: string | null = null
    render(
      <ContextPicker
        id="p"
        label="Site"
        value="id-0"
        choices={choices(40)}
        onChange={(value) => { chosen = value }}
      />,
    )
    fireEvent.click(screen.getByRole('combobox'))
    const input = await waitFor(() => screen.getByPlaceholderText(/Search 40 sites/))
    fireEvent.change(input, { target: { value: 'Site 21' } })
    const option = await waitFor(() => screen.getByText('Site 21'))
    fireEvent.click(option)
    await waitFor(() => expect(chosen).toBe('id-21'))
  })

  it('re-selecting the current value does NOT fire a change', async () => {
    // A stray click must not reload the surface the user is already on.
    let calls = 0
    render(
      <ContextPicker
        id="p"
        label="Site"
        value="id-3"
        choices={choices(40)}
        onChange={() => { calls += 1 }}
      />,
    )
    fireEvent.click(screen.getByRole('combobox'))
    const input = await waitFor(() => screen.getByPlaceholderText(/Search 40 sites/))
    fireEvent.change(input, { target: { value: 'Site 3' } })
    // Scoped to the option: 'Site 3' is a substring of 'Site 30'..'Site 39', AND the trigger itself
    // shows the current selection, so an unscoped exact match still finds two nodes.
    const option = await waitFor(() => {
      const found = screen
        .getAllByRole('option')
        .find((element) => element.textContent?.startsWith('Site 3') && !element.textContent?.startsWith('Site 3' + '0'))
      if (!found) throw new Error('option not rendered yet')
      return found
    })
    fireEvent.click(option)
    expect(calls).toBe(0)
  })
})
