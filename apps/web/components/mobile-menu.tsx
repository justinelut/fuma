'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCentralIdentityStatus, CENTRAL_APP_DASHBOARD_URL } from '@/components/central-session'
import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

type MenuLink = readonly [href: Route, label: string]

const journeys = [
  {
    body: 'For portfolios, services, campaigns and designed content-rich sites.',
    eyebrow: 'Designed pages',
    href: '/website',
    title: 'Website',
  },
  {
    body: 'For blogs, magazines, newsletters and work that keeps arriving.',
    eyebrow: 'Recurring entries',
    href: '/publication',
    title: 'Publication',
  },
] as const

const sections: readonly (readonly [string, readonly MenuLink[]])[] = [
  ['Platform', [['/features', 'Features'], ['/templates', 'Templates'], ['/components', 'Component packs'], ['/plugins', 'Plugins']]],
  ['Discover', [['/solutions', 'All outcomes'], ['/pricing', 'Pricing'], ['/showcase', 'Showcase'], ['/experts', 'Experts']]],
  ['Learn', [['/docs', 'Docs'], ['/guides', 'Guides'], ['/blog', 'Blog'], ['/changelog', 'Changelog']]],
  ['Company & trust', [['/about', 'About'], ['/contact', 'Contact'], ['/trust', 'Trust centre'], ['/security', 'Security'], ['/status', 'Status'], ['/legal', 'Legal']]],
]

export function MobileMenu() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const identityStatus = useCentralIdentityStatus()
  const close = () => setOpen(false)

  return <Sheet onOpenChange={setOpen} open={open}>
    <SheetTrigger
      aria-expanded={open}
      aria-label={open ? 'Close menu' : 'Open menu'}
      className="inline-flex size-11 items-center justify-center rounded-control text-foreground transition-colors hover:bg-surface-hover lg:hidden"
    >
      <svg aria-hidden="true" fill="none" height="19" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 20 20" width="19">
        <path d="M3 6h14M3 10h14M3 14h14" />
      </svg>
    </SheetTrigger>

    <SheetContent
      className="fuma-overlay h-dvh w-full max-w-none gap-0 overflow-hidden border-l border-line-soft bg-background p-0 sm:w-[min(30rem,92vw)] sm:max-w-[30rem]"
      side="right"
    >
      <SheetHeader className="shrink-0 border-b border-line-soft px-5 py-5 pr-14 sm:px-7 sm:py-6 sm:pr-16">
        <p className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-signal-bright">Navigation</p>
        <SheetTitle className="mt-2 font-display text-display-md tracking-[-0.02em]">Explore Fuma.</SheetTitle>
        <SheetDescription className="mt-2 max-w-sm text-sm leading-6">
          Choose the working surface that matches what you need to publish today.
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
        <nav aria-label="Site navigation">
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">Start with the work</p>
          <ul className="mt-4 border-y border-line-soft">
            {journeys.map((journey) => <li className="border-b border-line-soft last:border-b-0" key={journey.href}>
              <Link
                aria-current={pathname === journey.href ? 'page' : undefined}
                className="group grid gap-2 py-5 transition-colors hover:text-signal-bright"
                href={journey.href}
                onClick={close}
              >
                <span className="flex items-center justify-between gap-4">
                  <span className="font-display text-display-md text-foreground">{journey.title}</span>
                  <span aria-hidden="true" className="text-signal-bright transition-transform group-hover:translate-x-0.5">→</span>
                </span>
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">{journey.eyebrow}</span>
                <span className="max-w-sm text-sm leading-6 text-muted-foreground">{journey.body}</span>
              </Link>
            </li>)}
          </ul>

          <div className="mt-9 grid grid-cols-2 gap-x-6 gap-y-9">
            {sections.map(([label, links]) => <div key={label}>
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
              <ul className="mt-3 grid gap-1">
                {links.map(([href, name]) => <li key={href}>
                  <Link
                    aria-current={pathname === href ? 'page' : undefined}
                    className="block py-1.5 text-sm leading-5 text-foreground transition-colors hover:text-signal-bright aria-[current=page]:text-signal-bright"
                    href={href}
                    onClick={close}
                  >{name}</Link>
                </li>)}
              </ul>
            </div>)}
          </div>
        </nav>
      </div>

      <div className="shrink-0 border-t border-line-soft bg-background/95 p-4 backdrop-blur-xl sm:p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          {identityStatus === 'authenticated' ? <>
            <a className="control-primary inline-flex min-h-11 items-center justify-center rounded-control bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors" href={CENTRAL_APP_DASHBOARD_URL} onClick={close}>Dashboard</a>
            <a className="control-secondary inline-flex min-h-11 items-center justify-center rounded-control px-4 text-sm font-medium transition-colors" href={CENTRAL_APP_DASHBOARD_URL} onClick={close}>Account</a>
          </> : <>
            <Link className="control-primary inline-flex min-h-11 items-center justify-center rounded-control bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors" href="/start?kind=sign_up&source=direct" onClick={close}>Start building</Link>
            <Link className="control-secondary inline-flex min-h-11 items-center justify-center rounded-control px-4 text-sm font-medium transition-colors" href="/start?kind=sign_in&source=direct" onClick={close}>Log in</Link>
          </>}
        </div>
      </div>
    </SheetContent>
  </Sheet>
}
