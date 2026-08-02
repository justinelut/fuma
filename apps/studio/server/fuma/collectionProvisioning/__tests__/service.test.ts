import { describe, expect, it } from 'bun:test'
import type { DataField, DataTable } from '@core/data/schemas'
import { CollectionProvisioningService, type CollectionStore } from '../service'
import { RESERVED_COLLECTION_SLUGS } from '../contracts'

function table(overrides: Partial<DataTable> & Pick<DataTable, 'id' | 'slug'>): DataTable {
  return {
    name: overrides.slug,
    kind: 'data',
    singularLabel: overrides.slug,
    pluralLabel: overrides.slug,
    routeBase: '',
    primaryFieldId: 'title',
    fields: [],
    system: false,
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  } as DataTable
}

class MemoryCollectionStore implements CollectionStore {
  readonly tables = new Map<string, DataTable>()
  #next = 0

  constructor(seed: readonly DataTable[] = []) {
    for (const entry of seed) this.tables.set(entry.slug, entry)
  }

  async listCollections(): Promise<readonly DataTable[]> {
    return [...this.tables.values()]
  }

  async getCollectionBySlug(slug: string): Promise<DataTable | null> {
    return this.tables.get(slug) ?? null
  }

  async createCollection(input: Parameters<CollectionStore['createCollection']>[0]): Promise<DataTable> {
    this.#next += 1
    const created = table({
      id: `tbl_${this.#next}`,
      slug: input.slug,
      name: input.name,
      kind: input.kind,
      routeBase: input.routeBase,
      singularLabel: input.singularLabel,
      pluralLabel: input.pluralLabel,
      primaryFieldId: input.primaryFieldId,
      fields: [...input.fields] as DataField[],
    })
    this.tables.set(created.slug, created)
    return created
  }

  async updateCollectionFields(collectionId: string, fields: readonly DataField[]): Promise<DataTable | null> {
    for (const [slug, entry] of this.tables) {
      if (entry.id !== collectionId) continue
      const updated = { ...entry, fields: [...fields] } as DataTable
      this.tables.set(slug, updated)
      return updated
    }
    return null
  }
}

const servicesRequest = {
  slug: 'services',
  name: 'Services',
  singularLabel: 'Service',
  pluralLabel: 'Services',
  shape: 'content' as const,
  primaryFieldId: 'title',
  fields: [
    { id: 'title', label: 'Title', type: 'text' as const, required: true },
    { id: 'summary', label: 'Summary', type: 'longText' as const },
    { id: 'body', label: 'Details', type: 'richText' as const, format: 'markdown' as const },
    { id: 'fromPrice', label: 'From price', type: 'number' as const, format: 'currency' as const, currency: 'KES' as const },
    { id: 'featured', label: 'Featured', type: 'boolean' as const },
    { id: 'heroImage', label: 'Hero image', type: 'media' as const, mediaKind: 'image' as const },
  ],
}

