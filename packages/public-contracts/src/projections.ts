import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { PublicProfileSchema } from './handoff'
import { PUBLIC_PAGE_SIZE_MAX, PublicCursorSchema, createCursorPageSchema } from './pagination'
import { createPublicReadEnvelopeSchema } from './reads'
import { PublicIdSchema, PublicTimestampSchema } from './scalars'

const PublicTextSchema = Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: '^[^\\u0000-\\u001F\\u007F]+$',
})
const PublicSummarySchema = Type.String({
  minLength: 1,
  maxLength: 600,
  pattern: '^[^\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]+$',
})
const PublicSlugSchema = Type.String({
  minLength: 1,
  maxLength: 96,
  pattern: '^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$',
})
const PublicTagSchema = Type.String({
  minLength: 1,
  maxLength: 48,
  pattern: '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$',
})
const PublicHttpsUrlSchema = Type.String({
  minLength: 9,
  maxLength: 2_048,
  pattern: '^https://[^\\s\\u0000-\\u001F\\u007F]+$',
})
const PublicRelativeAssetSchema = Type.String({
  minLength: 2,
  maxLength: 2_048,
  pattern: '^/[^\\s\\u0000-\\u001F\\u007F]*$',
})
const PublicAssetUrlSchema = Type.Union([PublicHttpsUrlSchema, PublicRelativeAssetSchema])
const PublicTagListSchema = Type.Array(PublicTagSchema, { maxItems: 24, uniqueItems: true })
const PublicIdListSchema = Type.Array(PublicIdSchema, { maxItems: 24, uniqueItems: true })
const PublicProfileListSchema = Type.Array(PublicProfileSchema, { minItems: 1, maxItems: 2, uniqueItems: true })

export const PublicProductFactSchema = Type.Object({
  id: PublicIdSchema,
  slug: PublicSlugSchema,
  name: PublicTextSchema,
  summary: PublicSummarySchema,
  profiles: PublicProfileListSchema,
  available: Type.Boolean(),
  featureKeys: PublicTagListSchema,
  updatedAt: PublicTimestampSchema,
}, { additionalProperties: false })
export type PublicProductFact = Static<typeof PublicProductFactSchema>

export const PublicPricingQuotaSchema = Type.Object({
  key: PublicTagSchema,
  label: PublicTextSchema,
  limit: Type.Integer({ minimum: 0, maximum: 1_000_000_000 }),
  unit: Type.Union([
    Type.Literal('count'),
    Type.Literal('bytes'),
    Type.Literal('minutes'),
    Type.Literal('credits'),
  ]),
}, { additionalProperties: false })
export type PublicPricingQuota = Static<typeof PublicPricingQuotaSchema>

export const PublicPricingPromotionSchema = Type.Object({
  label: PublicTextSchema,
  startsAt: PublicTimestampSchema,
  endsAt: PublicTimestampSchema,
}, { additionalProperties: false })
export type PublicPricingPromotion = Static<typeof PublicPricingPromotionSchema>

export const PublicPricingPlanSchema = Type.Object({
  id: PublicIdSchema,
  slug: PublicSlugSchema,
  name: PublicTextSchema,
  summary: PublicSummarySchema,
  profile: PublicProfileSchema,
  currency: Type.Literal('KES'),
  cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
  amountMinor: Type.Integer({ minimum: 0, maximum: 1_000_000_000 }),
  featureKeys: PublicTagListSchema,
  quotas: Type.Array(PublicPricingQuotaSchema, { maxItems: 32 }),
  promotion: Type.Union([PublicPricingPromotionSchema, Type.Null()]),
  checkoutAvailable: Type.Boolean(),
  effectiveAt: PublicTimestampSchema,
  expiresAt: Type.Union([PublicTimestampSchema, Type.Null()]),
}, { additionalProperties: false })
export type PublicPricingPlan = Static<typeof PublicPricingPlanSchema>

export const PublicTemplateImageSchema = Type.Object({
  url: PublicAssetUrlSchema,
  alt: PublicTextSchema,
  width: Type.Integer({ minimum: 320, maximum: 2_400 }),
  height: Type.Integer({ minimum: 180, maximum: 2_400 }),
  byteSize: Type.Integer({ minimum: 1, maximum: 300_000 }),
}, { additionalProperties: false })
export type PublicTemplateImage = Static<typeof PublicTemplateImageSchema>

