import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { CTA, Tag } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { jsonLd, publicMetadata } from '@/lib/seo'
import { installTemplateHref, readTemplateDetail } from '@/lib/templates'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const result = await readTemplateDetail(slug)
  return result.status === 'available'
    ? publicMetadata(result.item.name, result.item.summary, `/templates/${result.item.slug}`)
    : publicMetadata('Template unavailable', 'This approved template is no longer available.', `/templates/${slug}`, true)
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const result = await readTemplateDetail(slug)
  if (result.status !== 'available') notFound()
  const { item } = result

  return <PageMain className="max-w-5xl">
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: item.name,
      description: item.summary,
      url: `https://fuma.co.ke/templates/${item.slug}`,
      category: 'Website template',
    })} />
    <Breadcrumbs items={[{ label: 'Templates', href: '/templates' }, { label: item.name, href: `/templates/${item.slug}` }]} />
    <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,.8fr)]">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Approved exact release</p>
        <h1 className="mt-4 text-4xl font-semibold sm:text-5xl">{item.name}</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">{item.summary}</p>
        <div aria-label="Template metadata" className="mt-6 flex flex-wrap gap-2">
          {item.profiles.map((tag) => <Tag key={`profile-${tag}`}>{tag}</Tag>)}
          {item.capabilities.map((tag) => <Tag key={`capability-${tag}`}>{tag}</Tag>)}
          {item.industries.map((tag) => <Tag key={`industry-${tag}`}>{tag}</Tag>)}
          {item.styles.map((tag) => <Tag key={`style-${tag}`}>{tag}</Tag>)}
        </div>
      </div>
      <img alt={item.image.alt} className="aspect-[16/9] h-auto w-full rounded-xl border object-cover" decoding="async" height={item.image.height} src={item.image.url} width={item.image.width} />
    </div>
    <section aria-labelledby="template-accessibility" className="mt-10 rounded-xl border p-6">
      <h2 id="template-accessibility" className="text-xl font-semibold">Accessibility review</h2>
      <p className="mt-2 text-sm text-muted-foreground">{item.accessibility.standard} · keyboard, reduced motion, and high contrast checked</p>
      <ul className="mt-3 list-disc space-y-2 pl-6">{item.accessibility.notes.map((note) => <li key={note}>{note}</li>)}</ul>
    </section>
    <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <CTA href={item.previewUrl}>Open immutable preview</CTA>
      <CTA secondary href={installTemplateHref(item.id)}>Use this template</CTA>
    </div>
    <p className="mt-5 text-sm leading-6 text-muted-foreground">Release {item.releaseId}. The product revalidates current approval and the exact retained release after handoff. Web transfers only the stable template ID and never copies template artifacts.</p>
  </PageMain>
}
