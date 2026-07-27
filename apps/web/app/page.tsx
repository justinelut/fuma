import { ClaimList, CTA, FeatureGrid, Hero, JourneyChoices, ProductMedia } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { jsonLd, publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata('Own your publishing', 'Build an independent website or publication with a Kenya-first working context.', '/')

export default function HomePage() {
  return <PageMain>
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Fuma', url: 'https://fuma.co.ke', inLanguage: 'en-KE' })} />
    <Hero eyebrow="Kenya-first independent publishing" title="Your work deserves a home you own." description="Begin with the outcome: a crafted website or a publication built for recurring ideas. Both paths keep the building, content and publishing work together.">
      <CTA href="/website">Build a website</CTA>
      <CTA href="/publication" secondary>Start a publication</CTA>
    </Hero>
    <ProductMedia mode="canvas" caption="A responsive canvas, content structure and design controls shown together." />
    <JourneyChoices />
    <FeatureGrid heading="One clear publishing loop" intro="Move from structure to content to a published result without presenting the public website as a second product authority." items={[
      { title: 'Design in context', body: 'Build pages on a visual canvas with reusable components and a coherent design system.' },
      { title: 'Keep content together', body: 'Work with pages, posts, media, forms and structured data from one product workflow.' },
      { title: 'Publish clean output', body: 'The reviewed publishing claim covers semantic HTML and compact CSS without the editor interface.' },
    ]} />
    <ClaimList ids={['single-workflow', 'kenya-context']} heading="Kenya-first, reviewed facts" />
    <section aria-labelledby="home-start" className="mt-16 rounded-2xl bg-brand-mint p-7 text-brand-black sm:mt-20 sm:p-12">
      <h2 id="home-start" className="text-3xl font-semibold">Start with the work you want to put online.</h2>
      <p className="mt-3 max-w-2xl text-lg leading-8">Continue through the public handoff. Identity and application sessions remain on their own authority and host.</p>
      <div className="mt-6"><CTA href="/start?kind=sign_up&source=home">Continue safely</CTA></div>
    </section>
  </PageMain>
}