export const PublicTemplateAccessibilitySchema = Type.Object({
  standard: Type.Literal('WCAG 2.2 AA'),
  keyboardChecked: Type.Literal(true),
  reducedMotionChecked: Type.Literal(true),
  highContrastChecked: Type.Literal(true),
  notes: Type.Array(PublicTextSchema, { minItems: 1, maxItems: 12, uniqueItems: true }),
}, { additionalProperties: false })
export type PublicTemplateAccessibility = Static<typeof PublicTemplateAccessibilitySchema>

export const PublicTemplateSchema = Type.Object({
  id: PublicIdSchema,
  slug: PublicSlugSchema,
  name: PublicTextSchema,
  summary: PublicSummarySchema,
  profiles: PublicProfileListSchema,
  capabilities: PublicTagListSchema,
  industries: PublicTagListSchema,
  styles: PublicTagListSchema,
  accessibility: PublicTemplateAccessibilitySchema,
  releaseId: PublicIdSchema,
  previewUrl: PublicHttpsUrlSchema,
  image: PublicTemplateImageSchema,
  sitemapEligible: Type.Literal(true),
  approvedAt: PublicTimestampSchema,
  updatedAt: PublicTimestampSchema,
}, { additionalProperties: false })
export type PublicTemplate = Static<typeof PublicTemplateSchema>

export const PublicTemplateTombstoneSchema = Type.Object({
  id: PublicIdSchema,
  slug: PublicSlugSchema,
  withdrawnAt: PublicTimestampSchema,
}, { additionalProperties: false })
export type PublicTemplateTombstone = Static<typeof PublicTemplateTombstoneSchema>

export const PublicShowcaseSchema = Type.Object({
  id: PublicIdSchema,
  slug: PublicSlugSchema,
  title: PublicTextSchema,
  summary: PublicSummarySchema,
  profiles: PublicProfileListSchema,
  industries: PublicTagListSchema,
  previewUrl: PublicHttpsUrlSchema,
  imageUrl: PublicAssetUrlSchema,
  expertIds: PublicIdListSchema,
  approvedAt: PublicTimestampSchema,
}, { additionalProperties: false })
export type PublicShowcase = Static<typeof PublicShowcaseSchema>

export const PublicExpertSchema = Type.Object({
  id: PublicIdSchema,
  slug: PublicSlugSchema,
  publicName: PublicTextSchema,
  summary: PublicSummarySchema,
  expertType: Type.Union([
    Type.Literal('designer'),
    Type.Literal('developer'),
    Type.Literal('studio'),
    Type.Literal('agency'),
  ]),
  location: PublicTextSchema,
  skills: PublicTagListSchema,
  services: PublicTagListSchema,
  showcaseIds: PublicIdListSchema,
  mediatedInquiryAvailable: Type.Boolean(),
  imageUrl: Type.Union([PublicAssetUrlSchema, Type.Null()]),
  approvedAt: PublicTimestampSchema,
}, { additionalProperties: false })
export type PublicExpert = Static<typeof PublicExpertSchema>

export const PublicPluginSchema = Type.Object({
  id: PublicIdSchema,
  slug: PublicSlugSchema,
  name: PublicTextSchema,
  summary: PublicSummarySchema,
  categories: PublicTagListSchema,
  publisherName: PublicTextSchema,
  publisherVerified: Type.Literal(true),
  version: Type.String({ minLength: 1, maxLength: 64, pattern: '^[0-9A-Za-z][0-9A-Za-z.+_-]*$' }),
  permissionLabels: Type.Array(PublicTextSchema, { maxItems: 32 }),
  imageUrl: Type.Union([PublicAssetUrlSchema, Type.Null()]),
  reviewedAt: PublicTimestampSchema,
}, { additionalProperties: false })
export type PublicPlugin = Static<typeof PublicPluginSchema>

function querySchema(properties: Readonly<Record<string, TSchema>>) {
  return Type.Object({
    cursor: Type.Optional(PublicCursorSchema),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: PUBLIC_PAGE_SIZE_MAX })),
    ...properties,
  }, { additionalProperties: false })
}

