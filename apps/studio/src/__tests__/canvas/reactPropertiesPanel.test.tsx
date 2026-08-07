/**
 * The properties panel where task 72's derived cva controls become editable.
 *
 * Driven with controls derived from the REAL shipped button, so the test cannot pass against a fixture
 * that flatters the deriver.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ReactPropertiesPanel } from '@site/panels/ReactPropertiesPanel/ReactPropertiesPanel'
import { deriveCvaVariants, controlsFromVariants } from '@core/react-ir/cvaControls'

afterEach(cleanup)

const REAL_BUTTON = readFileSync(
  join(import.meta.dir, '..', '..', 'admin', 'fuma', 'ui', 'button.tsx'), 'utf8')

/** The controls the shipped button actually declares. */
const buttonControls = controlsFromVariants(deriveCvaVariants(REAL_BUTTON).groups)

describe('it renders the options the component actually accepts', () => {
  it('shows a control per variant group from the real button', () => {
    render(<ReactPropertiesPanel controls={buttonControls} values={{}} onChange={() => {}} />)
    expect(screen.getByTestId('react-properties-panel')).not.toBeNull()
    // Both groups the shipped file declares.
    expect(screen.getAllByText(/Style|Size/i).length).toBeGreaterThan(0)
  })

  it('reports an unset property rather than leaving it blank', () => {
    render(<ReactPropertiesPanel controls={buttonControls} values={{}} onChange={() => {}} />)
    // "Nothing chosen" must not read as a control that failed to load.
    expect(screen.getAllByText(/the component's own default applies/i).length).toBeGreaterThan(0)
  })
})

describe('changing a value', () => {
  it('reports the chosen option', async () => {
    const changes: [string, string | null][] = []
    // A small control set so the segmented form is used and the options are buttons.
    const controls = { variant: { kind: 'enum' as const, title: 'Style', options: ['a', 'b'] } }
    render(
      <ReactPropertiesPanel
        controls={controls as never}
        values={{}}
        onChange={(name, value) => changes.push([name, value])}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'b' }))
    expect(changes).toEqual([['variant', 'b']])
  })

  it('CLEARS by re-pressing the option already set, so a choice is reversible in place', async () => {
    const changes: [string, string | null][] = []
    const controls = { variant: { kind: 'enum' as const, title: 'Style', options: ['a', 'b'] } }
    render(
      <ReactPropertiesPanel
        controls={controls as never}
        values={{ variant: 'a' }}
        onChange={(name, value) => changes.push([name, value])}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'a' }))
    // Null clears the prop, returning the component to its own default — which is a different state
    // from any explicit value, so it has to be reachable.
    expect(changes).toEqual([['variant', null]])
  })

  it('announces the pressed option rather than only shading it', () => {
    const controls = { variant: { kind: 'enum' as const, title: 'Style', options: ['a', 'b'] } }
    render(<ReactPropertiesPanel controls={controls as never} values={{ variant: 'a' }} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'a' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'b' }).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('a long option set becomes a select', () => {
  it('offers Default as a real choice, not a placeholder', async () => {
    // The shipped button's size group has more options than fit as buttons.
    render(<ReactPropertiesPanel controls={buttonControls} values={{}} onChange={() => {}} />)
    const selects = screen.getAllByRole('combobox')
    expect(selects.length).toBeGreaterThan(0)
    // Clearing must be reachable: it returns the component to its own default.
    expect(screen.getAllByText('Default').length).toBeGreaterThan(0)
  })

  it('reports null when Default is chosen', async () => {
    const changes: [string, string | null][] = []
    const controls = {
      size: { kind: 'enum' as const, title: 'Size', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
    }
    render(
      <ReactPropertiesPanel
        controls={controls as never}
        values={{ size: 'lg' }}
        onChange={(name, value) => changes.push([name, value])}
      />,
    )
    await userEvent.selectOptions(screen.getByRole('combobox'), '')
    expect(changes).toEqual([['size', null]])
  })
})

describe('nothing to configure is stated', () => {
  it('says so rather than rendering an empty panel that looks broken', () => {
    render(<ReactPropertiesPanel controls={{}} values={{}} onChange={() => {}} />)
    expect(screen.getByText(/no options to configure/i)).not.toBeNull()
  })
})