describe('collection provisioning', () => {
  it('provisions a routable content collection in the universal model', async () => {
    const store = new MemoryCollectionStore()
    const service = new CollectionProvisioningService(store)
    const result = await service.provision(servicesRequest)

    expect(result.slug).toBe('services')
    expect(result.shape).toBe('content')
    expect(result.routeBase).toBe('/services')
    expect(result.alreadyExisted).toBe(false)
    expect(result.fieldIds).toEqual(['title', 'summary', 'body', 'fromPrice', 'featured', 'heroImage'])
    expect(store.tables.get('services')?.kind).toBe('postType')
  })

  it('provisions a non-routable record collection', async () => {
    const store = new MemoryCollectionStore()
    const service = new CollectionProvisioningService(store)
    const result = await service.provision({
      ...servicesRequest,
      slug: 'testimonials',
      name: 'Testimonials',
      singularLabel: 'Testimonial',
      pluralLabel: 'Testimonials',
      shape: 'records',
      primaryFieldId: 'author',
      fields: [
        { id: 'author', label: 'Author', type: 'text', required: true },
        { id: 'quote', label: 'Quote', type: 'longText', required: true },
      ],
    })
    expect(result.shape).toBe('records')
    expect(result.routeBase).toBe('')
    expect(store.tables.get('testimonials')?.kind).toBe('data')
  })

  it('is idempotent when the same collection is provisioned twice', async () => {
    const store = new MemoryCollectionStore()
    const service = new CollectionProvisioningService(store)
    const first = await service.provision(servicesRequest)
    const second = await service.provision(servicesRequest)
    expect(second.alreadyExisted).toBe(true)
    expect(second.collectionId).toBe(first.collectionId)
    expect(store.tables.size).toBe(1)
  })

  it('refuses every reserved Fuma collection slug', async () => {
    const service = new CollectionProvisioningService(new MemoryCollectionStore())
    for (const slug of RESERVED_COLLECTION_SLUGS) {
      await expect(service.provision({ ...servicesRequest, slug })).rejects.toThrow(/reserved/)
    }
  })

  it('refuses a protected system collection even under a non-reserved slug', async () => {
    const store = new MemoryCollectionStore([table({ id: 'tbl_sys', slug: 'team', system: true })])
    const service = new CollectionProvisioningService(store)
    await expect(service.provision({ ...servicesRequest, slug: 'team' })).rejects.toThrow(/system collection/)
  })

  it('refuses to change an existing collection shape', async () => {
    const store = new MemoryCollectionStore()
    const service = new CollectionProvisioningService(store)
    await service.provision(servicesRequest)
    await expect(service.provision({ ...servicesRequest, shape: 'records' })).rejects.toThrow(/cannot be recreated/)
  })

  it('rejects structural editor field types and unknown types', async () => {
    const service = new CollectionProvisioningService(new MemoryCollectionStore())
    for (const type of ['pageTree', 'fieldSchema', 'password', 'json']) {
      await expect(service.provision({
        ...servicesRequest,
        fields: [{ id: 'title', label: 'Title', type }],
      })).rejects.toThrow(/strict validation/)
    }
  })

  it('rejects a primary field that is missing or not readable', async () => {
    const service = new CollectionProvisioningService(new MemoryCollectionStore())
    await expect(service.provision({ ...servicesRequest, primaryFieldId: 'nope' }))
      .rejects.toThrow(/not one of the declared fields/)
    await expect(service.provision({
      ...servicesRequest,
      primaryFieldId: 'heroImage',
    })).rejects.toThrow(/readable scalar field/)
  })

  it('rejects duplicate field ids and malformed identifiers', async () => {
    const service = new CollectionProvisioningService(new MemoryCollectionStore())
    await expect(service.provision({
      ...servicesRequest,
      fields: [
        { id: 'title', label: 'Title', type: 'text' },
        { id: 'title', label: 'Title again', type: 'text' },
      ],
    })).rejects.toThrow(/duplicated/)
    await expect(service.provision({
      ...servicesRequest,
      fields: [{ id: 'Title-With-Dashes', label: 'Bad', type: 'text' }],
    })).rejects.toThrow(/strict validation/)
  })

  it('resolves relations by slug and refuses unknown targets', async () => {
    const store = new MemoryCollectionStore()
    const service = new CollectionProvisioningService(store)
    await service.provision(servicesRequest)
    const result = await service.provision({
      slug: 'case-studies',
      name: 'Case studies',
      singularLabel: 'Case study',
      pluralLabel: 'Case studies',
      shape: 'content',
      primaryFieldId: 'title',
      fields: [
        { id: 'title', label: 'Title', type: 'text', required: true },
        { id: 'service', label: 'Service', type: 'relation', targetCollectionSlug: 'services' },
      ],
    })
    expect(result.fieldIds).toContain('service')
    const stored = store.tables.get('case-studies')?.fields.find((field) => field.id === 'service')
    // The stored field carries a real table id; the caller never supplied one.
    expect(stored).toMatchObject({ type: 'relation', targetTableId: 'tbl_1' })
    expect(stored).not.toHaveProperty('targetCollectionSlug')

    await expect(service.provision({
      slug: 'awards',
      name: 'Awards',
      singularLabel: 'Award',
      pluralLabel: 'Awards',
      shape: 'records',
      primaryFieldId: 'title',
      fields: [
        { id: 'title', label: 'Title', type: 'text' },
        { id: 'missing', label: 'Missing', type: 'relation', targetCollectionSlug: 'nowhere' },
      ],
    })).rejects.toThrow(/unknown collection/)
  })

  it('rejects a caller-supplied raw table id', async () => {
    const service = new CollectionProvisioningService(new MemoryCollectionStore())
    await expect(service.provision({
      ...servicesRequest,
      fields: [
        { id: 'title', label: 'Title', type: 'text' },
        { id: 'rel', label: 'Rel', type: 'relation', targetTableId: 'tbl_secret' },
      ],
    })).rejects.toThrow(/strict validation/)
  })

  it('bounds field counts and select options', async () => {
    const service = new CollectionProvisioningService(new MemoryCollectionStore())
    const many = Array.from({ length: 41 }, (_, index) => ({
      id: `f${index}`, label: `F${index}`, type: 'text' as const,
    }))
    await expect(service.provision({ ...servicesRequest, primaryFieldId: 'f0', fields: many }))
      .rejects.toThrow(/strict validation/)
    await expect(service.provision({
      ...servicesRequest,
      fields: [
        { id: 'title', label: 'Title', type: 'text' },
        {
          id: 'tags', label: 'Tags', type: 'multiSelect',
          options: Array.from({ length: 41 }, (_, i) => ({ value: `v${i}`, label: `V${i}` })),
        },
      ],
    })).rejects.toThrow(/strict validation/)
  })
})

