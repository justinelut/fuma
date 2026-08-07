/**
 * The seeded plans, so limits apply from the moment somebody signs up.
 *
 * WHY THIS SEEDS A DRAFT AND NOT A PUBLISHED PRICE BOOK, which is the central decision.
 *
 * `PriceBookSchema` demands `economics: EconomicsEvidence` on every plan, and publishing runs
 * `assertLaunchEconomics`, which refuses a gross margin below 70% or variable COGS above 30%.
 * Those figures are computed from costBaseline.ts, whose own comment calls its UNIT_COSTS
 * "deliberately nonzero fail-closed launch assumptions, not invoice claims" - and
 * origin_bandwidth_bytes there implies about USD 20 per GB against OCI's published ~USD 0.0085.
 * So publishing today would either refuse a sound plan or pass one on arithmetic nobody can
 * stand behind, and the number it printed would be quoted later as though it meant something.
 *
 * `PriceBookDraftSchema` takes `PlanDefinition`, which carries QUOTAS AND NO ECONOMICS. That
 * split is the useful one: how much a plan INCLUDES is a product decision, while what it COSTS
 * US is measurement. The first is knowable now and is what the builder and the allowance surface
 * need; the second is tasks 104/106 and is blocked on data rather than on effort.
 *
 * A NOTE ON "UNLIMITED": assertFiniteQuotas requires every one of the fourteen quota classes to
 * be a finite positive integer, so there is NO WAY to express unlimited here - deliberately, and
 * it agrees with the allowance surface's own rule that an unknown limit is not an unlimited one.
 * Every number below is therefore a promise somebody can hold us to.
 */
import { Value } from '@core/utils/typeboxHelpers'
import { marginClaimReadiness } from '../metering/costProvenance'
import { PriceBookDraftSchema, type PlanDefinition, type PriceBookDraft, type QuotaEnvelope } from './contracts'

const MB = 1_048_576
const GB = 1_024 * MB

/**
 * The free tier.
 *
 * ONE PAGE is a product decision, not a technical bound: the free tier exists to let somebody
 * publish something real and see it work, and one page does that while making the reason to
 * upgrade obvious from the first minute rather than after a surprise.
 *
 * Email is capped at 100/day and 3,000/month because assertFiniteQuotas REFUSES a Fuma-funded
 * plan above those, and this plan is funded by us - so the cap is not a preference, it is the
 * limit the entitlement layer already enforces.
 */
const STARTER_QUOTAS: QuotaEnvelope = Object.freeze({
  sites: 1,
  // One page. Task 68 enforces this inside the builder; the number lives here so the builder and
  // the billing layer cannot disagree about what the free tier includes.
  pages: 1,
  cmsItems: 50,
  members: 100,
  storageBytes: 512 * MB,
  bandwidthBytes: 5 * GB,
  emailRecipientsDay: 100,
  emailRecipientsMonth: 3_000,
  buildPublishMinutes: 60,
  pluginComputeMinutes: 30,
  aiCredits: 100,
  // Release retention is smaller than storage on purpose: it holds previous builds for rollback,
  // and a free tier that retains many of them spends our storage on history nobody asked for.
  releaseRetentionBytes: 256 * MB,
  collaborators: 1,
  customDomains: 1,
})

/**
 * The first paid tier.
 *
 * Its AMOUNT is deliberately marked as not yet checkout-available, because a price nobody has
 * checked against measured cost is a number to review rather than one to charge. The quotas are
 * real and enforceable now; the price waits for task 106.
 */
const STUDIO_QUOTAS: QuotaEnvelope = Object.freeze({
  sites: 3,
  pages: 100,
  cmsItems: 5_000,
  members: 10_000,
  storageBytes: 20 * GB,
  bandwidthBytes: 200 * GB,
  emailRecipientsDay: 2_000,
  emailRecipientsMonth: 50_000,
  buildPublishMinutes: 1_200,
  pluginComputeMinutes: 600,
  aiCredits: 5_000,
  releaseRetentionBytes: 10 * GB,
  collaborators: 5,
  customDomains: 5,
})

