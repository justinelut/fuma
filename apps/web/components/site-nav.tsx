'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'

type Entry = Readonly<{ href: Route; title: string; body: string }>
type Group = Readonly<{ label: string; entries: readonly Entry[] }>
type Feature = Readonly<{ label: string; title: string; body: string; cta: string; href: Route }>

/**
 * Information architecture for the public site. Every href is an existing public route — the
 * menu never advertises a surface the product cannot serve.
 */
const platform: readonly Group[] = [
  {
    label: 'Build',
    entries: [
      { href: '/website', title: 'Website', body: 'Portfolios, services, campaigns and content-rich sites.' },
      { href: '/publication', title: 'Publication', body: 'Blogs, magazines, newsletters and editorial teams.' },
      { href: '/features', title: 'Features', body: 'The full build, manage and publish workflow.' },
    ],
  },
  {
    label: 'Extend',
    entries: [
      { href: '/templates', title: 'Templates', body: 'Reviewed starting structures with exact releases.' },
      { href: '/components', title: 'Component packs', body: 'Reusable interface pieces with review evidence.' },
      { href: '/plugins', title: 'Plugins', body: 'Sandboxed backend extensions and permissions.' },
    ],
  },
]

const solutions: readonly Group[] = [
  {
    label: 'By outcome',
    entries: [
      { href: '/solutions', title: 'All outcomes', body: 'Compare paths without forking the product.' },
      { href: '/pricing', title: 'Pricing', body: 'Current KES plans and what each one includes.' },
    ],
  },
  {
    label: 'By proof',
    entries: [
      { href: '/showcase', title: 'Showcase', body: 'Consent-backed public work and previews.' },
      { href: '/experts', title: 'Experts', body: 'Opt-in people and studios, mediated inquiry.' },
    ],
  },
]

const resources: readonly Group[] = [
  {
    label: 'Learn',
    entries: [
      { href: '/docs', title: 'Docs', body: 'Reference for every product surface.' },
      { href: '/guides', title: 'Guides', body: 'Practical walkthroughs, start to publish.' },
    ],
  },
  {
    label: 'Follow',
    entries: [
      { href: '/blog', title: 'Blog', body: 'Notes on the craft and the roadmap.' },
      { href: '/changelog', title: 'Changelog', body: 'What shipped, when, and what changed.' },
    ],
  },
]

const trust: readonly Group[] = [
  {
    label: 'Operate',
    entries: [
      { href: '/trust', title: 'Trust centre', body: 'Privacy, security, service status and policies.' },
      { href: '/status', title: 'Status', body: 'Current service state from the real source.' },
    ],
  },
  {
    label: 'Assure',
    entries: [
      { href: '/security', title: 'Security', body: 'Reporting, hardening and disclosure.' },
      { href: '/legal', title: 'Legal', body: 'Policies with versioned approval receipts.' },
    ],
  },
]

const features: Record<string, Feature> = {
  Platform: { label: 'Start here', title: 'The whole workflow', body: 'Walk every surface from first block to published page.', cta: 'See the platform', href: '/features' },
  Solutions: { label: 'Not sure yet', title: 'Choose by outcome', body: 'Find the work that looks like yours, then pick a starting surface.', cta: 'Compare outcomes', href: '/solutions' },
  Resources: { label: 'New here', title: 'Getting started', body: 'Install, create your first page and publish it.', cta: 'Read the docs', href: '/docs' },
  Trust: { label: 'Due diligence', title: 'Trust centre', body: 'Privacy, security, current policies and service status.', cta: 'Open the trust centre', href: '/trust' },
}

const menus: readonly (readonly [string, readonly Group[], Feature])[] = [
  ['Platform', platform, features.Platform],
  ['Solutions', solutions, features.Solutions],
  ['Resources', resources, features.Resources],
  ['Trust', trust, features.Trust],
]

