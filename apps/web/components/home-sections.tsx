import type { Route } from 'next'
import { NativeImage } from '@/components/native-image'
import Link from 'next/link'
import { Eyebrow } from '@/components/section-kit'

/**
 * Remaining homepage sections: how a site ships, where it can run, what surrounds the product,
 * and the ownership argument.
 *
 * Every figure is traceable to the codebase or the deployment docs. No uptime numbers, customer
 * counts, performance scores or logos appear anywhere — see the forbidden-pattern list in
 * docs/reference/fuma-web-design-system.md.
 */

/** Publishing is a genuine sequence, so ordered markers are appropriate here. */
const releaseStages = [
  ['Draft', 'Edit on the real canvas. Unpublished changes never leak to a visitor.'],
  ['Reviewed release', 'Publishing bakes static pages to disk and swaps them atomically.'],
  ['Public page', 'Semantic HTML and compact CSS. Rollback and version history stay yours.'],
] as const

const cacheLayers = [
  ['Baked to disk', 'Pages are written on publish and swapped in atomically. Visitors are served a file, not a render.'],
  ['Versioned cache', 'Routes that genuinely change hit an in-memory cache. Publishing bumps the version, so nobody sees a stale page.'],
  ['1.1 kB runtime', 'The few truly per-visitor parts are detected automatically and lazy-loaded. Smaller than this paragraph.'],
] as const

export function PublishingSection() {
  return <section className="section" data-fuma-publishing>
    <div className="max-w-2xl">
      <Eyebrow>Publishing</Eyebrow>
      <h2 className="font-display text-display-lg text-balance">Fast because there is almost nothing to load.</h2>
      <p className="mt-5 text-lede text-muted-foreground text-pretty">
        Speed here is not a setting you tune. It falls out of how publishing works, in three layers
        you never have to think about.
      </p>
    </div>

    <ol className="mt-12 grid gap-px overflow-hidden rounded-panel border border-border bg-border lg:grid-cols-3">
      {releaseStages.map(([stage, detail], index) => <li className="bg-background p-6 sm:p-7" key={stage}>
        <p className="font-mono text-eyebrow uppercase text-signal-bright">{`Stage ${index + 1}`}</p>
        <p className="mt-4 font-display text-display-md">{stage}</p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{detail}</p>
      </li>)}
    </ol>

    {/* Each layer carries a miniature of what it actually does, rather than a paragraph about it. */}
    <dl className="mt-10 grid gap-px overflow-hidden rounded-panel border border-border bg-border pt-0 lg:grid-cols-3">
      {cacheLayers.map(([label, detail], index) => <div className="bg-background p-6 sm:p-7" key={label}>
        <dt className="font-medium">{label}</dt>
        <div className="mt-4">
          {index === 0 && <ul className="grid gap-px overflow-hidden rounded-lg border border-border/70 bg-border/40">
            {[['/', 'index.html'], ['/work', 'index.html'], ['/journal', 'index.html']].map(([route, file]) => <li className="flex items-center justify-between gap-3 bg-card px-3 py-2 text-[0.78rem]" key={route}>
              <span className="font-mono text-foreground/80">{route}</span>
              <span className="font-mono text-[0.7rem] text-muted-foreground">{file}</span>
            </li>)}
          </ul>}
          {index === 1 && <ul className="grid gap-px overflow-hidden rounded-lg border border-border/70 bg-border/40">
            {[['cache v41', 'stale'], ['publish', 'bump'], ['cache v42', 'current']].map(([left, right]) => <li className="flex items-center justify-between gap-3 bg-card px-3 py-2 text-[0.78rem]" key={left}>
              <span className="font-mono text-foreground/80">{left}</span>
              <span className="font-mono text-[0.7rem] text-muted-foreground">{right}</span>
            </li>)}
          </ul>}
          {index === 2 && <div className="rounded-lg border border-border/70 bg-card p-4">
            <p className="font-display text-[2rem] leading-none">1.1 kB</p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-border">
              <div className="h-full w-[3%] rounded-full bg-signal-bright" />
            </div>
            <p className="mt-2 font-mono text-[0.7rem] text-muted-foreground">per-visitor parts only</p>
          </div>}
        </div>
        <dd className="mt-4 text-sm leading-6 text-muted-foreground">{detail}</dd>
      </div>)}
    </dl>
  </section>
}



