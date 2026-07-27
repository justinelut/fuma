import { ClaimList, CTA, FeatureGrid, Hero } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata('Solutions', 'Choose a Fuma journey by the work you want to publish.', '/solutions')

export default function Page() {
  return <PageMain>
    <Hero eyebrow="Choose by outcome" title="Different work. One ownership model." description="Start with a business website, a portfolio or an editorial publication. The choice sets a useful starting surface; it does not create a separate product fork.">
      <CTA href="/website">Website journey</CTA>
      <CTA href="/publication" secondary>Publication journey</CTA>
    </Hero>
    <FeatureGrid heading="Where each journey can begin" items={[
      { title: 'Small organisations', body: 'Explain services, show work and create a direct home for enquiries.' },
      { title: 'Independent creators', body: 'Bring a portfolio and recurring writing into a destination you shape.' },
      { title: 'Editorial teams', body: 'Coordinate recurring drafts, collections and designed reading experiences.' },
    ]} />
    <ClaimList ids={['single-workflow', 'kenya-context']} heading="Shared foundations" />
  </PageMain>
}