export const PublicProductFactsQuerySchema = querySchema({
  profile: Type.Optional(PublicProfileSchema),
})
export const PublicPricingQuerySchema = querySchema({
  profile: Type.Optional(PublicProfileSchema),
  cadence: Type.Optional(Type.Union([Type.Literal('monthly'), Type.Literal('annual')])),
})
export const PublicTemplatesQuerySchema = querySchema({
  profile: Type.Optional(PublicProfileSchema),
  capability: Type.Optional(PublicTagSchema),
  industry: Type.Optional(PublicTagSchema),
  style: Type.Optional(PublicTagSchema),
  slug: Type.Optional(PublicSlugSchema),
})
export const PublicShowcasesQuerySchema = querySchema({
  profile: Type.Optional(PublicProfileSchema),
  industry: Type.Optional(PublicTagSchema),
})
export const PublicExpertsQuerySchema = querySchema({
  expertType: Type.Optional(Type.Union([
    Type.Literal('designer'),
    Type.Literal('developer'),
    Type.Literal('studio'),
    Type.Literal('agency'),
  ])),
  skill: Type.Optional(PublicTagSchema),
  location: Type.Optional(PublicSlugSchema),
})
export const PublicPluginsQuerySchema = querySchema({
  category: Type.Optional(PublicTagSchema),
})

export type PublicProductFactsQuery = Static<typeof PublicProductFactsQuerySchema>
export type PublicPricingQuery = Static<typeof PublicPricingQuerySchema>
export type PublicTemplatesQuery = Static<typeof PublicTemplatesQuerySchema>
export type PublicShowcasesQuery = Static<typeof PublicShowcasesQuerySchema>
export type PublicExpertsQuery = Static<typeof PublicExpertsQuerySchema>
export type PublicPluginsQuery = Static<typeof PublicPluginsQuerySchema>

export const PublicProductFactsPageSchema = createCursorPageSchema(PublicProductFactSchema)
export const PublicPricingCatalogPageSchema = createCursorPageSchema(PublicPricingPlanSchema)
export const PublicTemplatesPageSchema = Type.Object({
  items: Type.Array(PublicTemplateSchema, { maxItems: PUBLIC_PAGE_SIZE_MAX }),
  tombstones: Type.Array(PublicTemplateTombstoneSchema, { maxItems: PUBLIC_PAGE_SIZE_MAX }),
  page: createCursorPageSchema(PublicTemplateSchema).properties.page,
}, { additionalProperties: false })
export const PublicShowcasesPageSchema = createCursorPageSchema(PublicShowcaseSchema)
export const PublicExpertsPageSchema = createCursorPageSchema(PublicExpertSchema)
export const PublicPluginsPageSchema = createCursorPageSchema(PublicPluginSchema)

export const PublicProductFactsEnvelopeSchema = createPublicReadEnvelopeSchema(PublicProductFactsPageSchema)
export const PublicPricingCatalogEnvelopeSchema = createPublicReadEnvelopeSchema(PublicPricingCatalogPageSchema)
export const PublicTemplatesEnvelopeSchema = createPublicReadEnvelopeSchema(PublicTemplatesPageSchema)
export const PublicShowcasesEnvelopeSchema = createPublicReadEnvelopeSchema(PublicShowcasesPageSchema)
export const PublicExpertsEnvelopeSchema = createPublicReadEnvelopeSchema(PublicExpertsPageSchema)
export const PublicPluginsEnvelopeSchema = createPublicReadEnvelopeSchema(PublicPluginsPageSchema)

export type PublicProductFactsEnvelope = Static<typeof PublicProductFactsEnvelopeSchema>
export type PublicPricingCatalogEnvelope = Static<typeof PublicPricingCatalogEnvelopeSchema>
export type PublicTemplatesEnvelope = Static<typeof PublicTemplatesEnvelopeSchema>
export type PublicShowcasesEnvelope = Static<typeof PublicShowcasesEnvelopeSchema>
export type PublicExpertsEnvelope = Static<typeof PublicExpertsEnvelopeSchema>
export type PublicPluginsEnvelope = Static<typeof PublicPluginsEnvelopeSchema>

export const PUBLIC_PROJECTION_RESOURCES = [
  'product-facts',
  'pricing',
  'templates',
  'showcases',
  'experts',
  'plugins',
] as const

export const PublicProjectionResourceSchema = Type.Union(
  PUBLIC_PROJECTION_RESOURCES.map((resource) => Type.Literal(resource)),
)
export type PublicProjectionResource = Static<typeof PublicProjectionResourceSchema>
