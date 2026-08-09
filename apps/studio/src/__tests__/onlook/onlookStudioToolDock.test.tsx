import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { OnlookStudioToolDock } from '@admin/onlook/OnlookStudioToolDock'
import { useEditorStore } from '@site/store/store'

describe('Onlook Studio tool dock', () => {
  beforeEach(() => {
    useEditorStore.setState({ canvasMode: 'select', canvasView: 'design' })
  })

  afterEach(() => cleanup())

  it('drives the existing Fuma canvas mode store', () => {
    render(<OnlookStudioToolDock />)

    const select = screen.getByRole('button', { name: 'Select tool' })
    const pan = screen.getByRole('button', { name: 'Pan tool' })
    expect(select.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(pan)
    expect(useEditorStore.getState().canvasMode).toBe('pan')
    expect(pan.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(select)
    expect(useEditorStore.getState().canvasMode).toBe('select')
  })

  it('stays out of the single-frame live view', () => {
    useEditorStore.setState({ canvasView: 'live' })
    render(<OnlookStudioToolDock />)
    expect(screen.queryByTestId('onlook-studio-tool-dock')).toBeNull()
  })
})
