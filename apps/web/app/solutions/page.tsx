import { ClaimList, CTA } from '@/components/public-sections'
import { ProductShot } from '@/components/section-kit'
import { StackCollapse } from '@/components/stack-collapse'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'
import Link from 'next/link'

export const metadata = publicMetadata('Solutions', 'Choose a Fuma journey by the work you want to publish.', '/solutions')

const sharedCapabilities = [
  {
    detail: 'Pages, posts, components, custom collections and structured tables belong to one consistent content model.',
    label: 'Structure',
    outcome: 'Model the work once',
  },
  {
    detail: 'Use the visual canvas, breakpoint frames, templates and live mode without moving into a separate design product.',
    label: 'Design',
    outcome: 'Keep authors inside the real site',
  },
  {
    detail: 'Collect form submissions in Fuma data tables, alongside the content and collections that use them.',
    label: 'Collect',
    outcome: 'Keep responses in the workflow',
  },
  {
    detail: 'Roles are built from 38 capabilities, with token-based sessions, step-up prompts and an append-only audit log.',
    label: 'Coordinate',
    outcome: 'Give each person the right surface',
  },
  {
    detail: 'Published pages leave the editor behind as semantic HTML and compact CSS. Draft changes stay out of the public result.',
    label: 'Publish',
    outcome: 'Ship the work, not the machinery',
  },
] as const

const decisionRows = [
  ['The centre of the work', 'A designed page or composition', 'A stream of recurring entries'],
  ['A useful first surface', 'The site canvas and page tree', 'Collections and editorial state'],
  ['Typical work', 'Services, portfolios, campaigns, organisations', 'Blogs, magazines, newsletters, newsrooms'],
  ['Publishing rhythm', 'Deliberate page releases', 'Draft, scheduled and published entries'],
] as const

/**
 * Solutions is a chooser, not a catalogue. Its visual signature is the decision fork below:
 * one practical question branches into two real Fuma working surfaces, then resolves into the
 * shared platform underneath. The fork helps a visitor choose without suggesting separate tiers,
 * editions or capability sets.
 */
