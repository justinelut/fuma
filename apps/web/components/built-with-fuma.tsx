import type { Route } from 'next'
import { NativeImage } from '@/components/native-image'
import Link from 'next/link'

/**
 * "This is what comes out."
 *
 * The image is not a mockup or a stock photograph: it is the rendered output of the studio site
 * built on the canvas shown earlier on this page, captured from the product. That makes it the one
 * piece of imagery here that simultaneously demonstrates the editor, the design system and the
 * clean-output claim.
 *
 * The page is otherwise typographic, so this section carries a warm glow and a full-bleed frame to
 * give the composition a visual centre of gravity.
 */

const OUTPUT_FACTS = [
  ['Semantic HTML', 'Headings, lists and figures, not nested divs'],
  ['Compact CSS', 'Generated from the tokens you set'],
  ['No editor runtime', 'Nothing from the canvas rides along'],
] as const

export function BuiltWithFuma() {
  return <section className="section fuma-pool" data-fuma-output>
    <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
      <div className="max-w-2xl">
        <p className="eyebrow">The result</p>
        <h2 className="font-display text-display-lg text-balance">This is what comes out.</h2>
        <p className="mt-5 max-w-xl text-lede text-muted-foreground text-pretty">
          The same studio site from the canvas above, rendered. Warm materials, an editorial measure
          and a project grid — none of it assembled from a template, and none of the editor left
          behind in the page.
        </p>
      </div>
      <Link
        className="inline-flex min-h-11 sm:min-h-0 sm:h-[2.125rem] shrink-0 items-center control-secondary rounded-control px-4 text-sm font-medium transition-colors"
        href={'/showcase' as Route}
      >See public work</Link>
    </div>

    <div className="mt-12 grid min-w-0 gap-px overflow-hidden rounded-surface border border-border bg-border lg:grid-cols-[minmax(0,1fr)_minmax(0,0.42fr)]">
      {/* A browser frame, so it reads as a shipped page rather than a screenshot of an app. */}
      <div className="min-w-0 bg-card p-4 sm:p-6">
        <div className="fuma-rimlit min-w-0 overflow-hidden rounded-panel bg-code-surface">
          <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-surface-active" />
            <span aria-hidden="true" className="size-1.5 rounded-full bg-surface-active" />
            <span aria-hidden="true" className="size-1.5 rounded-full bg-surface-active" />
            <span className="ml-2 truncate font-mono text-xs text-muted-foreground">atelier-nia.co.ke</span>
          </div>
          {/* Tall output cropped to its opening screens; the full page continues below the fold. */}
          <div className="max-h-[34rem] overflow-hidden">
            <NativeImage
              alt="The rendered Atelier Nia studio site: an editorial hero reading Rooms that keep the afternoon, a credentials row, and a selected-work grid"
              className="block h-auto w-full"
              height={2392}
              sizes="(min-width: 1024px) 62vw, 100vw"
              src="/product/built-with-fuma.webp"
              unoptimized
              width={1440}
            />
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col justify-between gap-8 bg-background p-5 sm:p-7">
        <dl className="grid gap-6">
          {OUTPUT_FACTS.map(([label, detail]) => <div key={label}>
            <dt className="text-[0.9375rem] font-medium">{label}</dt>
            <dd className="mt-1.5 text-[0.8125rem] leading-6 text-muted-foreground">{detail}</dd>
          </div>)}
        </dl>
        <div className="rounded-panel border border-border/70 bg-card p-4">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground">Built on the canvas above</p>
          <p className="mt-2 text-[0.8125rem] leading-6 text-muted-foreground">
            Same site, same session — the editor screenshot and this page are the two ends of one
            workflow.
          </p>
        </div>
      </div>
    </div>
  </section>
}