describe('collection extension', () => {
  async function seeded() {
    const store = new MemoryCollectionStore()
    const service = new CollectionProvisioningService(store)
    await service.provision(servicesRequest)
    return { store, service }
  }

  it('adds new fields additively', async () => {
    const { store, service } = await seeded()
    const result = await service.extend({
      slug: 'services',
      addFields: [{ id: 'duration', label: 'Duration', type: 'text' }],
    })
    expect(result.addedFieldIds).toEqual(['duration'])
    expect(result.unchangedFieldIds).toEqual([])
    expect(result.totalFieldCount).toBe(7)
    expect(store.tables.get('services')?.fields.map((f) => f.id)).toContain('duration')
  })

  it('is idempotent for an identical repeat request', async () => {
    const { service } = await seeded()
    const payload = { slug: 'services', addFields: [{ id: 'duration', label: 'Duration', type: 'text' as const }] }
    await service.extend(payload)
    const second = await service.extend(payload)
    expect(second.addedFieldIds).toEqual([])
    expect(second.unchangedFieldIds).toEqual(['duration'])
    expect(second.totalFieldCount).toBe(7)
  })

  it('refuses a retype or relabel of a live field as destructive', async () => {
    const { service } = await seeded()
    await expect(service.extend({
      slug: 'services',
      addFields: [{ id: 'summary', label: 'Summary', type: 'number' }],
    })).rejects.toThrow(/destructive/)
    await expect(service.extend({
      slug: 'services',
      addFields: [{ id: 'summary', label: 'Renamed summary', type: 'longText' }],
    })).rejects.toThrow(/destructive/)
  })

  it('has no capability to drop a field at all', async () => {
    const { service } = await seeded()
    // The contract exposes only `addFields`; a removal request cannot be expressed.
    await expect(service.extend({ slug: 'services', removeFields: ['summary'] }))
      .rejects.toThrow(/strict validation/)
    await expect(service.extend({ slug: 'services', addFields: [] }))
      .rejects.toThrow(/strict validation/)
  })

  it('refuses unknown, reserved and system collections', async () => {
    const store = new MemoryCollectionStore([table({ id: 'tbl_sys', slug: 'team', system: true })])
    const service = new CollectionProvisioningService(store)
    const addFields = [{ id: 'x', label: 'X', type: 'text' as const }]
    await expect(service.extend({ slug: 'ghost', addFields })).rejects.toThrow(/does not exist/)
    await expect(service.extend({ slug: 'posts', addFields })).rejects.toThrow(/reserved/)
    await expect(service.extend({ slug: 'team', addFields })).rejects.toThrow(/system collection/)
  })

  it('enforces the bounded total field limit across extensions', async () => {
    const { service } = await seeded()
    const addFields = Array.from({ length: 35 }, (_, index) => ({
      id: `extra${index}`, label: `Extra ${index}`, type: 'text' as const,
    }))
    await expect(service.extend({ slug: 'services', addFields })).rejects.toThrow(/bounded field limit/)
  })
})

describe('collection description', () => {
  it('projects only provisionable fields and marks system collections read-only', async () => {
    const store = new MemoryCollectionStore([
      table({
        id: 'tbl_posts', slug: 'posts', name: 'Posts', kind: 'postType', system: true,
        routeBase: '/posts', primaryFieldId: 'title',
        fields: [
          { id: 'title', label: 'Title', type: 'text', builtIn: true },
          { id: 'tree', label: 'Tree', type: 'pageTree' },
        ] as DataField[],
      }),
    ])
    const service = new CollectionProvisioningService(store)
    await service.provision(servicesRequest)
    const described = await service.describe({ limit: 50 })

    const posts = described.collections.find((entry) => entry.slug === 'posts')
    expect(posts?.shape).toBe('system')
    expect(posts?.editable).toBe(false)
    // The structural pageTree field is never exposed.
    expect(posts?.fields.map((field) => field.id)).toEqual(['title'])

    const services = described.collections.find((entry) => entry.slug === 'services')
    expect(services?.shape).toBe('content')
    expect(services?.editable).toBe(true)
    expect(services?.fields.find((field) => field.id === 'title')?.required).toBe(true)
  })

  it('bounds the described collection count', async () => {
    const store = new MemoryCollectionStore(
      Array.from({ length: 5 }, (_, index) => table({ id: `tbl_${index}`, slug: `c${index}` })),
    )
    const service = new CollectionProvisioningService(store)
    const described = await service.describe({ limit: 2 })
    expect(described.collections).toHaveLength(2)
    await expect(service.describe({ limit: 0 })).rejects.toThrow(/strict validation/)
  })
})
