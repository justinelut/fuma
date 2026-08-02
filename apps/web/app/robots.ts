import type { MetadataRoute } from 'next'
import { CANONICAL_ORIGIN } from '@/lib/seo'
import { sitemapIndexUrls } from '@/lib/sitemaps'

export const CRAWLER_EXCLUSIONS = Object.freeze([
  '/api/',
  '/start',
  '/search',
  '/contract-demo',
  '/preview/',
  '/privacy-request',
  '/__acceptance/',
  '/%5F%5Facceptance/',
] as const)

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: [...CRAWLER_EXCLUSIONS] },
    sitemap: [...sitemapIndexUrls()],
    host: CANONICAL_ORIGIN,
  }
}