/** Ecosystem routes. The homepage names what each surface is for; detail routes carry evidence. */
const ecosystem = [
  ['/templates', 'Templates', 'Reviewed starting points, pinned to the release you inspect.'],
  ['/components', 'Component packs', 'Reusable presentation pieces with version-specific review evidence.'],
  ['/plugins', 'Plugins', 'Sandboxed extensions with publisher and permission labels in view.'],
  ['/experts', 'Experts', 'People and studios listed with current, approved public work.'],
  ['/showcase', 'Showcase', 'Consent-backed work that disappears when approval is withdrawn.'],
] as const

export function EcosystemSection() {
  return <section aria-labelledby="ecosystem-title" className="section" data-fuma-ecosystem>
    <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
      <div>
        <p className="eyebrow">Around the product</p>
        <h2 className="max-w-[17ch] font-display text-display-lg text-balance" id="ecosystem-title">
          A smaller, more considered ecosystem.
        </h2>
      </div>
      <p className="max-w-lg text-lede text-muted-foreground text-pretty lg:pb-1">
        Start from reviewed releases, extend the product with permissions in view, and discover work
        that is published only with current approval.
      </p>
    </div>

    {/* Authentic capture first. The adjacent copy explains it; it does not imitate product UI. */}
    <div className="mt-12 grid overflow-hidden rounded-surface border border-line-soft bg-line-soft lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.55fr)] lg:gap-px">
      <figure className="bg-card p-4 sm:p-6">
        <div className="fuma-rimlit overflow-hidden rounded-panel bg-surface-inset">
          <div className="flex items-center justify-between gap-4 border-b border-line-soft px-4 py-3">
            <span className="font-mono text-xs text-muted-foreground">Fuma Studio</span>
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted-foreground">Plugins</span>
          </div>
          <NativeImage
            alt="The Plugins workspace in Fuma Studio, with an Upload Plugin control and no plugins installed"
            className="block h-auto w-full"
            height={1000}
            sizes="(min-width: 1024px) 68vw, 100vw"
            src="/product/plugins.webp"
            unoptimized
            width={1600}
          />
        </div>
        <figcaption className="mt-3 font-mono text-xs text-muted-foreground">
          The real Plugins workspace in Fuma Studio.
        </figcaption>
      </figure>

      <div className="flex flex-col justify-between gap-10 bg-background p-6 sm:p-8 lg:p-10">
        <div>
          <p className="font-mono text-eyebrow uppercase tracking-[0.14em] text-signal-bright">Extensions, with context</p>
          <h3 className="mt-5 max-w-[12ch] font-display text-display-md text-balance">See what it is allowed to do.</h3>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Backend plugins run in a QuickJS-WASM sandbox. Publisher, exact version and requested
            permissions stay visible before installation.
          </p>
        </div>
        <Link
          className="group inline-flex items-center gap-2 text-sm font-medium"
          href={'/plugins' as Route}
        >
          Explore plugins
          <span aria-hidden="true" className="text-signal-bright transition-transform group-hover:translate-x-0.5">→</span>
        </Link>
      </div>
    </div>

    {/* A route index, not five miniature compliance dashboards. */}
    <ul className="mt-8 border-t border-line-soft">
      {ecosystem.map(([href, title, body]) => <li className="border-b border-line-soft" key={href}>
        <Link
          className="group grid gap-2 py-5 transition-colors hover:text-signal-bright sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-baseline sm:gap-8"
          href={href as Route}
        >
          <span className="font-medium text-foreground">{title}</span>
          <span className="max-w-2xl text-sm leading-6 text-muted-foreground">{body}</span>
          <span aria-hidden="true" className="hidden text-signal-bright transition-transform group-hover:translate-x-0.5 sm:inline">→</span>
        </Link>
      </li>)}
    </ul>
  </section>
}
