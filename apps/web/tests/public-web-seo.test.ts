import { describe, expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { renderToStaticMarkup } from 'react-dom/server'
import robots, { CRAWLER_EXCLUSIONS } from '../app/robots'
import { GET as socialCardResponse } from '../app/social/fuma-social-v1.png/route'
import { generateAtom, generateRss, parseEditorialSource } from '../lib/editorial'
import {
  canonicalPublicUrl,
  editorialMetadata,
  jsonLd,
  publicMetadata,
  SOCIAL_CARD_URL,
} from '../lib/seo'
import {
  collectPublicPages,
  contentSitemap,
  coreSitemap,
  discoverySitemap,
  SITEMAP_ENTRY_LIMIT,
} from '../lib/sitemaps'
import { SOCIAL_CARD, SocialCard } from '../lib/social-card'
import {
  ArticleStructuredDataSchema,
  BreadcrumbStructuredDataSchema,
  ExpertStructuredDataSchema,
  TemplateStructuredDataSchema,
  WebSiteStructuredDataSchema,
  articleStructuredData,
  breadcrumbStructuredData,
  expertStructuredData,
  serializeStructuredData,
  templateStructuredData,
  websiteStructuredData,
} from '../lib/structured-data'
import { editorialSource } from './fixtures/public-web'

const template = {
  id: 'template_portfolio',
  slug: 'editorial-portfolio',
  name: 'Editorial Portfolio',
  summary: 'A restrained portfolio with accessible navigation and publication-ready article layouts.',
  profiles: ['website', 'publication'],
  capabilities: ['blog', 'forms'],
  industries: ['creative-services'],
  styles: ['editorial', 'minimal'],
  accessibility: {
    standard: 'WCAG 2.2 AA',
    keyboardChecked: true,
    reducedMotionChecked: true,
    highContrastChecked: true,
    notes: ['Landmarks and heading order were reviewed.'],
  },
  releaseId: 'release_portfolio_7',
  previewUrl: 'https://templates.preview.trimly.co.ke/releases/release_portfolio_7/',
  image: {
    url: 'https://templates.preview.trimly.co.ke/releases/release_portfolio_7/assets/cover.webp',
    alt: 'Editorial portfolio home page with project cards.',
    width: 1600,
    height: 900,
    byteSize: 120000,
  },
  sitemapEligible: true,
  approvedAt: '2026-07-27T10:00:00.000Z',
  updatedAt: '2026-07-27T10:00:00.000Z',
} as const

const expert = {
  id: 'expert_nairobi_1',
  slug: 'amani-studio',
  publicName: 'Amani Studio',
  summary: 'An approved Nairobi studio focused on accessible editorial websites.',
  expertType: 'studio',
  location: 'Nairobi, Kenya',
  skills: ['accessible-design', 'editorial-design'],
  services: ['website-design'],
  showcaseIds: ['showcase_amani_1'],
  mediatedInquiryAvailable: true,
  imageUrl: null,
  approvedAt: '2026-07-27T11:00:00.000Z',
} as const

const showcase = {
  id: 'showcase_amani_1', slug: 'amani-journal', title: 'Amani Journal',
  summary: 'An approved public editorial project.', profiles: ['publication'],
  industries: ['media'], previewUrl: 'https://example.invalid/work', imageUrl: '/social/fuma-social-v1.png',
  expertIds: ['expert_nairobi_1'], approvedAt: '2026-07-27T11:00:00.000Z',
} as const

const reviewEvidence = {
  contentHashSha256: 'a'.repeat(64), signatureKeyId: 'review-key-1',
  signaturePayloadHashSha256: 'b'.repeat(64), provenanceHashSha256: 'c'.repeat(64),
  licenseSpdx: 'MIT', accessibilityStandard: 'WCAG2.2-AA', minimumRuntimeVersion: '1.0.0',
} as const

const plugin = {
  id: 'plugin_forms_1', slug: 'reviewed-forms', name: 'Reviewed Forms',
  summary: 'Reviewed form workflow metadata.', categories: ['forms'], publisherName: 'Fuma Labs',
  publisherVerified: true, version: '1.0.0', permissionLabels: ['Store submissions'], imageUrl: null,
  reviewEvidence, reviewedAt: '2026-07-27T12:00:00.000Z', artifactKind: 'plugin',
} as const

const component = {
  id: 'component_hero_1', slug: 'reviewed-hero-pack', name: 'Reviewed Hero Pack',
  summary: 'Reviewed declarative component-pack metadata.', categories: ['layout'], publisherName: 'Fuma Labs',
  publisherVerified: true, version: '1.0.0', permissionLabels: [], imageUrl: null,
  reviewEvidence, reviewedAt: '2026-07-27T12:30:00.000Z', artifactKind: 'component-pack',
} as const

const editorial = parseEditorialSource(editorialSource, '/content/public/docs/safe-entry.md')

function canonical(metadata: ReturnType<typeof publicMetadata>): string {
  return String(metadata.alternates?.canonical)
}

describe('technical SEO metadata and crawler contracts', () => {
  test('emits bounded unique canonicals with en-KE/x-default, feed discovery, and immutable social metadata', () => {
    const values = [
      publicMetadata('Pricing', 'Current approved pricing.', '/pricing'),
      publicMetadata('Templates', 'Current approved templates.', '/templates'),
      publicMetadata('Experts', 'Current approved experts.', '/experts'),
    ]
    expect(new Set(values.map(canonical)).size).toBe(values.length)
    expect(new Set(values.map((value) => value.title)).size).toBe(values.length)
    expect(values[0]!.alternates?.languages).toEqual({
      'en-KE': 'https://trimly.co.ke/pricing',
      'x-default': 'https://trimly.co.ke/pricing',
    })
    expect(values[0]!.alternates?.types).toEqual({
      'application/rss+xml': 'https://trimly.co.ke/feeds/rss.xml',
      'application/atom+xml': 'https://trimly.co.ke/feeds/atom.xml',
    })
    expect(values[0]!.openGraph?.images).toEqual([expect.objectContaining({
      url: SOCIAL_CARD_URL,
      width: 1200,
      height: 630,
      alt: SOCIAL_CARD.alt,
    })])
    expect(JSON.stringify(values[0]!.twitter)).toContain(SOCIAL_CARD.pathname)
  })

  test('registers each root feed discovery type exactly once', async () => {
    const layoutSource = await Bun.file(new URL('../app/layout.tsx', import.meta.url)).text()
    expect(layoutSource.match(/application\/rss\+xml/g) ?? []).toHaveLength(1)
    expect(layoutSource.match(/application\/atom\+xml/g) ?? []).toHaveLength(1)
  })

  test('rejects external, query, fragment, duplicate-slash, trailing-slash, and unsafe metadata variants', () => {
    for (const path of ['https://attacker.invalid/', '//attacker.invalid', '/pricing?plan=x', '/pricing#plans', '/pricing/', '/pricing//x']) {
      expect(() => canonicalPublicUrl(path)).toThrow()
    }
    expect(canonicalPublicUrl('/pricing')).toBe('https://trimly.co.ke/pricing')
    expect(() => publicMetadata('', 'Valid description.', '/')).toThrow()
    expect(() => publicMetadata('Valid', 'x\u0000y', '/')).toThrow()
  })

  test('noindexes handoff, preview, search, missing, and withdrawn-like surfaces', () => {
    for (const path of ['/start', '/preview', '/search', '/experts/withdrawn']) {
      const value = publicMetadata('Unavailable', 'This public surface is unavailable.', path, true)
      expect(value.robots).toEqual({ index: false, follow: false })
    }
  })

  test('robots excludes private/noncanonical surfaces and advertises only segmented canonical sitemaps', () => {
    const value = robots()
    expect(value.rules).toEqual({ userAgent: '*', allow: '/', disallow: [...CRAWLER_EXCLUSIONS] })
    expect(value.sitemap).toEqual([
      'https://trimly.co.ke/sitemap/core.xml',
      'https://trimly.co.ke/sitemap/content.xml',
      'https://trimly.co.ke/sitemap/discovery.xml',
    ])
    expect(JSON.stringify(value)).not.toContain('/feeds/')
  })
})

describe('truthful schema.org JSON-LD', () => {
  test('validates website, article, template, expert, and breadcrumb schemas from owned sources', () => {
    const values = [
      [WebSiteStructuredDataSchema, websiteStructuredData()],
      [ArticleStructuredDataSchema, articleStructuredData(editorial)],
      [TemplateStructuredDataSchema, templateStructuredData(template)],
      [ExpertStructuredDataSchema, expertStructuredData(expert)],
      [BreadcrumbStructuredDataSchema, breadcrumbStructuredData([
        { label: 'Home', href: '/' },
        { label: expert.publicName, href: `/experts/${expert.slug}` },
      ])],
    ] as const
    for (const [schema, value] of values) expect(Value.Check(schema, value)).toBe(true)
    expect(articleStructuredData(editorial)).toEqual(expect.objectContaining({
      '@type': 'TechArticle',
      url: 'https://trimly.co.ke/docs/safe-entry',
    }))
    expect(templateStructuredData(template)).not.toHaveProperty('offers')
    expect(expertStructuredData(expert)).not.toHaveProperty('email')
  })

  test('rejects fabricated ratings/reviews, executable closing tags, non-JSON values, and excessive payloads', () => {
    for (const key of ['aggregateRating', 'review', 'reviewCount', 'testimonial']) {
      expect(() => serializeStructuredData({ '@context': 'https://schema.org', [key]: {} })).toThrow(/authority/)
    }
    const serialized = jsonLd({ '@context': 'https://schema.org', description: '</script><script>alert(1)</script>' }).__html
    expect(serialized).not.toContain('</script>')
    expect(serialized).toContain('\\u003c/script>')
    expect(() => serializeStructuredData({ value: new Date() })).toThrow(/plain JSON/)
    expect(() => serializeStructuredData({ value: 'x'.repeat(64_001) })).toThrow(/byte limit/)
    expect(() => serializeStructuredData({ value: '🙂'.repeat(20_000) })).toThrow(/byte limit/)
  })

  test('article metadata is article-shaped and unavailable editorial is noindex', () => {
    const available = editorialMetadata(editorial, editorial.canonicalPath, 'Unavailable')
    expect(available.openGraph?.type).toBe('article')
    expect(available.openGraph && 'publishedTime' in available.openGraph ? available.openGraph.publishedTime : null).toBe(editorial.meta.publishedAt)
    const missing = editorialMetadata(null, '/docs/missing', 'Documentation unavailable')
    expect(missing.robots).toEqual(expect.objectContaining({ index: false }))
  })
})

describe('segmented sitemaps, feeds, and authority withdrawal', () => {
  test('keeps core/content sitemap deterministic, complete, unique, and free of noindex routes', () => {
    const core = coreSitemap()
    const urls = core.map((item) => item.url)
    expect(urls).toEqual([...urls].sort())
    expect(new Set(urls).size).toBe(urls.length)
    expect(urls).toContain('https://trimly.co.ke/')
    for (const excluded of ['/start', '/search', '/preview', '/privacy-request', '/contract-demo']) {
      expect(urls).not.toContain(`https://trimly.co.ke${excluded}`)
    }
    expect(core.every((item) => item.lastModified === undefined)).toBe(true)

    const content = contentSitemap([editorial])
    expect(content).toEqual([expect.objectContaining({
      url: 'https://trimly.co.ke/docs/safe-entry',
      lastModified: new Date(editorial.meta.updatedAt),
    })])
  })

  test('includes only current approved discovery records and removes expert sitemap/schema state on withdrawal', () => {
    const before = discoverySitemap({ templates: [template], experts: [expert], showcases: [showcase], plugins: [plugin], components: [component] })
    expect(before.map((item) => item.url)).toEqual([
      'https://trimly.co.ke/components/reviewed-hero-pack',
      'https://trimly.co.ke/experts/amani-studio',
      'https://trimly.co.ke/plugins/reviewed-forms',
      'https://trimly.co.ke/showcase/amani-journal',
      'https://trimly.co.ke/templates/editorial-portfolio',
    ])
    const structuredBefore = expertStructuredData(expert)
    expect(structuredBefore.url).toBe('https://trimly.co.ke/experts/amani-studio')

    // The authority's post-withdrawal envelope contains no expert. Web has no fallback record.
    const afterAuthorityItems: readonly typeof expert[] = []
    const after = discoverySitemap({ templates: [template], experts: afterAuthorityItems, showcases: [showcase], plugins: [plugin], components: [component] })
    expect(after.map((item) => item.url)).not.toContain(structuredBefore.url)
    const detail = afterAuthorityItems.find((item) => item.slug === expert.slug)
    expect(detail).toBeUndefined()
    expect(detail ? expertStructuredData(detail) : null).toBeNull()
  })

  test('rejects sitemap collisions and over-limit segments rather than truncating', () => {
    expect(() => discoverySitemap({ templates: [], experts: [expert, expert], showcases: [], plugins: [], components: [] })).toThrow(/Duplicate sitemap URL/)
    const tooMany = Array.from({ length: SITEMAP_ENTRY_LIMIT + 1 }, (_, index) => ({
      ...editorial,
      canonicalPath: `/docs/entry-${index}`,
    }))
    expect(() => contentSitemap(tooMany)).toThrow(/exceeds/)
  })

  test('walks bounded authority cursors and fails closed on gaps or loops', async () => {
    const calls: Array<string | undefined> = []
    const values = await collectPublicPages(async (cursor) => {
      calls.push(cursor)
      if (!cursor) return { items: ['a'], hasMore: true, nextCursor: 'cursor-2' }
      return { items: ['b'], hasMore: false, nextCursor: null }
    })
    expect(values).toEqual(['a', 'b'])
    expect(calls).toEqual([undefined, 'cursor-2'])
    expect(await collectPublicPages(async () => ({ items: ['a'], hasMore: true, nextCursor: null }))).toBeNull()
    expect(await collectPublicPages(async () => ({ items: ['a'], hasMore: true, nextCursor: 'same' }))).toBeNull()
  })

  test('emits deterministic eligible RSS/Atom discovery with escaped content and no draft leakage', () => {
    const hostile = { ...editorial, meta: { ...editorial.meta, title: 'Safe & <reviewed>' } }
    const rss = generateRss([hostile], 'https://trimly.co.ke')
    const atom = generateAtom([hostile], 'https://trimly.co.ke')
    expect(rss).toStartWith('<?xml version="1.0" encoding="UTF-8"?><rss')
    expect(atom).toStartWith('<?xml version="1.0" encoding="UTF-8"?><feed')
    expect(rss).toContain('Safe &amp; &lt;reviewed&gt;')
    expect(atom).toContain('rel="self"')
    expect(generateRss([hostile], 'https://trimly.co.ke')).toBe(rss)
  })
})

describe('immutable social-card fallback', () => {
  test('renders an accessible deterministic app-owned card without external media or scripts', async () => {
    const markup = renderToStaticMarkup(SocialCard())
    expect(markup).toContain(SOCIAL_CARD.headline)
    expect(markup).toContain(SOCIAL_CARD.description)
    expect(markup).not.toMatch(/<img|<script|https?:\/\//)
    expect(markup).not.toMatch(/Nairobi|Kenya/i)
    const digest = new Bun.CryptoHasher('sha256').update(markup).digest('hex')
    expect(digest).toBe('2e0be01cf58a2c4117ee54f2b826b8c806f26a15c865cc679cd08edf5c919ba5')

    const response = socialCardResponse()
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(SOCIAL_CARD.pathname).toBe('/social/fuma-social-v1.png')
  })
})
