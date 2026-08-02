import type { Route } from 'next'
import Link from 'next/link'

/**
 * Vendor-stack consolidation, expressed as one editorial reduction rather than a dashboard.
 *
 * Seven categories remain visible because that is the truthful contrast. They are deliberately set
 * as quiet type—not cards, pills or fake vendor interfaces—so the eye lands on the one Fuma
 * workflow. Colours and effects come only from the semantic roles in globals.css.
 */

const VENDOR_CATEGORIES = [
  'Headless CMS',
  'Framework host',
  'Form service',
  'Media storage',
  'Image CDN',
  'Analytics vendor',
  'Auth provider',
] as const

const CONSOLIDATED_WORK = [
  ['Build', 'Canvas, components and design tokens'],
  ['Manage', 'Content, media, forms and access'],
  ['Publish', 'Draft, review and one path to live'],
] as const

export function StackCollapse() {
  return <section aria-labelledby="stack-collapse-title" className="section" data-fuma-stack-collapse>
    <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
      <div>
        <p className="eyebrow">The whole stack</p>
        <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="stack-collapse-title">
          One platform, not seven vendors.
        </h2>
      </div>
      <div className="lg:pb-1">
        <p className="max-w-lg text-lede text-muted-foreground text-pretty">
          Replace the handoffs, not just the logos. Design, content, media, forms, access and
          publishing stay in one Fuma workflow.
        </p>
        <Link
          className="control-secondary mt-6 inline-flex min-h-11 sm:min-h-0 sm:h-[2.125rem] items-center rounded-control px-4 text-sm font-medium transition-colors"
          href={'/features' as Route}
        >See the whole workflow</Link>
      </div>
    </div>

    {/* The section signature: one typographic reduction, with no nested cards or UI imitation. */}
    <div className="mt-12 border-y border-line-soft py-10 sm:py-14">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.82fr)_5rem_minmax(0,1.18fr)] lg:items-center lg:gap-12">
        <div>
          <div className="flex items-end gap-4">
            <p aria-hidden="true" className="font-display text-[clamp(5rem,12vw,9rem)] leading-[0.72] tracking-[-0.06em] text-muted-foreground">7</p>
            <p className="max-w-28 pb-1 text-sm leading-5 text-muted-foreground">separate services to reconcile</p>
          </div>
          <ul className="mt-9 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-2">
            {VENDOR_CATEGORIES.map((item) => <li
              className="text-sm text-muted-foreground line-through decoration-line-strong decoration-1"
              key={item}
            >{item}</li>)}
          </ul>
        </div>

        <div aria-hidden="true" className="hidden items-center lg:flex">
          <span className="h-px flex-1 bg-line-soft" />
          <span className="px-3 font-mono text-display-md text-signal-bright">→</span>
          <span className="h-px flex-1 bg-signal-line" />
        </div>

        <div className="border-t border-line-soft pt-9 lg:border-l lg:border-t-0 lg:py-3 lg:pl-12">
          <div className="flex items-end gap-4">
            <p aria-hidden="true" className="font-display text-[clamp(5rem,12vw,9rem)] leading-[0.72] tracking-[-0.06em]">1</p>
            <div className="pb-1">
              <p className="font-display text-display-md">Fuma</p>
              <p className="mt-1 text-sm text-muted-foreground">One workflow. One place to work.</p>
            </div>
          </div>

          <dl className="mt-10 grid gap-5 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {CONSOLIDATED_WORK.map(([label, detail]) => <div key={label}>
              <dt className="text-sm font-medium">{label}</dt>
              <dd className="mt-1.5 text-xs leading-5 text-muted-foreground">{detail}</dd>
            </div>)}
          </dl>
        </div>
      </div>
    </div>
  </section>
}
