import { ClaimList, CTA } from '@/components/public-sections'
import { FactStrip, SectionHead } from '@/components/section-kit'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'
import Link from 'next/link'

export const metadata = publicMetadata(
  'About',
  'Why Fuma brings visual building, content and publishing into one product.',
  '/about',
)

/**
 * Fuma's product story, told through the work that preceded it.
 *
 * The lineage rail is the page's signature: Motion.page and Core Framework are not decorative
 * founder credentials, but two concrete bodies of work whose lessons meet in Fuma. The rest of the
 * composition stays editorial and claim-bounded. Fuma is presented as a closed product built and
 * operated by Fuma, and the narrative stays at the product level.
 */

const lineage = [
  {
    name: 'Motion.page',
    role: 'Visual control',
    lesson: 'Animation tooling shaped around the way website professionals actually build.',
  },
  {
    name: 'Core Framework',
    role: 'Design systems',
    lesson: 'Colour, type, spacing and utility systems that stay coherent across a site.',
  },
  {
    name: 'Fuma',
    role: 'The whole workflow',
    lesson: 'Visual building, content, media, forms and publishing designed as one product.',
  },
] as const

const decisions = [
  ['Build one product', 'The canvas, content, media, forms and publisher share one workflow instead of handing the work from tool to tool.'],
  ['Treat output as product', 'What reaches a visitor deserves the same care as the interface used to make it: semantic structure, compact styles and no editor machinery.'],
  ['Put the system inside', 'Core Framework is wired into Fuma, so colour, type and spacing are part of the work rather than an add-on beside it.'],
  ['Say where the edge is', 'Commercial, identity and marketplace facts remain with their authoritative systems. The public site explains them without guessing.'],
] as const

const roadmap = [
  ['Real analytics', 'First-party and privacy-respecting, to round out the Analyze pillar.'],
  ['A bigger ecosystem', 'More first-party modules, more SDK surface and more examples worth copying.'],
  ['A sharper AI agent', 'More tools, with deeper awareness of the site it is helping to build.'],
  ['Everything tighter', 'Pre-1.0 is the right time to discard weak ideas and make the product more coherent.'],
] as const

