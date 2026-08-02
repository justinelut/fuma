import { ClaimList, CTA } from '@/components/public-sections'
import { ProductShot } from '@/components/section-kit'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'
import type { Route } from 'next'
import Link from 'next/link'

export const metadata = publicMetadata('Publication', 'A serious home for recurring ideas.', '/publication')

/**
 * The Publication journey.
 *
 * The page is organised around the recurring editorial cycle rather than a generic capability
 * stack. Every product image is an authentic capture of the running Fuma Studio. Workflow claims
 * stay within shipped behaviour: custom content shapes, draft/scheduled/published states, version
 * history on the published copy, live-mode authoring, capability-based roles and append-only audit.
 */

const editorialCycle = [
  {
    detail: 'Give each recurring format its own fields, sections and source before the first draft.',
    label: 'Shape the format',
    state: 'Structure',
  },
  {
    detail: 'Write in a focused surface, or use live mode inside the design readers will see.',
    label: 'Make the edition',
    state: 'Draft',
  },
  {
    detail: 'Queue a publish date while every unpublished change stays away from visitors.',
    label: 'Set the moment',
    state: 'Scheduled',
  },
  {
    detail: 'Release the public copy, keep its version history, then begin the next edition.',
    label: 'Publish. Repeat.',
    state: 'Published',
  },
] as const

const publicationKinds = [
  ['Blog', 'A clear rhythm for one writer or a small team, with the archive and design together.'],
  ['Magazine', 'Sections, authors and recurring formats held inside one designed reading system.'],
  ['Newsletter', 'Publishing tools and subscriber data kept in the same Fuma platform.'],
  ['Newsroom', 'Editorial access built from 38 capabilities, with an append-only record of change.'],
  ['Editorial team', 'Shared work with explicit roles and step-up prompts before destructive actions.'],
  ['Documentation', 'Structured entries that can carry named reviewers, review dates and versions.'],
] as const

const evidenceLinks = [
  ['Editorial workflow', '/features', 'See how writing, publishing and version history fit together.'],
  ['Trust centre', '/trust', 'Read how roles, two-factor authentication and audit history are handled.'],
  ['Fuma blog', '/blog', 'Read recurring work published through Fuma’s own public surface.'],
] as const satisfies readonly (readonly [string, Route, string])[]

