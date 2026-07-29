import type { ReactNode } from 'react'
import type { RuntimeJson } from '../lib/contracts'
import { RuntimeLink } from './runtime-link'

export type LawyerAccessProjection = Readonly<{
  member: boolean
  paid: boolean
  memberSource: 'none' | 'registered' | 'complimentary' | 'manual' | 'paid'
  segmentIds: readonly string[]
}>

type JsonRecord = Readonly<Record<string, RuntimeJson>>

function record(value: RuntimeJson | undefined): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function text(value: RuntimeJson | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function items(value: RuntimeJson | undefined): readonly JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : []
}

function safePath(value: string, fallback = '/'): string {
  return /^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/.test(value) ? value : fallback
}

function safeMedia(value: string): string | null {
  if (/^\/(?!\/)[A-Za-z0-9._~/%-]+$/.test(value)) return value
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash ? url.toString() : null
  } catch { return null }
}

export function LawyerSiteShell({
  host,
  props,
  children,
}: Readonly<{ host: string; props: JsonRecord; children: ReactNode }>) {
  const navigation = items(props.navigation)
  return (
    <div className="min-h-svh bg-[var(--lawyer-paper)] text-[var(--lawyer-ink)]">
      <RuntimeLink value="#lawyer-main" currentHost={host} target="_self" decoration={{ className: 'sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-[var(--lawyer-paper)] focus:px-4 focus:py-3 focus:shadow-lg' }}>Skip to content</RuntimeLink>
      <header className="border-b border-[var(--lawyer-rule)] bg-[var(--lawyer-paper)]">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <RuntimeLink value="/" currentHost={host} target="_self" decoration={{ className: 'font-serif text-2xl font-bold tracking-tight sm:text-3xl', 'aria-label': 'The Lawyer home' }}>The Lawyer</RuntimeLink>
          <nav aria-label="Primary navigation">
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold">
              {navigation.map((item, index) => {
                const label = text(item.label)
                const href = safePath(text(item.href))
                return <li key={`${href}:${index}`}><RuntimeLink value={href} currentHost={host} target="_self" decoration={{ className: 'underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4' }}>{label}</RuntimeLink></li>
              })}
            </ul>
          </nav>
        </div>
      </header>
      <main id="lawyer-main" tabIndex={-1}>{children}</main>
      <footer className="mt-16 border-t border-[var(--lawyer-rule)] bg-[var(--lawyer-ink)] text-[var(--lawyer-paper)]">
        <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:px-8">
          <p className="font-serif text-xl font-bold">Independent legal journalism for Kenya.</p>
          <p className="text-sm lg:text-right">Member email is delivered through Fuma-managed OCI Email Delivery.</p>
        </div>
      </footer>
    </div>
  )
}

export function LawyerEditorialHeader({ props }: Readonly<{ props: JsonRecord }>) {
  const canonicalPath = safePath(text(props.canonicalPath))
  return (
    <header className="mx-auto grid w-full max-w-4xl gap-4 px-4 pb-8 pt-10 sm:px-6 sm:pt-16 lg:px-8">
      <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-[var(--lawyer-accent)]">{text(props.eyebrow, 'The Lawyer')}</p>
      <h1 className="text-balance font-serif text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">{text(props.title, 'The Lawyer')}</h1>
      {text(props.excerpt) ? <p className="max-w-3xl text-lg leading-8 text-[var(--lawyer-muted)] sm:text-xl">{text(props.excerpt)}</p> : null}
      <div className="flex flex-wrap gap-x-4 gap-y-2 border-y border-[var(--lawyer-rule)] py-3 text-sm text-[var(--lawyer-muted)]">
        {text(props.byline) ? <span>By {text(props.byline)}</span> : null}
        {text(props.publishedAt) ? <time dateTime={text(props.publishedAt)}>{text(props.publishedLabel, text(props.publishedAt))}</time> : null}
        <span data-fuma-canonical={canonicalPath}>Canonical: {canonicalPath}</span>
      </div>
    </header>
  )
}

