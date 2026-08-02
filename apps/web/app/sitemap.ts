import type { MetadataRoute } from 'next'
import { readEditorial } from '@/lib/editorial'
import { readPublicData } from '@/lib/public-data'
import {
  collectPublicPages,
  contentSitemap,
  coreSitemap,
  discoverySitemap,
} from '@/lib/sitemaps'

export const dynamic = 'force-dynamic'

export async function generateSitemaps() {
  return [{ id: 'core' }, { id: 'content' }, { id: 'discovery' }]
}

export default async function sitemap({ id }: { id: string }): Promise<MetadataRoute.Sitemap> {
  if (id === 'core') return coreSitemap()
  if (id === 'content') return contentSitemap(await readEditorial())
  if (id !== 'discovery') return []

  const [templates, experts, showcases, plugins, components] = await Promise.all([
    collectPublicPages(async (cursor) => {
      const envelope = await readPublicData('templates', { limit: 100, cursor })
      return envelope ? {
        items: envelope.data.items,
        hasMore: envelope.data.page.hasMore,
        nextCursor: envelope.data.page.nextCursor,
      } : null
    }),
    collectPublicPages(async (cursor) => {
      const envelope = await readPublicData('experts', { limit: 100, cursor })
      return envelope ? {
        items: envelope.data.items,
        hasMore: envelope.data.page.hasMore,
        nextCursor: envelope.data.page.nextCursor,
      } : null
    }),
    collectPublicPages(async (cursor) => {
      const envelope = await readPublicData('showcases', { limit: 100, cursor })
      return envelope ? {
        items: envelope.data.items,
        hasMore: envelope.data.page.hasMore,
        nextCursor: envelope.data.page.nextCursor,
      } : null
    }),
    collectPublicPages(async (cursor) => {
      const envelope = await readPublicData('plugins', { limit: 100, cursor })
      return envelope ? {
        items: envelope.data.items,
        hasMore: envelope.data.page.hasMore,
        nextCursor: envelope.data.page.nextCursor,
      } : null
    }),
    collectPublicPages(async (cursor) => {
      const envelope = await readPublicData('components', { limit: 100, cursor })
      return envelope ? {
        items: envelope.data.items,
        hasMore: envelope.data.page.hasMore,
        nextCursor: envelope.data.page.nextCursor,
      } : null
    }),
  ])

  return discoverySitemap({
    templates: templates ?? [],
    experts: experts ?? [],
    showcases: showcases ?? [],
    plugins: plugins ?? [],
    components: components ?? [],
  })
}
