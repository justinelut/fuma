import { ClaimList, CTA } from '@/components/public-sections'
import { ProductShot } from '@/components/section-kit'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'
import { NativeImage } from '@/components/native-image'
import Link from 'next/link'

export const metadata = publicMetadata('Website builder', 'Design, manage and publish an independent website.', '/website')

const journey = [
  {
    detail: 'Arrange containers, text, images, buttons, video, lists, links, SVG and forms on a real canvas.',
    label: 'Shape',
  },
  {
    detail: 'Set colour, type and spacing once, then let the same design language carry across every page.',
    label: 'Systemise',
  },
  {
    detail: 'Connect pages, custom collections, media and form submissions without leaving the product.',
    label: 'Structure',
  },
  {
    detail: 'Publish semantic HTML and compact CSS without sending the editor interface along with it.',
    label: 'Release',
  },
] as const

const siteTypes = [
  ['Portfolios', 'Show the work with real typographic control rather than a template you fight.'],
  ['Service businesses', 'Keep pages, enquiry forms and site-owned submissions in one workflow.'],
  ['Campaigns', 'Build a focused site, then retire it or reshape it when the work changes.'],
  ['Organisations', 'Give shared editing a clear structure with roles, review states and audit history.'],
  ['Content-rich sites', 'Define custom collections once, then let loops render them wherever they belong.'],
  ['Anything you invent', 'Create your own tables and treat their rows as first-class site content.'],
] as const

/**
 * The Website journey is composed around a real before-and-after: the Atelier Nia page in Fuma
 * Studio, its structured content, and the resulting public page. Product evidence carries the
 * visual signature; the surrounding typography explains the sequence without imitating product UI.
 */
