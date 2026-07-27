import { ClaimList, CTA, FeatureGrid, Hero, ProductMedia } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata('Publication', 'Write, organise and publish an independent publication.', '/publication')

export default function Page() {
  return <PageMain>
    <Hero eyebrow="Publication journey" title="A serious home for recurring ideas." description="Choose this path for a blog, magazine, newsletter, newsroom or editorial team. It begins with publishing rhythms while keeping design available.">
      <CTA href="/start?kind=create_site&source=product&profile=publication">Create a publication</CTA>
      <CTA href="/website" secondary>Compare Website</CTA>
    </Hero>
    <ProductMedia mode="editorial" caption="An editorial workspace and designed reading preview shown side by side." />
    <FeatureGrid heading="Built around the next edition" items={[
      { title: 'Editorial workflow', body: 'Move work from draft toward scheduled and published states without presenting unfinished edits publicly.' },
      { title: 'Collections and authors', body: 'Organise recurring formats, categories and contributors around one publication.' },
      { title: 'Designed reading', body: 'Use a coherent typography and spacing system with reusable story layouts.' },
      { title: 'Published history', body: 'Keep a dependable record of published copy as work evolves.' },
      { title: 'Your reading surface', body: 'Give readers a direct destination for your publication rather than a platform-feed description.' },
      { title: 'Clean delivery', body: 'The approved output claim covers semantic HTML and compact CSS without the editor interface.' },
    ]} />
    <ClaimList ids={['draft-isolation', 'clean-output']} />
  </PageMain>
}