export function LawyerStoryCard({ host, props }: Readonly<{ host: string; props: JsonRecord }>) {
  const href = safePath(text(props.href), '/archive')
  const image = safeMedia(text(props.image))
  return (
    <article className="group grid min-w-0 gap-3 border-t border-[var(--lawyer-rule)] py-6 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_9rem]">
      <div className="grid content-start gap-2">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-[var(--lawyer-accent)]">{text(props.section, 'Analysis')}</p>
        <h2 className="text-pretty font-serif text-2xl font-bold leading-tight sm:text-3xl"><RuntimeLink value={href} currentHost={host} target="_self" decoration={{ className: 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 group-hover:underline' }}>{text(props.title, 'Untitled')}</RuntimeLink></h2>
        {text(props.excerpt) ? <p className="line-clamp-3 leading-7 text-[var(--lawyer-muted)]">{text(props.excerpt)}</p> : null}
      </div>
      {image ? <img className="aspect-[4/3] w-full rounded-sm object-cover" src={image} alt={text(props.imageAlt)} loading="lazy" decoding="async" /> : null}
    </article>
  )
}

export function LawyerAccessGate({
  host,
  props,
  access,
  children,
}: Readonly<{ host: string; props: JsonRecord; access: LawyerAccessProjection; children: ReactNode }>) {
  const requirement = text(props.requirement, 'public')
  const allowed = requirement === 'public' || (requirement === 'member' && access.member) || (requirement === 'paid' && access.paid)
  if (allowed) return <>{children}</>
  const paid = requirement === 'paid'
  return (
    <section className="mx-auto my-10 grid w-[min(100%-2rem,48rem)] gap-5 rounded-sm border border-[var(--lawyer-rule)] bg-[var(--lawyer-panel)] p-6 sm:p-10" role="region" aria-labelledby="lawyer-access-title" data-lawyer-access={requirement}>
      <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-[var(--lawyer-accent)]">{paid ? 'Subscriber article' : 'Member article'}</p>
      <h2 id="lawyer-access-title" className="font-serif text-3xl font-bold">{paid ? 'A verified subscription is required' : 'Sign in to continue'}</h2>
      <p className="max-w-2xl leading-7 text-[var(--lawyer-muted)]">{paid ? 'Paid access follows Fuma’s reconciled membership authority. Legacy labels never grant access.' : 'Use your reactivated Lawyer member account to read this story.'}</p>
      <div className="flex flex-wrap gap-3">
        <RuntimeLink value="/sign-in" currentHost={host} target="_self" decoration={{ className: 'rounded-sm bg-[var(--lawyer-ink)] px-5 py-3 font-semibold text-[var(--lawyer-paper)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4' }}>Sign in</RuntimeLink>
        {paid ? <RuntimeLink value="/membership" currentHost={host} target="_self" decoration={{ className: 'rounded-sm border border-[var(--lawyer-ink)] px-5 py-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4' }}>View membership</RuntimeLink> : null}
      </div>
    </section>
  )
}

export function LawyerMembershipPanel({ host, props }: Readonly<{ host: string; props: JsonRecord }>) {
  return (
    <section className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-12 sm:px-6 sm:py-20 lg:grid-cols-[1.2fr_0.8fr] lg:px-8" aria-labelledby="membership-title">
      <div className="grid content-start gap-4">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-[var(--lawyer-accent)]">Membership</p>
        <h1 id="membership-title" className="text-balance font-serif text-4xl font-bold sm:text-6xl">{text(props.title, 'Read beyond the headline')}</h1>
        <p className="max-w-2xl text-lg leading-8 text-[var(--lawyer-muted)]">{text(props.description, 'Support independent legal journalism and unlock subscriber analysis.')}</p>
      </div>
      <div className="grid gap-4 rounded-sm border border-[var(--lawyer-rule)] bg-[var(--lawyer-panel)] p-6 sm:p-8">
        <p className="text-sm font-bold uppercase tracking-[0.14em]">{text(props.tier, 'Practitioner')}</p>
        <p className="font-serif text-4xl font-bold">{text(props.price, 'KES 950')} <span className="font-sans text-base font-normal text-[var(--lawyer-muted)]">/ month</span></p>
        <p className="text-sm text-[var(--lawyer-muted)]">Checkout and renewal are handled only by Fuma’s customer-payment authority.</p>
        <RuntimeLink value="/membership/initialise" currentHost={host} target="_self" decoration={{ className: 'rounded-sm bg-[var(--lawyer-accent)] px-5 py-3 text-center font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4' }}>Choose membership</RuntimeLink>
      </div>
    </section>
  )
}

export function LawyerAccountPanel({ access, props }: Readonly<{ access: LawyerAccessProjection; props: JsonRecord }>) {
  return (
    <section className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-12 sm:px-6 sm:py-20 lg:px-8" aria-labelledby="account-title">
      <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-[var(--lawyer-accent)]">Member account</p>
      <h1 id="account-title" className="font-serif text-4xl font-bold sm:text-5xl">{text(props.title, 'Your Lawyer account')}</h1>
      <dl className="grid gap-3 rounded-sm border border-[var(--lawyer-rule)] p-6 sm:grid-cols-2">
        <div><dt className="text-sm text-[var(--lawyer-muted)]">Member access</dt><dd className="font-semibold">{access.member ? 'Active' : 'Sign-in required'}</dd></div>
        <div><dt className="text-sm text-[var(--lawyer-muted)]">Paid access</dt><dd className="font-semibold">{access.paid ? 'Verified' : 'Not active'}</dd></div>
        <div><dt className="text-sm text-[var(--lawyer-muted)]">Access source</dt><dd className="font-semibold">{access.memberSource}</dd></div>
        <div><dt className="text-sm text-[var(--lawyer-muted)]">Email delivery</dt><dd className="font-semibold">OCI Email Delivery</dd></div>
      </dl>
    </section>
  )
}

export const LAWYER_SOURCE_COMPONENTS = Object.freeze([
  { componentId: 'lawyer.site-shell', exactVersion: '1.0.0', client: false },
  { componentId: 'lawyer.editorial-header', exactVersion: '1.0.0', client: false },
  { componentId: 'lawyer.story-card', exactVersion: '1.0.0', client: false },
  { componentId: 'lawyer.access-gate', exactVersion: '1.0.0', client: false },
  { componentId: 'lawyer.membership-panel', exactVersion: '1.0.0', client: false },
  { componentId: 'lawyer.account-panel', exactVersion: '1.0.0', client: false },
] as const)
