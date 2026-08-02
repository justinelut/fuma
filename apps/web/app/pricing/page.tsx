import { CTA } from '@/components/public-sections'
import { PageMain } from '@/components/site-shell'
import { PricingCatalog } from '@/components/pricing-catalog'
import { readPublicData } from '@/lib/public-data'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Pricing',
  'Compare current Fuma plans and choose the right fit for your work.',
  '/pricing',
)
export const dynamic = 'force-dynamic'

type PricingCadence = 'monthly' | 'annual'
type PricingProfile = 'website' | 'publication'

const pricePath = [
  {
    detail: 'Every amount, allowance and promotion comes from the current published plan.',
    label: 'Published',
  },
  {
    detail: 'Expired or withdrawn plans disappear instead of leaving an outdated price behind.',
    label: 'Up to date',
  },
  {
    detail: 'Before checkout, Fuma confirms the plan and price are still available to you.',
    label: 'Confirmed',
  },
] as const

const pricingNotes = [
  ['Amounts', 'Shown only for a current published plan.'],
  ['Purchase actions', 'Available only when checkout is open for that plan.'],
  ['Promotions', 'Shown only while the published offer is active.'],
  ['Commitment', 'Choosing a plan lets you review it in Fuma; it does not charge you.'],
] as const

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

  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="page-title" className="section fuma-glow pt-16 sm:pt-24">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.12fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow fuma-rise">Pricing</p>
          <h1 className="fuma-rise max-w-[16ch] font-display text-display-xl text-balance" id="page-title">
            Choose a plan with current, published pricing.
          </h1>
        </div>
        <div className="lg:pb-1">
          <p className="fuma-rise max-w-xl text-lede text-muted-foreground text-pretty">
            Compare plans, allowances and billing periods. If a current price is unavailable, Fuma
            hides the purchase action rather than showing an estimate.
          </p>
          <div className="fuma-rise mt-8 flex flex-wrap items-center gap-2.5">
            <CTA href="#published-catalog">Compare plans</CTA>
            <CTA href="/solutions" secondary>Choose what you’re building</CTA>
          </div>
        </div>
      </div>

      <ol aria-label="How Fuma keeps pricing current" className="mt-16 grid border-y border-border sm:mt-24 lg:grid-cols-3">
        {pricePath.map((item, index) => <li
          className="border-b border-border py-6 last:border-b-0 lg:border-b-0 lg:border-l lg:px-7 lg:first:border-l-0 lg:first:pl-0 lg:last:pr-0"
          key={item.label}
        >
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-signal-bright">
            Step {String(index + 1).padStart(2, '0')}
          </p>
          <h2 className="mt-5 font-display text-display-md">{item.label}</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{item.detail}</p>
        </li>)}
      </ol>
    </section>

    <section aria-labelledby="catalog-title" className="section" id="published-catalog">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.78fr)_minmax(20rem,0.5fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Plans</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="catalog-title">
            Find the right fit for your work.
          </h2>
        </div>
        <p className="max-w-xl text-lede text-muted-foreground text-pretty lg:pb-1">
          Switch between monthly and annual billing, or filter by Website and Publication.
        </p>
      </div>

      <div className="mt-12 overflow-hidden rounded-surface border border-line-strong bg-card">
        <div className="flex flex-wrap items-start justify-between gap-5 border-b border-border bg-surface-inset px-5 py-4 sm:px-8">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-foreground">Available plans</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Use the filters to narrow the comparison.</p>
          </div>
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">Current pricing</p>
        </div>
        <div className="px-4 pb-5 sm:px-8 sm:pb-8 lg:px-10 lg:pb-10">
          <PricingCatalog cadence={cadence} envelope={envelope} profile={profile} />
        </div>
      </div>
    </section>

    <section aria-labelledby="pricing-notes" className="border-y border-border bg-card">
      <div className="section grid gap-12 lg:grid-cols-[minmax(18rem,0.6fr)_minmax(0,1fr)] lg:gap-24">
        <div>
          <p className="eyebrow">Clear pricing</p>
          <h2 className="max-w-[14ch] font-display text-display-lg text-balance" id="pricing-notes">
            If it isn’t current, it isn’t shown.
          </h2>
          <p className="mt-5 max-w-md text-lede text-muted-foreground text-pretty">
            Fuma shows only the plan details available now. You can review everything again before checkout.
          </p>
        </div>

        <dl className="border-t border-border">
          {pricingNotes.map(([term, detail]) => <div
            className="grid gap-3 border-b border-border py-6 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-8"
            key={term}
          >
            <dt className="text-sm font-medium">{term}</dt>
            <dd className="max-w-2xl text-sm leading-7 text-muted-foreground">{detail}</dd>
          </div>)}
        </dl>
      </div>
    </section>

    <section aria-labelledby="pricing-close" className="section !pb-0">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,0.58fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">Not sure yet?</p>
          <h2 className="max-w-[17ch] font-display text-display-xl text-balance" id="pricing-close">
            Start with what you want to publish.
          </h2>
        </div>
        <div className="lg:pb-1">
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">
            Compare Website and Publication, then return when you know which workflow fits your work.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <CTA href="/solutions">Compare options</CTA>
            <CTA href="/contact" secondary>Talk to Fuma</CTA>
          </div>
        </div>
      </div>
    </section>
  </PageMain>
}
