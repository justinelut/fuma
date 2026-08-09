/**
 * Onlook Studio tool dock.
 *
 * Presentation follows Onlook's compact, floating design/pan toolbar while all
 * behavior remains Fuma-owned: the controls write only to the existing editor
 * store and never introduce Onlook project, auth, sandbox, or persistence
 * authority.
 *
 * Onlook is licensed under Apache-2.0. See THIRD_PARTY_NOTICES.md.
 */
import { useEffect } from 'react'
import { HandGrabSolidIcon } from 'pixel-art-icons/icons/hand-grab-solid'
import { PointerSolidIcon } from 'pixel-art-icons/icons/pointer-solid'
import { Button } from '@ui/components/Button'
import { useEditorStore } from '@site/store/store'
import styles from './OnlookStudioToolDock.module.css'

export function OnlookStudioToolDock() {
  const canvasMode = useEditorStore((state) => state.canvasMode)
  const canvasView = useEditorStore((state) => state.canvasView)
  const setCanvasMode = useEditorStore((state) => state.setCanvasMode)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) return

      const key = event.key.toLowerCase()
      if (key !== 'v' && key !== 'h') return
      event.preventDefault()
      setCanvasMode(key === 'v' ? 'select' : 'pan')
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [setCanvasMode])

  if (canvasView !== 'design') return null

  return (
    <div
      className={styles.dock}
      role="toolbar"
      aria-label="Canvas tools"
      data-testid="onlook-studio-tool-dock"
    >
      <Button
        variant="ghost"
        size="md"
        iconOnly
        pressed={canvasMode === 'select'}
        aria-label="Select tool"
        aria-keyshortcuts="V"
        tooltip="Select tool (V)"
        tooltipSide="top"
        onClick={() => setCanvasMode('select')}
      >
        <PointerSolidIcon size={15} aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="md"
        iconOnly
        pressed={canvasMode === 'pan'}
        aria-label="Pan tool"
        aria-keyshortcuts="H"
        tooltip="Pan tool (H or Space)"
        tooltipSide="top"
        onClick={() => setCanvasMode('pan')}
      >
        <HandGrabSolidIcon size={15} aria-hidden="true" />
      </Button>
    </div>
  )
}
