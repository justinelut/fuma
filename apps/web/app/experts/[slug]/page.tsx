import { Breadcrumbs } from '@/components/breadcrumbs'
import { ContactForm } from '@/components/contact-form'
import { CTA, Tag } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { readPublicData } from '@/lib/public-data'
import { jsonLd, publicMetadata } from '@/lib/seo'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = await readPublicData('experts', { limit: 100 })
  const item = data?.data.items.find((value) => value.slug === slug)
  return publicMetadata(item?.publicName ?? 'Expert profile', item?.summary ?? 'Expert unavailable.', `/experts/${slug}`, !item)
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = await readPublicData('experts', { limit: 100 })
  const item = data?.data.items.find((value) => value.slug === slug)
  if (!item) notFound()

  return <PageMain className="max-w-5xl">
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd({
      '@context': 'https://schema.org',
      '@type': ['studio', 'agency'].includes(item.expertType) ? 'Organization' : 'Person',
      name: item.publicName,
      description: item.summary,
      url: `https://fuma.co.ke/experts/${item.slug}`,
      areaServed: item.location,
      knowsAbout: item.skills,
    })} />
    <Breadcrumbs items={[{ label: 'Experts', href: '/experts' }, { label: item.publicName, href: `/experts/${item.slug}` }]} />
    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{item.expertType} · {item.location}</p>
    <h1 className="mt-4 text-5xl font-semibold">{item.publicName}</h1>
    <p className="mt-5 max-w-3xl text-lg text-muted-foreground">{item.summary}</p>
    <h2 className="mt-10 text-2xl font-semibold">Skills and services</h2>
    <div className="mt-4 flex flex-wrap gap-2">{[...item.skills, ...item.services].map((tag) => <Tag key={tag}>{tag}</Tag>)}</div>
    {item.mediatedInquiryAvailable
      ? <section className="mt-12 border-t pt-10" aria-labelledby="expert-inquiry-heading">
          <h2 id="expert-inquiry-heading" className="text-2xl font-semibold">Send a mediated inquiry</h2>
          <p className="mt-3 text-muted-foreground">Fuma forwards this bounded request through the server without exposing private recipient details. Approval and availability are checked again.</p>
          <ContactForm kind="expert_inquiry" expertId={item.id} />
          <div className="mt-6"><CTA secondary href={`/start?kind=contact_expert&source=expert&expertId=${item.id}`}>Continue inquiry in the application</CTA></div>
        </section>
      : <p role="status" className="mt-10 text-muted-foreground">This expert is not accepting mediated inquiries.</p>}
  </PageMain>
}
