import { Hero } from '@/components/public-sections'
import { PricingCatalog } from '@/components/pricing-catalog'
import { PageMain } from '@/components/site-shell'
import { readPublicData } from '@/lib/public-data'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Pricing',
  'Current publish-approved Fuma pricing in Kenyan shillings.',
  '/pricing',
)
export const dynamic = 'force-dynamic'

type PricingCadence = 'monthly' | 'annual'
type PricingProfile = 'website' | 'publication'

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ cadence?: string | string[]; profile?: string | string[] }>
}) {
  const raw = await searchParams
  const cadence: PricingCadence = raw.cadence === 'annual' ? 'annual' : 'monthly'
  const profile: PricingProfile | undefined = raw.profile === 'publication'
    ? 'publication'
    : raw.profile === 'website'
      ? 'website'
      : undefined
  const envelope = await readPublicData('pricing', { cadence, profile, limit: 100 })

  return <PageMain>
    <Hero
      description="Amounts, allowances, promotions and checkout availability come directly from the platform pricing authority. If that evidence is not safe and current, this page hides it."
      eyebrow="Authoritative pricing"
      title="Clear KES pricing, only when approved."
    />
    <PricingCatalog cadence={cadence} envelope={envelope} profile={profile} />
  </PageMain>
}
