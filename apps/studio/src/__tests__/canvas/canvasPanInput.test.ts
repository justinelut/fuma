import { describe, expect, it } from 'bun:test'
import {
  isCanvasPointerPanActive,
  shouldStartCanvasPointerPan,
} from '@site/canvas/canvasPanInput'

describe('canvas pan input', () => {
  it('keeps select mode clicks available for layer selection', () => {
    expect(shouldStartCanvasPointerPan(
      { button: 0 },
      { spaceHeld: false, panMode: false },
    )).toBe(false)
    expect(isCanvasPointerPanActive(
      { buttons: 1 },
      { spaceHeld: false, panMode: false },
    )).toBe(false)
  })

  it('uses primary-button dragging in persistent hand-tool mode', () => {
    expect(shouldStartCanvasPointerPan(
      { button: 0 },
      { spaceHeld: false, panMode: true },
    )).toBe(true)
    expect(isCanvasPointerPanActive(
      { buttons: 1 },
      { spaceHeld: false, panMode: true },
    )).toBe(true)
  })

  it('preserves space-drag and middle-button panning in either mode', () => {
    expect(shouldStartCanvasPointerPan(
      { button: 0 },
      { spaceHeld: true, panMode: false },
    )).toBe(true)
    expect(isCanvasPointerPanActive(
      { buttons: 4 },
      { spaceHeld: false, panMode: false },
    )).toBe(true)
  })
})
