import type { Route } from 'next'
import Link from 'next/link'

/**
 * Platform architecture proof.
 *
 * This is deliberately not a bento or a fabricated product screenshot. It is a system map: five
 * working surfaces converge into one shared site, then leave through one publishing path. The
 * continuous signal bus is the section's signature and visually proves the claim in the heading.
 *
 * Every colour comes from semantic roles in globals.css. Components do not generate shades or
 * invent alpha values. Every product fact shown here is already shipped and documented.
 */

const INPUTS = [
  ['Design', 'Canvas and tokens'],
  ['Content', 'Pages and collections'],
  ['Media', 'Assets with usage'],
  ['Forms', 'Fields into tables'],
  ['Extensions', 'Permissioned tools'],
] as const

const CORE = [
  ['Design system', 'Colour, type, spacing'],
  ['Site structure', 'Pages, templates, components'],
  ['Content model', 'Posts, rows, submissions'],
  ['Access rules', '38 capabilities'],
] as const

const OUTPUT = [
  ['Draft', 'Private'],
  ['Review', 'Visible to the team'],
  ['Publish', 'Live'],
] as const

function SectionLabel({ children }: Readonly<{ children: string }>) {
  return <p className="font-mono text-eyebrow uppercase tracking-[0.14em] text-muted-foreground">{children}</p>
}

export function PlatformGrid() {
  return <section aria-labelledby="platform-title" className="section">
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.62fr)] lg:items-end">
      <div>
        <p className="eyebrow">Platform architecture</p>
        <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="platform-title">
          Not a stack. One platform.
        </h2>
      </div>
      <div className="lg:pb-1">
        <p className="max-w-lg text-lede text-muted-foreground text-pretty">
          Design, content, media, forms and publishing work on the same site. Nothing is exported to
          another tool just to finish the job.
        </p>
        <Link
          className="control-secondary mt-6 inline-flex min-h-11 sm:min-h-0 sm:h-[2.125rem] items-center rounded-control px-4 text-sm font-medium transition-colors"
          href={'/features' as Route}
        >See everything inside</Link>
      </div>
    </div>

    <div className="fuma-rimlit mt-12 overflow-hidden rounded-surface bg-surface-inset">
      {/* One quiet header establishes this as an architecture diagram, not a UI mockup. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-4 sm:px-7">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="size-2 rounded-full bg-signal-bright" />
          <span className="font-mono text-xs text-muted-foreground">One shared site</span>
        </div>
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted-foreground">Design → publish</span>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.3fr)_minmax(0,0.88fr)]">
        {/* Inputs are channels, not cards: each line feeds the same central bus. */}
        <div className="border-b border-line-soft p-5 sm:p-7 lg:border-b-0 lg:border-r">
          <SectionLabel>Working surfaces</SectionLabel>
          <ul className="mt-6 grid gap-1">
            {INPUTS.map(([label, detail]) => <li
              className="relative grid grid-cols-[minmax(0,0.68fr)_minmax(0,1fr)] items-center gap-3 border-b border-line-soft py-3 last:border-b-0 lg:after:absolute lg:after:-right-7 lg:after:top-1/2 lg:after:h-px lg:after:w-7 lg:after:bg-signal-line"
              key={label}
            >
              <span className="text-sm font-medium">{label}</span>
              <span className="text-right text-xs leading-5 text-muted-foreground">{detail}</span>
            </li>)}
          </ul>
        </div>

        {/* The shared core is one continuous surface; internal rules show one model, not modules. */}
        <div className="relative border-b border-line-soft p-5 sm:p-7 lg:border-b-0 lg:border-r">
          <div aria-hidden="true" className="absolute inset-y-0 left-0 hidden w-px bg-signal-line lg:block" />
          <SectionLabel>Shared core</SectionLabel>
          <div className="mt-6 overflow-hidden rounded-panel border border-signal-line bg-signal-soft">
            <div className="border-b border-signal-line px-5 py-5 sm:px-6">
              <p className="font-display text-display-md">Fuma</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                One site carries the design, the data and every publishing state.
              </p>
            </div>
            <dl className="grid sm:grid-cols-2">
              {CORE.map(([label, detail], index) => <div
                className={`p-5 sm:p-6 ${index < 2 ? 'border-b border-line-soft' : ''} ${index % 2 === 0 ? 'sm:border-r sm:border-line-soft' : ''}`}
                key={label}
              >
                <dt className="text-sm font-medium">{label}</dt>
                <dd className="mt-1.5 text-xs leading-5 text-muted-foreground">{detail}</dd>
              </div>)}
            </dl>
          </div>

          <div className="mt-5">
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">One token propagates everywhere</p>
            <div aria-hidden="true" className="mt-3 grid h-2 grid-cols-5 overflow-hidden rounded-full">
              <span className="bg-signal-tone-1" />
              <span className="bg-signal-tone-2" />
              <span className="bg-signal-tone-3" />
              <span className="bg-signal-tone-4" />
              <span className="bg-signal-tone-5" />
            </div>
          </div>
        </div>

        {/* Output is an actual ordered state transition, so a sequence is truthful here. */}
        <div className="p-5 sm:p-7">
          <SectionLabel>Publishing path</SectionLabel>
          <ol className="mt-6 grid gap-0">
            {OUTPUT.map(([label, detail], index) => <li className="relative flex gap-4 pb-6 last:pb-0" key={label}>
              <div className="relative flex w-3 shrink-0 justify-center">
                <span className={`relative z-10 mt-1.5 size-2 rounded-full ${index === OUTPUT.length - 1 ? 'bg-live' : 'bg-signal-bright'}`} />
                {index < OUTPUT.length - 1 && <span aria-hidden="true" className="absolute bottom-0 top-3 w-px bg-diagram-track" />}
              </div>
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
              </div>
            </li>)}
          </ol>

          <div className="mt-7 rounded-panel border border-live-line bg-live-soft p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-live" />
              Published page
            </p>
            <dl className="mt-4 grid gap-2 border-t border-live-line pt-4 font-mono text-[0.7rem] text-muted-foreground">
              <div className="flex justify-between gap-3"><dt>HTML</dt><dd>semantic</dd></div>
              <div className="flex justify-between gap-3"><dt>CSS</dt><dd>compact</dd></div>
              <div className="flex justify-between gap-3"><dt>runtime</dt><dd>1.1 kB when needed</dd></div>
            </dl>
          </div>
        </div>
      </div>

      {/* The single bus closes the map and carries the section's one-sentence proof. */}
      <div className="grid gap-px border-t border-line-soft bg-line-soft sm:grid-cols-3">
        {[
          ['One canvas', 'Several breakpoints, edited together'],
          ['One content model', 'Pages, posts and custom tables'],
          ['One publish action', 'Draft to live without a handoff'],
        ].map(([label, detail]) => <div className="bg-background px-5 py-4 sm:px-7" key={label}>
          <p className="text-sm font-medium">{label}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
        </div>)}
      </div>
    </div>
  </section>
}
