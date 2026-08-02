export { ContactRequestSchema, type ContactRequest } from '@fuma/public-contracts'
import { Type, type Static } from '@sinclair/typebox'
import { FUMA_WEB_DEPLOYMENT } from './deployment-profile'

const Slug = Type.String({
  minLength: 1,
  maxLength: 96,
  pattern: '^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$',
})
const SafeText = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: '^[^\\u0000-\\u001F\\u007F]+$',
})
const Timestamp = Type.String({
  minLength: 20,
  maxLength: 20,
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$',
})
export const EditorialCollectionSchema = Type.Union([
  Type.Literal('docs'),
  Type.Literal('guides'),
  Type.Literal('blog'),
  Type.Literal('changelog'),
  Type.Literal('legal'),
])

export const EditorialFrontmatterSchema = Type.Object({
  title: SafeText,
  description: Type.String({ minLength: 1, maxLength: 320, pattern: '^[^\\u0000-\\u001F\\u007F]+$' }),
  slug: Slug,
  collection: EditorialCollectionSchema,
  author: SafeText,
  category: SafeText,
  publishedAt: Timestamp,
  updatedAt: Timestamp,
  reviewAt: Timestamp,
  draft: Type.Boolean(),
  version: Type.String({ minLength: 1, maxLength: 40, pattern: '^[0-9A-Za-z._-]+$' }),
  redirects: Type.Array(Type.String({ minLength: 2, maxLength: 160, pattern: '^/[a-z0-9](?:[a-z0-9/-]*[a-z0-9])?$' }), {
    maxItems: 20,
    uniqueItems: true,
  }),
  components: Type.Array(Type.Union([Type.Literal('Callout'), Type.Literal('CodeBlock')]), {
    maxItems: 8,
    uniqueItems: true,
  }),
  owner: SafeText,
  audience: Type.Literal('public'),
}, { additionalProperties: false })
export type EditorialFrontmatter = Static<typeof EditorialFrontmatterSchema>

export const PublicStatusSchema = Type.Object({
  status: Type.Union([
    Type.Literal('operational'),
    Type.Literal('degraded'),
    Type.Literal('outage'),
    Type.Literal('unknown'),
  ]),
  message: SafeText,
  checkedAt: Timestamp,
}, { additionalProperties: false })
export type PublicStatus = Static<typeof PublicStatusSchema>

export const ConsentPreferenceSchema = Type.Object({
  version: Type.Literal(1),
  choice: Type.Union([Type.Literal('essential'), Type.Literal('optional')]),
  updatedAt: Timestamp,
}, { additionalProperties: false })
export type ConsentPreference = Static<typeof ConsentPreferenceSchema>

export const LaunchConfigSchema = Type.Object({
  canonicalOrigin: Type.String({ pattern: '^https://[^/]+$' }),
  appOrigin: Type.Literal(FUMA_WEB_DEPLOYMENT.origins.product),
  statusOrigin: Type.Literal(FUMA_WEB_DEPLOYMENT.origins.status),
}, { additionalProperties: false })

export const PublicWebVitalSchema = Type.Object({
  name: Type.Union([
    Type.Literal('CLS'),
    Type.Literal('FCP'),
    Type.Literal('INP'),
    Type.Literal('LCP'),
    Type.Literal('TTFB'),
  ]),
  value: Type.Number({ minimum: 0, maximum: 1_000_000 }),
  rating: Type.Union([
    Type.Literal('good'),
    Type.Literal('needs-improvement'),
    Type.Literal('poor'),
  ]),
  routeClass: Type.Union([
    Type.Literal('home'),
    Type.Literal('product'),
    Type.Literal('resource'),
    Type.Literal('discovery'),
    Type.Literal('legal'),
  ]),
}, { additionalProperties: false })
export type PublicWebVital = Static<typeof PublicWebVitalSchema>

export const PublicClaimSchema = Type.Object({
  id: Type.String({ pattern: '^[a-z0-9-]+$' }),
  statement: Type.String({ minLength: 10, maxLength: 240 }),
  owner: SafeText,
  reviewAt: Timestamp,
  evidence: Type.String({ minLength: 3, maxLength: 240 }),
}, { additionalProperties: false })
export const PublicClaimInventorySchema = Type.Array(PublicClaimSchema, { minItems: 1, maxItems: 100 })
