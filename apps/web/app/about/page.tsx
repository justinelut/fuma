import { ClaimList, CTA, Hero } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata('About', 'Why Fuma is building a Kenya-first independent publishing product.', '/about')

export default function Page() {
  return <PageMain>
    <Hero eyebrow="About Fuma" title="The web should still belong to the people building it." description="Fuma is being shaped for independent creators and teams who care about the craft and ownership of what they put online.">
      <CTA href="/blog" secondary>Read our thinking</CTA>
      <CTA href="/contact">Talk to us</CTA>
    </Hero>
    <section aria-labelledby="about-principles" className="mt-16">
      <h2 id="about-principles" className="text-3xl font-semibold">A coherent product, with honest boundaries</h2>
      <div className="mt-7 grid gap-8 text-lg leading-8 text-muted-foreground lg:grid-cols-2">
        <p>Modern web work can mean stitching together editors, frameworks, hosts, forms and analytics. Fuma’s reviewed product direction brings the building and publishing workflow together while keeping the result understandable.</p>
        <p>Mutable product, commercial, marketplace and identity facts stay behind their owning authorities. These public pages explain the journey; they do not become a second billing system, directory or session service.</p>
      </div>
    </section>
    <ClaimList ids={['kenya-context']} heading="What Kenya-first means here" />
    <section aria-labelledby="about-trust" className="mt-12 rounded-2xl border p-7 sm:p-10">
      <h2 id="about-trust" className="text-2xl font-semibold">See the operating boundaries</h2>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">Review public security, privacy and data-authority commitments before continuing.</p>
      <div className="mt-5"><CTA href="/trust" secondary>Visit the trust centre</CTA></div>
    </section>
  </PageMain>
}
