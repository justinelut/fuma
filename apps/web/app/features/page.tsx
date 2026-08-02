import { ClaimList, CTA } from '@/components/public-sections'
import { Eyebrow, ProductShot } from '@/components/section-kit'
import { PageMain } from '@/components/site-shell'
import { ViewSourceProof } from '@/components/view-source-proof'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata('Features', 'Explore the Fuma building, content and publishing workflow.', '/features')

const modules = [
  'Containers', 'Text', 'Images', 'Buttons', 'Video', 'Lists', 'Links', 'SVG', 'Forms',
] as const

const paramTypes = [
  'String', 'Number', 'Boolean', 'Colour', 'Image', 'URL', 'Rich text', 'Enum', 'Slot',
] as const

const workflow = [
  ['Compose', 'Build across breakpoints'],
  ['Structure', 'Model content once'],
  ['Organise', 'Keep every asset legible'],
  ['Govern', 'Set boundaries and access'],
  ['Publish', 'Ship the clean page'],
] as const

const contentModel = [
  ['One store', 'Pages, posts, components and custom tables share one content model.'],
  ['Your fields', 'Design collections and custom post types around the material you actually publish.'],
  ['Editorial control', 'Search, sort, filter, bulk publish and bulk export from the spreadsheet-style grid.'],
  ['A source everywhere', 'Every table you create can become a source a loop renders on the site.'],
] as const

const boundaries = [
  {
    eyebrow: 'Extend',
    title: 'Plugins can add reach without inheriting the keys.',
    body: 'Backend code runs in a per-plugin QuickJS-WASM sandbox: no filesystem, no environment variables and no network unless the site owner grants it, one host at a time.',
    details: [
      'Add routes, admin pages, storage, scheduled jobs and canvas modules',
      'Editor extensions require the explicit editor.code permission before install',
    ],
    href: '/plugins',
    linkLabel: 'Browse plugins',
  },
  {
    eyebrow: 'Permission',
    title: 'Access is assembled, not implied.',
    body: 'Roles are built from 38 distinct capabilities, with token-based sessions, TOTP two-factor and secrets encrypted at rest.',
    details: [
      'Account lockout backs off after repeated failures',
      'Deleting a user or signing out every device requires a step-up prompt',
    ],
    href: '/trust',
    linkLabel: 'Read the trust centre',
  },
] as const

const imports = [
  ['Paste raw HTML', 'Markup becomes editable nodes through the same pipeline the assistant uses.'],
  ['Bring a whole site', 'Super Import turns HTML, CSS, images and fonts into pages, style rules, tokens and media.'],
  ['See the conflicts first', 'Nothing is written before you have seen what the import would change.'],
  ['Reverse it together', 'The entire import is one undo rather than a trail of cleanup.'],
] as const

