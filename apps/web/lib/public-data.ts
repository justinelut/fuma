import type {
  PublicExpertsEnvelope, PublicPluginsEnvelope, PublicPricingCatalogEnvelope, PublicProductFactsEnvelope,
  PublicShowcasesEnvelope, PublicTemplatesEnvelope, PublicProjectionResource,
} from '@fuma/public-contracts'
import { fetchPublicProjection } from './public-projections'

export type PublicEnvelopeMap = {
  'product-facts': PublicProductFactsEnvelope
  pricing: PublicPricingCatalogEnvelope
  templates: PublicTemplatesEnvelope
  showcases: PublicShowcasesEnvelope
  experts: PublicExpertsEnvelope
  plugins: PublicPluginsEnvelope
}

export async function readPublicData<R extends PublicProjectionResource>(resource: R, filters: Readonly<Record<string, string | number | undefined>> = {}): Promise<PublicEnvelopeMap[R] | null> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters).sort(([a], [b]) => a.localeCompare(b))) if (value !== undefined && value !== '') query.set(key, String(value))
  let response: Response
  try { response = await fetchPublicProjection(resource, query) } catch { return null }
  if (!response.ok) return null
  try { return await response.json() as PublicEnvelopeMap[R] } catch { return null }
}

export function visiblePricing(envelope: PublicPricingCatalogEnvelope | null, now = new Date()): PublicPricingCatalogEnvelope['data']['items'] {
  if (!envelope) return []
  const epoch = now.getTime()
  return envelope.data.items.filter(plan => {
    const effective = Date.parse(plan.effectiveAt)
    const expires = plan.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(plan.expiresAt)
    return Number.isFinite(effective) && Number.isFinite(expires) && effective <= epoch && expires > epoch
  })
}

export function activePromotion<T extends PublicPricingCatalogEnvelope['data']['items'][number]>(plan: T, now = new Date()): T['promotion'] {
  if (!plan.promotion) return null
  const epoch = now.getTime()
  return Date.parse(plan.promotion.startsAt) <= epoch && Date.parse(plan.promotion.endsAt) > epoch ? plan.promotion : null
}

export function formatKes(amountMinor: number): string {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amountMinor / 100)
}

export function isImmutableTemplatePreview(raw: string): boolean {
  try { const url = new URL(raw); return url.protocol === 'https:' && url.hostname === 'templates.preview.fuma.co.ke' && /^\/releases\/[a-z0-9](?:[a-z0-9._-]{0,94}[a-z0-9])?\/$/.test(url.pathname) && !url.username && !url.password && !url.search && !url.hash } catch { return false }
}
