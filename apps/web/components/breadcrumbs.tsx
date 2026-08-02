import type { Route } from 'next'
import { jsonLd } from '@/lib/seo'
import { breadcrumbStructuredData } from '@/lib/structured-data'
import Link from 'next/link'

export function Breadcrumbs({ items }: { items: readonly Readonly<{ label: string; href: string }>[] }) {
  const list = [{ label: 'Home', href: '/' }, ...items]
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(breadcrumbStructuredData(list))} />
    <nav aria-label="Breadcrumb" className="mb-8 text-sm text-muted-foreground">
      <ol className="flex flex-wrap gap-2">
        {list.map((item, index) => <li key={item.href as Route}>
          {index < list.length - 1
            ? <><Link className="underline" href={item.href as Route}>{item.label}</Link><span aria-hidden="true"> / </span></>
            : <span aria-current="page">{item.label}</span>}
        </li>)}
      </ol>
    </nav>
  </>
}