export default function Page() {
  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="page-title" className="section fuma-glow !pb-0 pt-16 sm:pt-24" data-fuma-visual="hero">
      <p className="eyebrow fuma-rise">The whole workflow</p>
      <h1 className="fuma-rise max-w-[17ch] font-display text-display-xl text-balance" id="page-title">
        One working loop, from first block to published page.
      </h1>
      <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(20rem,0.48fr)] lg:items-end lg:gap-20">
        <p className="max-w-2xl text-lede text-muted-foreground text-pretty">
          Compose the design, give the content structure, keep the assets organised, set the
          boundaries and publish the clean result without handing the work between disconnected tools.
        </p>
        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          <CTA href="/website">Explore Website</CTA>
          <CTA href="/publication" secondary>Explore Publication</CTA>
        </div>
      </div>

      <ol aria-label="The Fuma working loop" className="mt-16 grid border-y border-border sm:grid-cols-2 lg:grid-cols-5">
        {workflow.map(([stage, outcome], index) => <li
          className="grid grid-cols-[2rem_1fr] gap-3 border-b border-border py-5 last:border-b-0 sm:border-r sm:px-5 sm:first:pl-0 sm:[&:nth-child(2)]:border-r-0 lg:border-b-0 lg:[&:nth-child(2)]:border-r lg:last:border-r-0 lg:last:pr-0"
          key={stage}
        >
          <span className="font-mono text-xs text-signal-bright">{String(index + 1).padStart(2, '0')}</span>
          <span>
            <span className="block text-sm font-medium">{stage}</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">{outcome}</span>
          </span>
        </li>)}
      </ol>
    </section>

    <section className="section !pt-16 sm:!pt-24">
      <div className="fuma-pool">
        <ProductShot
          alt="The Fuma Pages workspace showing breakpoint canvases, the page tree and design controls"
          caption="The real Pages workspace: page tree, canvases and design controls in one view."
          priority
          src="/product/site.webp"
        />
      </div>
      <div className="mt-14 grid gap-10 border-t border-border pt-10 lg:grid-cols-[minmax(0,0.72fr)_minmax(20rem,0.45fr)] lg:gap-24">
        <div>
          <Eyebrow>Compose</Eyebrow>
          <h2 className="max-w-2xl font-display text-display-lg text-balance">A canvas that keeps every view in the same thought.</h2>
          <p className="mt-5 max-w-xl text-lede text-muted-foreground text-pretty">
            Put several breakpoint frames side by side and edit them together. Change desktop and
            mobile reacts in the same view; switch to live mode when you want one full-size page in place.
          </p>
        </div>
        <ul className="grid content-start gap-3 text-sm leading-6 text-muted-foreground">
          <li className="border-t border-border pt-4">Nest modules freely instead of filling in a fixed form.</li>
          <li className="border-t border-border pt-4">Turn recurring structures into visual components with typed parameters and named slots.</li>
          <li className="border-t border-border pt-4">Components that would reference themselves are blocked before they happen.</li>
        </ul>
      </div>
    </section>

    <section className="section border-y border-border">
      <div className="grid gap-14 lg:grid-cols-[minmax(0,0.68fr)_minmax(0,1fr)] lg:gap-24">
        <div>
          <Eyebrow>The parts on the canvas</Eyebrow>
          <h2 className="max-w-lg font-display text-display-lg text-balance">Small pieces. Durable systems.</h2>
          <p className="mt-5 max-w-lg text-lede text-muted-foreground text-pretty">
            Start with semantic building blocks. Promote the patterns worth keeping into components,
            then decide exactly what each instance is allowed to change.
          </p>
          <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-border bg-border">
            <div className="bg-background p-5">
              <dt className="font-display text-display-md">9</dt>
              <dd className="mt-1 text-sm text-muted-foreground">nestable modules</dd>
            </div>
            <div className="bg-background p-5">
              <dt className="font-display text-display-md">9</dt>
              <dd className="mt-1 text-sm text-muted-foreground">parameter types</dd>
            </div>
          </dl>
        </div>
        <div className="grid gap-10 sm:grid-cols-2">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Modules</p>
            <ul className="mt-5 divide-y divide-border border-y border-border">
              {modules.map((module) => <li className="flex items-center justify-between py-3 text-sm" key={module}>
                {module}<span aria-hidden="true" className="size-1 rounded-full bg-signal-bright" />
              </li>)}
            </ul>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Component parameters</p>
            <ul className="mt-5 divide-y divide-border border-y border-border">
              {paramTypes.map((type) => <li className="flex items-center justify-between py-3 text-sm" key={type}>
                {type}<span aria-hidden="true" className="font-mono text-xs text-muted-foreground">typed</span>
              </li>)}
            </ul>
          </div>
        </div>
      </div>
    </section>

    <section className="section">
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-7">
        <div className="max-w-2xl">
          <Eyebrow>Structure</Eyebrow>
          <h2 className="font-display text-display-lg text-balance">Content gets one spine.</h2>
          <p className="mt-5 max-w-xl text-lede text-muted-foreground text-pretty">
            Schemas, rows, imports, exports and form submissions live in the same consistent model.
            There is no special-cased pages table hiding in a corner.
          </p>
        </div>
        <CTA href="/publication" secondary>See the Publication journey</CTA>
      </div>

      <dl className="mt-12 grid gap-x-10 gap-y-6 border-t border-border pt-7 sm:grid-cols-2 lg:grid-cols-4">
        {contentModel.map(([label, detail]) => <div key={label}>
          <dt className="text-sm font-medium">{label}</dt>
          <dd className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</dd>
        </div>)}
      </dl>

      <div className="fuma-pool mt-14 sm:mt-16">
        <ProductShot
          alt="The Fuma Data workspace showing Pages in a spreadsheet-style grid with table settings"
          caption="The real Data workspace, where collections and custom post types are designed."
          src="/product/data.webp"
        />
      </div>

      <div className="mt-12 grid gap-8 border-t border-border pt-10 lg:grid-cols-[minmax(0,0.7fr)_minmax(20rem,0.5fr)] lg:gap-24">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Organise</p>
          <h3 className="mt-3 max-w-xl font-display text-display-md text-balance">Media works like a file manager, not an attachment drawer.</h3>
        </div>
        <ul className="grid gap-3 text-sm leading-6 text-muted-foreground">
          <li>Folders, smart folders and bulk operations keep the library navigable.</li>
          <li>Usage tracking shows where a file is used before you replace it.</li>
          <li>Deliberate replacement workflows avoid silent overwrites.</li>
          <li>Pluggable storage adapters are there when local disk is outgrown.</li>
        </ul>
      </div>
    </section>

    <section className="section border-y border-border">
      <div className="max-w-2xl">
        <Eyebrow>Govern</Eyebrow>
        <h2 className="font-display text-display-lg text-balance">The edges are part of the product.</h2>
        <p className="mt-5 max-w-xl text-lede text-muted-foreground text-pretty">
          Extensibility and access control only work when their boundaries are visible, specific and
          difficult to bypass.
        </p>
      </div>

      <div className="mt-14 divide-y divide-border border-y border-border">
        {boundaries.map((item) => <article className="grid gap-8 py-10 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,0.7fr)_minmax(20rem,0.48fr)] lg:gap-24" key={item.eyebrow}>
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-signal-bright">{item.eyebrow}</p>
            <h3 className="mt-3 max-w-2xl font-display text-display-md text-balance">{item.title}</h3>
            <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">{item.body}</p>
          </div>
          <div className="flex flex-col items-start">
            <ul className="grid gap-3 text-sm leading-6 text-muted-foreground">
              {item.details.map((detail) => <li className="border-t border-border pt-3" key={detail}>{detail}</li>)}
            </ul>
            <div className="mt-6">
              <CTA href={item.href} secondary>{item.linkLabel}</CTA>
            </div>
          </div>
        </article>)}
      </div>
    </section>

    <section className="section">
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-7">
        <div className="max-w-2xl">
          <Eyebrow>Observe</Eyebrow>
          <h2 className="font-display text-display-lg text-balance">An operational view, honestly scoped.</h2>
          <p className="mt-5 max-w-xl text-lede text-muted-foreground text-pretty">
            The analytics surface is deliberately operational today: dashboard status, audit history
            and owned form data rather than third-party visitor tracking.
          </p>
        </div>
        <CTA href="/status" secondary>See service status</CTA>
      </div>

      <div className="fuma-pool mt-14 sm:mt-16">
        <ProductShot
          alt="The Fuma dashboard showing setup progress and configurable site overview widgets"
          caption="The real dashboard, arranged from a 12-column grid of resizable tile widgets."
          src="/product/dashboard.webp"
        />
      </div>

      <dl className="mt-10 grid gap-x-10 gap-y-6 border-t border-border pt-7 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-sm font-medium">Arrange it per user</dt>
          <dd className="mt-2 text-sm leading-6 text-muted-foreground">Drag, resize and rearrange widgets; each person keeps their own layout.</dd>
        </div>
        <div>
          <dt className="text-sm font-medium">Extend the grid</dt>
          <dd className="mt-2 text-sm leading-6 text-muted-foreground">Plugins can ship their own widgets into the same dashboard.</dd>
        </div>
        <div>
          <dt className="text-sm font-medium">Keep the record</dt>
          <dd className="mt-2 text-sm leading-6 text-muted-foreground">The append-only audit log records logins, content changes and role edits.</dd>
        </div>
        <div>
          <dt className="text-sm font-medium">Use your form data</dt>
          <dd className="mt-2 text-sm leading-6 text-muted-foreground">Submissions remain queryable and exportable in your tables.</dd>
        </div>
      </dl>
    </section>

    <section className="section border-t border-border">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.62fr)_minmax(20rem,0.7fr)] lg:gap-24">
        <div>
          <Eyebrow>Bring what you have</Eyebrow>
          <h2 className="max-w-xl font-display text-display-lg text-balance">Imports that finish as real Fuma work.</h2>
          <p className="mt-5 max-w-lg text-lede text-muted-foreground text-pretty">
            Migration is where tools quietly fail. Here, imported material ends as editable nodes and
            nothing is written before the conflicts are visible.
          </p>
        </div>
        <dl className="divide-y divide-border border-y border-border">
          {imports.map(([label, detail]) => <div className="grid gap-2 py-5 sm:grid-cols-[10rem_1fr] sm:gap-6" key={label}>
            <dt className="text-sm font-medium">{label}</dt>
            <dd className="text-sm leading-6 text-muted-foreground">{detail}</dd>
          </div>)}
        </dl>
      </div>
    </section>

    <ViewSourceProof />

    <section className="section border-t border-border !pb-0">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
        <div>
          <Eyebrow>The same platform</Eyebrow>
          <h2 className="max-w-[18ch] font-display text-display-xl text-balance">Choose the work, not a different stack.</h2>
        </div>
        <div className="lg:pb-1">
          <p className="max-w-lg text-lede text-muted-foreground text-pretty">
            Website and Publication are two ways into the same Fuma workflow. Neither path forks the
            product or locks away capabilities you may need later.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <CTA href="/start?kind=sign_up&source=solution">Start building</CTA>
            <CTA href="/docs" secondary>Read the docs</CTA>
          </div>
        </div>
      </div>

      <div className="mt-16 border-t border-border pt-12">
        <ClaimList columns={2} heading="What we will stand behind" ids={['single-workflow', 'owned-form-data']} />
      </div>
    </section>
  </PageMain>
}
