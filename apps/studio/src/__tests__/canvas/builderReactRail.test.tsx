/** Regression coverage for the React engine's Explorer-centered left rail. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { PanelRail } from '@site/sidebars/PanelRail/PanelRail'
import { useEditorStore } from '@site/store/store'

describe('the visual builder preserves Explorer as the navigation destination', () => {
  beforeEach(() => {
    useEditorStore.setState({
      explorerPanelOpen: true,
      selectorsPanelOpen: false,
      frameworkPanelOpen: false,
      dependenciesPanelOpen: false,
      modulesPanelOpen: false,
      blocksPanelOpen: false,
      isAgentOpen: false,
      activePluginPanelId: null,
      activeDocument: null,
    })
  })
  afterEach(cleanup)

  it('does not add duplicate Components or Blocks rail destinations', () => {
    render(<PanelRail editable canUseAiChat={false} />)
    expect(screen.getByRole('button', { name: 'Close Explorer panel' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Components panel/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Blocks panel/ })).toBeNull()
  })

  it('shows Explorer and allowed AI as the React-safe tools', () => {
    useEditorStore.setState({
      activeDocument: { kind: 'reactModule', path: 'app/page.tsx' },
      explorerPanelOpen: true,
    })
    render(<PanelRail editable canUseAiChat />)

    expect(screen.getByRole('button', { name: 'Close Explorer panel' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open AI assistant panel' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Components panel/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Blocks panel/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Framework panel/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Selectors panel/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Dependencies panel/ })).toBeNull()
  })


  it('keeps Explorer available as a read-only React navigation surface', () => {
    useEditorStore.setState({ activeDocument: { kind: 'reactModule', path: 'app/page.tsx' } })
    render(<PanelRail editable={false} canUseAiChat={false} />)
    expect(screen.getByRole('button', { name: 'Close Explorer panel' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Components panel|Blocks panel/ })).toBeNull()
  })
  it('opens Explorer through the same mutually-exclusive panel state as the other tools', async () => {
    useEditorStore.setState({
      explorerPanelOpen: false,
      frameworkPanelOpen: true,
    })
    render(<PanelRail editable canUseAiChat={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open Explorer panel' }))
    const state = useEditorStore.getState()
    expect(state.explorerPanelOpen).toBe(true)
    expect(state.frameworkPanelOpen).toBe(false)
    expect(state.modulesPanelOpen).toBe(false)
    expect(state.blocksPanelOpen).toBe(false)
  })
})
