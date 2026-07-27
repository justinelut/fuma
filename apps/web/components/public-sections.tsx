import type { ApprovedClaimId } from '@/lib/acquisition-content'
import { approvedClaim } from '@/lib/acquisition-content'
import type { ReactNode } from 'react'

export function Eyebrow({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{children}</p>
}

export function Hero({
  eyebrow,
  title,
  description,
  children,
}: Readonly<{ eyebrow: string; title: string; description: string; children?: ReactNode }>) {
  return <section aria-labelledby="page-title" className="grid gap-8 border-b pb-12 sm:pb-14 lg:grid-cols-[1.45fr_1fr] lg:items-end">
    <div>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 id="page-title" className="max-w-4xl text-[clamp(2.65rem,10vw,4.75rem)] font-semibold leading-[0.96] tracking-[-0.045em]">{title}</h1>
    </div>
    <div>
      <p className="max-w-2xl text-lg leading-8 text-muted-foreground">{description}</p>
      {children && <div className="mt-6 flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  </section>
}

export function CTA({ href, children, secondary = false }: Readonly<{ href: string; children: ReactNode; secondary?: boolean }>) {
  return <a className={`inline-flex min-h-11 items-center justify-center rounded-md px-5 py-3 text-center text-sm font-semibold ${secondary ? 'border bg-background text-foreground hover:bg-secondary' : 'bg-primary text-primary-foreground hover:opacity-90'}`} href={href}>{children}</a>
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
  return <section aria-labelledby={`feature-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="mt-16 sm:mt-20">
    <div className="max-w-2xl">
      <h2 id={`feature-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="text-3xl font-semibold tracking-tight sm:text-4xl">{heading}</h2>
      {intro && <p className="mt-4 text-lg leading-8 text-muted-foreground">{intro}</p>}
    </div>
    <div className="mt-8 grid overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => <article className="border-b bg-card p-6 last:border-b-0 sm:border-r lg:min-h-56" key={item.title}>
        <h3 className="text-xl font-semibold">{item.title}</h3>
        <p className="mt-3 leading-7 text-muted-foreground">{item.body}</p>
      </article>)}
    </div>
  </section>
}

export function JourneyChoices() {
  return <section aria-labelledby="choose-journey" className="mt-16 sm:mt-20">
    <Eyebrow>Choose by outcome</Eyebrow>
    <h2 id="choose-journey" className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">What are you here to publish?</h2>
    <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">Both paths use the same ownership model. Pick the working surface that best matches what you need today.</p>
    <div className="mt-8 grid gap-4 md:grid-cols-2">
      <a className="group rounded-2xl border bg-card p-7 hover:border-foreground" href="/website">
        <span className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">A home for your work</span>
        <h3 className="mt-4 text-3xl font-semibold">Website</h3>
        <p className="mt-3 max-w-xl leading-7 text-muted-foreground">For services, portfolios, campaigns, organisations and content-rich sites.</p>
        <span className="mt-6 inline-block font-semibold underline decoration-brand-mint decoration-4 underline-offset-4">Explore the Website journey</span>
      </a>
      <a className="group rounded-2xl border bg-card p-7 hover:border-foreground" href="/publication">
        <span className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">A rhythm for recurring ideas</span>
        <h3 className="mt-4 text-3xl font-semibold">Publication</h3>
        <p className="mt-3 max-w-xl leading-7 text-muted-foreground">For blogs, magazines, newsletters, newsrooms and editorial teams.</p>
        <span className="mt-6 inline-block font-semibold underline decoration-brand-lilac decoration-4 underline-offset-4">Explore the Publication journey</span>
      </a>
    </div>
  </section>
}

export function ProductMedia({ mode, caption }: Readonly<{ mode: 'canvas' | 'editorial'; caption: string }>) {
  const isCanvas = mode === 'canvas'
  return <figure className="mt-10 overflow-hidden rounded-2xl border bg-brand-black text-brand-near-white shadow-sm sm:mt-14">
    <svg aria-labelledby={`media-${mode}-title media-${mode}-description`} className="block h-auto w-full" role="img" viewBox="0 0 1200 620">
      <title id={`media-${mode}-title`}>{isCanvas ? 'Responsive website canvas' : 'Publication editorial workspace'}</title>
      <desc id={`media-${mode}-description`}>{caption}</desc>
      <rect fill="#101212" height="620" width="1200" />
      <rect fill="#1d2222" height="62" rx="14" width="1080" x="60" y="48" />
      <circle cx="96" cy="79" fill="#8ef2c6" r="10" />
      <circle cx="128" cy="79" fill="#c8b7ff" r="10" />
      <circle cx="160" cy="79" fill="#ffb59d" r="10" />
      <rect fill="#f5f5ef" height="440" rx="16" width={isCanvas ? 720 : 760} x="60" y="132" />
      <rect fill="#8ef2c6" height="130" rx="10" width={isCanvas ? 620 : 280} x="110" y="180" />
      <rect fill="#101212" height="22" rx="6" width={isCanvas ? 360 : 450} x="110" y="346" />
      <rect fill="#777d7b" height="14" rx="5" width={isCanvas ? 510 : 580} x="110" y="392" />
      <rect fill="#777d7b" height="14" rx="5" width={isCanvas ? 440 : 520} x="110" y="424" />
      <rect fill="#c8b7ff" height="54" rx="9" width="170" x="110" y="470" />
      <rect fill="#232928" height="440" rx="16" width={isCanvas ? 330 : 290} x={isCanvas ? 810 : 850} y="132" />
      {[0, 1, 2, 3].map((row) => <g key={row}>
        <rect fill={row === 0 ? '#8ef2c6' : '#454d4b'} height="12" rx="4" width={isCanvas ? 230 : 190} x={isCanvas ? 860 : 900} y={190 + row * 76} />
        <rect fill="#303735" height="10" rx="4" width={isCanvas ? 190 : 150} x={isCanvas ? 860 : 900} y={216 + row * 76} />
      </g>)}
    </svg>
    <figcaption className="border-t border-white/15 px-5 py-4 text-sm text-brand-near-white/80">{caption} Illustrative interface; no customer content or live availability is implied.</figcaption>
  </figure>
}

export function ClaimList({ ids, heading = 'Reviewed product facts' }: Readonly<{ ids: readonly ApprovedClaimId[]; heading?: string }>) {
  return <section aria-labelledby={`claim-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="mt-16 rounded-2xl bg-secondary p-6 sm:p-10">
    <h2 id={`claim-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="text-2xl font-semibold">{heading}</h2>
    <ul className="mt-6 grid gap-4 md:grid-cols-2">
      {ids.map((id) => {
        const claim = approvedClaim(id)
        return <li className="rounded-xl border bg-card p-5" data-claim-id={claim.id} key={claim.id}>
          <p className="leading-7">{claim.statement}</p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reviewed by {claim.owner}</p>
        </li>
      })}
    </ul>
  </section>
}

export function AuthorityUnavailable({ subject, detail = 'Authoritative information is temporarily unavailable. We will not guess or show stale data.' }: Readonly<{ subject: string; detail?: string }>) {
  return <section aria-live="polite" role="status" className="mt-10 rounded-xl border border-dashed p-8">
    <h2 className="text-xl font-semibold">{subject} unavailable</h2>
    <p className="mt-2 max-w-2xl text-muted-foreground">{detail}</p>
  </section>
}

export function FilterBar({ children }: Readonly<{ children: ReactNode }>) {
  return <form className="mt-8 flex flex-wrap gap-3 rounded-xl border bg-card p-4" method="get">{children}<button className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" type="submit">Apply filters</button></form>
}

export function Tag({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="rounded-full bg-secondary px-3 py-1 text-xs">{children}</span>
}