export default function Page() {
  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="page-title" className="section fuma-bloom pt-16 sm:pt-24">
      <p className="eyebrow fuma-rise">About Fuma</p>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.18fr)_minmax(18rem,0.62fr)] lg:items-end lg:gap-20">
        <h1 className="fuma-rise max-w-[17ch] font-display text-display-xl text-balance" id="page-title">
          Fuma began as a question we could no longer ignore.
        </h1>
        <div className="fuma-rise lg:pb-1">
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">
            What if the visual builder, design system, content engine and publisher were shaped as
            one product from the beginning?
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <CTA prefetch={false} href="/contact">Talk to us</CTA>
            <CTA prefetch={false} href="/blog" secondary>Read our thinking</CTA>
          </div>
        </div>
      </div>

      {/* About-specific signature: a real product lineage, not an invented metric or UI mockup. */}
      <div className="fuma-rimlit mt-14 overflow-hidden rounded-surface bg-surface-inset sm:mt-16">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-4 sm:px-7">
          <p className="font-mono text-xs text-muted-foreground">Lessons carried forward</p>
          <p className="font-mono text-xs text-muted-foreground">Two bodies of work → one new product</p>
        </div>
        <ul className="grid lg:grid-cols-3">
          {lineage.map((item, index) => <li
            className="relative border-b border-line-soft p-5 last:border-b-0 sm:p-7 lg:border-b-0 lg:border-r lg:last:border-r-0"
            key={item.name}
          >
            <div className="mb-8 flex items-center gap-3" aria-hidden="true">
              <span className={`size-2 rounded-full ${index === lineage.length - 1 ? 'bg-signal-bright' : 'bg-diagram-node'}`} />
              <span className="h-px flex-1 bg-diagram-track" />
            </div>
            <p className="font-mono text-eyebrow uppercase text-muted-foreground">{item.role}</p>
            <h2 className="mt-3 font-display text-display-md">{item.name}</h2>
            <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">{item.lesson}</p>
          </li>)}
        </ul>
        <p className="border-t border-line-soft px-5 py-4 text-sm leading-6 text-muted-foreground sm:px-7">
          Not a corporate timeline. A record of what the team learned by building for website
          professionals, and what those lessons demanded next.
        </p>
      </div>
    </section>

    <FactStrip
      facts={[
        ['Motion.page', 'One of the team’s earlier products'],
        ['Core Framework', 'Built into Fuma’s design system'],
        ['0.0.x', 'The current product stage'],
        ['Closed product', 'Built and operated by Fuma'],
      ]}
    />

    <section className="section">
      <div className="grid gap-10 lg:grid-cols-[minmax(18rem,0.62fr)_minmax(0,1.18fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Who is behind this</p>
          <h2 className="font-display text-display-lg text-balance">We spent years making other platforms more bearable.</h2>
        </div>
        <div className="max-w-[68ch] border-l border-signal-line pl-6 sm:pl-10">
          <p className="font-display text-display-md text-balance">
            We are the team behind Motion.page and Core Framework — tools used by thousands of
            people who build websites for a living, mostly in the WordPress world.
          </p>
          <div className="mt-8 grid gap-6 text-base leading-7 text-muted-foreground sm:grid-cols-2 sm:gap-10">
            <p>
              Working inside an established platform taught us where visual tools help, where
              inherited constraints get in the way, and how much care the final page deserves.
            </p>
            <p>
              Eventually the question changed from “how do we improve this layer?” to “what would
              we build if every layer could be designed together?” Fuma is our answer.
            </p>
          </div>
        </div>
      </div>
    </section>

    <section className="section">
      <SectionHead
        eyebrow="Product decisions"
        lede="These are not values pinned to a wall. Each one changes what Fuma includes, how the parts meet and what we are willing to claim."
        title="The decisions underneath the product."
      />
      <dl className="mt-12 border-y border-line-soft">
        {decisions.map(([label, detail]) => <div
          className="grid gap-3 border-b border-line-soft py-7 last:border-b-0 sm:grid-cols-[minmax(12rem,0.48fr)_minmax(0,1fr)] sm:gap-12"
          key={label}
        >
          <dt className="font-display text-display-md">{label}</dt>
          <dd className="max-w-2xl text-sm leading-7 text-muted-foreground sm:pt-1">{detail}</dd>
        </div>)}
      </dl>
    </section>

    <section className="section">
      <ClaimList heading="What the product brings together" ids={['single-workflow']} />
    </section>

    <section className="section" aria-labelledby="early-title">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.48fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Early, on purpose</p>
          <h2 className="max-w-[18ch] font-display text-display-lg text-balance" id="early-title">
            The starting line is substantial. It is still the starting line.
          </h2>
        </div>
        <div className="lg:pb-1">
          <p className="text-lede text-muted-foreground text-pretty">
            Version 0.0.x already includes the canvas, content model, sandboxed plugins, forms,
            loops, templates, media, MFA, audit log and publisher. APIs and workflows can still shift.
          </p>
          <Link
            className="control-secondary mt-6 inline-flex h-[2.125rem] items-center rounded-control px-4 text-sm font-medium transition-colors"
            href="/changelog"
            prefetch={false}
          >See what shipped</Link>
        </div>
      </div>

      <dl className="mt-12 grid gap-px overflow-hidden rounded-surface border border-border bg-border sm:grid-cols-2">
        {roadmap.map(([label, detail]) => <div className="bg-background p-6 sm:p-7" key={label}>
          <dt className="font-display text-display-md">{label}</dt>
          <dd className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{detail}</dd>
        </div>)}
      </dl>
      <p className="mt-8 max-w-2xl text-sm leading-7 text-muted-foreground">
        If change before 1.0 makes you nervous, wait for 1.0 — no hard feelings. If you would rather
        help sharpen the product while its foundations can still move, now is the useful moment.
      </p>
    </section>

    <section className="section">
      <SectionHead eyebrow="Credit where it is due" title="Built with other people’s good work." />
      <p className="mt-8 max-w-2xl text-lede text-muted-foreground text-pretty">
        Fuma&rsquo;s interface uses{' '}
        <a
          className="font-medium text-foreground underline decoration-signal decoration-2 underline-offset-4"
          href="https://pixelarticons.com/"
          rel="noopener noreferrer"
          target="_blank"
        >Pixelarticons</a>{' '}
        by Gerrit Halfmann. Thanks to Gerrit for a genuinely distinctive icon set, and for kindly
        letting us use it in our product.
      </p>
    </section>

    <section className="section border-t border-border">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(18rem,0.52fr)] lg:items-end lg:gap-20">
        <h2 className="max-w-[18ch] font-display text-display-xl text-balance">Know the boundaries before you build.</h2>
        <div className="lg:pb-1">
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">
            Read Fuma&rsquo;s public security, privacy and data commitments before you put
            real work into the product. We would rather make the boundaries clear first.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <CTA prefetch={false} href="/trust">Visit the trust centre</CTA>
            <CTA prefetch={false} href="/contact" secondary>Talk to us</CTA>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Prefer the longer reasoning?{' '}
            <Link
              className="font-medium text-foreground underline decoration-signal decoration-2 underline-offset-4"
              href="/blog"
              prefetch={false}
            >Read our thinking</Link>.
          </p>
        </div>
      </div>
    </section>
  </PageMain>
}
