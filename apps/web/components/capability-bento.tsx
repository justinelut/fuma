import type { Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * The second capability bento.
 *
 * This replaces a grid of eight text-only cards. The lesson from the platform grid above it is that
 * a cell earns its space by showing a real miniature of the product surface, not by describing it —
 * so every cell here carries a functional micro-diagram built from actual product concepts.
 *
 * Deliberately does NOT repeat the four surfaces the platform grid already visualises (design
 * tokens, the content model, roles, the plugin sandbox). Showing the same diagram twice on one page
 * is what makes a section feel like filler.
 *
 * Every value shown is real: the nine module types, the nine component parameter types, the three
 * editorial states, the QuickJS-WASM permission model. No invented counts or metrics.
 */

function Cell({
  children,
  className = '',
  href,
  label,
}: Readonly<{ children: ReactNode; className?: string; href: Route; label: string }>) {
  return <Link
    className={`group relative flex min-h-64 flex-col justify-between gap-6 border-b border-r border-border p-5 transition-colors hover:bg-secondary/30 sm:p-6 ${className}`}
    href={href}
  >
    <div className="min-w-0 flex-1">{children}</div>
    <span className="flex items-center gap-2 text-[0.9375rem] font-semibold">
      {label}
      <span aria-hidden="true" className="text-signal-bright transition-transform group-hover:translate-x-0.5">&rarr;</span>
    </span>
  </Link>
}

function Title({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="font-mono text-eyebrow uppercase tracking-[0.14em] text-muted-foreground">{children}</p>
}

function Note({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="mt-4 text-[0.8125rem] leading-6 text-muted-foreground">{children}</p>
}

/** Shared row visual: a left label with a right-hand monospace value. */
function Rows({ items }: Readonly<{ items: readonly (readonly [string, string])[] }>) {
  return <ul className="grid gap-px overflow-hidden rounded-lg border border-border/70 bg-border/40">
    {items.map(([left, right]) => <li className="flex items-center justify-between gap-3 bg-card px-3 py-2 text-[0.78rem]" key={left}>
      <span className="truncate text-foreground/80">{left}</span>
      <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">{right}</span>
    </li>)}
  </ul>
}

/** Chip cloud, for enumerating a fixed vocabulary. */
function Chips({ items }: Readonly<{ items: readonly string[] }>) {
  return <ul className="flex flex-wrap gap-1.5">
    {items.map((item) => <li
      className="rounded-md border border-border/70 bg-card px-2 py-1 font-mono text-[0.7rem] text-muted-foreground"
      key={item}
    >{item}</li>)}
  </ul>
}

export function CapabilityBento() {
  return <section aria-labelledby="capability-title" className="section">
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-2xl">
        <h2 className="font-display text-display-lg text-balance" id="capability-title">Everything else the work needs.</h2>
        <p className="mt-5 max-w-xl text-lede text-muted-foreground text-pretty">
          Six more surfaces, each a real part of the product rather than a roadmap entry.
        </p>
      </div>
      <Link
        className="inline-flex min-h-11 max-w-full items-center whitespace-normal text-center control-secondary rounded-control px-4 text-sm font-medium transition-colors sm:h-[2.125rem] sm:min-h-0 sm:shrink-0"
        href={'/features' as Route}
      >Walk the whole workflow</Link>
    </div>

    <div className="mt-10 overflow-hidden rounded-surface border-l border-t border-border [&>*:last-child]:border-b-0 md:grid md:grid-cols-3 md:[&>*]:border-b md:[&>*:nth-last-child(-n+3)]:border-b-0">
      <Cell href={'/features' as Route} label="Media">
        <Title>Media library</Title>
        <div className="mt-4">
          <Rows items={[['brand/', 'folder'], ['projects/', 'folder'], ['hero.webp', 'in use'], ['old-logo.png', 'unused']]} />
        </div>
        <Note>Usage is tracked, so you know where a file is used before you replace it.</Note>
      </Cell>

      <Cell href={'/features' as Route} label="Owned forms">
        <Title>Form to table</Title>
        <div className="mt-4">
          <Rows items={[['name', 'text'], ['email', 'email'], ['budget', 'number'], ['→ enquiries', 'table']]} />
        </div>
        <Note>Fuma reads the fields you placed and creates the table to hold what people send.</Note>
      </Cell>

      <Cell href={'/features' as Route} label="Modules">
        <Title>Nine building blocks</Title>
        <div className="mt-4">
          <Chips items={['container', 'text', 'image', 'button', 'video', 'list', 'link', 'svg', 'form']} />
        </div>
        <Note>Nest them freely on the canvas rather than filling in a fixed form.</Note>
      </Cell>

      <Cell href={'/features' as Route} label="Components">
        <Title>Typed parameters</Title>
        <div className="mt-4">
          <Chips items={['string', 'number', 'boolean', 'colour', 'image', 'url', 'rich text', 'enum', 'slot']} />
        </div>
        <Note>Edit a component once and every instance across the site follows.</Note>
      </Cell>

      <Cell href={'/publication' as Route} label="Version history">
        <Title>Published copy</Title>
        <div className="mt-4">
          <Rows items={[['v3', 'current'], ['v2', 'archived'], ['v1', 'archived'], ['draft', 'private']]} />
        </div>
        <Note>Version history sits on the published copy, so you can see what actually changed.</Note>
      </Cell>

      <Cell href={'/features' as Route} label="Imports">
        <Title>Paste or bring a site</Title>
        <div className="mt-4">
          <Rows items={[['index.html', 'nodes'], ['styles.css', 'style rules'], ['fonts, images', 'media'], ['conflicts', 'shown first']]} />
        </div>
        <Note>Every conflict is shown before anything is written, and the import is a single undo.</Note>
      </Cell>
    </div>
  </section>
}
