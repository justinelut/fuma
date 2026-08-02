import type { PublicProjectionResource } from '@fuma/public-contracts'
import { PublicProjectionInvalidRequestError } from './authority'

export const PUBLIC_DISCOVERY_PAGE_SIZE = 24

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

export async function publicDatasetVersion(resource: PublicProjectionResource, value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `${resource}:sha256:${[...digest].map((item) => item.toString(16).padStart(2, '0')).join('')}`
}

function pageLimit(query: Readonly<Record<string, string | number>>): number {
  const limit = query.limit ?? PUBLIC_DISCOVERY_PAGE_SIZE
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new PublicProjectionInvalidRequestError('Invalid public projection limit.')
  }
  return limit
}

function cursorFor(offset: number, datasetVersion: string): string {
  return `p_${offset}_${datasetVersion.slice(-16)}`
}

function cursorOffset(query: Readonly<Record<string, string | number>>, datasetVersion: string, itemCount: number): number {
  const cursor = query.cursor
  if (cursor === undefined) return 0
  if (typeof cursor !== 'string') throw new PublicProjectionInvalidRequestError('Invalid public projection cursor.')
  const match = /^p_([0-9]{1,10})_([a-f0-9]{16})$/.exec(cursor)
  const offset = match ? Number(match[1]) : Number.NaN
  if (!match || match[2] !== datasetVersion.slice(-16) || !Number.isSafeInteger(offset) || offset < 1 || offset >= itemCount) {
    throw new PublicProjectionInvalidRequestError('Invalid or stale public projection cursor.')
  }
  return offset
}

export async function paginatePublicDiscovery<T>(input: Readonly<{
  resource: PublicProjectionResource
  allItems: readonly T[]
  filteredItems: readonly T[]
  facets: unknown
  query: Readonly<Record<string, string | number>>
}>): Promise<Readonly<{ datasetVersion: string; data: Readonly<{ items: readonly T[]; facets: unknown; page: Readonly<{ hasMore: true; nextCursor: string } | { hasMore: false; nextCursor: null }> }> }>> {
  const datasetVersion = await publicDatasetVersion(input.resource, { items: input.allItems, facets: input.facets })
  const offset = cursorOffset(input.query, datasetVersion, input.filteredItems.length)
  const items = input.filteredItems.slice(offset, offset + pageLimit(input.query))
  const nextOffset = offset + items.length
  const page = nextOffset < input.filteredItems.length
    ? { hasMore: true as const, nextCursor: cursorFor(nextOffset, datasetVersion) }
    : { hasMore: false as const, nextCursor: null }
  return Object.freeze({
    datasetVersion,
    data: Object.freeze({ items: Object.freeze(items), facets: input.facets, page: Object.freeze(page) }),
  })
}

export function boundedSearchMatch(query: unknown, values: readonly string[]): boolean {
  if (query === undefined) return true
  if (typeof query !== 'string') return false
  const terms = query.toLocaleLowerCase('en-KE').trim().split(/\s+/).filter(Boolean)
  const haystack = values.join(' ').toLocaleLowerCase('en-KE')
  return terms.length > 0 && terms.every((term) => haystack.includes(term))
}

export function sortedUnique(values: readonly string[], maximum: number): readonly string[] {
  return Object.freeze([...new Set(values)].sort((left, right) => left.localeCompare(right)).slice(0, maximum))
}
