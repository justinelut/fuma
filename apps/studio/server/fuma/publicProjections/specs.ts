import {
  PublicComponentsEnvelopeSchema,
  PublicComponentsPageSchema,
  PublicComponentsQuerySchema,
  PublicExpertsEnvelopeSchema,
  PublicExpertsPageSchema,
  PublicExpertsQuerySchema,
  PublicPluginsEnvelopeSchema,
  PublicPluginsPageSchema,
  PublicPluginsQuerySchema,
  PublicPricingCatalogEnvelopeSchema,
  PublicPricingCatalogPageSchema,
  PublicPricingQuerySchema,
  PublicProductFactsEnvelopeSchema,
  PublicProductFactsPageSchema,
  PublicProductFactsQuerySchema,
  PublicShowcasesEnvelopeSchema,
  PublicShowcasesPageSchema,
  PublicShowcasesQuerySchema,
  PublicTemplatesEnvelopeSchema,
  PublicTemplatesPageSchema,
  PublicTemplatesQuerySchema,
  type PublicProjectionResource,
} from '@fuma/public-contracts'
import type { TSchema } from '@sinclair/typebox'

export const PUBLIC_PROJECTION_PATH_PREFIX = '/_fuma/private/public/v1'
export const PUBLIC_PROJECTION_RATE_LIMIT = Object.freeze({ limit: 600, windowMs: 60_000 })

export type PublicProjectionResourceSpec = Readonly<{
  querySchema: TSchema
  pageSchema: TSchema
  envelopeSchema: TSchema
  cacheTtlMs: number
  cacheControl: string
}>

const DISCOVERY_CACHE = 'public, max-age=30, s-maxage=300, stale-while-revalidate=60'
const IMMEDIATE_INVALIDATION = 'no-store'

export const PUBLIC_PROJECTION_SPECS: Readonly<Record<PublicProjectionResource, PublicProjectionResourceSpec>> = Object.freeze({
  'product-facts': Object.freeze({
    querySchema: PublicProductFactsQuerySchema,
    pageSchema: PublicProductFactsPageSchema,
    envelopeSchema: PublicProductFactsEnvelopeSchema,
    cacheTtlMs: 30_000,
    cacheControl: DISCOVERY_CACHE,
  }),
  pricing: Object.freeze({
    querySchema: PublicPricingQuerySchema,
    pageSchema: PublicPricingCatalogPageSchema,
    envelopeSchema: PublicPricingCatalogEnvelopeSchema,
    cacheTtlMs: 0,
    cacheControl: IMMEDIATE_INVALIDATION,
  }),
  templates: Object.freeze({
    querySchema: PublicTemplatesQuerySchema,
    pageSchema: PublicTemplatesPageSchema,
    envelopeSchema: PublicTemplatesEnvelopeSchema,
    cacheTtlMs: 0,
    cacheControl: IMMEDIATE_INVALIDATION,
  }),
  showcases: Object.freeze({
    querySchema: PublicShowcasesQuerySchema,
    pageSchema: PublicShowcasesPageSchema,
    envelopeSchema: PublicShowcasesEnvelopeSchema,
    cacheTtlMs: 0,
    cacheControl: IMMEDIATE_INVALIDATION,
  }),
  experts: Object.freeze({
    querySchema: PublicExpertsQuerySchema,
    pageSchema: PublicExpertsPageSchema,
    envelopeSchema: PublicExpertsEnvelopeSchema,
    cacheTtlMs: 0,
    cacheControl: IMMEDIATE_INVALIDATION,
  }),
  plugins: Object.freeze({
    querySchema: PublicPluginsQuerySchema,
    pageSchema: PublicPluginsPageSchema,
    envelopeSchema: PublicPluginsEnvelopeSchema,
    cacheTtlMs: 0,
    cacheControl: IMMEDIATE_INVALIDATION,
  }),
  components: Object.freeze({
    querySchema: PublicComponentsQuerySchema,
    pageSchema: PublicComponentsPageSchema,
    envelopeSchema: PublicComponentsEnvelopeSchema,
    cacheTtlMs: 0,
    cacheControl: IMMEDIATE_INVALIDATION,
  }),
})
