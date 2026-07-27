import { ClaimList, CTA, FeatureGrid, Hero } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata('Features', 'Explore the Fuma building, content and publishing workflow.', '/features')

export default function Page() {
  return <PageMain>
    <Hero eyebrow="One working loop" title="From first block to published page." description="Explore the parts of the building and publishing workflow, then choose Website or Publication by the outcome you need.">
      <CTA href="/website">Explore Website</CTA>
      <CTA href="/publication" secondary>Explore Publication</CTA>
    </Hero>
    <FeatureGrid heading="Tools around the work" items={[
      { title: 'Canvas editor', body: 'Arrange responsive layouts and edit content in context.' },
      { title: 'Reusable components', body: 'Define reusable design pieces with typed content slots.' },
      { title: 'Content and data', body: 'Work with articles, pages and custom collections in one system.' },
      { title: 'Media workspace', body: 'Organise assets, track where they are used and replace files deliberately.' },
      { title: 'Templates and loops', body: 'Wrap shared structure and repeat content from approved sources.' },
      { title: 'Forms', body: 'Build semantic forms whose submissions can remain in site-owned data tables.' },
      { title: 'Permissioned extensions', body: 'Extend approved surfaces through bounded capabilities.' },
      { title: 'Editable assistance', body: 'Assisted output enters the same editable structures as other page work.' },
      { title: 'Publisher', body: 'Emit the reviewed clean-output format at the end of the workflow.' },
    ]} />
    <ClaimList ids={['single-workflow', 'owned-form-data']} />
    <div className="mt-8"><CTA href="/start?kind=sign_up&source=solution">Continue through the safe handoff</CTA></div>
  </PageMain>
}