export default function Page() {
  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="page-title" className="section fuma-glow !pb-0 pt-16 sm:pt-24">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.62fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow fuma-rise">Website journey</p>
          <h1 className="fuma-rise max-w-[15ch] font-display text-display-xl text-balance" id="page-title">
            Build the site. Keep the craft.
          </h1>
        </div>
        <div className="lg:pb-1">
          <p className="fuma-rise max-w-xl text-lede text-muted-foreground text-pretty">
            Choose this path for a portfolio, service business, campaign, organisation or
            content-rich website. It gives you a useful starting surface without deciding what
            your site is allowed to become.
          </p>
          <div className="fuma-rise mt-8 flex flex-wrap items-center gap-2.5">
            <CTA href="/start?kind=create_site&source=product&profile=website">Create a website</CTA>
            <CTA href="/publication" secondary>Compare Publication</CTA>
          </div>
        </div>
      </div>

      <div className="fuma-pool mt-14 sm:mt-20">
        <ProductShot
          alt="The Fuma Site workspace showing the Atelier Nia page in mobile and desktop breakpoint frames"
          caption="The real Fuma Studio canvas. Mobile and desktop frames show the same Atelier Nia page side by side."
          priority
          src="/product/site.webp"
        />
      </div>

      <dl className="mt-8 grid border-y border-border sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Several frames', 'Edit breakpoints together on one canvas'],
          ['One token set', 'Colour, type and spacing generated from your choices'],
          ['One content model', 'Pages, rows and submissions in one structured system'],
          ['1.1 kB', 'The only runtime a visitor loads, when a page needs it'],
        ].map(([value, detail], index) => <div
          className="border-b border-border py-5 sm:px-5 sm:first:pl-0 sm:[&:nth-child(2)]:border-l lg:border-b-0 lg:border-l lg:first:border-l-0 lg:last:pr-0"
          key={value}
        >
          <dt className="font-display text-xl">{value}</dt>
          <dd className="mt-1.5 max-w-[28ch] text-sm leading-6 text-muted-foreground">{detail}</dd>
          <span className="sr-only">Journey fact {index + 1}</span>
        </div>)}
      </dl>
    </section>

    <section aria-labelledby="website-journey" className="section">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)] lg:gap-24">
        <div>
          <p className="eyebrow">From first frame to public page</p>
          <h2 className="max-w-[14ch] font-display text-display-lg text-balance" id="website-journey">
            One continuous making process.
          </h2>
        </div>
        <p className="max-w-xl text-lede text-muted-foreground text-pretty lg:pt-7">
          The work does not jump between a page builder, a design-token utility, a form vendor and
          a separate publisher. Each stage remains part of the same Website journey.
        </p>
      </div>

      <ol className="mt-14 grid border-t border-border md:grid-cols-2 lg:grid-cols-4">
        {journey.map((item, index) => <li
          className="relative border-b border-border py-7 md:px-6 md:[&:nth-child(even)]:border-l lg:border-b-0 lg:border-l lg:first:border-l-0 lg:first:pl-0 lg:last:pr-0"
          key={item.label}
        >
          <p className="font-mono text-xs uppercase tracking-widest text-signal-bright">
            {String(index + 1).padStart(2, '0')} / {String(journey.length).padStart(2, '0')}
          </p>
          <h3 className="mt-5 font-display text-display-md">{item.label}</h3>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.detail}</p>
        </li>)}
      </ol>
    </section>

    <section aria-labelledby="canvas-beyond" className="section border-y border-border">
      <div className="grid gap-14 lg:grid-cols-[minmax(0,0.86fr)_minmax(20rem,0.74fr)] lg:gap-24">
        <div>
          <p className="eyebrow">Compose</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="canvas-beyond">
            The canvas is only the beginning.
          </h2>
          <p className="mt-6 max-w-xl text-lede text-muted-foreground text-pretty">
            Put breakpoint frames side by side, edit them together, or switch to live mode and work
            on the real full-size page. Build reusable visual components with typed parameters and
            named slots when a pattern needs to travel.
          </p>
          <div className="mt-9 flex flex-wrap gap-2.5">
            <CTA href="/features" secondary>See the complete workflow</CTA>
            <CTA href="/templates" secondary>Browse templates</CTA>
          </div>
        </div>

        <div className="border-t border-border">
          {[
            ['Responsive by view', 'Change the desktop frame and see the mobile frame respond in the same working view.'],
            ['Reusable by design', 'Edit a visual component once and every instance using it can follow.'],
            ['Safe by structure', 'Components that would reference themselves are blocked before they create a cycle.'],
          ].map(([label, detail]) => <div className="grid gap-2 border-b border-border py-6 sm:grid-cols-[9rem_1fr] sm:gap-6" key={label}>
            <h3 className="text-sm font-medium">{label}</h3>
            <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
          </div>)}
        </div>
      </div>
    </section>

    <section aria-labelledby="design-language" className="section">
      <div className="flex flex-wrap items-end justify-between gap-x-16 gap-y-8">
        <div className="max-w-2xl">
          <p className="eyebrow">Design system</p>
          <h2 className="font-display text-display-lg text-balance" id="design-language">
            A visual language that changes as one.
          </h2>
        </div>
        <p className="max-w-md text-lede text-muted-foreground text-pretty">
          Core Framework is built into Fuma, so the system behind the page is part of the work—not
          a plugin sitting beside it.
        </p>
      </div>

      <div className="mt-14 grid gap-px overflow-hidden rounded-panel border border-border bg-border md:grid-cols-3">
        {[
          ['Colour', 'Define a brand colour and generate its tuned shade scale from the same source.'],
          ['Type and space', 'Use fluid, mathematical scales instead of maintaining dozens of disconnected values.'],
          ['Utilities', 'Emit locked classes into one compact framework.css, then update every use from the token.'],
        ].map(([label, detail]) => <article className="bg-background p-7 sm:p-8" key={label}>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">System layer</p>
          <h3 className="mt-12 font-display text-display-md">{label}</h3>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">{detail}</p>
        </article>)}
      </div>
    </section>

    <section aria-labelledby="content-structure" className="section">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)] lg:items-end lg:gap-24">
        <div>
          <p className="eyebrow">Structure</p>
          <h2 className="max-w-[17ch] font-display text-display-lg text-balance" id="content-structure">
            Content takes the shape the site needs.
          </h2>
        </div>
        <p className="max-w-xl text-lede text-muted-foreground text-pretty">
          Pages, custom collections and form submissions use the same structured content system.
          Define the information once, then place it wherever the design calls for it.
        </p>
      </div>

      <div className="mt-14">
        <ProductShot
          alt="The Fuma Data workspace showing the Pages table and its structured fields"
          caption="The real Data workspace. The Atelier Nia home page appears as structured content with its fields visible."
          src="/product/data.webp"
        />
      </div>

      <div className="mt-10 grid gap-8 border-t border-border pt-8 md:grid-cols-3">
        {[
          ['Pages', 'Keep the page tree and its structured fields connected to the canvas.'],
          ['Collections', 'Model services, projects, people or any recurring content, then render it through loops.'],
          ['Forms', 'Place semantic fields and let Fuma create the matching table for the submissions.'],
        ].map(([label, detail]) => <div key={label}>
          <h3 className="font-display text-xl">{label}</h3>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{detail}</p>
        </div>)}
      </div>
    </section>

    <section aria-labelledby="published-result" className="border-y border-border bg-card">
      <div className="section">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)] lg:items-end lg:gap-24">
          <div>
            <p className="eyebrow">Release</p>
            <h2 className="max-w-[16ch] font-display text-display-lg text-balance" id="published-result">
              The editor stops at Publish.
            </h2>
          </div>
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">
            What the visitor receives is the site itself: semantic HTML, compact CSS and none of
            the Studio interface used to make it.
          </p>
        </div>

        <figure className="mt-14">
          <div className="fuma-rimlit overflow-hidden rounded-surface bg-background">
            <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-2.5">
              <span className="font-mono text-xs text-muted-foreground">Published page</span>
              <span className="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-live" />
                Rendered output
              </span>
            </div>
            <div className="relative h-[32rem] sm:h-[42rem] lg:h-[48rem]">
              <NativeImage
                alt="The published Atelier Nia website rendered as a clean public page"
                className="object-cover object-top"
                fill
                sizes="(min-width: 1280px) 1280px, 100vw"
                src="/product/built-with-fuma.webp"
                unoptimized
              />
            </div>
          </div>
          <figcaption className="mt-3 font-mono text-xs text-muted-foreground">
            The real rendered Atelier Nia output—the same page shown earlier inside Fuma Studio.
          </figcaption>
        </figure>

        <dl className="mt-10 grid gap-8 border-t border-border pt-8 md:grid-cols-3">
          {[
            ['Semantic HTML', 'Readable structure without builder attributes or editor machinery.'],
            ['Compact CSS', 'The page carries the styles it needs, including the generated framework.'],
            ['Runtime only when needed', 'Per-visitor parts are detected and loaded through the 1.1 kB runtime.'],
          ].map(([label, detail]) => <div key={label}>
            <dt className="text-sm font-medium">{label}</dt>
            <dd className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</dd>
          </div>)}
        </dl>
      </div>
    </section>

    <section aria-labelledby="sites-people-ship" className="section">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)] lg:gap-24">
        <div>
          <p className="eyebrow">A useful starting point</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="sites-people-ship">
            Built for the sites people actually ship.
          </h2>
        </div>
        <div>
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">
            The Website path starts with the right working surface. It does not fork the product or
            lock away capabilities you may need later.
          </p>
          <div className="mt-8">
            <CTA href="/showcase" secondary>See public work</CTA>
          </div>
        </div>
      </div>

      <dl className="mt-14 border-t border-border">
        {siteTypes.map(([label, detail]) => <div
          className="grid gap-3 border-b border-border py-6 sm:grid-cols-[minmax(12rem,0.65fr)_minmax(0,1fr)] sm:items-baseline sm:gap-10"
          key={label}
        >
          <dt className="font-display text-display-md">{label}</dt>
          <dd className="max-w-2xl text-sm leading-6 text-muted-foreground">{detail}</dd>
        </div>)}
      </dl>
    </section>

    <section className="section border-t border-border !pb-0">
      <div className="grid gap-14 lg:grid-cols-[minmax(0,0.86fr)_minmax(20rem,0.74fr)] lg:items-start lg:gap-24">
        <div>
          <p className="eyebrow">Your next page</p>
          <h2 className="max-w-[17ch] font-display text-display-xl text-balance">
            Start with structure. Keep the final say.
          </h2>
          <p className="mt-6 max-w-xl text-lede text-muted-foreground text-pretty">
            Begin from a reviewed template or an empty canvas. Both lead into the same complete
            Website workflow, from the first frame to the published page.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-2.5">
            <CTA href="/start?kind=create_site&source=product&profile=website">Create a website</CTA>
            <CTA href="/templates" secondary>Browse templates</CTA>
          </div>
          <p className="mt-7 text-sm text-muted-foreground">
            Prefer a recurring editorial rhythm?{' '}
            <Link
              className="font-medium text-foreground underline decoration-signal decoration-2 underline-offset-4"
              href="/publication"
            >
              Compare the Publication journey
            </Link>.
          </p>
        </div>

        <ClaimList heading="What we will stand behind" ids={['clean-output', 'owned-form-data']} />
      </div>
    </section>
  </PageMain>
}