export default function Page() {
  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="page-title" className="section fuma-bloom pt-16 sm:pt-24">
      <p className="eyebrow">Publication journey</p>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)] lg:items-end lg:gap-20">
        <h1 className="max-w-[15ch] font-display text-display-xl text-balance" id="page-title">
          A serious home for recurring ideas.
        </h1>
        <p className="max-w-xl text-lede text-muted-foreground text-pretty lg:pb-1">
          For blogs, magazines, newsletters, newsrooms and editorial teams. Fuma keeps each edition
          moving from its first shape to its published copy without separating writing from design.
        </p>
      </div>
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <CTA href="/start?kind=create_site&source=product&profile=publication">Start a publication</CTA>
        <CTA href="/website" secondary>Compare Website</CTA>
      </div>

      <div className="mt-16 border-y border-border sm:mt-24" aria-label="Publication workflow summary">
        <dl className="grid sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Content model', 'Posts, pages and custom collections share one store'],
            ['Editorial states', 'Draft, scheduled and published'],
            ['Access', 'Roles built from 38 capabilities'],
            ['Accountability', 'Append-only audit history'],
          ].map(([term, detail]) => <div className="border-b border-border py-5 last:border-b-0 sm:odd:border-r sm:[&:nth-last-child(-n+2)]:border-b-0 lg:border-b-0 lg:border-r lg:px-6 lg:first:pl-0 lg:last:border-r-0 lg:last:pr-0" key={term}>
            <dt className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{term}</dt>
            <dd className="mt-2 text-sm leading-6">{detail}</dd>
          </div>)}
        </dl>
      </div>
    </section>

    <section className="section" aria-labelledby="writing-in-context">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(20rem,0.48fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">The writing room</p>
          <h2 className="max-w-[19ch] font-display text-display-lg text-balance" id="writing-in-context">
            Write in the setting the reader will meet.
          </h2>
        </div>
        <p className="text-lede text-muted-foreground text-pretty">
          Use the focused Content workspace when the words need quiet. Switch to live mode when the
          relationship between copy and design is the work. Authors do not have to imagine the page.
        </p>
      </div>

      <div className="fuma-pool mt-12 sm:mt-16">
        <ProductShot
          alt="The Fuma Content workspace showing the Posts collection and the writing surface"
          caption="Authentic product capture — the Content workspace in the running Fuma Studio."
          priority
          src="/product/content.webp"
        />
      </div>

      <div className="mt-10 grid gap-6 border-t border-border pt-8 sm:grid-cols-3">
        {[
          ['Focused when writing', 'Posts and collections have a dedicated content surface.'],
          ['In context when needed', 'Live mode places authoring inside the real site design.'],
          ['Private until published', 'Unpublished edits never appear to a visitor.'],
        ].map(([title, detail]) => <div key={title}>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
        </div>)}
      </div>
    </section>

    <section className="section" aria-labelledby="editorial-cycle">
      <div className="max-w-3xl">
        <p className="eyebrow">The recurring edition</p>
        <h2 className="font-display text-display-lg text-balance" id="editorial-cycle">
          Publishing is a loop, not a finish line.
        </h2>
        <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">
          A publication earns its shape by doing the same exacting work again and again. The Fuma
          workflow makes that rhythm visible without turning every edition into a new project.
        </p>
      </div>

      <ol className="mt-14 border-y border-border" aria-label="One recurring publication cycle">
        {editorialCycle.map((item, index) => <li className="grid gap-5 border-b border-border py-7 last:border-b-0 sm:grid-cols-[4rem_minmax(10rem,0.45fr)_minmax(0,1fr)] sm:items-start sm:gap-8 sm:py-8" key={item.label}>
          <p className="font-mono text-xs text-muted-foreground" aria-hidden="true">
            {String(index + 1).padStart(2, '0')}
          </p>
          <div>
            <p className={`font-mono text-xs uppercase tracking-widest ${item.state === 'Published' ? 'text-live' : 'text-signal-bright'}`}>
              {item.state}
            </p>
            <h3 className="mt-2 font-display text-display-md">{item.label}</h3>
          </div>
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{item.detail}</p>
        </li>)}
      </ol>
      <p className="mt-5 max-w-2xl font-mono text-xs leading-6 text-muted-foreground">
        Version history is kept on the published copy, so the record follows what readers actually saw.
      </p>
    </section>

    <section className="section" aria-labelledby="recurring-shape">
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
        <div className="max-w-2xl">
          <p className="eyebrow">A shape for every series</p>
          <h2 className="font-display text-display-lg text-balance" id="recurring-shape">
            Define the format once. Fill it with new work.
          </h2>
          <p className="mt-5 max-w-xl text-lede text-muted-foreground text-pretty">
            Create custom post types with the fields each recurring format needs. Search, sort,
            filter, bulk publish and bulk export from the same Data workspace.
          </p>
        </div>
        <CTA href="/features" secondary>Explore the content model</CTA>
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-end lg:gap-10">
        <ProductShot
          alt="The Fuma Data workspace showing content tables, editorial states and table settings"
          caption="Authentic product capture — the Data workspace in the running Fuma Studio."
          src="/product/data.webp"
        />
        <dl className="border-t border-border lg:border-t-0">
          {[
            ['Custom post types', 'Fields for the recurring content your publication actually makes.'],
            ['Plain data tables', 'Useful for submissions, catalogues, testimonials and other structured rows.'],
            ['Loop sources', 'Every table can become content that a designed loop renders.'],
          ].map(([term, detail]) => <div className="border-b border-border py-5" key={term}>
            <dt className="text-sm font-medium">{term}</dt>
            <dd className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</dd>
          </div>)}
        </dl>
      </div>
    </section>

    <section className="section" aria-labelledby="editorial-access">
      <div className="grid gap-12 lg:grid-cols-[minmax(18rem,0.52fr)_minmax(0,1fr)] lg:items-center lg:gap-20">
        <div>
          <p className="eyebrow">The people behind the work</p>
          <h2 className="font-display text-display-lg text-balance" id="editorial-access">
            Access follows responsibility.
          </h2>
          <p className="mt-5 text-lede text-muted-foreground text-pretty">
            Shared editing needs boundaries that mean something. Build roles from 38 capabilities,
            require TOTP two-factor authentication, and keep a record of meaningful admin actions.
          </p>
          <ul className="mt-8 border-t border-border">
            {[
              'Account lockout with backoff after repeated failures',
              'TOTP secrets encrypted at rest',
              'Step-up prompts before deleting a user or signing out every device',
              'An append-only audit log of who did what and when',
            ].map((item) => <li className="border-b border-border py-4 text-sm leading-6 text-muted-foreground" key={item}>{item}</li>)}
          </ul>
          <div className="mt-8"><CTA href="/trust" secondary>Read the trust centre</CTA></div>
        </div>
        <ProductShot
          alt="The Fuma Users workspace showing an account, its role and access state"
          caption="Authentic product capture — the Users workspace in the running Fuma Studio."
          src="/product/users.webp"
        />
      </div>
    </section>

    <section className="section" aria-labelledby="publication-fit">
      <div className="grid gap-10 lg:grid-cols-[minmax(16rem,0.42fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Where the rhythm fits</p>
          <h2 className="font-display text-display-lg text-balance" id="publication-fit">
            Built for work that keeps arriving.
          </h2>
          <p className="mt-5 text-lede text-muted-foreground text-pretty">
            Start here when a cadence, an archive and repeatable editorial formats matter more than a
            one-off launch.
          </p>
        </div>
        <dl className="border-t border-border">
          {publicationKinds.map(([label, detail]) => <div className="grid gap-2 border-b border-border py-6 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-8" key={label}>
            <dt className="font-display text-xl">{label}</dt>
            <dd className="text-sm leading-7 text-muted-foreground">{detail}</dd>
          </div>)}
        </dl>
      </div>
    </section>

    <section className="section" aria-labelledby="publication-evidence">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.68fr)_minmax(20rem,0.48fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Keep reading</p>
          <h2 className="font-display text-display-lg text-balance" id="publication-evidence">
            Follow the product evidence.
          </h2>
          <ul className="mt-8 border-t border-border">
            {evidenceLinks.map(([label, href, detail]) => <li className="border-b border-border" key={href}>
              <Link className="group grid gap-2 py-5 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center sm:gap-6" href={href}>
                <span className="text-sm font-medium">{label}</span>
                <span className="text-sm leading-6 text-muted-foreground">{detail}</span>
                <span aria-hidden="true" className="text-signal-bright transition-transform group-hover:translate-x-1">→</span>
              </Link>
            </li>)}
          </ul>
        </div>
        <ClaimList heading="What we will stand behind" ids={['draft-isolation', 'clean-output']} />
      </div>
    </section>

    <section className="section border-t border-border !pb-0" aria-labelledby="publication-close">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(20rem,0.55fr)] lg:items-end lg:gap-20">
        <h2 className="max-w-[18ch] font-display text-display-xl text-balance" id="publication-close">
          Make room for the next edition.
        </h2>
        <div className="lg:pb-1">
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">
            Keep the archive, the editorial workflow and the designed reading view in one Fuma
            publication, ready for the work that follows this issue.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <CTA href="/start?kind=create_site&source=product&profile=publication">Start a publication</CTA>
            <CTA href="/docs" secondary>Read the docs</CTA>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Building without a publishing rhythm?{' '}
            <Link className="font-medium text-foreground underline decoration-signal decoration-2 underline-offset-4" href="/website">
              Compare the Website journey
            </Link>.
          </p>
        </div>
      </div>
    </section>
  </PageMain>
}
