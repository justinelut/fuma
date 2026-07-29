'use client'

import { useState, type ReactNode } from 'react'

export function RestrictedClientBoundary(props: Readonly<{
  component: string
  initialOpen: boolean
  interactive: boolean
  children: ReactNode
}>) {
  const [open, setOpen] = useState(props.initialOpen)
  if (!props.interactive) {
    return <div data-fuma-restricted-client={props.component} data-fuma-client-mode="isolated-static">{props.children}</div>
  }
  return (
    <div data-fuma-restricted-client={props.component} data-fuma-client-mode="isolated-reveal" data-open={open ? 'true' : 'false'}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="fuma-client-trigger">
        {open ? 'Hide' : 'Show'}
      </button>
      <div hidden={!open}>{props.children}</div>
    </div>
  )
}
