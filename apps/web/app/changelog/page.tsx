import type { Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { PageMain } from '@/components/site-shell'
import { readEditorial, type EditorialEntry } from '@/lib/editorial'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Changelog',
  'Versioned Fuma release notes with published dates, change categories and complete shipped changes.',
  '/changelog',
)

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  })
}

function releaseInline(text: string, entry: EditorialEntry): ReactNode[] {
  return text
    .split(/(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
      if (part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
      if (link) {
        const href = link[2]!.startsWith('#') ? `${entry.canonicalPath}${link[2]}` : link[2]!
        const external = href.startsWith('https://')
        return <a href={href} key={index} rel={external ? 'noopener noreferrer' : undefined}>{link[1]}</a>
      }
      return part
    })
}

function ReleaseChanges({ entry }: Readonly<{ entry: EditorialEntry }>) {
  return <div className="prose-public max-w-[68ch]">
    {entry.blocks.map((block, index) => {
      const key = `${entry.meta.slug}-${index}`
      if (block.kind === 'heading') {
        return block.heading.depth === 2
          ? <h3 className="!text-display-md" key={key}>{releaseInline(block.heading.text, entry)}</h3>
          : <h4 className="mt-8 font-display text-xl" key={key}>{releaseInline(block.heading.text, entry)}</h4>
      }
      if (block.kind === 'code') {
        return <pre aria-label={block.language ? `${block.language} code example` : 'Code example'} key={key} tabIndex={0}>
          <code className={block.language ? `language-${block.language}` : undefined}>{block.code}</code>
        </pre>
      }
      if (block.kind === 'list') {
        return <ul key={key}>{block.items.map((item) => <li key={item}>{releaseInline(item, entry)}</li>)}</ul>
      }
      if (block.kind === 'blockquote') return <blockquote key={key}>{releaseInline(block.text, entry)}</blockquote>
      if (block.kind === 'callout') {
        return <aside aria-label="Note" className="mt-5 border-l-4 border-signal bg-muted p-5" key={key}>
          {releaseInline(block.text, entry)}
        </aside>
      }
      return <p key={key}>{releaseInline(block.text, entry)}</p>
    })}
  </div>
}

function Release({ entry, latest }: Readonly<{ entry: EditorialEntry; latest: boolean }>) {
  const titleId = `release-${entry.meta.slug}`

  return <li className="relative border-b border-line-soft last:border-b-0">
    <article aria-labelledby={titleId} className="grid gap-8 py-12 sm:py-14 lg:grid-cols-[minmax(12rem,0.34fr)_2rem_minmax(0,1fr)] lg:gap-10">
      <header className="lg:pt-1">
        <p className="font-mono text-eyebrow uppercase text-muted-foreground">
          {latest ? 'Latest release' : 'Release'}
        </p>
        <p className="mt-3 font-display text-display-md">{entry.meta.version}</p>
        <p className="mt-3 text-sm text-muted-foreground">
          <time dateTime={entry.meta.publishedAt}>{formatDate(entry.meta.publishedAt)}</time>
        </p>
      </header>

      <div aria-hidden="true" className="relative hidden lg:block">
        <span className="absolute inset-y-0 left-1/2 border-l border-line-strong" />
        <span className="absolute left-1/2 top-2 size-3 -translate-x-1/2 rounded-full border-2 border-signal-bright bg-background" />
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-eyebrow uppercase text-muted-foreground">
          <span className="text-signal-bright">{entry.meta.category}</span>
          <span aria-hidden="true">/</span>
          <span>{entry.meta.author}</span>
        </div>
        <h2 className="mt-5 max-w-[18ch] font-display text-display-lg text-balance" id={titleId}>
          {entry.meta.title}
        </h2>
        <p className="mt-5 max-w-2xl text-lede text-muted-foreground text-pretty">
          {entry.meta.description}
        </p>

        <div className="mt-9 border-t border-line-soft pt-2">
          <ReleaseChanges entry={entry} />
        </div>

        <div className="mt-10 grid gap-6 border-t border-line-soft pt-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <dl className="flex flex-wrap gap-x-8 gap-y-4 text-sm">
            <div>
              <dt className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">Maintained by</dt>
              <dd className="mt-1.5">{entry.meta.owner}</dd>
            </div>
            <div>
              <dt className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">Last updated</dt>
              <dd className="mt-1.5"><time dateTime={entry.meta.updatedAt}>{formatDate(entry.meta.updatedAt)}</time></dd>
            </div>
            <div>
              <dt className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">Next review</dt>
              <dd className="mt-1.5"><time dateTime={entry.meta.reviewAt}>{formatDate(entry.meta.reviewAt)}</time></dd>
            </div>
          </dl>
          <Link
            className="inline-flex items-center gap-2 text-sm font-medium decoration-signal underline-offset-4 hover:underline"
            href={entry.canonicalPath as Route}
          >
            Permanent release note
            <span aria-hidden="true" className="text-signal-bright">→</span>
          </Link>
        </div>
      </div>
    </article>
  </li>
}

export default async function Page() {
  const entries = (await readEditorial()).filter((entry) => entry.meta.collection === 'changelog')

  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="changelog-title" className="section !pb-0 pt-14 sm:pt-20">
      <div className="grid gap-10 border-b border-line-soft pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.42fr)] lg:items-end lg:gap-20 lg:pb-16">
        <div>
          <p className="eyebrow">Fuma release history</p>
          <h1 className="fuma-rise max-w-[16ch] font-display text-display-xl text-balance" id="changelog-title">
            What changed, release by release.
          </h1>
          <p className="mt-6 max-w-2xl text-lede text-muted-foreground text-pretty">
            A dated record of public Fuma releases. Every entry keeps its version, change category
            and complete shipped notes together.
          </p>
        </div>

        <dl className="border-l border-line-strong pl-6 text-sm sm:pl-8">
          <div>
            <dt className="font-mono text-eyebrow uppercase text-muted-foreground">Reading the record</dt>
            <dd className="mt-3 max-w-sm leading-6 text-muted-foreground">
              Newest first. The release coordinate gives the exact version and publication date;
              the change record is the approved note from Fuma.
            </dd>
          </div>
        </dl>
      </div>
    </section>

    {entries.length > 0
      ? <section aria-labelledby="release-ledger-title" className="section">
          <div className="grid gap-10 lg:grid-cols-[minmax(11rem,0.24fr)_minmax(0,1fr)] lg:gap-14">
            <header>
              <div className="lg:sticky lg:top-24">
                <p className="eyebrow">Release ledger</p>
                <h2 className="max-w-[10ch] font-display text-display-lg text-balance" id="release-ledger-title">
                  Shipped, in order.
                </h2>
                <p className="mt-5 max-w-xs text-sm leading-6 text-muted-foreground">
                  Only eligible public release notes appear in this history.
                </p>
              </div>
            </header>

            <ol className="border-t border-line-soft">
              {entries.map((entry, index) => <Release entry={entry} key={entry.meta.slug} latest={index === 0} />)}
            </ol>
          </div>
        </section>
      : <section aria-labelledby="release-ledger-title" className="section">
          <div className="border-y border-line-soft py-12" role="status">
            <p className="eyebrow">Release ledger</p>
            <h2 className="font-display text-display-lg text-balance" id="release-ledger-title">No public releases yet.</h2>
            <p className="mt-5 max-w-xl text-muted-foreground">
              Eligible Fuma release notes will appear here after publication. No placeholder releases are shown.
            </p>
          </div>
        </section>}
  </PageMain>
}
