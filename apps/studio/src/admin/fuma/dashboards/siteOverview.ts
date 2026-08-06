/**
 * Site overview readers.
 *
 * The builder already measures storage, pages, posts, media and plugins for the
 * site it builds. The platform dashboard presents those measurements rather than
 * recounting anything, so there is one number for each fact.
 *
 * Contracts are TypeBox, matching every other untyped boundary in this
 * repository. A reader that fails or is unavailable resolves to `null` and the
 * surface says so instead of showing a zero that looks like real data.
 */
import { apiRequest } from '@core/http'
import { Type, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const CMS_DASHBOARD = '/admin/api/cms/dashboard'

export const StorageStatsSchema = Type.Object({
  imageBytes: Type.Number(),
  videoBytes: Type.Number(),
  documentBytes: Type.Number(),
  pluginBytes: Type.Number(),
  databaseBytes: Type.Number(),
  totalBytes: Type.Number(),
  dialect: Type.String(),
}, { additionalProperties: true })
export type StorageStats = Static<typeof StorageStatsSchema>

export const PagesStatsSchema = Type.Object({
  total: Type.Number(),
  published: Type.Number(),
  drafts: Type.Number(),
  scheduled: Type.Number(),
  deltaPublishedThisWeek: Type.Number(),
}, { additionalProperties: true })
export type PagesStats = Static<typeof PagesStatsSchema>

export const PostsStatsSchema = Type.Object({
  total: Type.Number(),
  categories: Type.Number(),
  scheduled: Type.Number(),
  daily28: Type.Array(Type.Number()),
}, { additionalProperties: true })
export type PostsStats = Static<typeof PostsStatsSchema>

export const MediaStatsSchema = Type.Object({
  count: Type.Number(),
  totalBytes: Type.Number(),
}, { additionalProperties: true })
export type MediaStats = Static<typeof MediaStatsSchema>

export type SiteOverview = Readonly<{
  storage: StorageStats | null
  pages: PagesStats | null
  posts: PostsStats | null
  media: MediaStats | null
}>

export const EMPTY_SITE_OVERVIEW: SiteOverview = Object.freeze({
  storage: null,
  pages: null,
  posts: null,
  media: null,
})

async function read<S extends TSchema>(
  path: string,
  schema: S,
): Promise<Static<S> | null> {
  try {
    return await apiRequest(path, { schema })
  } catch {
    // A reader the caller is not entitled to, or one that failed, is reported
    // as unavailable rather than as zero.
    return null
  }
}

export async function readSiteOverview(): Promise<SiteOverview> {
  const [storage, pages, posts, media] = await Promise.all([
    read(`${CMS_DASHBOARD}/storage`, StorageStatsSchema),
    read(`${CMS_DASHBOARD}/pages`, PagesStatsSchema),
    read(`${CMS_DASHBOARD}/posts`, PostsStatsSchema),
    read(`${CMS_DASHBOARD}/media`, MediaStatsSchema),
  ])
  return Object.freeze({ storage, pages, posts, media })
}

export function formatBytes(value: number | null): string {
  if (value === null) return '—'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let scaled = value / 1024
  let unit = 0
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024
    unit += 1
  }
  return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1)} ${units[unit]}`
}
