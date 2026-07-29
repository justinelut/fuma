import type { PublicPricingCatalogEnvelope, PublicPricingDisplayPlan } from '@fuma/public-contracts'
import { AuthorityUnavailable, CTA, Tag } from '@/components/public-sections'
import {
  activePromotion,
  formatKes,
  formatPricingQuota,
  pricingPlanIntentHref,
  visiblePricing,
} from '@/lib/public-data'

type PricingCadence = 'monthly' | 'annual'
type PricingProfile = 'website' | 'publication'

function words(value: string): string {
  return value.replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
}

function cadenceLabel(cadence: PricingCadence): string {
  return cadence === 'monthly' ? 'month' : 'year'
}

function promotionEnd(value: string): string {
  return new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeZone: 'Africa/Nairobi' }).format(new Date(value))
}

function cadenceHref(cadence: PricingCadence, profile?: PricingProfile): string {
  const query = new URLSearchParams({ cadence })
  if (profile) query.set('profile', profile)
  return `/pricing?${query.toString()}`
}

function profileHref(cadence: PricingCadence, profile?: PricingProfile): string {
  const query = new URLSearchParams({ cadence })
  if (profile) query.set('profile', profile)
  return `/pricing?${query.toString()}`
}

function PriceCard({ plan, version, now }: Readonly<{
  plan: PublicPricingDisplayPlan
  version: string
  now: Date
}>) {
  const promotion = activePromotion(plan, now)
  const headingId = `pricing-${plan.id}`
  return <article aria-labelledby={headingId} className="flex min-w-0 flex-col rounded-2xl border bg-card p-5 sm:p-7">
    <p className="text-sm font-medium capitalize text-muted-foreground">{plan.profile} · {plan.cadence}</p>
    <h2 className="mt-2 text-2xl font-semibold" id={headingId}>{plan.name}</h2>
    <p className="mt-3 min-h-14 leading-7 text-muted-foreground">{plan.summary}</p>
    <p className="mt-7 text-[clamp(2rem,9vw,3.25rem)] font-semibold leading-none tracking-tight">
      <span className="sr-only">Price: </span>{formatKes(plan.amountMinor)}
    </p>
    <p className="mt-2 text-sm text-muted-foreground">per {cadenceLabel(plan.cadence)}, billed {plan.cadence}</p>
    {promotion && <p className="mt-5 rounded-lg bg-brand-mint p-3 text-sm font-medium text-brand-black">
      {promotion.label} until <time dateTime={promotion.endsAt}>{promotionEnd(promotion.endsAt)}</time>
    </p>}
    <section aria-labelledby={`${headingId}-features`} className="mt-7">
      <h3 className="text-sm font-semibold" id={`${headingId}-features`}>Included features</h3>
      <ul className="mt-3 flex flex-wrap gap-2">
        {plan.featureKeys.map((key) => <li key={key}><Tag>{words(key)}</Tag></li>)}
      </ul>
    </section>
    <section aria-labelledby={`${headingId}-quotas`} className="mt-7">
      <h3 className="text-sm font-semibold" id={`${headingId}-quotas`}>Published allowances</h3>
      <dl className="mt-3 grid gap-3 text-sm">
        {plan.quotas.map((quota) => <div className="flex items-start justify-between gap-4 border-b pb-3 last:border-0" key={quota.key}>
          <dt className="text-muted-foreground">{quota.label}</dt>
          <dd className="text-right font-medium">{formatPricingQuota(quota.limit, quota.unit)}</dd>
        </div>)}
      </dl>
    </section>
    <div className="mt-auto pt-8">
      {plan.checkoutAvailable
        ? <CTA href={pricingPlanIntentHref(plan, version)}>Choose {plan.name}</CTA>
        : <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground" role="status">Checkout is not currently available for this plan.</p>}
    </div>
  </article>
}

function Comparison({ plans, cadence }: Readonly<{ plans: readonly PublicPricingDisplayPlan[]; cadence: PricingCadence }>) {
  const quotaKeys = [...new Set(plans.flatMap((plan) => plan.quotas.map(({ key }) => key)))]
  return <section aria-labelledby="pricing-comparison" className="mt-16 sm:mt-20">
    <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl" id="pricing-comparison">Compare published allowances</h2>
    <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">A horizontal view of the same authority-backed details. Scroll the table on a narrow screen.</p>
    <div className="mt-7 overflow-x-auto rounded-xl border" tabIndex={0}>
      <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
        <caption className="sr-only">Published plan comparison for {cadence} billing</caption>
        <thead className="bg-secondary">
          <tr><th className="p-4" scope="col">Plan detail</th>{plans.map((plan) => <th className="p-4" key={plan.id} scope="col">{plan.name}</th>)}</tr>
        </thead>
        <tbody>
          <tr className="border-t"><th className="p-4 font-medium" scope="row">Price per {cadenceLabel(cadence)}</th>{plans.map((plan) => <td className="p-4 font-semibold" key={plan.id}>{formatKes(plan.amountMinor)}</td>)}</tr>
          <tr className="border-t"><th className="p-4 font-medium" scope="row">Built for</th>{plans.map((plan) => <td className="p-4 capitalize" key={plan.id}>{plan.profile}</td>)}</tr>
          {quotaKeys.map((key) => {
            const label = plans.flatMap((plan) => plan.quotas).find((quota) => quota.key === key)?.label ?? words(key)
            return <tr className="border-t" key={key}><th className="p-4 font-medium" scope="row">{label}</th>{plans.map((plan) => {
              const quota = plan.quotas.find((candidate) => candidate.key === key)
              return <td className="p-4" key={plan.id}>{quota ? formatPricingQuota(quota.limit, quota.unit) : 'Not included'}</td>
            })}</tr>
          })}
        </tbody>
      </table>
    </div>
  </section>
}

export function PricingCatalog({ envelope, cadence, profile, now = new Date() }: Readonly<{
  envelope: PublicPricingCatalogEnvelope | null
  cadence: PricingCadence
  profile?: PricingProfile
  now?: Date
}>) {
  const plans = visiblePricing(envelope, now)
  const version = envelope?.data.effectiveVersion
  return <>
    <nav aria-label="Pricing cadence" className="mt-10 flex flex-wrap gap-2">
      {(['monthly', 'annual'] as const).map((value) => <a
        aria-current={value === cadence ? 'page' : undefined}
        className={`inline-flex min-h-11 items-center rounded-full border px-5 py-2 text-sm font-semibold ${value === cadence ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}`}
        href={cadenceHref(value, profile)}
        key={value}
      >{words(value)} billing</a>)}
    </nav>
    <nav aria-label="Pricing profile" className="mt-4 flex max-w-full gap-2 overflow-x-auto pb-1">
      {([
        [undefined, 'All plans'],
        ['website', 'Website'],
        ['publication', 'Publication'],
      ] as const).map(([value, label]) => <a
        aria-current={value === profile || (value === undefined && profile === undefined) ? 'page' : undefined}
        className="inline-flex min-h-11 shrink-0 items-center rounded-full border bg-card px-4 py-2 text-sm font-medium hover:bg-secondary"
        href={profileHref(cadence, value)}
        key={label}
      >{label}</a>)}
    </nav>
    {plans.length === 0 || !version
      ? <AuthorityUnavailable subject="Pricing" detail="Current publish-approved pricing is unavailable. Amounts and purchase actions stay hidden until the pricing authority publishes a complete, current and commercially approved catalog." />
      : <>
        <p className="mt-8 text-xs text-muted-foreground">Effective catalog version <span className="font-mono">{version}</span></p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{plans.map((plan) => <PriceCard key={plan.id} now={now} plan={plan} version={version} />)}</div>
        <Comparison cadence={cadence} plans={plans} />
      </>}
    <aside aria-labelledby="pricing-resolution" className="mt-10 rounded-xl bg-secondary p-5 sm:p-6">
      <h2 className="font-semibold" id="pricing-resolution">The application confirms your selection</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Choosing a plan creates only an opaque, short-lived handoff. The Fuma application re-resolves the plan, effective price-book version, cadence, availability and eligibility before checkout. This public display is not a payment commitment.</p>
    </aside>
  </>
}