export default function Page() {
  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="page-title" className="section fuma-glow !pb-0 pt-16 sm:pt-24">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Solutions</p>
          <h1 className="max-w-[16ch] font-display text-display-xl text-balance" id="page-title">
            Choose the work that sets the rhythm.
          </h1>
        </div>
        <div className="lg:pb-1">
          <p className="text-lede text-muted-foreground text-pretty">
            Fuma has two starting journeys. Choose Website when designed pages lead. Choose
            Publication when recurring entries lead. Both open into the same Fuma platform.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <CTA href="/website">Website journey</CTA>
            <CTA href="/publication" secondary>Publication journey</CTA>
          </div>
        </div>
      </div>
    </section>

    <section aria-labelledby="decision-title" className="section">
      <div className="max-w-3xl">
        <p className="eyebrow">Choose in one question</p>
        <h2 className="font-display text-display-lg text-balance" id="decision-title">
          What changes most often after launch?
        </h2>
        <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">
          The answer chooses a useful starting point, not a permanent choice. No feature disappears
          when you take either path.
        </p>
      </div>

      {/* The decision fork is this route's one expressive device: a shared question branches into
          two truthful product surfaces, then the comparison rows make the choice concrete. */}
      <div className="mt-12 overflow-hidden rounded-surface border border-border bg-border">
        <div className="grid gap-px lg:grid-cols-2">
          <article className="flex min-w-0 flex-col bg-background">
            <div className="flex flex-1 flex-col p-5 sm:p-8 lg:min-h-80 lg:p-10">
              <div className="flex items-center justify-between gap-4 border-b border-line-soft pb-5">
                <p className="font-mono text-eyebrow uppercase text-signal-bright">Designed pages</p>
                <span className="font-mono text-xs text-muted-foreground">Website</span>
              </div>
              <h3 className="mt-8 max-w-[13ch] font-display text-display-lg text-balance">
                The site itself is the main work.
              </h3>
              <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
                Start with the page tree and visual canvas when the outcome is a service site,
                portfolio, campaign or organisation home.
              </p>
              <Link
                className="mt-8 inline-flex w-fit items-center gap-2 border-b border-signal pb-1 text-sm font-medium transition-colors hover:border-signal-bright"
                href="/website"
              >
                Follow the Website journey <span aria-hidden="true">→</span>
              </Link>
            </div>
            <div className="border-t border-line-soft bg-surface-inset p-4 sm:p-5">
              <ProductShot
                alt="The Fuma Site workspace showing a page on the visual canvas at two breakpoints"
                caption="The real Site workspace: page tree, canvas and breakpoint frames."
                priority
                src="/product/site.webp"
              />
            </div>
          </article>

          <article className="flex min-w-0 flex-col bg-card">
            <div className="flex flex-1 flex-col p-5 sm:p-8 lg:min-h-80 lg:p-10">
              <div className="flex items-center justify-between gap-4 border-b border-line-soft pb-5">
                <p className="font-mono text-eyebrow uppercase text-signal-bright">Recurring entries</p>
                <span className="font-mono text-xs text-muted-foreground">Publication</span>
              </div>
              <h3 className="mt-8 max-w-[13ch] font-display text-display-lg text-balance">
                New ideas keep the site moving.
              </h3>
              <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
                Start with collections and editorial state when the outcome is a blog, magazine,
                newsletter, newsroom or another recurring body of work.
              </p>
              <Link
                className="mt-8 inline-flex w-fit items-center gap-2 border-b border-signal pb-1 text-sm font-medium transition-colors hover:border-signal-bright"
                href="/publication"
              >
                Follow the Publication journey <span aria-hidden="true">→</span>
              </Link>
            </div>
            <div className="border-t border-line-soft bg-surface-inset p-4 sm:p-5">
              <ProductShot
                alt="The Fuma Content workspace showing collections and editorial controls"
                caption="The real Content workspace: collections, entries and publishing state."
                src="/product/content.webp"
              />
            </div>
          </article>
        </div>

        <div className="border-t border-border bg-background">
          <div className="grid border-b border-line-soft px-5 py-4 sm:grid-cols-[minmax(8rem,0.48fr)_minmax(0,1fr)_minmax(0,1fr)] sm:px-8">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">Decision guide</p>
            <p className="hidden font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground sm:block">Website</p>
            <p className="hidden font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground sm:block">Publication</p>
          </div>
          <dl>
            {decisionRows.map(([prompt, website, publication]) => <div
              className="grid gap-4 border-b border-line-soft px-5 py-5 last:border-b-0 sm:grid-cols-[minmax(8rem,0.48fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-8 sm:px-8"
              key={prompt}
            >
              <dt className="text-sm font-medium">{prompt}</dt>
              <dd className="text-sm leading-6 text-muted-foreground">
                <span className="mb-1 block font-mono text-xs uppercase text-foreground sm:hidden">Website</span>
                {website}
              </dd>
              <dd className="text-sm leading-6 text-muted-foreground">
                <span className="mb-1 block font-mono text-xs uppercase text-foreground sm:hidden">Publication</span>
                {publication}
              </dd>
            </div>)}
          </dl>
        </div>
      </div>
    </section>

    <section aria-labelledby="shared-title" className="section border-t border-border">
      <div className="grid gap-10 lg:grid-cols-[minmax(18rem,0.58fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">After the first screen</p>
          <h2 className="max-w-[14ch] font-display text-display-lg text-balance" id="shared-title">
            The paths converge immediately.
          </h2>
          <p className="mt-5 max-w-md text-lede text-muted-foreground text-pretty">
            Website and Publication are working orientations inside one product. The content model,
            design system, team controls and publisher underneath are identical.
          </p>
          <div className="mt-8">
            <CTA href="/features" secondary>Walk the whole workflow</CTA>
          </div>
        </div>

        <ol className="border-t border-border">
          {sharedCapabilities.map((item, index) => <li
            className="grid gap-4 border-b border-border py-6 sm:grid-cols-[3rem_minmax(8rem,0.42fr)_minmax(0,1fr)] sm:gap-6 sm:py-7"
            key={item.label}
          >
            <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">{item.label}</p>
              <h3 className="mt-2 font-display text-xl leading-tight">{item.outcome}</h3>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">{item.detail}</p>
          </li>)}
        </ol>
      </div>
    </section>

    <StackCollapse />

    <section aria-labelledby="close-title" className="section border-t border-border !pb-0">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">No wrong door</p>
          <h2 className="max-w-[18ch] font-display text-display-xl text-balance" id="close-title">
            Start where the work is. Keep the rest within reach.
          </h2>
        </div>
        <div className="lg:pb-1">
          <p className="max-w-lg text-lede text-muted-foreground text-pretty">
            Pick the surface that matches what you are making first. You can move between pages,
            collections, data and design without migrating to another Fuma product.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <CTA href="/website">Website journey</CTA>
            <CTA href="/publication" secondary>Publication journey</CTA>
          </div>
        </div>
      </div>

      <div className="mt-16 border-t border-line-soft pt-12">
        <ClaimList columns={2} heading="What both paths stand on" ids={['single-workflow', 'clean-output']} />
      </div>
    </section>
  </PageMain>
}
