import type { Route } from 'next'
import type { ApprovedClaimId } from '@/lib/acquisition-content'
import { approvedClaim } from '@/lib/acquisition-content'
import type { ReactNode } from 'react'
import Link from 'next/link'

export function Eyebrow({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="eyebrow">{children}</p>
}

/**
 * Shared public hero.
 *
 * Structure follows the briefed reference: left-aligned display headline at the
 * margin, action row directly beneath it, and a release note pushed to the far
 * right of that same row. No centred stack, no pill-above-headline template.
 *
 * Entrance is CSS-only (`fuma-rise`) so the hero costs no route JavaScript and
 * inherits the global reduced-motion rule.
 */
export function Hero({
  eyebrow,
  title,
  description,
  children,
}: Readonly<{ eyebrow: string; title: string; description: string; children?: ReactNode }>) {
  return <section aria-labelledby="page-title" className="section fuma-glow !pb-0 pt-16 sm:pt-24" data-fuma-visual="hero">
    {/* No badge pill: none of the eight measured premium references uses one above the h1. The
        eyebrow stays as quiet type, which is how linear and framer label a page. */}
    <p className="eyebrow fuma-rise">{eyebrow}</p>
    <h1
      className="fuma-rise max-w-[19ch] font-display text-display-xl text-balance"
      id="page-title"
    >{title}</h1>
    <p
      className="fuma-rise mt-6 max-w-xl text-lede text-muted-foreground text-pretty"
      style={{ animationDelay: '70ms' }}
    >{description}</p>
    {children && <div className="fuma-rise mt-10 flex flex-row flex-wrap items-center gap-3" style={{ animationDelay: '140ms' }}>{children}</div>}
  </section>
}

export function CTA({ href, children, prefetch = false, secondary = false }: Readonly<{
  href: Route | string
  children: ReactNode
  prefetch?: boolean
  secondary?: boolean
}>) {
  const className = `inline-flex min-h-11 sm:min-h-0 sm:h-[2.125rem] items-center justify-center rounded-control px-3.5 text-center text-sm font-medium transition-colors ${secondary ? 'control-secondary' : 'control-primary bg-primary text-primary-foreground'}`
  // External destinations get a real anchor with safe rel; internal ones route client-side.
  return /^https?:\/\//.test(href)
    ? <a className={className} href={href} rel="noopener noreferrer" target="_blank">{children}</a>
    : <Link className={className} href={href as Route} prefetch={prefetch}>{children}</Link>
}

export function FeatureGrid({
  items,
  heading = 'What you can do',
  intro,
}: Readonly<{
  items: readonly Readonly<{ title: string; body: string }>[]
  heading?: string
  intro?: string
}>) {
  return <section aria-labelledby={`feature-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="section">
    <div className="max-w-2xl">
      <h2 id={`feature-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="font-display text-display-lg">{heading}</h2>
      {intro && <p className="mt-5 text-lede text-muted-foreground">{intro}</p>}
    </div>
    <div className="mt-8 grid overflow-hidden rounded-panel border bg-border sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => <article className="border-b bg-card p-6 last:border-b-0 sm:border-r lg:min-h-56" key={item.title}>
        <h3 className="font-display text-display-md">{item.title}</h3>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.body}</p>
      </article>)}
    </div>
  </section>
}

export function JourneyChoices({ embedded = false }: Readonly<{ embedded?: boolean }>) {
  return <section aria-labelledby="choose-journey" className={embedded ? undefined : 'section'}>
    <Eyebrow>Choose by outcome</Eyebrow>
    <h2 id="choose-journey" className="max-w-3xl font-display text-display-lg">What are you here to publish?</h2>
    <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">Both paths use the same ownership model. Pick the working surface that best matches what you need today.</p>
    <div className="mt-8 grid gap-4 md:grid-cols-2">
      <Link className="group rounded-surface border bg-card p-7 hover:border-foreground" href="/website">
        <span className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">A home for your work</span>
        <h3 className="mt-4 font-display text-display-md">Website</h3>
        <p className="mt-3 max-w-xl leading-7 text-muted-foreground">For services, portfolios, campaigns, organisations and content-rich sites.</p>
        <span className="mt-6 inline-block font-semibold underline decoration-brand-mint decoration-4 underline-offset-4">Explore the Website journey</span>
      </Link>
      <Link className="group rounded-surface border bg-card p-7 hover:border-foreground" href="/publication">
        <span className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">A rhythm for recurring ideas</span>
        <h3 className="mt-4 font-display text-display-md">Publication</h3>
        <p className="mt-3 max-w-xl leading-7 text-muted-foreground">For blogs, magazines, newsletters, newsrooms and editorial teams.</p>
        <span className="mt-6 inline-block font-semibold underline decoration-brand-lilac decoration-4 underline-offset-4">Explore the Publication journey</span>
      </Link>
    </div>
  </section>
}

/**
 * Approved claims, rendered as receipts rather than as prose cards.
 *
 * Every claim in the inventory carries a named reviewing owner. Showing that owner as a signed-off
 * record is the honest form of the section: the point is not that we assert these things, it is that
 * each one has someone accountable for it. Nothing here is a rating, score or invented metric.
 */
export function ClaimList({ columns = 1, ids, heading = 'Reviewed product facts' }: Readonly<{ columns?: 1 | 2; ids: readonly ApprovedClaimId[]; heading?: string }>) {
  const anchor = `claim-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return <section aria-labelledby={anchor}>
    <p className="eyebrow">Accountability</p>
    <h2 className="font-display text-display-md" id={anchor}>{heading}</h2>
    <ul className={`mt-6 grid gap-px overflow-hidden rounded-panel border border-border bg-border ${columns === 2 ? 'md:grid-cols-2' : ''}`}>
      {ids.map((id) => {
        const claim = approvedClaim(id)
        return <li className="bg-card p-5" data-claim-id={claim.id} key={claim.id}>
          <p className="text-[0.9375rem] leading-7">{claim.statement}</p>
          <div className="mt-4 flex items-center gap-2.5 border-t border-border/70 pt-3.5">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-live" />
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-muted-foreground">
              Reviewed by {claim.owner}
            </span>
          </div>
        </li>
      })}
    </ul>
  </section>
}

export function AuthorityUnavailable({ subject, detail = 'Current information is temporarily unavailable. We will not guess or show outdated data.' }: Readonly<{ subject: string; detail?: string }>) {
  return <section aria-live="polite" role="status" className="mt-10 rounded-panel border border-dashed p-8">
    <h2 className="text-xl font-semibold">{subject} unavailable</h2>
    <p className="mt-2 max-w-2xl text-muted-foreground">{detail}</p>
  </section>
}

export function FilterBar({ children }: Readonly<{ children: ReactNode }>) {
  return <form className="mt-8 flex flex-wrap gap-3 rounded-panel border bg-card p-4" method="get">{children}<button className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" type="submit">Apply filters</button></form>
}

export function Tag({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="rounded-full bg-secondary px-3 py-1 text-xs">{children}</span>
}
