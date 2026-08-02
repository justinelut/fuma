import type { Route } from 'next'
import { NativeImage } from '@/components/native-image'
import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Section primitives for the public marketing site.
 *
 * All measurements come from docs/reference/fuma-web-design-system.md. The `.section` class
 * supplies the single container width and vertical rhythm, so no component sets its own.
 *
 * Product imagery must be a real capture of the running Studio from `public/product/`.
 * Hand-built HTML imitations of product UI are not permitted.
 */

export function Eyebrow({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="eyebrow">{children}</p>
}

/** Section heading plus optional lede and action, sharing one measured treatment. */
export function SectionHead({
  action,
  eyebrow,
  lede,
  title,
}: Readonly<{
  action?: Readonly<{ href: Route; label: string }>
  eyebrow?: string
  lede?: string
  title: string
}>) {
  return <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
    <div className="max-w-2xl">
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="font-display text-display-lg text-balance">{title}</h2>
      {lede && <p className="mt-5 max-w-xl text-lede text-muted-foreground text-pretty">{lede}</p>}
    </div>
    {action && <Link
      className="inline-flex min-h-11 sm:min-h-0 sm:h-[2.125rem] shrink-0 items-center rounded-control bg-secondary px-3.5 text-sm font-medium transition-colors hover:bg-input"
      href={action.href}
    >{action.label}</Link>}
  </div>
}

/**
 * A real screenshot of the running Studio, framed as a product window.
 * `caption` states plainly that it is the actual interface.
 */
export function ProductShot({
  alt,
  caption,
  priority = false,
  src,
}: Readonly<{ alt: string; caption?: string; priority?: boolean; src: string }>) {
  return <figure className="min-w-0">
    <div className="fuma-rimlit overflow-hidden rounded-surface bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-live" />
        <span className="font-mono text-xs text-muted-foreground">Fuma Studio</span>
      </div>
      {/* Already exported at 1600px and compressed, so Next's optimiser is bypassed. */}
      <NativeImage
        alt={alt}
        className="block h-auto w-full"
        height={1000}
        priority={priority}
        sizes="(min-width: 1024px) 60vw, 100vw"
        src={src}
        unoptimized
        width={1600}
      />
    </div>
    {caption && <figcaption className="mt-3 font-mono text-xs text-muted-foreground">{caption}</figcaption>}
  </figure>
}

/**
 * One capability, told as text beside a real screenshot. Alternating sides keeps a long page
 * from marching; the reference sites all alternate rather than repeating one orientation.
 */
export function CapabilitySection({
  bullets,
  caption,
  eyebrow,
  href,
  image,
  imageAlt,
  lede,
  linkLabel,
  reverse = false,
  title,
}: Readonly<{
  bullets?: readonly string[]
  caption?: string
  eyebrow: string
  href: Route
  image: string
  imageAlt: string
  lede: string
  linkLabel: string
  reverse?: boolean
  title: string
}>) {
  return <section className="section" data-fuma-capability>
    <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
      <div className={reverse ? 'lg:order-2' : undefined}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="max-w-xl font-display text-display-lg text-balance">{title}</h2>
        <p className="mt-5 max-w-lg text-lede text-muted-foreground text-pretty">{lede}</p>
        {bullets && <ul className="mt-7 grid gap-3 border-t border-border pt-7">
          {bullets.map((item) => <li className="flex gap-3 text-sm leading-6 text-muted-foreground" key={item}>
            <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-signal-bright" />
            {item}
          </li>)}
        </ul>}
        <Link
          className="mt-8 inline-flex items-center gap-2 border-b border-signal/50 pb-0.5 text-sm font-medium transition-colors hover:border-signal-bright"
          href={href}
        >
          {linkLabel}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className={reverse ? 'lg:order-1' : undefined}>
        <ProductShot alt={imageAlt} caption={caption} src={image} />
      </div>
    </div>
  </section>
}

/** Compact fact strip. Only verifiable product facts — never invented metrics. */
export function FactStrip({ facts }: Readonly<{ facts: readonly (readonly [string, string])[] }>) {
  return <section className="section !py-0">
    <dl className="grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
      {facts.map(([value, label]) => <div className="bg-background px-5 py-6" key={label}>
        <dt className="font-display text-display-md">{value}</dt>
        <dd className="mt-1.5 text-sm leading-6 text-muted-foreground">{label}</dd>
      </div>)}
    </dl>
  </section>
}

/**
 * A capability told the way the reference sites actually tell one.
 *
 * Measured across framer.com and vercel.com at 1440px: NEITHER uses a two-column text-beside-image
 * split anywhere on its homepage (0 occurrences). Their anchor pattern is a text block above a
 * near-full-bleed visual — framer's hero media is 1200px of a 1440 viewport (83%), vercel's run
 * 921-1165px (64-81%) — with multi-column grids used for enumeration instead. The alternating
 * left/right pattern this replaces is the agency-template look, not the SaaS one.
 */
export function ShowcaseSection({
  caption,
  eyebrow,
  href,
  image,
  imageAlt,
  lede,
  linkLabel,
  specs,
  title,
}: Readonly<{
  caption?: string
  eyebrow: string
  href: Route
  image?: string
  imageAlt?: string
  lede: string
  linkLabel: string
  specs?: readonly (readonly [string, string])[]
  title: string
}>) {
  return <section className="section" data-fuma-showcase>
    <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
      <div className="max-w-2xl">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="font-display text-display-lg text-balance">{title}</h2>
        <p className="mt-5 max-w-xl text-lede text-muted-foreground text-pretty">{lede}</p>
      </div>
      <Link
        className="inline-flex min-h-11 sm:min-h-0 sm:h-[2.125rem] shrink-0 items-center control-secondary rounded-control px-4 text-sm font-medium transition-colors"
        href={href}
      >{linkLabel}</Link>
    </div>

    {specs && <dl className="mt-10 grid gap-x-10 gap-y-5 border-t border-border pt-6 sm:grid-cols-2 lg:grid-cols-4">
      {specs.map(([label, detail]) => <div key={label}>
        <dt className="text-sm font-medium">{label}</dt>
        <dd className="mt-1.5 text-sm leading-6 text-muted-foreground">{detail}</dd>
      </div>)}
    </dl>}

    {/* Near-full-bleed: the visual fills the container rather than sharing a row with the copy.
        Omitted when the page already shows that surface — repeating one screenshot reads as filler. */}
    {image && <div className="fuma-pool mt-14 sm:mt-16">
      <ProductShot alt={imageAlt ?? ''} caption={caption} src={image} />
    </div>}
  </section>
}

/**
 * Enumeration grid. The reference sites carry capability lists in 3-, 4- and 12-column grids rather
 * than repeating a hero-sized block per item, which is what kept their pages from marching.
 */
export function CapabilityGrid({
  columns = 4,
  eyebrow,
  items,
  lede,
  title,
}: Readonly<{
  columns?: 3 | 4
  eyebrow: string
  items: readonly Readonly<{ body: string; href: Route; linkLabel: string; title: string }>[]
  lede?: string
  title: string
}>) {
  return <section className="section">
    <SectionHead eyebrow={eyebrow} lede={lede} title={title} />
    <ul className={`mt-12 grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-2 ${columns === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
      {items.map((item) => <li className="bg-background" key={item.title}>
        <Link className="group flex h-full flex-col gap-3 p-6 transition-colors hover:bg-secondary/40 sm:p-7" href={item.href}>
          <p className="font-display text-display-md">{item.title}</p>
          <p className="text-sm leading-6 text-muted-foreground">{item.body}</p>
          <span className="mt-auto inline-flex items-center gap-2 pt-4 text-sm font-medium">
            {item.linkLabel}
            <span aria-hidden="true" className="text-signal-bright transition-transform group-hover:translate-x-0.5">&rarr;</span>
          </span>
        </Link>
      </li>)}
    </ul>
  </section>
}
