import type { Route } from 'next'
import Link from 'next/link'
import { Eyebrow } from '@/components/section-kit'

/**
 * The view-source proof.
 *
 * Fuma's distinguishing claim is that published output stays readable — semantic HTML and compact
 * CSS with none of the editor's machinery in the page. Rather than assert that, this section shows
 * the request: exactly what a visitor downloads, beside the layers that are absent.
 *
 * Honesty constraints held here: the only figure is the real 1.1 kB dynamic runtime, and it is
 * labelled as conditional because it only loads for genuinely per-visitor parts. Nothing is claimed
 * about any other product's page weight, because we have not measured one.
 */

const PUBLISHED_MARKUP = [
  '<main>',
  '  <h1>Rooms that keep the afternoon.</h1>',
  '  <p>An independent studio working in warm materials',
  '     and daylight.</p>',
  '  <ul class="work">',
  '    <li><img src="/kilimani.avif" alt="Kilimani apartment"></li>',
  '    <li><img src="/karen.avif" alt="Karen family house"></li>',
  '  </ul>',
  '</main>',
] as const

/** What actually crosses the wire, in order. */
const DELIVERED = [
  ['index.html', 'served as a file', true],
  ['styles.css', 'compact, generated', true],
  ['runtime.js', '1.1 kB · only if the page has per-visitor parts', false],
] as const

/** Layers a builder-produced page usually carries, and this one does not. */
const ABSENT = [
  'framework runtime',
  'hydration payload',
  'builder attributes',
  'editor markup',
  'div soup',
  'tracking by default',
] as const

export function ViewSourceProof() {
  return <section className="section" data-fuma-viewsource>
    <div className="max-w-2xl">
      <Eyebrow>View source</Eyebrow>
      <h2 className="font-display text-display-lg text-balance">The page ships without the workshop.</h2>
      <p className="mt-5 text-lede text-muted-foreground text-pretty">
        A published page is mostly a file. No framework to boot, no hydration step, no database
        round-trip on the common path — so there is barely anything between a visitor and the content.
      </p>
    </div>

    <div className="mt-12 grid min-w-0 gap-px overflow-hidden rounded-surface border border-border bg-border lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      {/* The emitted markup, as it appears in view-source. */}
      <div className="min-w-0 bg-card p-5 sm:p-7">
        <p className="mb-4 flex items-center gap-2.5 font-mono text-eyebrow uppercase text-muted-foreground">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-live" />
          view-source: the published page
        </p>
        <pre className="overflow-x-auto font-mono text-[0.8125rem] leading-[1.8]"><code>
          {PUBLISHED_MARKUP.map((line) => <span className="block text-foreground/85" key={line}>{line || '\u00a0'}</span>)}
        </code></pre>
      </div>

      {/* What the visitor actually downloads, then what is absent. */}
      <div className="min-w-0 bg-background p-5 sm:p-7">
        <p className="font-mono text-eyebrow uppercase text-muted-foreground">What a visitor downloads</p>
        <ul className="mt-4 grid gap-px overflow-hidden rounded-lg border border-border/70 bg-border/40">
          {DELIVERED.map(([name, note, always]) => <li className="flex min-w-0 flex-col items-start gap-1.5 bg-card px-3 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3" key={name}>
            <span className="font-mono text-[0.8125rem] text-foreground/90">{name}</span>
            <span className="min-w-0 break-words text-left font-mono text-[0.68rem] leading-4 text-muted-foreground sm:shrink-0 sm:text-right">
              {always ? note : <span className="text-signal-bright">{note}</span>}
            </span>
          </li>)}
        </ul>

        <p className="mt-8 font-mono text-eyebrow uppercase text-muted-foreground">What is not in the page</p>
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {ABSENT.map((item) => <li
            className="rounded-md border border-border/60 bg-card/60 px-2 py-1 font-mono text-[0.7rem] text-muted-foreground/70 line-through decoration-live/60"
            key={item}
          >{item}</li>)}
        </ul>

        <Link
          className="mt-8 inline-flex w-fit items-center gap-2 border-b border-signal/50 pb-0.5 text-sm font-medium transition-colors hover:border-signal-bright"
          href={'/docs' as Route}
        >
          How publishing works
          <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>
    </div>
  </section>
}
