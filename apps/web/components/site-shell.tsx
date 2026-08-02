import { FUMA_PUBLIC_IDENTITY } from '@fuma/brand'
import type { Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { MobileMenu } from '@/components/mobile-menu'
import { SiteNav } from '@/components/site-nav'

type Column = Readonly<{ heading: string; links: readonly (readonly [Route, string, string?])[] }>

/**
 * Footer information architecture. Some columns carry a second heading beneath the first so
 * related groups stay together without inventing more columns than the content supports.
 */
const columns: readonly (readonly Column[])[] = [
  [{
    heading: 'Product',
    links: [['/website', 'Website'], ['/publication', 'Publication'], ['/features', 'Features'], ['/templates', 'Templates'], ['/components', 'Component packs'], ['/plugins', 'Plugins']],
  }],
  [{
    heading: 'Resources',
    links: [['/docs', 'Docs'], ['/guides', 'Guides'], ['/blog', 'Blog'], ['/changelog', 'Changelog'], ['/search', 'Search']],
  }],
  [
    { heading: 'Business', links: [['/pricing', 'Pricing'], ['/solutions', 'Solutions']] },
    { heading: 'Company', links: [['/about', 'About'], ['/contact', 'Contact']] },
  ],
  [{
    heading: 'Solutions',
    links: [['/website', 'Site builders'], ['/publication', 'Editorial teams'], ['/solutions', 'By outcome'], ['/experts', 'Studios']],
  }],
  [{
    heading: 'Ecosystem',
    links: [['/showcase', 'Showcase'], ['/experts', 'Experts'], ['/components', 'Components'], ['/plugins', 'Plugins'], ['/templates', 'Templates']],
  }],
  [
    { heading: 'Trust', links: [['/trust', 'Trust centre'], ['/security', 'Security'], ['/status', 'Status']] },
    { heading: 'Legal', links: [['/legal', 'Policies'], ['/legal/privacy' as Route, 'Privacy'], ['/legal/terms' as Route, 'Terms'], ['/privacy-request', 'Privacy request'], ['/legal/history', 'Policy history']] },
  ],
  [{
    heading: 'Get started',
    links: [['/start?kind=sign_up&source=direct', 'Sign up'], ['/start?kind=sign_in&source=direct', 'Log in'], ['/pricing', 'Compare plans'], ['/contact', 'Talk to us']],
  }],
]

export function SiteShell({ children }: Readonly<{ children: ReactNode }>) {
  return <>
    <header className="sticky top-0 z-40 border-b border-border bg-background/70 backdrop-blur-xl" data-testid="public-header">
      <div className="mx-auto flex min-h-[4.5rem] max-w-7xl items-center gap-2 px-4 sm:gap-6 sm:px-8">
        <Link className="shrink-0 rounded-sm font-display text-[1.35rem] font-semibold tracking-[-0.02em]" href="/" aria-label={`${FUMA_PUBLIC_IDENTITY.product.name} home`}>Fuma<span className="text-signal-bright">.</span></Link>
        <nav aria-label="Primary" className="hidden min-w-0 flex-1 items-center lg:flex">
          <SiteNav />
        </nav>
        <div aria-label="Account actions" className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
          <Link className="inline-flex min-h-11 items-center rounded-lg px-3 text-[0.9375rem] text-muted-foreground transition-colors hover:text-foreground max-[22rem]:hidden lg:min-h-10" href="/start?kind=sign_in&source=direct">Log in</Link>
          <Link className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-[0.9375rem] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 max-[22rem]:hidden lg:min-h-10" href="/start?kind=sign_up&source=direct"><span className="sm:hidden">Sign up</span><span className="hidden sm:inline">Sign up free</span></Link>
          <MobileMenu />
        </div>
      </div>
    </header>
    {children}
    <footer className="mt-14 border-t border-border sm:mt-16" data-fuma-footer>
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8 sm:py-14">
        <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-[auto_repeat(7,minmax(0,1fr))] lg:gap-x-6">
          <Link className="font-display text-[1.35rem] font-semibold tracking-[-0.02em] lg:mr-6" href="/">Fuma<span className="text-signal-bright">.</span></Link>
          {columns.map((groups) => <div className="grid content-start gap-8" key={groups[0]!.heading}>
            {groups.map((group) => <nav aria-label={group.heading} key={group.heading}>
              <p className="text-[0.875rem] font-semibold">{group.heading}</p>
              <ul className="mt-3.5 grid gap-2.5">
                {group.links.map(([href, label, badge]) => <li key={href}>
                  <Link className="inline-flex items-center gap-1.5 text-[0.875rem] text-muted-foreground transition-colors hover:text-foreground" href={href}>
                    {label}
                    {badge && <span className="rounded bg-signal/20 px-1.5 py-px font-mono text-[0.55rem] uppercase tracking-wide text-signal-bright">{badge}</span>}
                  </Link>
                </li>)}
              </ul>
            </nav>)}
          </div>)}
        </div>

        {/* Status bar */}
        <div className="mt-14 flex flex-col gap-5 border-t border-border pt-6 text-[0.8125rem] text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-8">
          <p>
            <Link className="inline-flex min-h-11 items-center transition-colors hover:text-foreground sm:min-h-0" href="/status">Service status</Link>
          </p>
          <p>Build, manage and publish in one place.</p>
          <p className="flex items-center gap-2">
            <Link className="transition-colors hover:text-foreground" href="/trust">Trust centre</Link>
            <span aria-hidden="true">·</span>
            <Link className="transition-colors hover:text-foreground" href="/security">Security</Link>
          </p>
          <p>© {new Date().getUTCFullYear()} Fuma.</p>
        </div>
      </div>
    </footer>
  </>
}

export function PageMain({ children, className = '' }: Readonly<{ children: ReactNode; className?: string }>) {
  return <main id="main-content" tabIndex={-1} className={`mx-auto w-full max-w-7xl px-4 py-10 focus:outline-none sm:px-8 sm:py-16 ${className}`}>{children}</main>
}
