import type { EditorialEntry } from '@/lib/editorial'
import type { ReactNode } from 'react'

function inline(text: string): ReactNode[] {
  return text
    .split(/(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
      if (part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
      if (link) {
        const external = link[2]!.startsWith('https://')
        return <a key={index} href={link[2]} rel={external ? 'noopener noreferrer' : undefined}>{link[1]}</a>
      }
      return part
    })
}

export function EditorialContent({ entry }: Readonly<{ entry: EditorialEntry }>) {
  return <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_15rem]">
    <article className="prose-public min-w-0">
      {entry.blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return block.heading.depth === 2
            ? <h2 id={block.heading.id} key={block.heading.id}>{inline(block.heading.text)}</h2>
            : <h3 id={block.heading.id} key={block.heading.id}>{inline(block.heading.text)}</h3>
        }
        if (block.kind === 'code') {
          return <pre key={index} tabIndex={0} aria-label={block.language ? `${block.language} code example` : 'Code example'}><code className={block.language ? `language-${block.language}` : undefined}>{block.code}</code></pre>
        }
        if (block.kind === 'list') return <ul key={index}>{block.items.map((item) => <li key={item}>{inline(item)}</li>)}</ul>
        if (block.kind === 'blockquote') return <blockquote key={index}>{inline(block.text)}</blockquote>
        if (block.kind === 'callout') return <aside aria-label="Note" className="rounded-lg border-l-4 border-primary bg-muted p-5" key={index}>{inline(block.text)}</aside>
        return <p key={index}>{inline(block.text)}</p>
      })}
    </article>
    {entry.headings.length > 0 && <aside>
      <nav aria-label="On this page" className="sticky top-28 rounded-lg border p-4">
        <p className="font-semibold">On this page</p>
        <ol className="mt-3 grid gap-2 text-sm">
          {entry.headings.map((heading) => <li className={heading.depth === 3 ? 'pl-3' : ''} key={heading.id}><a href={`#${heading.id}`}>{heading.text}</a></li>)}
        </ol>
      </nav>
    </aside>}
  </div>
}