/**
 * Workload assumptions describe EXPECTED usage, not the cap.
 *
 * They exist so economics can be computed later against what a plan is actually likely to
 * consume. Setting them equal to the quota would assume every account saturates its plan, which
 * makes every margin look worse than it is and prices the product for a customer who does not
 * exist. Set well below the cap, which is what a real distribution looks like.
 */
function assumptionsFor(quotas: QuotaEnvelope, share: number): PlanDefinition['workloadAssumptions'] {
  const part = (value: number): number => Math.max(0, Math.floor(value * share))
  // MILLISECONDS, not minutes. The quota is expressed in minutes and the assumption in
  // milliseconds; I had these confused and the typechecker caught it against the real schema.
  // Mixing them would have understated compute by 60,000x, which would make every margin look
  // wonderful for exactly the meter most likely to cost real money.
  const ms = (minutes: number): number => part(minutes) * 60_000
  return Object.freeze({
    sites: quotas.sites,
    pages: part(quotas.pages),
    cms_items: part(quotas.cmsItems),
    members: part(quotas.members),
    // Source and variant are separate meters: an upload is stored once and then derived into
    // several sizes, so variants are usually the larger figure rather than an equal one.
    storage_source_bytes: part(quotas.storageBytes),
    storage_variant_bytes: part(quotas.storageBytes),
    storage_release_bytes: part(quotas.releaseRetentionBytes),
    // Backups are OUR obligation rather than the tenant's usage, so they are assumed at the
    // stored size rather than a fraction - we back up what exists, not what they expected.
    storage_local_backup_bytes: part(quotas.storageBytes),
    storage_offsite_bytes: part(quotas.storageBytes),
    origin_bandwidth_bytes: part(quotas.bandwidthBytes),
    email_recipients: part(quotas.emailRecipientsMonth),
    // 50 kB per message is a plain-text newsletter with a little markup. Stated rather than
    // derived, because nothing in the quota implies a message size.
    email_message_bytes: part(quotas.emailRecipientsMonth) * 50_000,
    custom_hostnames: quotas.customDomains,
    build_publish_milliseconds: ms(quotas.buildPublishMinutes),
    plugin_compute_milliseconds: ms(quotas.pluginComputeMinutes),
    ai_credits: part(quotas.aiCredits),
    release_retention_bytes: part(quotas.releaseRetentionBytes),
    // Queue time is assumed to track build time: a publish that takes a minute occupies a
    // worker for about that minute, and that occupancy is the cost.
    weighted_queue_milliseconds: ms(quotas.buildPublishMinutes),
  })
}

/**
 * Every plan must exist at BOTH cadences, and that is enforced rather than conventional.
 *
 * service.ts refuses a price book unless each planId appears exactly twice, once monthly and
 * once annual, with `samePlanPair` holding across everything except cadence and amount. My first
 * draft had one cadence per plan and would have been refused with "requires matching monthly and
 * annual definitions" - found by reading the publisher rather than by guessing.
 *
 * Deriving the annual entry from the monthly one is what makes the pair provably identical:
 * writing it out twice invites the two copies to drift, and the drift is refused later at a
 * moment that does not name which field diverged.
 */
function annualFrom(plan: PlanDefinition, amountMinor: number): PlanDefinition {
  return Object.freeze({ ...plan, cadence: 'annual' as const, amountMinor })
}

const MONTHLY_PLANS: readonly PlanDefinition[] = Object.freeze([
  Object.freeze({
    planId: 'plan_starter_website',
    slug: 'starter',
    name: 'Starter',
    summary: 'Publish one page on a free site and see it live.',
    profile: 'website' as const,
    cadence: 'monthly' as const,
    // Minimum 1 because the schema forbids 0: a free plan is expressed by offeringClass, not by
    // a zero price. Making it zero would have required loosening a constraint that is right.
    amountMinor: 1,
    offeringClass: 'fuma-funded-starter' as const,
    quotas: STARTER_QUOTAS,
    workloadAssumptions: assumptionsFor(STARTER_QUOTAS, 0.5),
    featureKeys: ['visual-builder', 'free-subdomain'],
    promotion: null,
    // NOT purchasable: nothing to buy, and offering checkout on a funded plan invites a payment
    // that has no matching entitlement change.
    checkoutAvailable: false,
    expiresAt: null,
  }),
  Object.freeze({
    planId: 'plan_studio_website',
    slug: 'studio',
    name: 'Studio',
    summary: 'Several sites, a custom domain each, and room for real traffic.',
    profile: 'website' as const,
    cadence: 'monthly' as const,
    amountMinor: 250_000,
    offeringClass: 'paid' as const,
    quotas: STUDIO_QUOTAS,
    workloadAssumptions: assumptionsFor(STUDIO_QUOTAS, 0.3),
    featureKeys: ['visual-builder', 'custom-domain', 'managed-email'],
    promotion: null,
    // Deliberately false until task 106 reconciles the margin gate with MEASURED costs. A price
    // that cannot be justified should not be chargeable, and the quotas are useful regardless.
    checkoutAvailable: false,
    expiresAt: null,
  }),
])

