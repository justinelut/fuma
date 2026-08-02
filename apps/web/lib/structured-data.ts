import { FUMA_PUBLIC_IDENTITY } from '@fuma/brand'
import { FUMA_WEB_DEPLOYMENT } from './deployment-profile'
import type { PublicExpert, PublicTemplate } from '@fuma/public-contracts'
import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { EditorialEntry } from './editorial-compiler'

const ORIGIN = FUMA_WEB_DEPLOYMENT.origins.public
const JsonText = Type.String({ minLength: 1, maxLength: 600 })
const JsonUrl = Type.String({ pattern: '^https://[^\\s]+$', maxLength: 2_048 })
const Context = Type.Literal('https://schema.org')

export const WebSiteStructuredDataSchema = Type.Object({
  '@context': Context,
  '@type': Type.Literal('WebSite'),
  name: JsonText,
  url: JsonUrl,
  inLanguage: Type.Literal('en-KE'),
}, { additionalProperties: false })

export const ArticleStructuredDataSchema = Type.Object({
  '@context': Context,
  '@type': Type.Union([Type.Literal('BlogPosting'), Type.Literal('TechArticle')]),
  headline: JsonText,
  description: JsonText,
  url: JsonUrl,
  datePublished: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$' }),
  dateModified: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$' }),
  author: Type.Object({
    '@type': Type.Literal('Organization'),
    name: JsonText,
  }, { additionalProperties: false }),
  inLanguage: Type.Literal('en-KE'),
}, { additionalProperties: false })

export const TemplateStructuredDataSchema = Type.Object({
  '@context': Context,
  '@type': Type.Literal('Product'),
  name: JsonText,
  description: JsonText,
  url: JsonUrl,
  image: JsonUrl,
  category: Type.Literal('Website template'),
  releaseNotes: JsonText,
}, { additionalProperties: false })

export const ExpertStructuredDataSchema = Type.Object({
  '@context': Context,
  '@type': Type.Union([Type.Literal('Person'), Type.Literal('Organization')]),
  name: JsonText,
  description: JsonText,
  url: JsonUrl,
  areaServed: JsonText,
  knowsAbout: Type.Array(JsonText, { maxItems: 24, uniqueItems: true }),
}, { additionalProperties: false })

export const BreadcrumbStructuredDataSchema = Type.Object({
  '@context': Context,
  '@type': Type.Literal('BreadcrumbList'),
  itemListElement: Type.Array(Type.Object({
    '@type': Type.Literal('ListItem'),
    position: Type.Integer({ minimum: 1 }),
    name: JsonText,
    item: JsonUrl,
  }, { additionalProperties: false }), { minItems: 1, maxItems: 16 }),
}, { additionalProperties: false })

export type WebSiteStructuredData = Static<typeof WebSiteStructuredDataSchema>
export type ArticleStructuredData = Static<typeof ArticleStructuredDataSchema>
export type TemplateStructuredData = Static<typeof TemplateStructuredDataSchema>
export type ExpertStructuredData = Static<typeof ExpertStructuredDataSchema>
export type BreadcrumbStructuredData = Static<typeof BreadcrumbStructuredDataSchema>

function checked<T>(schema: TSchema, value: T): Readonly<T> {
  if (!Value.Check(schema, value)) throw new TypeError('Structured data does not match its public schema.')
  return Object.freeze(value)
}

export function websiteStructuredData(): Readonly<WebSiteStructuredData> {
  return checked(WebSiteStructuredDataSchema, {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: FUMA_PUBLIC_IDENTITY.product.name,
    url: ORIGIN,
    inLanguage: 'en-KE',
  })
}

export function articleStructuredData(entry: EditorialEntry): Readonly<ArticleStructuredData> {
  return checked(ArticleStructuredDataSchema, {
    '@context': 'https://schema.org',
    '@type': entry.meta.collection === 'blog' ? 'BlogPosting' : 'TechArticle',
    headline: entry.meta.title,
    description: entry.meta.description,
    url: `${ORIGIN}${entry.canonicalPath}`,
    datePublished: entry.meta.publishedAt,
    dateModified: entry.meta.updatedAt,
    author: { '@type': 'Organization', name: entry.meta.author },
    inLanguage: 'en-KE',
  })
}

export function templateStructuredData(item: PublicTemplate): Readonly<TemplateStructuredData> {
  const image = new URL(item.image.url, ORIGIN).toString()
  return checked(TemplateStructuredDataSchema, {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: item.name,
    description: item.summary,
    url: `${ORIGIN}/templates/${item.slug}`,
    image,
    category: 'Website template',
    releaseNotes: `Approved immutable release ${item.releaseId}`,
  })
}

export function expertStructuredData(item: PublicExpert): Readonly<ExpertStructuredData> {
  return checked(ExpertStructuredDataSchema, {
    '@context': 'https://schema.org',
    '@type': item.expertType === 'studio' || item.expertType === 'agency' ? 'Organization' : 'Person',
    name: item.publicName,
    description: item.summary,
    url: `${ORIGIN}/experts/${item.slug}`,
    areaServed: item.location,
    knowsAbout: [...item.skills],
  })
}

export function breadcrumbStructuredData(items: readonly Readonly<{ label: string; href: string }>[]): Readonly<BreadcrumbStructuredData> {
  return checked(BreadcrumbStructuredDataSchema, {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem' as const,
      position: index + 1,
      name: item.label,
      item: new URL(item.href, ORIGIN).toString(),
    })),
  })
}

const FABRICATED_SOCIAL_PROOF_KEYS = new Set([
  'aggregateRating', 'rating', 'ratingCount', 'ratingValue', 'review', 'reviewCount', 'testimonial',
])

function assertSafeJson(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  budget.nodes += 1
  if (depth > 16 || budget.nodes > 1_024) throw new TypeError('Structured data exceeds the safe complexity limit.')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Structured data contains a non-finite number.')
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeJson(item, depth + 1, budget)
    return
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Structured data must contain only plain JSON values.')
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FABRICATED_SOCIAL_PROOF_KEYS.has(key)) {
      throw new TypeError('Ratings, reviews, and testimonials require a separately approved authority.')
    }
    assertSafeJson(nested, depth + 1, budget)
  }
}

export function serializeStructuredData(value: Readonly<Record<string, unknown>>): string {
  assertSafeJson(value)
  const serialized = JSON.stringify(value)
  if (new TextEncoder().encode(serialized).byteLength > 64_000) {
    throw new TypeError('Structured data exceeds the safe byte limit.')
  }
  return serialized
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
