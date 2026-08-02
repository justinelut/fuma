'use client'

import type { KeyboardEvent, ReactNode } from 'react'
import { lazy, Suspense, useEffect, useState } from 'react'

const MotionProductPanel = lazy(() => import('./motion-product-panel').then((module) => ({
  default: module.MotionProductPanel,
})))

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'

export type MotionCanvasScene = Readonly<{
  id: string
  label: string
  content: ReactNode
}>

export type MotionCanvasStyles = Readonly<{
  canvas: string
  tabs: string
  tab: string
  indicator: string
  panel: string
}>

export function MotionProductCanvasIsland({
  scenes,
  styles,
}: Readonly<{
  scenes: readonly MotionCanvasScene[]
  styles: MotionCanvasStyles
}>) {
  const [{ active, mediaReduced, motionRequested }, setCanvasState] = useState({
    active: 0,
    mediaReduced: false,
    motionRequested: false,
  })

  useEffect(() => {
    const media = window.matchMedia(reducedMotionQuery)
    const synchronize = () => setCanvasState((current) => (
      current.mediaReduced === media.matches ? current : { ...current, mediaReduced: media.matches }
    ))
    media.addEventListener('change', synchronize)
    return () => media.removeEventListener('change', synchronize)
  }, [])

  const scene = scenes[active]!

  function activateScene(index: number) {
    setCanvasState({
      active: index,
      mediaReduced: window.matchMedia(reducedMotionQuery).matches,
      motionRequested: true,
    })
  }

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % scenes.length
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + scenes.length) % scenes.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = scenes.length - 1
    if (next === undefined) return
    event.preventDefault()
    activateScene(next)
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]
      ?.focus()
  }

  const panelId = `pc-panel-${scene.id}`
  const labelId = `pc-tab-${scene.id}`
  const staticPanel = <div
    aria-labelledby={labelId}
    className={styles.panel}
    id={panelId}
    role="tabpanel"
  >
    {scene.content}
  </div>

  return <div className={styles.canvas} data-fuma-motion-canvas>
    <div aria-label="Product stages" className={styles.tabs} role="tablist">
      {scenes.map((item, index) => <button
        aria-controls={`pc-panel-${item.id}`}
        aria-selected={active === index}
        className={styles.tab}
        id={`pc-tab-${item.id}`}
        key={item.id}
        onClick={() => activateScene(index)}
        onKeyDown={(event) => moveTab(event, index)}
        role="tab"
        tabIndex={active === index ? 0 : -1}
        type="button"
      >
        {active === index && <span aria-hidden="true" className={styles.indicator} />}
        {item.label}
      </button>)}
    </div>
    {motionRequested
      ? <Suspense fallback={staticPanel}>
        <MotionProductPanel
          content={scene.content}
          id={panelId}
          labelId={labelId}
          panelClassName={styles.panel}
          reducedByMedia={mediaReduced}
        />
      </Suspense>
      : staticPanel}
  </div>
}
