import { ClaimList, CTA, FeatureGrid, Hero, ProductMedia } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata('Website builder', 'Design, manage and publish an independent website.', '/website')

export default function Page() {
  return <PageMain>
    <Hero eyebrow="Website journey" title="Build the site. Keep the craft." description="Choose this path for a portfolio, service business, campaign, organisation or content-rich website. You can change capabilities later; this choice simply gives you a useful starting point.">
      <CTA href="/start?kind=create_site&source=product&profile=website">Create a website</CTA>
      <CTA href="/publication" secondary>Compare Publication</CTA>
    </Hero>
    <ProductMedia mode="canvas" caption="Website pages across a responsive canvas with design controls beside the work." />
    <FeatureGrid heading="A website workflow, end to end" items={[
      { title: 'Visual canvas', body: 'Compose responsive pages directly with reusable modules and components.' },
      { title: 'Design system', body: 'Set colour, type and spacing choices once, then use them consistently.' },
      { title: 'Pages and data', body: 'Bring content, media and custom collections into the same working surface.' },
      { title: 'Publishing', body: 'Publish a clean result without carrying the editor interface into the public page.' },
      { title: 'Owned forms', body: 'Retain form submissions in site-owned data tables rather than requiring a third-party embed.' },
      { title: 'A safe next step', body: 'The public journey passes only a closed site-creation choice to the application handoff.' },
    ]} />
    <ClaimList ids={['clean-output', 'owned-form-data']} />
  </PageMain>
}
