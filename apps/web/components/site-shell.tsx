import { FUMA_PUBLIC_IDENTITY } from '@fuma/brand'
import type { ReactNode } from 'react'

const primary = [
  ['/website', 'Website'],
  ['/publication', 'Publication'],
  ['/features', 'Features'],
  ['/solutions', 'Solutions'],
  ['/about', 'About'],
] as const
const resources = [['/docs', 'Docs'], ['/guides', 'Guides'], ['/blog', 'Blog'], ['/changelog', 'Changelog']] as const

export function SiteShell({ children }: Readonly<{ children: ReactNode }>) {
  return <>
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur" data-testid="public-header">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-2 px-3 sm:gap-5 sm:px-6">
        <a className="shrink-0 rounded-sm text-xl font-semibold tracking-tight" href="/" aria-label={`${FUMA_PUBLIC_IDENTITY.product.name} home`}>Fuma<span className="text-brand-mint">.</span></a>
        <nav aria-label="Primary" className="hidden min-w-0 flex-1 items-center gap-5 text-sm lg:flex">
          {primary.map(([href, label]) => <a className="rounded-sm text-muted-foreground hover:text-foreground" href={href} key={href}>{label}</a>)}
        </nav>
        <div aria-label="Application handoff" className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
          <a className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-semibold hover:bg-secondary sm:px-3" href="/start?kind=sign_in&source=direct">Sign in</a>
          <a className="inline-flex min-h-11 items-center rounded-md bg-primary px-2 text-sm font-semibold text-primary-foreground sm:px-3" href="/start?kind=sign_up&source=direct"><span className="sm:hidden">Start</span><span className="hidden sm:inline">Start building</span></a>
        </div>
      </div>
      <nav aria-label="Explore Fuma" className="flex max-w-full gap-5 overflow-x-auto border-t px-4 py-3 text-sm lg:hidden">
        {primary.map(([href, label]) => <a className="shrink-0 rounded-sm font-medium text-muted-foreground hover:text-foreground" href={href} key={href}>{label}</a>)}
      </nav>
    </header>
    {children}
    <footer className="mt-20 border-t bg-card sm:mt-24">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-12 sm:grid-cols-3">
        <div><p className="font-semibold">Fuma</p><p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">A Kenya-first place to build and publish an independent website or publication.</p></div>
        <nav aria-label="Resources" className="grid content-start gap-3 text-sm">{resources.map(([href, label]) => <a className="w-fit rounded-sm" href={href} key={href}>{label}</a>)}</nav>
        <nav aria-label="Company and legal" className="grid content-start gap-3 text-sm">
          <a className="w-fit rounded-sm" href="/about">About</a><a className="w-fit rounded-sm" href="/contact">Contact</a><a className="w-fit rounded-sm" href="/trust">Trust centre</a><a className="w-fit rounded-sm" href="/security">Security</a><a className="w-fit rounded-sm" href="/status">Status</a><a className="w-fit rounded-sm" href="/legal/privacy">Privacy</a><a className="w-fit rounded-sm" href="/legal/terms">Terms</a>
        </nav>
      </div>
      <p className="border-t px-6 py-5 text-center text-xs text-muted-foreground">© {new Date().getUTCFullYear()} Fuma. Built for ownership.</p>
    </footer>
  </>
}

export function PageMain({ children, className = '' }: Readonly<{ children: ReactNode; className?: string }>) {
  return <main id="main-content" tabIndex={-1} className={`mx-auto w-full max-w-7xl px-4 py-10 focus:outline-none sm:px-8 sm:py-16 ${className}`}>{children}</main>
}