export const SEEDED_PLANS: readonly PlanDefinition[] = Object.freeze(
  MONTHLY_PLANS.flatMap((plan) => [
    plan,
    // Ten months for twelve is the usual annual shape. For the funded starter the amount is
    // nominal either way, because offeringClass is what makes it free.
    annualFrom(plan, plan.offeringClass === 'paid' ? plan.amountMinor * 10 : plan.amountMinor),
  ]),
)

/**
 * The draft a price-book publisher would consume.
 *
 * Validated against the real schema at construction rather than trusted, because a seed that
 * fails validation fails at whatever later moment first reads it, and the error then points at
 * the reader rather than at the seed.
 */
export function seededPriceBookDraft(effectiveAt: string): PriceBookDraft {
  const draft = {
    version: 'seed-1',
    currency: 'KES' as const,
    effectiveAt,
    plans: SEEDED_PLANS.map((plan) => ({ ...plan })),
  }
  return Value.Parse(PriceBookDraftSchema, draft) as PriceBookDraft
}

/** The allowance the hosted storage surface should show for a plan slug, or null if unknown. */
export function allowanceForSlug(slug: string): Readonly<{ storageBytes: number, bandwidthBytes: number }> | null {
  const plan = SEEDED_PLANS.find((entry) => entry.slug === slug)
  // NULL rather than a default: showing one plan's allowance for another is worse than showing
  // none, because it is wrong in a way nobody can see.
  if (!plan) return null
  return Object.freeze({ storageBytes: plan.quotas.storageBytes, bandwidthBytes: plan.quotas.bandwidthBytes })
}

/**
 * The page allowance for a plan slug, or null if the slug is unknown.
 *
 * A SEPARATE accessor from allowanceForSlug rather than a widened return, because the two are read by
 * different surfaces for different reasons: storage feeds a usage panel, pages feeds a REFUSAL in the
 * builder. Widening would make every storage caller carry a number it does not use.
 *
 * The figure comes from the seed, so the builder cannot enforce one limit while billing promises
 * another - the property task 68's test already asserts by reading STARTER_QUOTAS.
 */
export function pageAllowanceForSlug(
  slug: string,
): Readonly<{ limit: number; planName: string }> | null {
  const plan = SEEDED_PLANS.find((entry) => entry.slug === slug)
  if (!plan) return null
  return Object.freeze({ limit: plan.quotas.pages, planName: plan.name })
}

/**
 * Why the seed stops short of publishing, as data rather than as a comment.
 */
export function reviewPublishReadiness(): Readonly<{ ready: boolean, reason: string }> {
  // DERIVED from the provenance check rather than restating its conclusion, so the two cannot drift:
  // the day a meter is genuinely reconciled against an invoice, this stops refusing on its own instead
  // of waiting for somebody to remember that a hard-coded `false` exists here.
  const readiness = marginClaimReadiness()
  if (readiness.ready) {
    return Object.freeze({
      ready: true,
      reason: 'Every meter feeding plan economics now carries a measured unit cost.',
    })
  }
  return Object.freeze({
    ready: false,
    reason: 'Publishing a price book computes economics from costBaseline.ts UNIT_COSTS, which are self-described launch assumptions rather than measured costs, and assertLaunchEconomics would pass or fail on that arithmetic. Quotas are seeded and enforceable; prices await measured OCI figures (tasks 104 and 106).',
  })
}
