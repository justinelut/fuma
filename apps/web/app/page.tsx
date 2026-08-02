import { ClaimList, CTA, JourneyChoices } from '@/components/public-sections'
import { HomeHero } from '@/components/home-hero'
import { FactStrip } from '@/components/section-kit'
import { NativeImage } from '@/components/native-image'
import { CapabilityBento } from '@/components/capability-bento'
import { BuiltWithFuma } from '@/components/built-with-fuma'
import { EcosystemSection, PublishingSection } from '@/components/home-sections'
import { PlatformGrid } from '@/components/platform-grid'
import { StackCollapse } from '@/components/stack-collapse'
import { ViewSourceProof } from '@/components/view-source-proof'
import { PageMain } from '@/components/site-shell'
import { jsonLd, publicMetadata } from '@/lib/seo'
import { websiteStructuredData } from '@/lib/structured-data'

export const metadata = publicMetadata(
  'Fuma',
  'One platform holds the visual editor, content engine, media, forms and publisher.',
  '/',
)

/**
 * Homepage composition.
 *
 * The section pattern is measured, not assumed. At 1440px, framer.com and vercel.com use ZERO
 * two-column text-beside-image splits on their homepages; their anchors are text blocks above
 * near-full-bleed visuals (framer 1200px of 1440 = 83%; vercel 921-1165px = 64-81%) with 3-, 4- and
 * 12-column grids carrying enumeration. This page previously used six alternating text/image
 * sections, which is the agency-template pattern. Every section after the platform grid now earns
 * its space with a functional miniature of the surface it describes rather than prose about it.
 *
 * Imagery discipline: only the two captures that genuinely have content are shown full-bleed. The
 * remaining surfaces are enumerated as type, because full-bleeding a near-empty screenshot makes a
 * page look thinner, not richer.
 *
 * Positioning: Fuma is a closed, owned platform. No self-hosting, infrastructure, deployment,
 * database-ownership or licence language appears anywhere on this page.
 */
export default function Page() {
  return <PageMain className="!max-w-none !px-0 !py-0">
    <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(websiteStructuredData())} />

    <HomeHero />

    <FactStrip
      facts={[
        ['1.1 kB', 'The only runtime a visitor loads, and only for per-visitor parts'],
        ['38', 'Capabilities that roles are built from'],
        ['One', 'Platform holding editor, content, media, forms and publisher'],
        ['Unified', 'One workflow instead of seven vendor handoffs'],
      ]}
    />

    <PlatformGrid />

    <CapabilityBento />

    <ViewSourceProof />

    <BuiltWithFuma />

    <section className="section">
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
        <div className="max-w-2xl">
          <p className="eyebrow">Observe</p>
          <h2 className="font-display text-display-lg text-balance">An operational view, honestly scoped.</h2>
          <p className="mt-5 max-w-xl text-lede text-muted-foreground text-pretty">
            The analytics surface is deliberately operational today: dashboard status, audit history
            and owned form data rather than third-party visitor tracking. We would rather ship that
            than imply more.
          </p>
        </div>
        <CTA href="/status" secondary>See service status</CTA>
      </div>

      <div className="mt-12 grid min-w-0 gap-px overflow-hidden rounded-surface border border-border bg-border lg:grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)]">
        <div className="min-w-0 bg-card p-5 sm:p-6">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground">Dashboard, arranged per user</p>
          <div className="mt-4 fuma-rimlit overflow-hidden rounded-panel">
            <NativeImage
              alt="The Fuma dashboard showing site statistics, an activity feed and status widgets on a configurable grid"
              className="block h-auto w-full"
              height={1000}
              sizes="(min-width: 1024px) 55vw, 100vw"
              src="/product/dashboard.webp"
              unoptimized
              width={1600}
            />
          </div>
        </div>

        {/* The audit log is the honest heart of this claim, so it is shown rather than described. */}
        <div className="min-w-0 bg-background p-5 sm:p-6">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground">Append-only audit log</p>
          <ul className="mt-4 grid gap-px overflow-hidden rounded-lg border border-border/70 bg-border/40">
            {[
              ['role.updated', 'Editor'],
              ['content.published', 'Field notes'],
              ['plugin.activated', 'sitemap'],
              ['session.revoked', 'all devices'],
              ['user.deleted', 'step-up required'],
            ].map(([event, subject]) => <li className="flex min-w-0 flex-col items-start gap-1 bg-card px-3 py-2 text-[0.78rem] sm:flex-row sm:items-center sm:justify-between sm:gap-3" key={event}>
              <span className="min-w-0 break-all font-mono text-foreground/85">{event}</span>
              <span className="min-w-0 break-words font-mono text-[0.7rem] text-muted-foreground sm:shrink-0">{subject}</span>
            </li>)}
          </ul>
          <p className="mt-4 text-[0.8125rem] leading-6 text-muted-foreground">
            Append-only, so it is a record of who did what and when rather than something anyone can
            quietly rewrite.
          </p>
          <dl className="mt-6 grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
            {[['12-column grid', 'Drag, resize, rearrange'], ['Saved per user', 'Not the team default']].map(([k, v]) => <div key={k}>
              <dt className="text-[0.8125rem] font-medium">{k}</dt>
              <dd className="mt-1 text-[0.75rem] leading-5 text-muted-foreground">{v}</dd>
            </div>)}
          </dl>
        </div>
      </div>
    </section>

    <PublishingSection />

    <StackCollapse />

    <EcosystemSection />

    {/* One balanced close: CTA first, two outcome paths across the full width, then two
        accountability receipts across the full width. No stretched column or filler content. */}
    <section className="section border-t border-border !pb-0" data-fuma-home-close>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
        <h2 className="max-w-[20ch] font-display text-display-xl text-balance">Build the site you actually wanted.</h2>
        <div className="lg:pb-1">
          <p className="max-w-lg text-lede text-muted-foreground text-pretty">
            For people who build for a living, and for anyone who would rather design the thing
            than assemble the stack underneath it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <CTA href="/start?kind=sign_up&source=home">Start building</CTA>
            <CTA href="/docs" secondary>Read the docs</CTA>
          </div>
        </div>
      </div>

      <div className="mt-16 border-t border-line-soft pt-12">
        <JourneyChoices embedded />
      </div>

      <div className="mt-16 border-t border-line-soft pt-12">
        <ClaimList columns={2} heading="What we will stand behind" ids={['single-workflow', 'clean-output']} />
      </div>
    </section>

  </PageMain>
}
