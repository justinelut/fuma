import {
  PublicTemplatesQuerySchema,
  type PublicTemplate,
  type PublicTemplateTombstone,
} from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import { readPublicData } from './public-data'

export const TEMPLATE_PREVIEW_HOST = 'templates.preview.fuma.co.ke' as const
export const TEMPLATE_IMAGE_BUDGET_BYTES = 300_000 as const

export type CanonicalTemplateFilters = Readonly<{
  profile?: 'website' | 'publication'
  capability?: string
  industry?: string
  style?: string
  cursor?: string
}>

const TAG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function canonicalTemplateFilters(raw: Readonly<Record<string, string | string[] | undefined>>): CanonicalTemplateFilters {
  const profileValue = scalar(raw.profile)
  const profile = profileValue === 'website' || profileValue === 'publication' ? profileValue : undefined
  const tag = (value: string | string[] | undefined) => {
    const candidate = scalar(value)
    return candidate && TAG.test(candidate) ? candidate : undefined
  }
  const cursorValue = scalar(raw.cursor)
  return Object.freeze({
    ...(profile ? { profile } : {}),
    ...(tag(raw.capability) ? { capability: tag(raw.capability) } : {}),
    ...(tag(raw.industry) ? { industry: tag(raw.industry) } : {}),
    ...(tag(raw.style) ? { style: tag(raw.style) } : {}),
    ...(cursorValue && CURSOR.test(cursorValue) ? { cursor: cursorValue } : {}),
  })
}

export function exactTemplatePreview(item: PublicTemplate): boolean {
  try {
    const preview = new URL(item.previewUrl)
    const image = new URL(item.image.url, preview)
    const releasePrefix = `/releases/${item.releaseId}/`
    return preview.protocol === 'https:'
      && preview.hostname === TEMPLATE_PREVIEW_HOST
      && preview.pathname === releasePrefix
      && preview.username === '' && preview.password === '' && preview.search === '' && preview.hash === ''
      && image.protocol === 'https:' && image.hostname === TEMPLATE_PREVIEW_HOST
      && image.pathname.startsWith(releasePrefix)
      && image.username === '' && image.password === '' && image.search === '' && image.hash === ''
      && item.image.byteSize <= TEMPLATE_IMAGE_BUDGET_BYTES
      && item.sitemapEligible === true
  } catch {
    return false
  }
}

export function installTemplateHref(templateId: string): string {
  return `/start?kind=use_template&source=template&templateId=${encodeURIComponent(templateId)}`
}

export type TemplateDetailResult =
  | Readonly<{ status: 'available'; item: PublicTemplate }>
  | Readonly<{ status: 'withdrawn'; tombstone: PublicTemplateTombstone }>
  | Readonly<{ status: 'missing' | 'unavailable' }>

export async function readTemplateDetail(slug: string): Promise<TemplateDetailResult> {
  if (!TAG.test(slug) || !Value.Check(PublicTemplatesQuerySchema, { slug, limit: 1 })) return Object.freeze({ status: 'missing' })
  const envelope = await readPublicData('templates', { slug, limit: 1 })
  if (!envelope) return Object.freeze({ status: 'unavailable' })
  const item = envelope.data.items.find((candidate) => candidate.slug === slug && exactTemplatePreview(candidate))
  if (item) return Object.freeze({ status: 'available', item })
  const tombstone = envelope.data.tombstones.find((candidate) => candidate.slug === slug)
  return tombstone
    ? Object.freeze({ status: 'withdrawn', tombstone })
    : Object.freeze({ status: 'missing' })
}

export function templateSitemapEligible(item: PublicTemplate): boolean {
  return exactTemplatePreview(item)
}

export function templateSitemapRows(items: readonly PublicTemplate[]) {
  return items.filter(templateSitemapEligible).map((item) => Object.freeze({
    path: `/templates/${item.slug}`,
    lastModified: item.updatedAt,
  }))
}