function MegaPanel({ close, feature, groups }: Readonly<{
  close: () => void
  feature: Feature
  groups: readonly Group[]
}>) {
  return <div className="grid w-full grid-cols-[repeat(2,minmax(0,1fr))_minmax(0,0.9fr)] gap-x-9 gap-y-7 p-7">
    {groups.map((group) => <div key={group.label}>
      <p className="mb-4 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground">{group.label}</p>
      <ul className="grid gap-0.5">
        {group.entries.map((entry) => <li key={entry.href}>
          <Link className="group/item block rounded-panel px-3 py-2.5 transition-colors hover:bg-surface-hover focus-visible:bg-surface-raised" href={entry.href} onClick={close}>
            <span className="block text-[0.9375rem] font-medium leading-snug text-foreground">{entry.title}</span>
            <span className="mt-1 block text-[0.8125rem] leading-5 text-muted-foreground">{entry.body}</span>
          </Link>
        </li>)}
      </ul>
    </div>)}
    <div className="border-l border-border pl-9">
      <p className="mb-4 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground">{feature.label}</p>
      <Link className="group/f block rounded-panel bg-surface-inset p-5 transition-colors hover:bg-surface-hover" href={feature.href} onClick={close}>
        <span className="block text-[0.9375rem] font-medium text-foreground">{feature.title}</span>
        <span className="mt-2 block text-[0.8125rem] leading-5 text-muted-foreground">{feature.body}</span>
        <span aria-hidden="true" className="mt-4 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-foreground">
          {feature.cta}
          <span className="transition-transform group-hover/f:translate-x-0.5">&rarr;</span>
        </span>
      </Link>
    </div>
  </div>
}

export function SiteNav() {
  const [open, setOpen] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    if (!open) return
    const label = open
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (closeTimer.current) clearTimeout(closeTimer.current)
      closeTimer.current = null
      setOpen(null)
      requestAnimationFrame(() => triggerRefs.current[label]?.focus())
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [open])

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }

  function closeMenu() {
    cancelClose()
    setOpen(null)
  }

  function scheduleClose() {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(null), 140)
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeMenu()
  }

  function handleTriggerKey(event: KeyboardEvent<HTMLButtonElement>, label: string) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeMenu()
      event.currentTarget.focus()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(label)
      requestAnimationFrame(() => rootRef.current?.querySelector<HTMLAnchorElement>(`#nav-panel-${label.toLowerCase()} a`)?.focus())
    }
  }

  function handlePanelKey(event: KeyboardEvent<HTMLDivElement>, label: string) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closeMenu()
    triggerRefs.current[label]?.focus()
  }

  return <div
    className="hidden lg:flex"
    onBlur={handleBlur}
    onPointerEnter={cancelClose}
    onPointerLeave={scheduleClose}
    ref={rootRef}
  >
    <ul className="flex items-center gap-0.5">
      {menus.map(([label, groups, feature]) => {
        const expanded = open === label
        const panelId = `nav-panel-${label.toLowerCase()}`
        return <li key={label}>
          <button
            aria-controls={panelId}
            aria-expanded={expanded}
            aria-haspopup="true"
            className="inline-flex h-10 items-center rounded-control bg-transparent px-3 text-[0.8125rem] font-normal text-muted-foreground transition-colors hover:text-foreground focus:text-foreground data-[state=open]:text-foreground"
            data-state={expanded ? 'open' : 'closed'}
            onClick={() => setOpen((current) => current === label ? null : label)}
            onKeyDown={(event) => handleTriggerKey(event, label)}
            onPointerEnter={() => setOpen(label)}
            ref={(node) => { triggerRefs.current[label] = node }}
            type="button"
          >{label}</button>
          {expanded && <div
            aria-label={`${label} navigation`}
            className="fuma-overlay fixed left-1/2 top-20 z-50 w-[min(58rem,calc(100vw-4rem))] -translate-x-1/2 rounded-surface border-0 backdrop-blur-2xl"
            id={panelId}
            onKeyDown={(event) => handlePanelKey(event, label)}
            onPointerEnter={cancelClose}
            onPointerLeave={scheduleClose}
            role="region"
          >
            <MegaPanel close={closeMenu} feature={feature} groups={groups} />
          </div>}
        </li>
      })}
      <li>
        <Link className="inline-flex h-10 items-center justify-center rounded-control px-3 text-[0.8125rem] leading-none text-muted-foreground transition-colors hover:text-foreground" href="/about">About</Link>
      </li>
    </ul>
  </div>
}
