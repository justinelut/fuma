'use client'

import { LazyMotion, domAnimation, useReducedMotion } from 'motion/react'
import { div as MotionDiv } from 'motion/react-m'
import type { ReactNode } from 'react'

export function MotionProductPanel({
  content,
  id,
  labelId,
  panelClassName,
  reducedByMedia,
}: Readonly<{
  content: ReactNode
  id: string
  labelId: string
  panelClassName: string
  reducedByMedia: boolean
}>) {
  const reduced = (useReducedMotion() ?? false) || reducedByMedia

  return <LazyMotion features={domAnimation}>
    <MotionDiv
      animate={{ opacity: 1, y: 0 }}
      aria-labelledby={labelId}
      className={panelClassName}
      data-fuma-motion-panel
      id={id}
      initial={reduced ? false : { opacity: 0.86, y: 6 }}
      key={id}
      layout={!reduced}
      role="tabpanel"
      transition={reduced ? { duration: 0 } : { duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      {content}
    </MotionDiv>
  </LazyMotion>
}
