import type {
  PublicComponent, PublicComponentsEnvelope, PublicExpert, PublicExpertsEnvelope, PublicPlugin, PublicPluginsEnvelope,
  PublicPricingCatalogEnvelope, PublicPricingDisplayPlan, PublicProductFactsEnvelope, PublicShowcase,
  PublicShowcasesEnvelope, PublicTemplatesEnvelope, PublicProjectionResource,
} from '@fuma/public-contracts'
import { fetchPublicProjection } from './public-projections'
import { FUMA_WEB_DEPLOYMENT } from './deployment-profile'

export type PublicEnvelopeMap = {
  'product-facts': PublicProductFactsEnvelope
  pricing: PublicPricingCatalogEnvelope
  templates: PublicTemplatesEnvelope
  showcases: PublicShowcasesEnvelope
  experts: PublicExpertsEnvelope
  plugins: PublicPluginsEnvelope
  components: PublicComponentsEnvelope
}

export async function readPublicData<R extends PublicProjectionResource>(resource: R, filters: Readonly<Record<string, string | number | undefined>> = {}): Promise<PublicEnvelopeMap[R] | null> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters).sort(([a], [b]) => a.localeCompare(b))) if (value !== undefined && value !== '') query.set(key, String(value))
  let response: Response
  try { response = await fetchPublicProjection(resource, query) } catch { return null }
  if (!response.ok) return null
  try { return await response.json() as PublicEnvelopeMap[R] } catch { return null }
}

export type PublicDiscoveryItemMap = {
  showcases: PublicShowcase
  experts: PublicExpert
  plugins: PublicPlugin
  components: PublicComponent
}

/** Exact detail reads are authority-filtered by slug; Web never list-scans or retains a withdrawn record. */
export async function readPublicItem<R extends keyof PublicDiscoveryItemMap>(
  resource: R,
  slug: string,
): Promise<PublicDiscoveryItemMap[R] | null> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/.test(slug)) return null
  const envelope = await readPublicData(resource, { slug, limit: 1 })
  if (!envelope || envelope.data.items.length !== 1 || envelope.data.items[0]?.slug !== slug) return null
  return envelope.data.items[0] as PublicDiscoveryItemMap[R]
}

export function visiblePricing(envelope: PublicPricingCatalogEnvelope | null, now = new Date()): PublicPricingCatalogEnvelope['data']['items'] {
  if (!envelope || envelope.data.effectiveVersion === null) return []
  const epoch = now.getTime()
  if (!Number.isFinite(epoch)) return []
  return envelope.data.items.filter(plan => {
    const effective = Date.parse(plan.effectiveAt)
    const expires = plan.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(plan.expiresAt)
    return Number.isFinite(effective) && Number.isFinite(expires) && effective <= epoch && expires > epoch
  })
}

export function activePromotion<T extends PublicPricingCatalogEnvelope['data']['items'][number]>(plan: T, now = new Date()): T['promotion'] {
  if (!plan.promotion) return null
  const epoch = now.getTime()
  const startsAt = Date.parse(plan.promotion.startsAt)
  const endsAt = Date.parse(plan.promotion.endsAt)
  return Number.isFinite(epoch) && Number.isFinite(startsAt) && Number.isFinite(endsAt)
    && startsAt < endsAt && startsAt <= epoch && endsAt > epoch
    ? plan.promotion
    : null
}

export function formatKes(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || amountMinor > 1_000_000_000) {
    throw new RangeError('KES minor units must be a bounded non-negative integer.')
  }
  return new Intl.NumberFormat('en-KE', {
    style: 'currency', currency: 'KES', currencyDisplay: 'code', minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(amountMinor / 100)
}

export function formatPricingQuota(limit: number, unit: 'count' | 'bytes' | 'minutes' | 'credits'): string {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Quota must be a non-negative integer.')
  if (unit === 'bytes') {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
    let value = limit
    let index = 0
    while (value >= 1_000 && index < units.length - 1) { value /= 1_000; index += 1 }
    return `${new Intl.NumberFormat('en-KE', { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${units[index]}`
  }
  const label = unit === 'count' ? '' : ` ${unit}`
  return `${new Intl.NumberFormat('en-KE').format(limit)}${label}`
}

export function pricingPlanIntentHref(plan: PublicPricingDisplayPlan, effectiveVersion: string): string {
  const query = new URLSearchParams({
    kind: 'choose_plan',
    source: 'pricing',
    planId: plan.planId,
    priceBookVersion: effectiveVersion,
    cadence: plan.cadence,
  })
  return `/start?${query.toString()}`
}

export function isImmutableTemplatePreview(raw: string): boolean {
  try { const url = new URL(raw); return url.protocol === 'https:' && url.hostname === FUMA_WEB_DEPLOYMENT.hosts.templatePreview && /^\/releases\/[a-z0-9](?:[a-z0-9._-]{0,94}[a-z0-9])?\/$/.test(url.pathname) && !url.username && !url.password && !url.search && !url.hash } catch { return false }
}
