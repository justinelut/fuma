import { beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { useEditorStore } from '@site/store/store'
import { CanvasRoot } from '@site/canvas/CanvasRoot'
import { waitForCanvasNodeInFrame } from './iframeCanvasQuery'
import '@modules/base'

function renderCanvas() {
  return render(<DndContext><CanvasRoot /></DndContext>)
}

beforeEach(() => {
  cleanup()
  useEditorStore.setState({
    site: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeDocument: null,
    activePageId: null,
    activeBreakpointId: 'desktop',
    canvasView: 'design',
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 360 },
    propertiesPanelMode: 'docked',
    hasUnsavedChanges: false,
  })
})

describe('canvas form controls', () => {
  it('prevents native form-control activation while preserving canvas node selection', async () => {
    const site = useEditorStore.getState().createSite('Form Controls')
    const page = site.pages[0]!
    const formId = useEditorStore.getState().insertNode('base.form', {
      mode: 'cms',
      formId: 'contact',
      targetTableId: '',
    }, page.rootNodeId)
    const inputId = useEditorStore.getState().insertNode('base.input', {
      inputType: 'email',
      name: 'email',
      id: 'email',
      autocomplete: 'email',
    }, formId)
    const selectId = useEditorStore.getState().insertNode('base.select', {
      name: 'plan',
      id: 'plan',
    }, formId)
    const submitId = useEditorStore.getState().insertNode('base.submit', {
      label: 'Send',
      formId: '',
    }, formId)

    renderCanvas()

    const input = await waitForCanvasNodeInFrame<HTMLInputElement>('desktop', inputId)

    let inputMouseDown = true
    await act(async () => {
      inputMouseDown = fireEvent.mouseDown(input)
    })
    expect(inputMouseDown).toBe(false)
    expect(useEditorStore.getState().selectedNodeId).toBe(inputId)

    const select = await waitForCanvasNodeInFrame<HTMLSelectElement>('desktop', selectId)
    const pointerDownEvent = new select.ownerDocument.defaultView!.Event('pointerdown', {
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      select.dispatchEvent(pointerDownEvent)
    })
    expect(pointerDownEvent.defaultPrevented).toBe(true)
    expect(useEditorStore.getState().selectedNodeId).toBe(selectId)

    const currentSelect = await waitForCanvasNodeInFrame<HTMLSelectElement>('desktop', selectId)
    await act(async () => {
      fireEvent.click(currentSelect)
    })
    expect(useEditorStore.getState().selectedNodeId).toBe(selectId)

    const currentInput = await waitForCanvasNodeInFrame<HTMLInputElement>('desktop', inputId)
    await act(async () => {
      fireEvent.click(currentInput)
    })
    expect(useEditorStore.getState().selectedNodeId).toBe(inputId)

    const submit = await waitForCanvasNodeInFrame<HTMLButtonElement>('desktop', submitId)
    const form = submit.closest('form')
    expect(form).toBeTruthy()
    let submitted = false
    form!.addEventListener('submit', (event) => {
      submitted = true
      event.preventDefault()
    })
    let submitMouseDown = true
    await act(async () => {
      submitMouseDown = fireEvent.mouseDown(submit)
      fireEvent.click(submit)
    })
    expect(submitMouseDown).toBe(false)
    expect(submitted).toBe(false)
    expect(useEditorStore.getState().selectedNodeId).toBe(submitId)
  })
})
