import type { PublicComponent, PublicExpert, PublicPlugin, PublicShowcase, PublicTemplate } from '@fuma/public-contracts'
import type { MetadataRoute } from 'next'
import type { EditorialEntry } from './editorial-compiler'
import { CANONICAL_ORIGIN, canonicalPublicUrl } from './seo'
import { templateSitemapEligible } from './templates'

export const SITEMAP_ENTRY_LIMIT = 45_000 as const
export const SITEMAP_PAGE_LIMIT = 500 as const

export const CORE_SITEMAP_PATHS = Object.freeze([
  '/', '/website', '/publication', '/features', '/solutions', '/pricing', '/templates',
  '/experts', '/showcase', '/plugins', '/components', '/docs', '/guides', '/blog', '/changelog',
  '/about', '/contact', '/trust', '/security', '/status', '/legal', '/legal/privacy', '/legal/terms',
  '/legal/cookies', '/legal/acceptable-use', '/legal/history',
] as const)

export type DiscoverySitemapInput = Readonly<{
  templates: readonly PublicTemplate[]
  experts: readonly PublicExpert[]
  showcases: readonly PublicShowcase[]
  plugins: readonly PublicPlugin[]
  components: readonly PublicComponent[]
}>

type SitemapEntry = MetadataRoute.Sitemap[number]

function compareUrl(left: SitemapEntry, right: SitemapEntry): number {
  return left.url < right.url ? -1 : left.url > right.url ? 1 : 0
}

function validTimestamp(value: string): Date {
  const epoch = Date.parse(value)
  if (!Number.isFinite(epoch)) throw new TypeError('Sitemap timestamp is invalid.')
  return new Date(epoch)
}

function entry(pathname: string, lastModified?: string, priority = 0.6): SitemapEntry {
  return {
    url: canonicalPublicUrl(pathname),
    ...(lastModified ? { lastModified: validTimestamp(lastModified) } : {}),
    changeFrequency: lastModified ? 'monthly' : 'weekly',
    priority,
  }
}

function finalized(entries: readonly SitemapEntry[]): MetadataRoute.Sitemap {
  if (entries.length > SITEMAP_ENTRY_LIMIT) {
    throw new RangeError(`Sitemap segment exceeds ${SITEMAP_ENTRY_LIMIT} entries.`)
  }
  const sorted = [...entries].sort(compareUrl)
  const urls = new Set<string>()
  for (const value of sorted) {
    if (urls.has(value.url)) throw new TypeError(`Duplicate sitemap URL: ${value.url}`)
    urls.add(value.url)
  }
  return sorted
}

export function coreSitemap(): MetadataRoute.Sitemap {
  return finalized(CORE_SITEMAP_PATHS.map((pathname) => entry(pathname, undefined, pathname === '/' ? 1 : 0.7)))
}

export function contentSitemap(entries: readonly EditorialEntry[]): MetadataRoute.Sitemap {
  return finalized(entries.map((value) => entry(value.canonicalPath, value.meta.updatedAt)))
}

export function discoverySitemap(input: DiscoverySitemapInput): MetadataRoute.Sitemap {
  return finalized([
    ...input.templates
      .filter(templateSitemapEligible)
      .map((value) => entry(`/templates/${value.slug}`, value.updatedAt)),
    ...input.experts.map((value) => entry(`/experts/${value.slug}`, value.approvedAt)),
    ...input.showcases.map((value) => entry(`/showcase/${value.slug}`, value.approvedAt)),
    ...input.plugins.map((value) => entry(`/plugins/${value.slug}`, value.reviewedAt)),
    ...input.components.map((value) => entry(`/components/${value.slug}`, value.reviewedAt)),
  ])
}

export type PublicPage<T> = Readonly<{
  items: readonly T[]
  hasMore: boolean
  nextCursor: string | null
}>

/** Collects an authority-owned cursor dataset without guessing through gaps or loops. */
export async function collectPublicPages<T>(
  load: (cursor: string | undefined) => Promise<PublicPage<T> | null>,
): Promise<readonly T[] | null> {
  const items: T[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  for (let pageNumber = 0; pageNumber < SITEMAP_PAGE_LIMIT; pageNumber += 1) {
    const page = await load(cursor)
    if (!page) return null
    if (items.length + page.items.length > SITEMAP_ENTRY_LIMIT) {
      throw new RangeError(`Discovery sitemap source exceeds ${SITEMAP_ENTRY_LIMIT} entries.`)
    }
    items.push(...page.items)
    if (!page.hasMore) {
      if (page.nextCursor !== null) return null
      return Object.freeze(items)
    }
    if (!page.nextCursor || cursors.has(page.nextCursor)) return null
    cursors.add(page.nextCursor)
    cursor = page.nextCursor
  }
  throw new RangeError(`Discovery sitemap source exceeds ${SITEMAP_PAGE_LIMIT} pages.`)
}

export function sitemapIndexUrls(): readonly string[] {
  return Object.freeze(['core', 'content', 'discovery'].map((segment) => `${CANONICAL_ORIGIN}/sitemap/${segment}.xml`))
}
