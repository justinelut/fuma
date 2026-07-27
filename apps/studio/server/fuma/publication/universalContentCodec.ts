import {
  PublicationContentSchema,
  PublicationSettingsSchema,
  PublicationTagSchema,
  parsePublicationContract,
  type PublicationContent,
  type PublicationSettings,
  type PublicationTag,
} from '@core/fuma/publication'
import type { PublicationRepositoryScope } from './scope'

export interface UniversalRow {
  id: string
  table_id: string
  cells_json: unknown
  slug: string
  status: string
  created_at: string | Date
  updated_at: string | Date
  published_at: string | Date | null
}

export interface RelationRow {
  source_row_id: string
  relation_kind: 'author' | 'tag'
  target_id: string
  target_row_id: string | null
  position: string | number | bigint
  is_primary: boolean
}

export type JsonRecord = Record<string, unknown>
export type ContentRelations = Map<string, { authorIds: string[]; tagIds: string[]; primaryTagId: string | null }>

function parsedJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : structuredClone(value)
}

export function record(value: unknown): JsonRecord {
  const parsed = parsedJson(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Stored Publication row is not an object.')
  return parsed as JsonRecord
}

export function integer(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Stored Publication integer is invalid.')
  return parsed
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Stored Publication timestamp is invalid.')
  return value
}

function nullableTimestamp(value: unknown): string | null {
  if (value === null) return null
  return timestamp(value)
}

export function relationMap(rows: readonly RelationRow[]): ContentRelations {
  const result: ContentRelations = new Map()
  for (const relation of [...rows].sort((left, right) => integer(left.position) - integer(right.position))) {
    const current = result.get(relation.source_row_id) ?? { authorIds: [], tagIds: [], primaryTagId: null }
    if (relation.relation_kind === 'author') current.authorIds.push(relation.target_id)
    else {
      current.tagIds.push(relation.target_id)
      if (relation.is_primary) current.primaryTagId = relation.target_id
    }
    result.set(relation.source_row_id, current)
  }
  return result
}

export function contentFromRow(row: UniversalRow, relations: ContentRelations): PublicationContent {
  const cells = record(row.cells_json)
  const relation = relations.get(row.id) ?? { authorIds: [], tagIds: [], primaryTagId: null }
  return parsePublicationContract('stored universal content', PublicationContentSchema, {
    contentId: cells.publicationId,
    kind: cells.publicationKind,
    metadata: {
      title: cells.title,
      slug: row.slug,
      excerpt: cells.excerpt,
      canonicalUrl: cells.canonicalUrl ?? null,
      redirects: cells.redirects ?? [],
      openGraph: cells.openGraph ?? { title: null, description: null, imageId: null, type: cells.publicationKind === 'post' ? 'article' : 'website' },
      social: cells.social ?? { title: null, description: null, imageId: null, card: 'summary-large-image' },
      visibility: cells.visibility ?? { kind: 'public' },
      featureImageId: cells.featureImageId ?? null,
      seoTitle: cells.seoTitle ?? null,
      seoDescription: cells.seoDescription ?? null,
      tagIds: relation.tagIds,
      primaryTagId: relation.primaryTagId,
      authorIds: relation.authorIds,
    },
    document: cells.visualDocument,
    status: cells.workflowStatus,
    workflowVersion: integer(cells.workflowVersion),
    scheduledAt: nullableTimestamp(cells.scheduledAt),
    publishedAt: nullableTimestamp(cells.publishedAt),
    createdAt: timestamp(cells.createdAt),
    updatedAt: timestamp(cells.updatedAt),
  })
}

export function contentCells(scope: PublicationRepositoryScope, value: PublicationContent): JsonRecord {
  return {
    publicationProfileId: scope.profileId,
    publicationId: value.contentId,
    publicationKind: value.kind,
    title: value.metadata.title,
    excerpt: value.metadata.excerpt,
    canonicalUrl: value.metadata.canonicalUrl,
    redirects: value.metadata.redirects,
    openGraph: value.metadata.openGraph,
    social: value.metadata.social,
    visibility: value.metadata.visibility,
    featureImageId: value.metadata.featureImageId,
    seoTitle: value.metadata.seoTitle,
    seoDescription: value.metadata.seoDescription,
    visualDocument: value.document,
    workflowStatus: value.status,
    workflowVersion: value.workflowVersion,
    scheduledAt: value.scheduledAt,
    publishedAt: value.publishedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

export function tagFromRow(row: UniversalRow): PublicationTag {
  const cells = record(row.cells_json)
  return parsePublicationContract('stored universal tag', PublicationTagSchema, {
    tagId: cells.publicationId,
    name: cells.name,
    slug: row.slug,
    description: cells.description,
  })
}

export function settingsFromRow(row: UniversalRow): PublicationSettings {
  const cells = record(row.cells_json)
  return parsePublicationContract('stored universal Publication settings', PublicationSettingsSchema, {
    publicationId: cells.publicationId,
    name: cells.name,
    description: cells.description,
    language: cells.language,
    timezone: cells.timezone,
    version: integer(cells.version),
    updatedAt: timestamp(cells.updatedAt),
  })
}
