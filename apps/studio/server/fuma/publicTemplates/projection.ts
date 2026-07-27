import type { PublicProfile, PublicTemplate } from '@fuma/public-contracts'
import { PublicProjectionInvalidRequestError } from '../publicProjections/authority'
import type { ApprovedPublicProjectionSource } from '../publicProjections/adapters/validatedDomainAdapter'
import type { PublicTemplateCatalogService, TemplateDiscoveryFilter } from './service'

const DEFAULT_PAGE_SIZE = 24
const MAX_PAGE_SIZE = 100

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

async function datasetVersion(value: unknown): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value))))
  return `templates:sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function limit(query: Readonly<Record<string, string | number>>): number {
  const value = query.limit ?? DEFAULT_PAGE_SIZE
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new PublicProjectionInvalidRequestError('Invalid template page limit.')
  }
  return value
}

function offset(query: Readonly<Record<string, string | number>>, version: string, count: number): number {
  if (query.cursor === undefined) return 0
  if (typeof query.cursor !== 'string') throw new PublicProjectionInvalidRequestError('Invalid template cursor.')
  const match = /^t_([0-9]{1,10})_([a-f0-9]{16})$/.exec(query.cursor)
  const value = match ? Number(match[1]) : Number.NaN
  if (!match || match[2] !== version.slice(-16) || !Number.isSafeInteger(value) || value < 1 || value >= count) {
    throw new PublicProjectionInvalidRequestError('Invalid or stale template cursor.')
  }
  return value
}

function filter(query: Readonly<Record<string, string | number>>): TemplateDiscoveryFilter {
  return Object.freeze({
    ...(typeof query.profile === 'string' ? { profile: query.profile as PublicProfile } : {}),
    ...(typeof query.capability === 'string' ? { capability: query.capability } : {}),
    ...(typeof query.industry === 'string' ? { industry: query.industry } : {}),
    ...(typeof query.style === 'string' ? { style: query.style } : {}),
    ...(typeof query.slug === 'string' ? { slug: query.slug } : {}),
  })
}

export class ApprovedTemplatesProjectionSource implements ApprovedPublicProjectionSource {
  private readonly catalog: Pick<PublicTemplateCatalogService, 'projectionSnapshot'>
  constructor(catalog: Pick<PublicTemplateCatalogService, 'projectionSnapshot'>) { this.catalog = catalog }

  async readApprovedDisplayPage(query: Readonly<Record<string, string | number>>) {
    const { material, discovery } = await this.catalog.projectionSnapshot(filter(query))
    const version = await datasetVersion(material)
    const start = offset(query, version, discovery.items.length)
    const pageSize = limit(query)
    const items: readonly PublicTemplate[] = discovery.items.slice(start, start + pageSize)
    const next = start + items.length
    return Object.freeze({
      datasetVersion: version,
      data: Object.freeze({
        items: Object.freeze(items),
        tombstones: Object.freeze(discovery.tombstones),
        page: next < discovery.items.length
          ? Object.freeze({ hasMore: true as const, nextCursor: `t_${next}_${version.slice(-16)}` })
          : Object.freeze({ hasMore: false as const, nextCursor: null }),
      }),
    })
  }
}
